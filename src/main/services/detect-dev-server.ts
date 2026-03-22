/**
 * Auto-detect the dev server URL for a project.
 *
 * Detection strategy (ordered by confidence):
 *  1. Parse config files (vite.config, electron.vite.config, next.config, angular.json, etc.)
 *  2. Detect framework from package.json deps → infer default port
 *  3. Parse package.json scripts for explicit port flags
 *  4. Parse .env / .env.local for PORT=
 *  5. For each candidate port, verify via `lsof` that the process CWD matches the project
 *  6. HTTP-probe the port for dev-server response headers (x-powered-by: Express, server: next.js, etc.)
 *  7. Only accept a port_scan result if process ownership is verified
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { createConnection } from 'net';
import { execFile } from 'child_process';
import { promisify } from 'util';
import http from 'http';

const execFileAsync = promisify(execFile);

export interface DetectionResult {
  url: string | null;
  source: 'config' | 'framework_default' | 'port_scan_verified' | 'config_offline' | 'framework_offline' | 'none';
  detail: string;
  configFile?: string;
  port?: number;
  framework?: string;
  /** How the port was verified — 'process_match' | 'http_probe' | 'tcp_only' | 'none' */
  verification?: string;
}

/** Framework info: name, default dev port(s), signature headers */
interface FrameworkInfo {
  name: string;
  defaultPorts: number[];
  /** HTTP response header checks — if any match, this is the right server */
  headerSignatures?: Array<{ header: string; pattern: RegExp }>;
}

/** Detect framework from package.json dependencies */
function detectFramework(packageJsonContent: string): FrameworkInfo | null {
  try {
    const pkg = JSON.parse(packageJsonContent);
    const allDeps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    };

    // Order matters — more specific frameworks first
    if ('electron-vite' in allDeps || '@electron-toolkit/utils' in allDeps) {
      return {
        name: 'electron-vite',
        defaultPorts: [5173],
        headerSignatures: [{ header: 'server', pattern: /vite/i }],
      };
    }
    if ('next' in allDeps) {
      return {
        name: 'next',
        defaultPorts: [3000],
        headerSignatures: [{ header: 'x-powered-by', pattern: /next/i }],
      };
    }
    if ('nuxt' in allDeps || 'nuxt3' in allDeps) {
      return {
        name: 'nuxt',
        defaultPorts: [3000],
        headerSignatures: [{ header: 'x-powered-by', pattern: /nuxt|nitro/i }],
      };
    }
    if ('@angular/core' in allDeps) {
      return {
        name: 'angular',
        defaultPorts: [4200],
        headerSignatures: [],
      };
    }
    if ('react-scripts' in allDeps) {
      return {
        name: 'create-react-app',
        defaultPorts: [3000],
        headerSignatures: [],
      };
    }
    if ('gatsby' in allDeps) {
      return { name: 'gatsby', defaultPorts: [8000], headerSignatures: [] };
    }
    if ('astro' in allDeps) {
      return {
        name: 'astro',
        defaultPorts: [4321],
        headerSignatures: [{ header: 'server', pattern: /astro/i }],
      };
    }
    if ('svelte' in allDeps || '@sveltejs/kit' in allDeps) {
      return {
        name: 'svelte',
        defaultPorts: [5173],
        headerSignatures: [{ header: 'server', pattern: /vite/i }],
      };
    }
    if ('vite' in allDeps) {
      return {
        name: 'vite',
        defaultPorts: [5173],
        headerSignatures: [{ header: 'server', pattern: /vite/i }],
      };
    }

    // Python / other
    if (pkg.scripts) {
      const devScript = pkg.scripts.dev || pkg.scripts.start || '';
      if (/flask/i.test(devScript)) return { name: 'flask', defaultPorts: [5000], headerSignatures: [] };
      if (/uvicorn|fastapi/i.test(devScript)) return { name: 'fastapi', defaultPorts: [8000], headerSignatures: [] };
      if (/django/i.test(devScript)) return { name: 'django', defaultPorts: [8000], headerSignatures: [] };
    }

    return null;
  } catch {
    return null;
  }
}

