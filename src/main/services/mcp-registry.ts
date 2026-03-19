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
} from './db';
import type { McpServerRecord, McpHealthResult } from '../../shared/types';

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
