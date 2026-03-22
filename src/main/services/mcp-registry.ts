/**
 * MCP Registry Service — manages MCP server inventory, profiles, health checks,
 * and per-session resolution.
 */

import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  getMcpServers,
  getMcpServer,
  getMcpServerByName,
  insertMcpServer,
  updateMcpServer as dbUpdateMcpServer,
  deleteMcpServer,
  toggleMcpServer as dbToggleMcpServer,
  getMcpProfiles,
  getMcpProfile,
  insertMcpProfile,
  updateMcpProfile as dbUpdateMcpProfile,
  deleteMcpProfile,
  setDefaultMcpProfile,
  attachSessionMcps,
  updateSessionMcpStatus,
  getSessionMcps,
  saveMcpDiscovery,
  getMcpCachedTools,
  getMcpServerMetadataById,
  getAllMcpServerMetadata,
} from './db';
import type { McpServerRecord, McpHealthResult, McpToolEntry, McpServerMetadata } from '../../shared/types';

// ─── CRUD Wrappers ───

export function listServers() {
  return getMcpServers();
}

export function getServer(id: string) {
  return getMcpServer(id);
}

export function addServer(opts: { name: string; command: string; args?: string[]; env?: Record<string, string> }) {
  const id = randomUUID();
  insertMcpServer({ id, ...opts, source: 'zeus' });
  return getMcpServer(id);
}

export function updateServer(id: string, updates: { name?: string; command?: string; args?: string[]; env?: Record<string, string>; enabled?: boolean }) {
  dbUpdateMcpServer(id, updates);
  return getMcpServer(id);
}

export function removeServer(id: string) {
  deleteMcpServer(id);
}

export function toggleServer(id: string, enabled: boolean) {
  dbToggleMcpServer(id, enabled);
  return getMcpServer(id);
}

// ─── Profiles ───

export function listProfiles() {
  return getMcpProfiles();
}

export function getProfileById(id: string) {
  return getMcpProfile(id);
}

export function createProfile(opts: { name: string; description?: string; serverIds: string[] }) {
  const id = randomUUID();
  insertMcpProfile({ id, ...opts });
  return getMcpProfile(id);
}

export function updateProfile(id: string, updates: { name?: string; description?: string; serverIds?: string[] }) {
  dbUpdateMcpProfile(id, updates);
  return getMcpProfile(id);
}

export function removeProfile(id: string) {
  deleteMcpProfile(id);
}

export function setDefault(id: string) {
  setDefaultMcpProfile(id);
}

// ─── Import from Claude Config ───

export function importFromClaude(): { imported: string[]; skipped: string[] } {
  const configPath = path.join(os.homedir(), '.claude', 'mcp.json');
  const imported: string[] = [];
  const skipped: string[] = [];

  if (!fs.existsSync(configPath)) {
    return { imported, skipped };
  }

  let config: { mcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }> };
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return { imported, skipped };
  }

  if (!config.mcpServers) return { imported, skipped };

  for (const [name, serverDef] of Object.entries(config.mcpServers)) {
    // Skip zeus-bridge — always injected automatically
    if (name === 'zeus-bridge') {
      skipped.push(name);
      continue;
    }

    const existing = getMcpServerByName(name);
    if (existing) {
      skipped.push(name);
      continue;
    }

    const id = randomUUID();
    insertMcpServer({
      id,
      name,
      command: serverDef.command,
      args: serverDef.args,
      env: serverDef.env,
      source: 'claude',
    });
    imported.push(name);
  }

  return { imported, skipped };
}

// ─── Health Check ───

export async function checkServerHealth(id: string): Promise<McpHealthResult> {
  const server = getMcpServer(id);
  if (!server) {
    return { healthy: false, error: 'Server not found', latencyMs: 0 };
  }

  return performHealthCheck(server);
}

export async function checkAllHealth(): Promise<Record<string, McpHealthResult>> {
  const servers = getMcpServers();
  const results: Record<string, McpHealthResult> = {};

  await Promise.all(
    servers.map(async (server) => {
      results[server.id] = await performHealthCheck(server);
    }),
  );

  return results;
}