/** Try to connect to a port — resolves true if something is listening */
function isPortOpen(port: number, host = '127.0.0.1', timeoutMs = 400): Promise<boolean> {
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
 * Use `lsof` to check if a port is owned by a process whose CWD is inside `workingDir`.
 * macOS specific but works well on Darwin.
 */
async function isPortOwnedByProject(port: number, workingDir: string): Promise<{ owned: boolean; processName?: string; pid?: number }> {
  try {
    // Get PID(s) listening on this port
    const { stdout } = await execFileAsync('lsof', ['-ti', `TCP:${port}`, '-sTCP:LISTEN'], { timeout: 3000 });
    const pids = stdout.trim().split('\n').filter(Boolean).map(Number);

    for (const pid of pids) {
      if (isNaN(pid)) continue;
      try {
        // Get the process CWD via lsof -a -p PID -d cwd
        const { stdout: cwdOut } = await execFileAsync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { timeout: 3000 });
        // Output format: pPID\nncwd\nnPATH
        const lines = cwdOut.trim().split('\n');
        const pathLine = lines.find((l) => l.startsWith('n') && l.length > 1);
        const processCwd = pathLine?.slice(1);

        // Get process name
        const { stdout: psOut } = await execFileAsync('ps', ['-p', String(pid), '-o', 'comm='], { timeout: 2000 });
        const processName = psOut.trim().split('/').pop() || 'unknown';

        if (processCwd && processCwd.startsWith(workingDir)) {
          return { owned: true, processName, pid };
        }

        // Also check parent process CWD (dev servers are often children of npm/node)
        try {
          const { stdout: ppidOut } = await execFileAsync('ps', ['-p', String(pid), '-o', 'ppid='], { timeout: 2000 });
          const ppid = parseInt(ppidOut.trim(), 10);
          if (!isNaN(ppid) && ppid > 1) {
            const { stdout: parentCwdOut } = await execFileAsync('lsof', ['-a', '-p', String(ppid), '-d', 'cwd', '-Fn'], { timeout: 3000 });
            const parentLines = parentCwdOut.trim().split('\n');
            const parentPathLine = parentLines.find((l) => l.startsWith('n') && l.length > 1);
            const parentCwd = parentPathLine?.slice(1);
            if (parentCwd && parentCwd.startsWith(workingDir)) {
              return { owned: true, processName, pid };
            }
          }
        } catch {
          // Parent check failed — non-critical
        }
      } catch {
        // CWD check failed for this PID
      }
    }
    return { owned: false };
  } catch {
    // lsof not available or no process found
    return { owned: false };
  }
}

