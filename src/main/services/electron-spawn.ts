// electron-spawn.ts — Spawns a child process via Electron's utilityProcess API.
//
// Returns a ChildProcess-like object with stdin, stdout, stderr streams
// and exit/error events. Works around the EBADF bug where the Electron
// main process accumulates ~12K+ libuv handles, causing child_process.spawn
// to fail. utilityProcess.fork() uses Chromium's service API which has a
// clean FD table.

import { utilityProcess } from 'electron';
import { PassThrough, Writable } from 'stream';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';

const debugLog = (msg: string) => {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync('/tmp/zeus-spawn-debug.log', line);
};

export interface SpawnResult extends EventEmitter {
  stdin: Writable;
  stdout: PassThrough;
  stderr: PassThrough;
  pid: number | undefined;
  kill(signal?: string): void;
}

export function electronSpawn(
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string> },
): SpawnResult {
  const emitter = new EventEmitter() as SpawnResult;

  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      if (proxy && !proxy.killed) {
        proxy.postMessage({ type: 'stdin', data: chunk.toString('utf-8') });
      }
      callback();
    },
  });

  emitter.stdout = stdout;
  emitter.stderr = stderr;
  emitter.stdin = stdin;
  emitter.pid = undefined;

  emitter.kill = (signal?: string) => {
    if (proxy && !proxy.killed) {
      proxy.postMessage({ type: 'kill', signal: signal || 'SIGTERM' });
    }
  };

  // After bundling, spawn-proxy lives alongside index.mjs in out/main/
  const proxyPath = path.join(__dirname, 'spawn-proxy.js');
  debugLog(`Forking proxy: ${proxyPath} (exists: ${fs.existsSync(proxyPath)})`);
  const proxy = utilityProcess.fork(proxyPath);
  debugLog(`Proxy forked, pid: ${proxy.pid}`);

  proxy.on('message', (msg: any) => {
    debugLog(`Proxy message: ${JSON.stringify(msg).slice(0, 200)}`);
    switch (msg.type) {
      case 'spawned':
        emitter.pid = msg.pid;
        debugLog(`Spawned child pid: ${msg.pid}`);
        break;
      case 'stdout':
        stdout.write(msg.data);
        break;
      case 'stderr':
        stderr.write(msg.data);
        break;
      case 'exit':
        stdout.end();
        stderr.end();
        stdin.end();
        emitter.emit('exit', msg.code, msg.signal);
        proxy.kill();
        break;
      case 'error':
        emitter.emit('error', new Error(msg.message));
        break;
      case 'spawn_error':
        emitter.emit('error', new Error(`Proxy spawn failed: ${msg.message}`));
        proxy.kill();
        break;
    }
  });

  proxy.on('exit', (code: number) => {
    debugLog(`Proxy exited with code: ${code}`);
    // If the proxy itself exits unexpectedly
    if (code !== 0) {
      stdout.end();
      stderr.end();
      stdin.end();
      emitter.emit('exit', code, null);
    }
  });

  // Send the spawn command
  proxy.postMessage({
    type: 'spawn',
    command,
    args,
    cwd: options.cwd,
    env: options.env,
  });

  return emitter;
}