function performHealthCheck(server: McpServerRecord): Promise<McpHealthResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const timeout = 5000;

    try {
      const proc = spawn(server.command, server.args, {
        env: { ...process.env, ...server.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let responded = false;
      const timer = setTimeout(() => {
        if (!responded) {
          responded = true;
          proc.kill('SIGKILL');
          resolve({ healthy: false, error: 'Timeout (5s)', latencyMs: timeout });
        }
      }, timeout);

      // Send MCP initialize request
      const initRequest = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'zeus-health-check', version: '1.0' },
        },
      });

      proc.stdout.on('data', () => {
        if (!responded) {
          responded = true;
          clearTimeout(timer);
          proc.kill('SIGTERM');
          resolve({ healthy: true, latencyMs: Date.now() - start });
        }
      });

      proc.on('error', (err) => {
        if (!responded) {
          responded = true;
          clearTimeout(timer);
          resolve({ healthy: false, error: err.message, latencyMs: Date.now() - start });
        }
      });

      proc.on('exit', (code) => {
        if (!responded) {
          responded = true;
          clearTimeout(timer);
          resolve({ healthy: false, error: `Process exited with code ${code}`, latencyMs: Date.now() - start });
        }
      });

      proc.stdin.write(initRequest + '\n');
    } catch (err) {
      resolve({ healthy: false, error: (err as Error).message, latencyMs: Date.now() - start });
    }
  });
}

// ─── MCP Tool Discovery ───

class JsonRpcStdioReader {
  private buffer = '';
  private pending = new Map<number, { resolve: (msg: unknown) => void; reject: (err: Error) => void }>();
  private nextId = 1;

  feed(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop()!;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          this.pending.get(msg.id)!.resolve(msg);
          this.pending.delete(msg.id);
        }
      } catch {
        // skip malformed lines
      }
    }
  }

  allocateId(): number {
    return this.nextId++;
  }

  waitForResponse(id: number, timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`JSON-RPC timeout waiting for id=${id}`));
        }
      }, timeoutMs);
    });
  }

  cancelAll(): void {
    for (const [, { reject }] of this.pending) {
      reject(new Error('Reader cancelled'));
    }
    this.pending.clear();
  }
}

const DISCOVERY_TIMEOUT = 10000;

export async function discoverServerTools(serverId: string): Promise<{ metadata: McpServerMetadata; tools: McpToolEntry[] }> {
  const server = getMcpServer(serverId);
  if (!server) throw new Error(`MCP server not found: ${serverId}`);

  return new Promise((resolve, reject) => {
    const reader = new JsonRpcStdioReader();
    let settled = false;

    const finish = (err: Error | null, result?: { metadata: McpServerMetadata; tools: McpToolEntry[] }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reader.cancelAll();
      // Kill gently on success, forcefully on error
      try { proc.kill(err ? 'SIGKILL' : 'SIGTERM'); } catch { /* already dead */ }
      if (err) reject(err);
      else resolve(result!);
    };

    console.log(`[MCP Discovery] Starting discovery for ${server.name} (${server.command} ${server.args.join(' ')})`);

    const proc = spawn(server.command, server.args, {
      env: { ...process.env, ...server.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Consume stderr to prevent pipe buffer blocking + useful for debugging
    let stderrOutput = '';
    proc.stderr!.on('data', (chunk: Buffer) => {
      stderrOutput += chunk.toString();
    });

    const timer = setTimeout(() => {
      console.error(`[MCP Discovery] Timeout for ${server.name}. stderr: ${stderrOutput.slice(0, 500)}`);
      finish(new Error(`Discovery timeout (${DISCOVERY_TIMEOUT / 1000}s)`));
    }, DISCOVERY_TIMEOUT);

    proc.on('error', (err) => {
      console.error(`[MCP Discovery] Spawn error for ${server.name}:`, err.message);
      finish(err);
    });

    proc.on('exit', (code) => {
      console.log(`[MCP Discovery] Process exited for ${server.name} with code ${code}. stderr: ${stderrOutput.slice(0, 500)}`);
      finish(new Error(`MCP server exited unexpectedly with code ${code}`));
    });

    proc.stdout!.on('data', (chunk: Buffer) => {
      reader.feed(chunk.toString());
    });

    // Step 1: Send initialize
    const initId = reader.allocateId();
    proc.stdin!.write(JSON.stringify({
      jsonrpc: '2.0',
      id: initId,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'zeus-discovery', version: '1.0' },
      },
    }) + '\n');

    reader.waitForResponse(initId, DISCOVERY_TIMEOUT)
      .then((initResponse: unknown) => {
        if (settled) return;
        const initResult = (initResponse as { result?: { serverInfo?: { name?: string; version?: string }; capabilities?: Record<string, unknown>; protocolVersion?: string } }).result ?? {};

        // Step 2: Send initialized notification (no id)
        proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

        // Step 3: Send tools/list
        const toolsId = reader.allocateId();
        proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id: toolsId, method: 'tools/list', params: {} }) + '\n');

        return reader.waitForResponse(toolsId, DISCOVERY_TIMEOUT).then((toolsResponse: unknown) => {
          if (settled) return;
          const toolsResult = (toolsResponse as { result?: { tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> } }).result ?? {};
          const rawTools = toolsResult.tools ?? [];

          const metadata: McpServerMetadata = {
            serverId,
            protocolVersion: initResult.protocolVersion ?? '',
            serverName: initResult.serverInfo?.name ?? server.name,
            serverVersion: initResult.serverInfo?.version ?? '',
            capabilities: initResult.capabilities ?? {},
            discoveredAt: new Date().toISOString(),
          };

          const tools: McpToolEntry[] = rawTools.map((t) => ({
            serverId,
            toolName: t.name,
            description: t.description ?? '',
            inputSchema: t.inputSchema ?? {},
          }));

          saveMcpDiscovery(
            serverId,
            { protocolVersion: metadata.protocolVersion, serverName: metadata.serverName, serverVersion: metadata.serverVersion, capabilities: metadata.capabilities },
            tools.map((t) => ({ toolName: t.toolName, description: t.description, inputSchema: t.inputSchema })),
          );

          finish(null, { metadata, tools });
        });
      })
      .catch((err) => {
        finish(err instanceof Error ? err : new Error(String(err)));
      });
  });
}

