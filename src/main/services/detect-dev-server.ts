/**
 * Auto-detect the dev server URL for a project by scanning
 * config files and probing common ports.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { createConnection } from 'net';

/** Common dev server ports ordered by popularity */
const COMMON_PORTS = [5173, 5174, 3000, 3001, 4200, 8080, 8081, 8000, 4000, 5199];

/** Try to connect to a port — resolves true if something is listening */
function isPortOpen(port: number, host = '127.0.0.1', timeoutMs = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.on('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

/** Read a file silently — returns null on any error */
async function readFileSafe(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Extract port from a vite/electron-vite config file.
 * Looks for patterns like `server: { port: 3000 }` or `port: 3000`.
 */
function parseVitePort(content: string): number | null {
  // Match server.port or server: { ... port: N ... }
  const match = content.match(/server\s*:\s*\{[^}]*port\s*:\s*(\d+)/s);
  if (match) return parseInt(match[1], 10);
  return null;
}

/**
 * Extract port from package.json dev scripts.
 * Looks for --port N, -p N, PORT=N patterns.
 */
function parsePackageJsonPort(content: string): number | null {
  try {
    const pkg = JSON.parse(content);
    const scripts = pkg.scripts || {};
    // Check dev, start, serve scripts
    for (const key of ['dev', 'start', 'serve']) {
      const script = scripts[key];
      if (!script) continue;
      // --port 3000, -p 3000, PORT=3000
      const portMatch = script.match(/(?:--port\s+|-p\s+|PORT=)(\d+)/);
      if (portMatch) return parseInt(portMatch[1], 10);
    }
  } catch {
    // Invalid JSON
  }
  return null;
}

/**
 * Extract port from .env or .env.local files.
 */
function parseEnvPort(content: string): number | null {
  const match = content.match(/^PORT\s*=\s*(\d+)/m);
  if (match) return parseInt(match[1], 10);
  return null;
}

/**
 * Detect the dev server URL for a project directory.
 *
 * Strategy:
 * 1. Parse config files for configured port
 * 2. Check if that port is actually listening
 * 3. If no config found, scan common ports for an active server
 *
 * Returns the detected URL or null if nothing found.
 */
export async function detectDevServerUrl(workingDir: string): Promise<string | null> {
  // Phase 1: Try to find configured port from project files
  const configPort = await detectConfiguredPort(workingDir);

  if (configPort) {
    const open = await isPortOpen(configPort);
    if (open) return `http://localhost:${configPort}`;
  }

  // Phase 2: Scan common ports for anything listening
  const openPorts = await scanCommonPorts();

  if (openPorts.length > 0) {
    // If we found a configured port but it wasn't open, prefer ports that
    // are NOT the Zeus dev server port
    return `http://localhost:${openPorts[0]}`;
  }

  // Phase 3: Return configured port even if not open (server may start later)
  if (configPort) return `http://localhost:${configPort}`;

  return null;
}

/** Parse project config files to find the configured dev server port */
async function detectConfiguredPort(workingDir: string): Promise<number | null> {
  // Check multiple config files in parallel
  const [viteConfig, electronViteConfig, packageJson, envFile, envLocal] = await Promise.all([
    readFileSafe(join(workingDir, 'vite.config.ts')),
    readFileSafe(join(workingDir, 'electron.vite.config.ts')),
    readFileSafe(join(workingDir, 'package.json')),
    readFileSafe(join(workingDir, '.env')),
    readFileSafe(join(workingDir, '.env.local')),
  ]);

  // Vite config (most specific)
  if (viteConfig) {
    const port = parseVitePort(viteConfig);
    if (port) return port;
  }

  // Electron-vite config (renderer server port)
  if (electronViteConfig) {
    // Look specifically in the renderer section
    const rendererMatch = electronViteConfig.match(/renderer\s*:\s*\{[^]*?server\s*:\s*\{[^}]*port\s*:\s*(\d+)/s);
    if (rendererMatch) return parseInt(rendererMatch[1], 10);
    // Fallback to any server.port
    const port = parseVitePort(electronViteConfig);
    if (port) return port;
  }

  // .env.local takes precedence over .env
  if (envLocal) {
    const port = parseEnvPort(envLocal);
    if (port) return port;
  }
  if (envFile) {
    const port = parseEnvPort(envFile);
    if (port) return port;
  }

  // package.json scripts
  if (packageJson) {
    const port = parsePackageJsonPort(packageJson);
    if (port) return port;
  }

  return null;
}

/** Scan common ports to find which ones have active servers */
async function scanCommonPorts(): Promise<number[]> {
  const results = await Promise.all(
    COMMON_PORTS.map(async (port) => ({ port, open: await isPortOpen(port) })),
  );
  return results.filter((r) => r.open).map((r) => r.port);
}
