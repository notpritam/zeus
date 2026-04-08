// spawn-proxy.js — Runs inside Electron utilityProcess.
// Receives spawn commands via parentPort, spawns the process,
// and proxies stdin/stdout/stderr back via IPC messages.
//
// This exists because the Electron main process leaks handles (~12K+),
// causing libuv's uv_spawn to fail with EBADF. utilityProcess.fork()
// uses Chromium's service API (not libuv), creating a fresh process
// with a clean FD table where spawn works normally.

const { spawn } = require('child_process');
const fs = require('fs');

const debugLog = (msg) => {
  const line = `[${new Date().toISOString()}] [spawn-proxy] ${msg}\n`;
  fs.appendFileSync('/tmp/zeus-spawn-debug.log', line);
};

// In Electron's utilityProcess, parentPort is on process
const parentPort = process.parentPort;

debugLog(`Starting. parentPort exists: ${!!parentPort}, type: ${typeof parentPort}`);

if (!parentPort) {
  debugLog('FATAL: process.parentPort is not available');
  process.exit(1);
}

let child = null;

parentPort.on('message', (event) => {
  // utilityProcess MessagePort wraps data in event.data
  const msg = event.data || event;
  debugLog(`Received: ${JSON.stringify(msg).slice(0, 200)}`);

  if (msg.type === 'spawn') {
    try {
      child = spawn(msg.command, msg.args, {
        cwd: msg.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: msg.env,
      });

      child.stdout.on('data', (chunk) => {
        parentPort.postMessage({ type: 'stdout', data: chunk.toString('utf-8') });
      });

      child.stderr.on('data', (chunk) => {
        parentPort.postMessage({ type: 'stderr', data: chunk.toString('utf-8') });
      });

      child.on('exit', (code, signal) => {
        debugLog(`Child exited: code=${code} signal=${signal}`);
        parentPort.postMessage({ type: 'exit', code, signal });
      });

      child.on('error', (err) => {
        debugLog(`Child error: ${err.message}`);
        parentPort.postMessage({ type: 'error', message: err.message, code: err.code });
      });

      debugLog(`Spawned child pid: ${child.pid}`);
      parentPort.postMessage({ type: 'spawned', pid: child.pid });
    } catch (err) {
      debugLog(`Spawn failed: ${err.message}`);
      parentPort.postMessage({ type: 'spawn_error', message: err.message, code: err.code });
    }
  } else if (msg.type === 'stdin') {
    if (child && child.stdin && !child.stdin.destroyed) {
      child.stdin.write(msg.data);
    }
  } else if (msg.type === 'kill') {
    if (child) {
      child.kill(msg.signal || 'SIGTERM');
    }
  }
});

debugLog('Message listener registered');
