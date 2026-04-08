import { execSync } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { Log } from "../log/log";

const log = Log.create({ service: "claude-cli" });

// Pin to a known-good version — update deliberately, not via @latest
const CLAUDE_CLI_VERSION = "2.1.92";

let resolvedPath: string | null = null;

export async function resolveClaudeBinary(): Promise<void> {
  // 1. Try common install locations first (faster, no shell needed)
  const home = process.env.HOME ?? "";
  const candidates = [
    path.join(home, ".local/bin/claude"),
    path.join(home, ".npm/bin/claude"),
    "/usr/local/bin/claude",
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      resolvedPath = candidate;
      log.info("resolved via path scan", { path: resolvedPath });
      return;
    }
  }

  // 2. Try `which claude` (depends on PATH being fixed)
  try {
    const result = execSync("which claude", { encoding: "utf-8", timeout: 5000 }).trim();
    if (result && existsSync(result)) {
      resolvedPath = result;
      log.info("resolved via which", { path: resolvedPath });
      return;
    }
  } catch { /* not found */ }

  // 3. Fallback — will use npx with pinned version
  log.warn("claude binary not found, will use npx fallback", { version: CLAUDE_CLI_VERSION });
  resolvedPath = null;
}

export function getClaudeBinary(): { command: string; prefixArgs: string[] } {
  if (resolvedPath) {
    return { command: resolvedPath, prefixArgs: [] };
  }
  return { command: "npx", prefixArgs: ["-y", `@anthropic-ai/claude-code@${CLAUDE_CLI_VERSION}`] };
}