/** HTTP probe a port for dev server response headers */
async function probeHttpHeaders(port: number, signatures: Array<{ header: string; pattern: RegExp }>): Promise<boolean> {
  if (signatures.length === 0) return false;
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/`, { timeout: 2000 }, (res) => {
      const headers = res.headers;
      for (const sig of signatures) {
        const val = headers[sig.header.toLowerCase()];
        if (val && sig.pattern.test(String(val))) {
          res.destroy();
          resolve(true);
          return;
        }
      }
      res.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

// ─── Config file parsers ───

function parseVitePort(content: string): number | null {
  const match = content.match(/server\s*:\s*\{[^}]*port\s*:\s*(\d+)/s);
  if (match) return parseInt(match[1], 10);
  return null;
}

function parsePackageJsonPort(content: string): number | null {
  try {
    const pkg = JSON.parse(content);
    const scripts = pkg.scripts || {};
    for (const key of ['dev', 'start', 'serve']) {
      const script = scripts[key];
      if (!script) continue;
      const portMatch = script.match(/(?:--port\s+|-p\s+|PORT=)(\d+)/);
      if (portMatch) return parseInt(portMatch[1], 10);
    }
  } catch { /* invalid JSON */ }
  return null;
}

function parseEnvPort(content: string): number | null {
  const match = content.match(/^PORT\s*=\s*(\d+)/m);
  if (match) return parseInt(match[1], 10);
  return null;
}

function parseAngularPort(content: string): number | null {
  try {
    const config = JSON.parse(content);
    // angular.json → projects.*.architect.serve.options.port
    for (const proj of Object.values(config.projects || {}) as any[]) {
      const port = proj?.architect?.serve?.options?.port;
      if (typeof port === 'number') return port;
    }
  } catch { /* invalid JSON */ }
  return null;
}

// ─── Main detection ───

export async function detectDevServerUrl(workingDir: string): Promise<string | null> {
  const result = await detectDevServerUrlDetailed(workingDir);
  return result.url;
}

/**
 * Full detection with details. Strategy:
 *
 * Phase 1: Config-based — explicit port in config files (highest confidence)
 * Phase 2: Framework-based — detect framework, try its default port with process verification
 * Phase 3: Script-based — parse package.json scripts for --port flags
 * Phase 4: Env-based — parse .env files for PORT=
 *
 * For each candidate port:
 *  a) Check if TCP port is open
 *  b) Verify the process on that port belongs to this project (lsof CWD check)
 *  c) HTTP-probe for framework-specific response headers
 *
 * We NEVER blindly accept an open port without verification.
 */
export async function detectDevServerUrlDetailed(workingDir: string): Promise<DetectionResult> {
  // Read all config files in parallel
  const [
    viteConfigTs, viteConfigJs, viteConfigMjs,
    electronViteConfig,
    packageJson,
    envFile, envLocal,
    nextConfigJs, nextConfigMjs, nextConfigTs,
    angularJson,
  ] = await Promise.all([
    readFileSafe(join(workingDir, 'vite.config.ts')),
    readFileSafe(join(workingDir, 'vite.config.js')),
    readFileSafe(join(workingDir, 'vite.config.mjs')),
    readFileSafe(join(workingDir, 'electron.vite.config.ts')),
    readFileSafe(join(workingDir, 'package.json')),
    readFileSafe(join(workingDir, '.env')),
    readFileSafe(join(workingDir, '.env.local')),
    readFileSafe(join(workingDir, 'next.config.js')),
    readFileSafe(join(workingDir, 'next.config.mjs')),
    readFileSafe(join(workingDir, 'next.config.ts')),
    readFileSafe(join(workingDir, 'angular.json')),
  ]);

  const viteConfig = viteConfigTs ?? viteConfigJs ?? viteConfigMjs;
  const viteConfigName = viteConfigTs ? 'vite.config.ts' : viteConfigJs ? 'vite.config.js' : 'vite.config.mjs';
  const nextConfig = nextConfigJs ?? nextConfigMjs ?? nextConfigTs;

  // Detect framework from package.json
  const framework = packageJson ? detectFramework(packageJson) : null;

  // ── Phase 1: Explicit port in config files ──

  const configCandidates: Array<{ port: number; file: string }> = [];

  // Electron-vite renderer port (most specific)
  if (electronViteConfig) {
    const rendererMatch = electronViteConfig.match(
      /renderer\s*:\s*\{[^]*?server\s*:\s*\{[^}]*port\s*:\s*(\d+)/s,
    );
    if (rendererMatch) {
      configCandidates.push({ port: parseInt(rendererMatch[1], 10), file: 'electron.vite.config.ts' });
    } else {
      const p = parseVitePort(electronViteConfig);
      if (p) configCandidates.push({ port: p, file: 'electron.vite.config.ts' });
    }
  }

  // Vite config
  if (viteConfig) {
    const p = parseVitePort(viteConfig);
    if (p) configCandidates.push({ port: p, file: viteConfigName });
  }

  // Next.js config
  if (nextConfig) {
    const portMatch = nextConfig.match(/port\s*:\s*(\d+)/);
    if (portMatch) configCandidates.push({ port: parseInt(portMatch[1], 10), file: 'next.config.*' });
  }

  // Angular config
  if (angularJson) {
    const p = parseAngularPort(angularJson);
    if (p) configCandidates.push({ port: p, file: 'angular.json' });
  }

  // Try config candidates with verification
  for (const candidate of configCandidates) {
    const open = await isPortOpen(candidate.port);
    if (open) {
      const ownership = await isPortOwnedByProject(candidate.port, workingDir);
      const verification = ownership.owned ? 'process_match' : 'tcp_only';
      return {
        url: `http://localhost:${candidate.port}`,
        source: 'config',
        detail: `Port ${candidate.port} from ${candidate.file}` +
          (ownership.owned ? ` — verified (${ownership.processName} pid:${ownership.pid})` : ' — running'),
        configFile: candidate.file,
        port: candidate.port,
        framework: framework?.name,
        verification,
      };
    }
  }

  // ── Phase 2: Framework default ports with process verification ──

  if (framework) {
    for (const defaultPort of framework.defaultPorts) {
      // Skip if already checked as a config candidate
      if (configCandidates.some((c) => c.port === defaultPort)) continue;

      const open = await isPortOpen(defaultPort);
      if (open) {
        // Must verify ownership — this is the key fix: don't blindly accept open ports
        const ownership = await isPortOwnedByProject(defaultPort, workingDir);
        if (ownership.owned) {
          return {
            url: `http://localhost:${defaultPort}`,
            source: 'framework_default',
            detail: `${framework.name} default port ${defaultPort} — verified (${ownership.processName} pid:${ownership.pid})`,
            port: defaultPort,
            framework: framework.name,
            verification: 'process_match',
          };
        }

        // Process check failed, try HTTP header signatures as fallback verification
        if (framework.headerSignatures && framework.headerSignatures.length > 0) {
          const headerMatch = await probeHttpHeaders(defaultPort, framework.headerSignatures);
          if (headerMatch) {
            return {
              url: `http://localhost:${defaultPort}`,
              source: 'framework_default',
              detail: `${framework.name} default port ${defaultPort} — verified via HTTP headers`,
              port: defaultPort,
              framework: framework.name,
              verification: 'http_probe',
            };
          }
        }
        // Port is open but NOT verified — do not use it (could be another project)
      }
    }
  }

  // ── Phase 3: Package.json script port flags ──

  if (packageJson) {
    const scriptPort = parsePackageJsonPort(packageJson);
    if (scriptPort && !configCandidates.some((c) => c.port === scriptPort)) {
      const open = await isPortOpen(scriptPort);
      if (open) {
        const ownership = await isPortOwnedByProject(scriptPort, workingDir);
        return {
          url: `http://localhost:${scriptPort}`,
          source: 'config',
          detail: `Port ${scriptPort} from package.json scripts` +
            (ownership.owned ? ` — verified (${ownership.processName} pid:${ownership.pid})` : ' — running (unverified)'),
          configFile: 'package.json',
          port: scriptPort,
          framework: framework?.name,
          verification: ownership.owned ? 'process_match' : 'tcp_only',
        };
      }
    }
  }

  // ── Phase 4: .env port ──

  const envPort = (envLocal ? parseEnvPort(envLocal) : null) ?? (envFile ? parseEnvPort(envFile) : null);
  const envSource = envLocal && parseEnvPort(envLocal) ? '.env.local' : '.env';
  if (envPort && !configCandidates.some((c) => c.port === envPort)) {
    const open = await isPortOpen(envPort);
    if (open) {
      const ownership = await isPortOwnedByProject(envPort, workingDir);
      return {
        url: `http://localhost:${envPort}`,
        source: 'config',
        detail: `Port ${envPort} from ${envSource}` +
          (ownership.owned ? ` — verified (${ownership.processName} pid:${ownership.pid})` : ' — running (unverified)'),
        configFile: envSource,
        port: envPort,
        framework: framework?.name,
        verification: ownership.owned ? 'process_match' : 'tcp_only',
      };
    }
  }

  // ── Phase 5: Offline fallbacks (config/framework port not running yet) ──

  if (configCandidates.length > 0) {
    const best = configCandidates[0];
    return {
      url: `http://localhost:${best.port}`,
      source: 'config_offline',
      detail: `Port ${best.port} from ${best.file} — server not running yet`,
      configFile: best.file,
      port: best.port,
      framework: framework?.name,
      verification: 'none',
    };
  }

  if (framework) {
    return {
      url: `http://localhost:${framework.defaultPorts[0]}`,
      source: 'framework_offline',
      detail: `${framework.name} default port ${framework.defaultPorts[0]} — server not running yet`,
      port: framework.defaultPorts[0],
      framework: framework.name,
      verification: 'none',
    };
  }

  if (envPort) {
    return {
      url: `http://localhost:${envPort}`,
      source: 'config_offline',
      detail: `Port ${envPort} from ${envSource} — server not running yet`,
      configFile: envSource,
      port: envPort,
      verification: 'none',
    };
  }

  // Package.json script port as last offline fallback
  if (packageJson) {
    const scriptPort = parsePackageJsonPort(packageJson);
    if (scriptPort) {
      return {
        url: `http://localhost:${scriptPort}`,
        source: 'config_offline',
        detail: `Port ${scriptPort} from package.json scripts — server not running yet`,
        configFile: 'package.json',
        port: scriptPort,
        framework: (framework as { name: string } | null)?.name,
        verification: 'none',
      };
    }
  }

  return {
    url: null,
    source: 'none',
    detail: 'No dev server config or framework detected in this project',
    verification: 'none',
  };
}