export async function discoverAllServerTools(): Promise<
  Array<{ serverId: string; metadata: McpServerMetadata; tools: McpToolEntry[] } | { serverId: string; error: string }>
> {
  const servers = getMcpServers().filter((s) => s.enabled);
  const results = await Promise.allSettled(
    servers.map((s) => discoverServerTools(s.id)),
  );

  return results.map((r, i) => {
    if (r.status === 'fulfilled') {
      return { serverId: servers[i].id, metadata: r.value.metadata, tools: r.value.tools };
    } else {
      return { serverId: servers[i].id, error: r.reason?.message ?? 'Unknown error' };
    }
  });
}

export function getCachedToolsGrouped(serverId?: string): Array<{
  serverId: string;
  serverName: string;
  metadata?: McpServerMetadata;
  tools: McpToolEntry[];
}> {
  const servers = serverId ? [getMcpServer(serverId)].filter(Boolean) as McpServerRecord[] : getMcpServers();
  const allTools = getMcpCachedTools(serverId);
  const allMetadata = serverId
    ? [getMcpServerMetadataById(serverId)].filter(Boolean)
    : getAllMcpServerMetadata();
  const metadataMap = new Map(allMetadata.map((m) => [m!.serverId, m as McpServerMetadata]));
  const toolsByServer = new Map<string, McpToolEntry[]>();

  for (const tool of allTools) {
    if (!toolsByServer.has(tool.serverId)) toolsByServer.set(tool.serverId, []);
    toolsByServer.get(tool.serverId)!.push(tool);
  }

  return servers.map((s) => ({
    serverId: s.id,
    serverName: s.name,
    metadata: metadataMap.get(s.id),
    tools: toolsByServer.get(s.id) ?? [],
  }));
}

// ─── Session Resolution ───

export function resolveSessionMcps(opts?: {
  profileId?: string;
  serverIds?: string[];
  excludeIds?: string[];
}): McpServerRecord[] {
  const allServers = getMcpServers();
  const serverMap = new Map(allServers.map((s) => [s.id, s]));
  const resolvedIds = new Set<string>();

  // Start with profile servers (or default profile)
  if (opts?.profileId) {
    const profile = getMcpProfile(opts.profileId);
    if (profile) {
      for (const s of profile.servers) {
        if (s && s.enabled) resolvedIds.add(s.id);
      }
    }
  } else {
    // Use default profile if exists
    const profiles = getMcpProfiles();
    const defaultProfile = profiles.find((p) => p.isDefault);
    if (defaultProfile) {
      for (const s of defaultProfile.servers) {
        if (s && s.enabled) resolvedIds.add(s.id);
      }
    }
  }

  // Add explicit server IDs
  if (opts?.serverIds) {
    for (const sid of opts.serverIds) {
      const s = serverMap.get(sid);
      if (s && s.enabled) resolvedIds.add(sid);
    }
  }

  // Remove excluded
  if (opts?.excludeIds) {
    for (const id of opts.excludeIds) {
      resolvedIds.delete(id);
    }
  }

  return Array.from(resolvedIds)
    .map((id) => serverMap.get(id))
    .filter(Boolean) as McpServerRecord[];
}

// ─── Session MCP Tracking ───

export { attachSessionMcps, updateSessionMcpStatus, getSessionMcps };
