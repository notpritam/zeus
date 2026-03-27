import { execSync } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { Log } from "../log/log";

const log = Log.create({ service: "claude-cli" });

let resolvedPath: string | null = null;

export async function resolveClaudeBinary(): Promise<void> {
  // 1. Try `which claude`
  try {
    const result = execSync("which claude", { encoding: "utf-8", timeout: 5000 }).trim();
    if (result && existsSync(result)) {
      resolvedPath = result;
      log.info("resolved via which", { path: resolvedPath });
      return;
    }
  } catch { /* not found */ }

  // 2. Try common global paths
  const candidates = [
    path.join(process.env.HOME ?? "", ".npm/bin/claude"),
    "/usr/local/bin/claude",
    path.join(process.env.HOME ?? "", ".local/bin/claude"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      resolvedPath = candidate;
      log.info("resolved via path scan", { path: resolvedPath });
      return;
    }
  }

  // 3. Fallback — will use npx
  log.warn("claude binary not found, will use npx fallback");
  resolvedPath = null;
}

export function getClaudeBinary(): { command: string; prefixArgs: string[] } {
  if (resolvedPath) {
    return { command: resolvedPath, prefixArgs: [] };
  }
  return { command: "npx", prefixArgs: ["-y", "@anthropic-ai/claude-code@latest"] };
}
