// src/main/log/log.ts
import path from "path";
import fs from "fs";

export namespace Log {
  export type Level = "DEBUG" | "INFO" | "WARN" | "ERROR";

  export interface Logger {
    debug(message: string, extra?: Record<string, unknown>): void;
    info(message: string, extra?: Record<string, unknown>): void;
    warn(message: string, extra?: Record<string, unknown>): void;
    error(message: string, extra?: Record<string, unknown>): void;
    time(label: string, extra?: Record<string, unknown>): { stop(): void };
  }

  const levelPriority: Record<Level, number> = {
    DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3,
  };

  let currentLevel: Level = "INFO";
  let logDir = "";
  let globalStream: fs.WriteStream | null = null;
  const sessionStreams = new Map<string, fs.WriteStream>();

  export function init(opts: { level: Level; logDir: string }): void {
    currentLevel = opts.level;
    logDir = opts.logDir;
    fs.mkdirSync(logDir, { recursive: true });
    fs.mkdirSync(path.join(logDir, "sessions"), { recursive: true });
    globalStream = fs.createWriteStream(path.join(logDir, "zeus.log"), { flags: "a" });
  }

  export function close(): void {
    globalStream?.close();
    globalStream = null;
    for (const stream of sessionStreams.values()) {
      stream.close();
    }
    sessionStreams.clear();
  }

  function shouldLog(level: Level): boolean {
    return levelPriority[level] >= levelPriority[currentLevel];
  }

  function formatDev(ts: string, level: Level, service: string, sessionId: string | undefined, message: string, extra?: Record<string, unknown>): string {
    const tag = sessionId ? `${service}:${sessionId.slice(0, 8)}` : service;
    const extraStr = extra ? " " + Object.entries(extra).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ") : "";
    return `${ts.slice(11, 19)} ${level.padEnd(5)} [${tag}] ${message}${extraStr}`;
  }

  function formatJson(ts: string, level: Level, service: string, sessionId: string | undefined, message: string, extra?: Record<string, unknown>): string {
    const obj: Record<string, unknown> = { ts, level, service, msg: message };
    if (sessionId) obj.sessionId = sessionId;
    if (extra) Object.assign(obj, extra);
    return JSON.stringify(obj);
  }

  function write(level: Level, service: string, sessionId: string | undefined, message: string, extra?: Record<string, unknown>): void {
    if (!shouldLog(level)) return;
    const ts = new Date().toISOString();
    const dev = formatDev(ts, level, service, sessionId, message, extra);
    const json = formatJson(ts, level, service, sessionId, message, extra);

    // Dev output to stderr
    process.stderr.write(dev + "\n");

    // JSON to global log file
    globalStream?.write(json + "\n");

    // JSON to session log file (if session-scoped)
    if (sessionId) {
      let stream = sessionStreams.get(sessionId);
      if (!stream) {
        const filePath = path.join(logDir, "sessions", `${sessionId}.log`);
        stream = fs.createWriteStream(filePath, { flags: "a" });
        sessionStreams.set(sessionId, stream);
      }
      stream.write(json + "\n");
    }
  }

  function makeLogger(service: string, sessionId?: string): Logger {
    return {
      debug: (msg, extra) => write("DEBUG", service, sessionId, msg, extra),
      info: (msg, extra) => write("INFO", service, sessionId, msg, extra),
      warn: (msg, extra) => write("WARN", service, sessionId, msg, extra),
      error: (msg, extra) => write("ERROR", service, sessionId, msg, extra),
      time(label, extra) {
        const start = Date.now();
        return {
          stop: () => {
            const duration = Date.now() - start;
            write("INFO", service, sessionId, label, { ...extra, duration: `${duration}ms` });
          },
        };
      },
    };
  }

  export function create(opts: { service: string }): Logger {
    return makeLogger(opts.service);
  }

  export function forSession(opts: { service: string; sessionId: string }): Logger {
    return makeLogger(opts.service, opts.sessionId);
  }

  export function getSessionLog(sessionId: string): string {
    const filePath = path.join(logDir, "sessions", `${sessionId}.log`);
    try {
      return fs.readFileSync(filePath, "utf-8");
    } catch {
      return "";
    }
  }

  export function pruneSessionLogs(maxAgeDays: number): void {
    const sessionsDir = path.join(logDir, "sessions");
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    try {
      for (const file of fs.readdirSync(sessionsDir)) {
        const filePath = path.join(sessionsDir, file);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
        }
      }
    } catch {
      // Directory may not exist yet
    }
  }
}
