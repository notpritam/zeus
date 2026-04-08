// spawn-proxy.js — Runs inside Electron utilityProcess.
// Receives spawn commands via parentPort, spawns the process,
// and proxies stdin/stdout/stderr back via IPC messages.
//
// This exists because the Electron main process leaks handles (~12K+),
// causing libuv's uv_spawn to fail with EBADF. utilityProcess.fork()
// uses Chromium's service API (not libuv), creating a fresh process
// with a clean FD table where spawn works normally.

const { parentPort } = require('electron');
const { spawn } = require('child_process');

let child = null;

parentPort.on('message', (msg) => {
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
        parentPort.postMessage({ type: 'exit', code, signal });
      });

      child.on('error', (err) => {
        parentPort.postMessage({ type: 'error', message: err.message, code: err.code });
      });

      parentPort.postMessage({ type: 'spawned', pid: child.pid });
    } catch (err) {
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
