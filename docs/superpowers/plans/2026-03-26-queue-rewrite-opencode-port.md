# Queue Rewrite: OpenCode-Style Promise Callbacks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the session message queue to use server-side Promise-based callbacks with atomic drain, eliminating frontend timing hacks.

**Architecture:** Move queue ownership from the renderer Zustand store to `ClaudeSession` in the main process. The backend atomically drains queued messages on turn completion — no WebSocket round-trip, no `setTimeout` cooldowns. The frontend becomes a mirror of backend queue state, still rendering the editable queue UI.

**Tech Stack:** TypeScript, Electron (main + renderer), WebSocket, Zustand

---

### Task 1: Add Queue Types to `src/shared/types.ts`

**Files:**
- Modify: `src/shared/types.ts:306-373`

- [ ] **Step 1: Add new payload interfaces after `ClaudeSendMessagePayload`**

Add these interfaces after line 306 in `src/shared/types.ts`:

```typescript
export interface ClaudeQueueMessagePayload {
  type: 'queue_message';
  id: string;
  content: string;
}

export interface ClaudeEditQueuedMessagePayload {
  type: 'edit_queued_message';
  msgId: string;
  content: string;
}

export interface ClaudeRemoveQueuedMessagePayload {
  type: 'remove_queued_message';
  msgId: string;
}
```

- [ ] **Step 2: Add the new types to the `ClaudePayload` union**

Update the `ClaudePayload` union (currently lines 359-373) to include the three new types:

```typescript
export type ClaudePayload =
  | ClaudeStartPayload
  | ClaudeResumePayload
  | ClaudeSendMessagePayload
  | ClaudeQueueMessagePayload
  | ClaudeEditQueuedMessagePayload
  | ClaudeRemoveQueuedMessagePayload
  | ClaudeApproveToolPayload
  | ClaudeDenyToolPayload
  | ClaudeInterruptPayload
  | ClaudeStopPayload
  | ClaudeListSessionsPayload
  | ClaudeSessionListPayload
  | ClaudeGetHistoryPayload
  | ClaudeHistoryPayload
  | ClaudeUpdateSessionPayload
  | ClaudeSessionUpdatedPayload
;
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd /Users/notpritamm/Documents/Projects/zeus/.worktrees/11b061-fix-queue-logic && npx tsc --noEmit --project src/shared/tsconfig.json 2>&1 | head -20`

If no shared tsconfig exists, just run: `npx tsc --noEmit 2>&1 | tail -20`

Expected: No errors related to the new types.

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(queue): add queue message payload types to shared types"
```

---

### Task 2: Add Queue + Promise Callbacks to `ClaudeSession`

**Files:**
- Modify: `src/main/services/claude-session.ts:49-211`

This is the core change. `ClaudeSession` gets an internal message queue with Promise-based callbacks, a `_isBusy` flag, and atomic drain logic.

- [ ] **Step 1: Add the QueuedMessage interface and new fields**

After the `ApprovalRequest` interface (line 47), add:

```typescript
export interface QueuedMessage {
  id: string;
  content: string | import('./claude-types').ContentBlock[];
  resolve: () => void;
  reject: (err: Error) => void;
}
```

Inside the `ClaudeSession` class, after the existing private fields (after line 59), add:

```typescript
  private messageQueue: QueuedMessage[] = [];
  private _isBusy = false;
```

Add public getters after the existing getters (after line 73):

```typescript
  get isBusy(): boolean {
    return this._isBusy;
  }
  get workingDir(): string {
    return this.options.workingDir;
  }
```

- [ ] **Step 2: Modify the constructor to intercept idle activity**

Replace the activity wiring in the constructor (lines 80-82):

Old:
```typescript
    this.logProcessor.onActivity((activity) => {
      this.emit('activity', activity);
    });
```

New:
```typescript
    this.logProcessor.onActivity((activity) => {
      if (activity.state === 'idle') {
        // Turn complete — try to drain queue before emitting idle
        if (this.drainNext()) {
          // Sent next queued message, stay busy. Don't emit idle to frontend.
          return;
        }
        // Queue empty — truly idle
        this._isBusy = false;
      }
      this.emit('activity', activity);
    });
```

- [ ] **Step 3: Add `_isBusy = true` to `start()`**

In the `start()` method, after `await this.protocol.sendUserMessage(prompt);` (line 162), the session is now busy. Add `this._isBusy = true;` right before that line.

Replace lines 161-162:

Old:
```typescript
    await this.protocol.setPermissionMode(mode);
    await this.protocol.sendUserMessage(prompt);
