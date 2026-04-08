# Fix Claude CLI Session Spawning

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix sessions stuck on "starting" by restoring shell PATH in Electron, pinning Claude CLI version, and forwarding stderr to the UI.

**Architecture:** Electron strips the user's shell PATH when launched from Finder/dock, so `which claude` fails and child processes can't find `node`/`npm`. We fix PATH at boot, pin the CLI version to avoid npx download hangs, and surface stderr so failures are never silent.

**Tech Stack:** Electron, Node.js child_process, Claude Code CLI stream-json protocol

---

### Task 1: Fix PATH at Electron Startup

**Files:**
- Modify: `src/main/index.ts:0-24`

- [ ] **Step 1: Add fixElectronPath helper and call it before bootAll**

In `src/main/index.ts`, add a PATH fix right after the dotenv import and before any service registration. This ensures all subsequent `which`, `spawn`, and `execSync` calls see the full user PATH.

```typescript
// Add after line 4 (after dotenv load), before Electron imports:

// Fix PATH for Electron — when launched from Finder/dock, PATH is stripped to
// /usr/bin:/bin:/usr/sbin:/sbin. Prepend common user binary locations so that
// `which claude`, `node`, `npm`, and `npx` resolve correctly.
function fixElectronPath(): void {
  const home = process.env.HOME ?? '';
  const additions = [
    `${home}/.local/bin`,
    `${home}/.npm/bin`,
    '/usr/local/bin',
    `${home}/.nvm/versions/node/${process.version}/bin`,
    `${home}/.volta/bin`,
  ].filter(Boolean);
  const current = process.env.PATH ?? '';
  const missing = additions.filter(p => !current.includes(p));
  if (missing.length > 0) {
    process.env.PATH = [...missing, current].join(':');
  }
}

fixElectronPath();
```

- [ ] **Step 2: Verify the PATH fix works**

Run: `npm run build && grep -c 'fixElectronPath' out/main/index.mjs`
Expected: `1` (function is bundled)

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "fix: restore shell PATH at Electron startup for Claude CLI resolution"
```

---

### Task 2: Pin Claude CLI Version and Improve Binary Resolution

**Files:**
- Modify: `src/main/services/claude-cli.ts`

- [ ] **Step 1: Update claude-cli.ts to pin version and add logging**

Replace the full file content:

```typescript
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
```

Key changes:
- Path scan runs before `which` (faster, no shell dependency)
- `@latest` replaced with pinned `CLAUDE_CLI_VERSION = "2.1.92"`
- Added version to the warning log

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Clean build, no errors

- [ ] **Step 3: Commit**

```bash
git add src/main/services/claude-cli.ts
git commit -m "fix: pin Claude CLI to 2.1.92, prefer path scan over which"
```

---

### Task 3: Forward Stderr to UI as Error Entries

**Files:**
- Modify: `src/main/services/claude-session.ts:112-160`
- Modify: `src/main/server/handlers/claude.ts:113-298`

- [ ] **Step 1: Add stderr_line event emission in ClaudeSession**

In `src/main/services/claude-session.ts`, add a stderr timeout after spawning. If no stdout message arrives within 10 seconds, emit an error with the collected stderr. Also forward individual stderr lines.

After line 131 (`this._isRunning = true;`), add:

```typescript
    // Track stderr for startup failure diagnosis
    let stderrBuffer: string[] = [];
    let startupTimer: ReturnType<typeof setTimeout> | null = null;

    // If no stdout message within 10s, the CLI likely failed to start
    startupTimer = setTimeout(() => {
      if (this._isRunning && !this.protocol?.listenerCount('message')) {
        const stderrMsg = stderrBuffer.join('\n') || 'No output received';
        this.emit('error', new Error(`Claude CLI failed to start: ${stderrMsg}`));
      }
    }, 10_000);
```

Then modify the stderr handling in ProtocolPeer to also emit on the session. In `claude-session.ts`, after line 168 (after wiring protocol 'message'), add:

```typescript
    // Clear startup timer on first message — CLI is alive
    this.protocol.once('message', () => {
      if (startupTimer) { clearTimeout(startupTimer); startupTimer = null; }
    });

    // Forward stderr lines as UI-visible entries
    this.protocol.on('stderr_line', (line: string) => {
      stderrBuffer.push(line);
      this.emit('stderr_line', line);
    });
```

- [ ] **Step 2: Add stderr_line event in ProtocolPeer**

In `src/main/services/claude-protocol.ts`, modify the stderr handler (lines 63-70) to also emit a separate event:

```typescript
    // Stderr — log everything for debugging, forward non-noise as messages
    if (this.child.stderr) {
      const stderrRl = createInterface({ input: this.child.stderr });
      stderrRl.on('line', (line: string) => {
        console.error('[Claude stderr]', line);
        // Emit raw stderr line for startup diagnostics
        this.emit('stderr_line', line);
        if (line.includes('[WARN] Fast mode')) return;
        if (line.includes('npm warn')) return;
        this.emit('message', { type: 'stderr', content: line } as ClaudeJson);
      });
    }
```

- [ ] **Step 3: Wire stderr_line in the handler to broadcast to clients**

In `src/main/server/handlers/claude.ts`, inside `wireClaudeSession()`, after the `session.on("error", ...)` block (after line 288), add:

```typescript
  // Forward stderr lines as diagnostic entries (visible in session log)
  session.on("stderr_line", (line: string) => {
    ctx.broadcast({
      channel: "claude",
      sessionId: envelope.sessionId,
      payload: { type: "stderr_line", line },
      auth: "",
    });
  });
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Clean build, no errors

- [ ] **Step 5: Commit**

```bash
git add src/main/services/claude-session.ts src/main/services/claude-protocol.ts src/main/server/handlers/claude.ts
git commit -m "fix: forward stderr to UI, add startup timeout for stuck sessions"
```

---

### Task 4: Move ref-vibe-kanban to /tmp

**Files:**
- Move: `ref-vibe-kanban/` → `/tmp/ref-vibe-kanban`

- [ ] **Step 1: Move the directory**

```bash
mv /Users/notpritamm/Documents/Projects/zeus/ref-vibe-kanban /tmp/ref-vibe-kanban
```

- [ ] **Step 2: Verify it's gone from the project**

```bash
ls /Users/notpritamm/Documents/Projects/zeus/ref-vibe-kanban 2>&1
# Expected: No such file or directory

ls /tmp/ref-vibe-kanban 2>&1
# Expected: Directory listing
```

- [ ] **Step 3: Commit (if it was tracked)**

Check `git status` — if ref-vibe-kanban was in `.gitignore` or untracked, no commit needed. If tracked:

```bash
git add -u ref-vibe-kanban/
git commit -m "chore: move ref-vibe-kanban reference out of project tree"
```

---

### Task 5: Verify End-to-End

- [ ] **Step 1: Build the app**

```bash
cd /Users/notpritamm/Documents/Projects/zeus
npm run build
```

Expected: Clean build

- [ ] **Step 2: Launch and test session**

```bash
npm run dev
```

Open the Zeus UI, start a new Claude session with a simple prompt like "say hello". Verify:
- Session transitions from "starting" to active
- Response appears in the session log
- No infinite "starting" spinner

- [ ] **Step 3: Check logs for PATH resolution**

In the Electron dev console, look for:
```
[claude-cli] resolved via path scan { path: '/Users/notpritamm/.local/bin/claude' }
```
