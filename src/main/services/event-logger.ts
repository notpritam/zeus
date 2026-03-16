import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import type { WsEnvelope } from '../types';

const LOG_FILE = 'zeus-events.jsonl';
let stream: fs.WriteStream | null = null;

export interface EventLogEntry {
  ts: string;
  dir: 'in' | 'out';
  channel: string;
  sessionId: string;
  payloadType: string | undefined;
}

function getLogPath(): string {
  return path.join(app.getPath('userData'), LOG_FILE);
}

export function initEventLogger(): void {
  try {
    const logPath = getLogPath();
    stream = fs.createWriteStream(logPath, { flags: 'a' });
    console.log(`[Zeus] Event logger writing to ${logPath}`);
  } catch (err) {
    console.error('[Zeus] Failed to init event logger:', err);
  }
}

function getPayloadType(envelope: WsEnvelope): string | undefined {
  return typeof envelope.payload === 'object' && envelope.payload !== null
    ? (envelope.payload as Record<string, unknown>).type as string | undefined
    : undefined;
}

export function logEvent(direction: 'in' | 'out', envelope: WsEnvelope): void {
  if (!stream) return;
  try {
    const entry: EventLogEntry = {
      ts: new Date().toISOString(),
      dir: direction,
      channel: envelope.channel,
      sessionId: envelope.sessionId,
      payloadType: getPayloadType(envelope),
    };
    stream.write(JSON.stringify(entry) + '\n');
  } catch {
    // swallow — never crash main process for logging
  }
}

export function closeEventLogger(): void {
  if (stream) {
    stream.end();
    stream = null;
  }
}