```

New:
```typescript
    await this.protocol.setPermissionMode(mode);
    this._isBusy = true;
    await this.protocol.sendUserMessage(prompt);
```

- [ ] **Step 4: Rewrite `sendMessage()` to auto-queue when busy**

Replace the entire `sendMessage` method (lines 165-169):

Old:
```typescript
  /** Send a follow-up message to an active session */
  async sendMessage(content: string | import('./claude-types').ContentBlock[]): Promise<void> {
    if (!this.protocol) throw new Error('Session not started');
    await this.protocol.sendUserMessage(content);
  }
```

New:
```typescript
  /** Send a follow-up message — queues automatically if session is busy */
  async sendMessage(
    content: string | import('./claude-types').ContentBlock[],
    options?: { id?: string },
  ): Promise<void> {
    if (!this.protocol) throw new Error('Session not started');

    if (this._isBusy) {
      // Queue it — return Promise that resolves when actually sent
      return new Promise<void>((resolve, reject) => {
        const id = options?.id ?? `q-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        this.messageQueue.push({ id, content, resolve, reject });
        this.emit('queue_updated', this.getQueueSnapshot());
      });
    }

    // Not busy — send immediately
    this._isBusy = true;
    await this.protocol.sendUserMessage(content);
  }
```

- [ ] **Step 5: Modify `exit` handler to check queue before emitting `done`**

Replace the exit handler (lines 106-115):

Old:
```typescript
    this.child.on('exit', (code, signal) => {
      console.log(`[Claude] Process exited: code=${code} signal=${signal}`);
      if (this._isRunning) {
        this._isRunning = false;
        if (code !== 0 && code !== null) {
          this.emit('error', new Error(`Claude CLI exited with code ${code}`));
        }
        this.emit('done', null);
      }
    });
```

New:
```typescript
    this.child.on('exit', (code, signal) => {
      console.log(`[Claude] Process exited: code=${code} signal=${signal}`);
      if (this._isRunning) {
        this._isRunning = false;
        this._isBusy = false;

        if (this.messageQueue.length > 0) {
          // Queue has items — request resume instead of emitting done
          const next = this.messageQueue.shift()!;
          this.emit('queue_drained', { id: next.id, content: next.content });
          this.emit('queue_updated', this.getQueueSnapshot());
          this.emit('queue_needs_resume', {
            content: next.content,
            resolve: next.resolve,
            reject: next.reject,
            remaining: [...this.messageQueue],
          });
          return;
        }

        if (code !== 0 && code !== null) {
          this.emit('error', new Error(`Claude CLI exited with code ${code}`));
        }
        this.emit('done', null);
      }
    });
```

- [ ] **Step 6: Modify `kill()` to reject queued Promises and add `drainNext()` + queue management methods**

Replace `kill()` (lines 205-211):

Old:
```typescript
  /** Kill the session process */
  kill(): void {
    // Don't set _isRunning = false here — let the exit/close handler do it
    // so that the 'done' event is properly emitted and listeners (e.g. wireSubagent)
    // can run cleanup like broadcasting subagent_stopped.
    this.child?.kill('SIGTERM');
  }
```

New:
```typescript
  /** Kill the session process — rejects all queued messages */
  kill(): void {
    for (const msg of this.messageQueue) {
      msg.reject(new Error('Session killed'));
    }
    this.messageQueue = [];
    this.emit('queue_updated', this.getQueueSnapshot());
    // Don't set _isRunning = false here — let the exit/close handler do it
    // so that the 'done' event is properly emitted and listeners (e.g. wireSubagent)
    // can run cleanup like broadcasting subagent_stopped.
    this.child?.kill('SIGTERM');
  }

  // --- Queue Management ---

  /** Atomically pop next queued message and send it. Returns true if drained. */
  private drainNext(): boolean {
    if (this.messageQueue.length === 0) return false;

    const next = this.messageQueue.shift()!;
    this.emit('queue_drained', { id: next.id, content: next.content });
    this.emit('queue_updated', this.getQueueSnapshot());

    // Send to subprocess — resolve the caller's Promise
    this._isBusy = true;
    this.protocol!.sendUserMessage(next.content)
      .then(() => next.resolve())
      .catch((err) => next.reject(err));

    return true;
  }

  /** Edit a queued message (if not yet drained). Returns false if already sent. */
  editQueuedMessage(msgId: string, content: string): boolean {
    const item = this.messageQueue.find((m) => m.id === msgId);
    if (!item) return false;
    item.content = content;
    this.emit('queue_updated', this.getQueueSnapshot());
    return true;
  }

  /** Remove a queued message (if not yet drained). Returns false if already sent. */
  removeQueuedMessage(msgId: string): boolean {
    const idx = this.messageQueue.findIndex((m) => m.id === msgId);
    if (idx === -1) return false;
    const [removed] = this.messageQueue.splice(idx, 1);
    removed.reject(new Error('Removed from queue'));
    this.emit('queue_updated', this.getQueueSnapshot());
    return true;
  }

  /** Get a snapshot of the current queue for frontend display. */
  getQueueSnapshot(): Array<{ id: string; content: string }> {
    return this.messageQueue.map((m) => ({
      id: m.id,
      content: typeof m.content === 'string' ? m.content : '[multi-part content]',
    }));
  }

  /** Transfer queued messages from another session (used during resume). */
  transferQueue(queue: QueuedMessage[]): void {
    this.messageQueue.push(...queue);
    if (queue.length > 0) {
      this.emit('queue_updated', this.getQueueSnapshot());
    }
  }
```

- [ ] **Step 7: Verify typecheck passes**

Run: `cd /Users/notpritamm/Documents/Projects/zeus/.worktrees/11b061-fix-queue-logic && npx tsc --noEmit 2>&1 | tail -30`

Expected: No new errors (existing errors unrelated to this change are OK).

- [ ] **Step 8: Commit**

```bash
git add src/main/services/claude-session.ts
git commit -m "feat(queue): add Promise-based message queue to ClaudeSession

Server-side queue with atomic drain on turn completion.
sendMessage() auto-queues when busy. Queue supports
edit/remove/transfer for frontend mirroring."
```

---

### Task 3: Wire Queue Events in `websocket.ts`

**Files:**
- Modify: `src/main/services/websocket.ts:533-674` (wireClaudeSession)
- Modify: `src/main/services/websocket.ts:1224-1306` (send_message handler)
- Modify: `src/main/services/websocket.ts:1164-1223` (resume_claude handler)

- [ ] **Step 1: Add queue event listeners to `wireClaudeSession()`**

After the `session.on('error', ...)` block (after line 673, before the closing `}` of `wireClaudeSession` on line 674), add:

```typescript

  // Forward queue state changes to frontend
  session.on('queue_updated', (queue: Array<{ id: string; content: string }>) => {
    broadcastEnvelope({
      channel: 'claude',
      sessionId: envelope.sessionId,
      payload: { type: 'queue_updated', queue },
      auth: '',
    });
  });

  // Persist drained message as user entry + notify frontend
  session.on('queue_drained', ({ id, content }: { id: string; content: string | unknown }) => {
    const textContent = typeof content === 'string' ? content : '[multi-part content]';
    upsertClaudeEntry(envelope.sessionId, {
      id: `user-${Date.now()}`,
      entryType: { type: 'user_message' },
      content: textContent,
    });
    broadcastEnvelope({
      channel: 'claude',
      sessionId: envelope.sessionId,
      payload: { type: 'queue_drained', msgId: id },
      auth: '',
    });
  });

  // Handle resume request when process exits with queued messages
  session.on('queue_needs_resume', async (data: {
    content: string | unknown;
    resolve: () => void;
    reject: (err: Error) => void;
    remaining: import('./claude-session').QueuedMessage[];
  }) => {
    try {
      const oldSessionId = session.sessionId;
      const oldMessageId = session.lastMessageId;
      if (!oldSessionId || !oldMessageId) {
        data.reject(new Error('Cannot resume: missing session or message ID'));
        return;
      }

      const promptText = typeof data.content === 'string' ? data.content : '[resume]';

      const newSession = await claudeManager.resumeSession(
        envelope.sessionId,
        oldSessionId,
        promptText,
        { workingDir: session.workingDir, zeusSessionId: envelope.sessionId },
      );

      // Transfer remaining queue to new session
      newSession.transferQueue(data.remaining);

      // Re-wire events for the new session instance
      wireClaudeSession(ws, newSession, envelope);

      // Persist & broadcast
      updateClaudeSessionStatus(envelope.sessionId, 'running', null);
      broadcastEnvelope({
        channel: 'claude',
        sessionId: envelope.sessionId,
        payload: { type: 'claude_started' },
        auth: '',
      });

      data.resolve();
    } catch (err) {
      data.reject(err as Error);
    }
  });
```

- [ ] **Step 2: Add `queue_message`, `edit_queued_message`, `remove_queued_message` handlers**

In the `handleClaude` function, after the `send_message` handler block (after line 1306), add these new handlers:

```typescript
  } else if (payload.type === 'queue_message') {
    const { id, content } = envelope.payload as { id: string; content: string };
    const session = claudeManager.getSession(envelope.sessionId);
    if (session) {
      adoptClaudeSession(ws, envelope.sessionId);
      // sendMessage auto-queues if busy, sends immediately if idle
      session.sendMessage(content, { id }).catch((err) => {
        console.warn('[WS] queue_message failed:', (err as Error).message);
      });
    } else {
      sendError(ws, envelope.sessionId, 'No active Claude session for this ID');
    }
  } else if (payload.type === 'edit_queued_message') {
    const { msgId, content } = envelope.payload as { msgId: string; content: string };
    const session = claudeManager.getSession(envelope.sessionId);
    if (session) {
      session.editQueuedMessage(msgId, content);
      // queue_updated broadcast happens inside editQueuedMessage
    }
  } else if (payload.type === 'remove_queued_message') {
    const { msgId } = envelope.payload as { msgId: string };
    const session = claudeManager.getSession(envelope.sessionId);
    if (session) {
      session.removeQueuedMessage(msgId);
      // queue_updated broadcast happens inside removeQueuedMessage
    }
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd /Users/notpritamm/Documents/Projects/zeus/.worktrees/11b061-fix-queue-logic && npx tsc --noEmit 2>&1 | tail -30`

Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/services/websocket.ts
git commit -m "feat(queue): wire queue events in websocket handlers

Add queue_updated, queue_drained, queue_needs_resume event listeners
to wireClaudeSession. Add queue_message, edit_queued_message,
remove_queued_message payload handlers."
```

---

### Task 4: Rewrite Frontend Store Queue Logic

**Files:**
- Modify: `src/renderer/src/stores/useZeusStore.ts:396-495` (remove drainQueue)
- Modify: `src/renderer/src/stores/useZeusStore.ts:951-976` (simplify activity/done handlers)
- Modify: `src/renderer/src/stores/useZeusStore.ts:2105-2139` (queue actions → WebSocket)

- [ ] **Step 1: Remove `drainInFlight` and `drainQueue()`**

Delete the `drainInFlight` variable (line 396) and the entire `drainQueue` function (lines 401-495). Also remove the `pendingSessionTerminals` map if it's only used by queue logic — check first. If `pendingSessionTerminals` is used elsewhere (it is — for terminal session correlation), keep it.

Specifically, replace lines 396-400 (drainInFlight + pendingSessionTerminals comment):

Old (line 396):
```typescript
let drainInFlight: Record<string, boolean> = {};
```

Replace with nothing — delete the line entirely.

Then delete the entire `drainQueue` function block from lines 401-495 (the JSDoc comment + function body).

- [ ] **Step 2: Simplify the `session_activity` handler**

Replace lines 951-961:

Old:
```typescript
      if (payload.type === 'session_activity') {
        const { activity } = envelope.payload as { activity: SessionActivity };
        set((state) => ({
          sessionActivity: { ...state.sessionActivity, [sid]: activity },
          lastActivityAt: { ...state.lastActivityAt, [sid]: Date.now() },
        }));

        // Auto-drain queued messages when session becomes idle
        if (activity.state === 'idle') {
          drainQueue(sid, 'idle', get, set);
        }
      }
```

New:
```typescript
      if (payload.type === 'session_activity') {
        const { activity } = envelope.payload as { activity: SessionActivity };
        set((state) => ({
          sessionActivity: { ...state.sessionActivity, [sid]: activity },
          lastActivityAt: { ...state.lastActivityAt, [sid]: Date.now() },
        }));
        // Queue drain is handled server-side — no frontend logic needed
      }
```

- [ ] **Step 3: Simplify the `done` handler**

Replace lines 964-976:

Old:
```typescript
      if (payload.type === 'done') {
        // Try to drain queue first — if there are queued messages, auto-resume
        const drained = drainQueue(sid, 'done', get, set);
        if (!drained) {
          set((state) => ({
            claudeSessions: state.claudeSessions.map((s) =>
              s.id === sid ? { ...s, status: 'done' as const } : s,
            ),
            pendingApprovals: state.pendingApprovals.filter((a) => a.sessionId !== sid),
            sessionActivity: { ...state.sessionActivity, [sid]: { state: 'idle' } },
          }));
        }
      }
```

New:
```typescript
      if (payload.type === 'done') {
        // Backend already checked queue — if items existed, it resumed internally
        // and we never receive 'done'. If we get here, session is truly finished.
        set((state) => ({
          claudeSessions: state.claudeSessions.map((s) =>
            s.id === sid ? { ...s, status: 'done' as const } : s,
          ),
          pendingApprovals: state.pendingApprovals.filter((a) => a.sessionId !== sid),
          sessionActivity: { ...state.sessionActivity, [sid]: { state: 'idle' } },
        }));
      }
```

- [ ] **Step 4: Add `queue_updated` and `queue_drained` handlers**

In the same WebSocket message handler, after the `done` handler block, add handlers for the new backend events:

```typescript
      if (payload.type === 'queue_updated') {
        const { queue } = envelope.payload as { queue: Array<{ id: string; content: string }> };
        set((state) => ({
          messageQueue: { ...state.messageQueue, [sid]: queue },
        }));
      }

      if (payload.type === 'queue_drained') {
        const { msgId } = envelope.payload as { msgId: string };
        // Add user entry for the drained message
        const queue = get().messageQueue[sid] ?? [];
        const drained = queue.find((m) => m.id === msgId);
        if (drained) {
          const userEntry: NormalizedEntry = {
            id: `user-${Date.now()}`,
            entryType: { type: 'user_message' },
            content: drained.content,
            timestamp: new Date().toISOString(),
          };
          set((state) => ({
            claudeEntries: {
              ...state.claudeEntries,
              [sid]: [...(state.claudeEntries[sid] ?? []), userEntry],
            },
            lastUserMessagePreview: {
              ...state.lastUserMessagePreview,
              [sid]: truncatePreview(drained.content),
            },
          }));
        }
      }
```

- [ ] **Step 5: Rewrite `queueMessage`, `editQueuedMessage`, `removeQueuedMessage` to send WebSocket payloads**

Replace lines 2105-2139:

Old:
```typescript
  queueMessage: (content: string) => {
    const { activeClaudeId } = get();
    if (!activeClaudeId) return;
    const msg = { id: `q-${Date.now()}-${Math.random()}`, content };
    set((state) => ({
      messageQueue: {
        ...state.messageQueue,
        [activeClaudeId]: [...(state.messageQueue[activeClaudeId] ?? []), msg],
      },
    }));
  },

  editQueuedMessage: (msgId: string, content: string) => {
    const { activeClaudeId } = get();
    if (!activeClaudeId) return;
    set((state) => ({
      messageQueue: {
        ...state.messageQueue,
        [activeClaudeId]: (state.messageQueue[activeClaudeId] ?? []).map((m) =>
          m.id === msgId ? { ...m, content } : m,
        ),
      },
    }));
  },

  removeQueuedMessage: (msgId: string) => {
    const { activeClaudeId } = get();
    if (!activeClaudeId) return;
    set((state) => ({
      messageQueue: {
        ...state.messageQueue,
        [activeClaudeId]: (state.messageQueue[activeClaudeId] ?? []).filter((m) => m.id !== msgId),
      },
    }));
  },
```

New:
```typescript
  queueMessage: (content: string) => {
    const { activeClaudeId } = get();
    if (!activeClaudeId) return;
    const id = `q-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    // Optimistic local add — backend will confirm via queue_updated
    set((state) => ({
      messageQueue: {
        ...state.messageQueue,
        [activeClaudeId]: [...(state.messageQueue[activeClaudeId] ?? []), { id, content }],
      },
    }));
    zeusWs.send({
      channel: 'claude',
      sessionId: activeClaudeId,
      payload: { type: 'queue_message', id, content },
      auth: '',
    });
  },

  editQueuedMessage: (msgId: string, content: string) => {
    const { activeClaudeId } = get();
    if (!activeClaudeId) return;
    // Optimistic local update
    set((state) => ({
      messageQueue: {
        ...state.messageQueue,
        [activeClaudeId]: (state.messageQueue[activeClaudeId] ?? []).map((m) =>
          m.id === msgId ? { ...m, content } : m,
        ),
      },
    }));
    zeusWs.send({
      channel: 'claude',
      sessionId: activeClaudeId,
      payload: { type: 'edit_queued_message', msgId, content },
      auth: '',
    });
  },

  removeQueuedMessage: (msgId: string) => {
    const { activeClaudeId } = get();
    if (!activeClaudeId) return;
    // Optimistic local remove
    set((state) => ({
      messageQueue: {
        ...state.messageQueue,
        [activeClaudeId]: (state.messageQueue[activeClaudeId] ?? []).filter((m) => m.id !== msgId),
      },
    }));
    zeusWs.send({
      channel: 'claude',
      sessionId: activeClaudeId,
      payload: { type: 'remove_queued_message', msgId },
      auth: '',
    });
  },
```

- [ ] **Step 6: Verify typecheck passes**

Run: `cd /Users/notpritamm/Documents/Projects/zeus/.worktrees/11b061-fix-queue-logic && npx tsc --noEmit 2>&1 | tail -30`

Expected: No new errors. Old references to `drainQueue` should be gone.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/stores/useZeusStore.ts
git commit -m "feat(queue): rewrite frontend store to mirror backend queue

Remove drainQueue, drainInFlight, and setTimeout cooldown.
Queue actions now send WebSocket payloads to backend.
Add queue_updated and queue_drained handlers.
Simplify session_activity and done handlers."
```

---

### Task 5: Verify `ClaudeView.tsx` Compatibility

**Files:**
- Review: `src/renderer/src/components/ClaudeView.tsx:24-69, 89-109, 336-357, 478-485`

The `ClaudeView.tsx` component should work without changes because:
- `QueuedMessageItem` reads from `queue` prop (unchanged shape)
- `handleSubmit` calls `onQueueMessage` when busy (unchanged)
- `onEditQueued` and `onRemoveQueued` call store actions (which now send WebSocket payloads)

- [ ] **Step 1: Verify no code changes are needed**

Read `ClaudeView.tsx` and confirm:
1. The `queue` prop type is `Array<{ id: string; content: string }>` — matches backend snapshot format
2. `onQueueMessage`, `onEditQueued`, `onRemoveQueued` are called the same way
3. `isBusy` check (line 336) still works — it reads `activity.state !== 'idle'`

No code changes expected. If the submit handler still references `onQueueMessage` and the store actions send WebSocket payloads, everything connects.

- [ ] **Step 2: Verify typecheck passes for the full project**

Run: `cd /Users/notpritamm/Documents/Projects/zeus/.worktrees/11b061-fix-queue-logic && npx tsc --noEmit 2>&1 | tail -30`

Expected: Clean (or only pre-existing errors unrelated to queue).

- [ ] **Step 3: Build the project**

Run: `cd /Users/notpritamm/Documents/Projects/zeus/.worktrees/11b061-fix-queue-logic && npm run build 2>&1 | tail -30`

Expected: Build succeeds.

---

### Task 6: Final Integration Verification

**Files:**
- All modified files

- [ ] **Step 1: Full typecheck**

Run: `cd /Users/notpritamm/Documents/Projects/zeus/.worktrees/11b061-fix-queue-logic && npx tsc --noEmit 2>&1 | tail -30`

Expected: No new errors.

- [ ] **Step 2: Run tests**

Run: `cd /Users/notpritamm/Documents/Projects/zeus/.worktrees/11b061-fix-queue-logic && npm run test 2>&1 | tail -30`

Expected: All tests pass (or only pre-existing failures unrelated to queue).

- [ ] **Step 3: Build**

Run: `cd /Users/notpritamm/Documents/Projects/zeus/.worktrees/11b061-fix-queue-logic && npm run build 2>&1 | tail -30`

Expected: Build succeeds.

- [ ] **Step 4: Verify old queue code is fully removed**

Run: `grep -rn 'drainQueue\|drainInFlight' src/ --include='*.ts' --include='*.tsx'`

Expected: Zero results.

- [ ] **Step 5: Verify new queue code is in place**

Run: `grep -rn 'queue_updated\|queue_drained\|queue_needs_resume\|drainNext\|messageQueue' src/ --include='*.ts' --include='*.tsx'`

Expected: Matches in `claude-session.ts`, `websocket.ts`, `useZeusStore.ts`.

- [ ] **Step 6: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(queue): final integration fixes for queue rewrite"
```
