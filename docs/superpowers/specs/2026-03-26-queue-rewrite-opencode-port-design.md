# Queue Rewrite: OpenCode-Style Promise Callbacks + Server-Side Drain

**Date:** 2026-03-26
**Branch:** `zeus/11b061-fix-queue-logic`
**Status:** Approved

## Problem

The current queue implementation has fundamental issues:

1. **Queue lives in the frontend (Zustand store)** — drain decisions require a WebSocket round-trip: backend broadcasts `idle` → frontend receives → frontend sends `send_message` → backend forwards to subprocess. This adds latency and creates ordering issues.
2. **`drainInFlight` boolean + `setTimeout(500ms)` cooldown** — a timing hack to prevent double-drains. The 500ms window is arbitrary and race-prone. Multiple rapid `idle` events can still cause double-sends.
3. **Two separate drain paths** — `idle` (session alive, send follow-up) vs `done` (process exited, spawn new subprocess). These are handled in different code paths with duplicated queue-popping logic.
4. **No backpressure** — the frontend fires and forgets. There's no mechanism for the backend to signal "I received and processed your drain request" vs "I dropped it."

## Solution: OpenCode-Style Promise-Based Queue on ClaudeSession

Adopt OpenCode's core patterns:
- **Atomic server-side drain** — backend pops and sends in one step, no round-trip
- **Promise-based queueing** — `sendMessage()` returns a Promise that queues if busy
- **Loop never exits while callbacks exist** — `idle` activity only emits when queue is empty
- **Frontend becomes a mirror** — backend is source of truth, frontend renders from broadcasts

### Mapping OpenCode → Zeus

| OpenCode Concept | Zeus Implementation |
|------------------|---------------------|
| `loop()` running | `_isBusy = true` on `ClaudeSession` |
| `state()[sid].callbacks` array | `ClaudeSession.messageQueue` array |
| `callbacks.push({resolve, reject})` | `sendMessage()` queues + returns Promise when busy |
| Loop finishes → resolves callbacks | `result` event handler → auto-drain next |
| `defer()` re-entry after shell | After drain, stay `_isBusy = true`, never emit idle |
| `resume_existing: true` | `done` + queue not empty → emit `queue_needs_resume` |
| `start()` returns null if busy | `sendMessage()` queues instead of throwing |
| `cancel()` clears state | `kill()` / `interrupt()` rejects queued Promises |

## Architecture

### Backend: `ClaudeSession` Changes

New internal state on `ClaudeSession`:

```typescript
interface QueuedMessage {
  id: string;                              // Frontend-assigned ID for edit/delete
  content: string | ContentBlock[];        // Message content
  resolve: () => void;                     // Resolves when message is sent to subprocess
  reject: (err: Error) => void;            // Rejects on cancel/kill/error
  metadata?: Record<string, unknown>;      // File attachments, images, etc.
}

// New fields
private messageQueue: QueuedMessage[] = [];
private _isBusy = false;
```

**`sendMessage()` becomes the gate:**

```typescript
async sendMessage(
  content: string | ContentBlock[],
  options?: { id?: string; metadata?: Record<string, unknown> }
): Promise<void> {
  if (!this.protocol) throw new Error('Session not started');

  if (this._isBusy) {
    // Queue it — return Promise that resolves when actually sent
    return new Promise<void>((resolve, reject) => {
      const id = options?.id ?? `q-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      this.messageQueue.push({ id, content, resolve, reject, metadata: options?.metadata });
      this.emit('queue_updated', this.getQueueSnapshot());
    });
  }

  // Not busy — send immediately
  this._isBusy = true;
  await this.protocol.sendUserMessage(content);
}

// Note: start() also sets _isBusy = true after sending initial prompt
```

**`start()` sets busy:**

```typescript
async start(prompt: string): Promise<void> {
  // ... existing spawn + wire logic ...
  this._isBusy = true;
  await this.protocol.sendUserMessage(prompt);
}
```

**`result` event triggers auto-drain:**

The `processResult` method in `ClaudeLogProcessor` emits `idle` activity. We intercept this in `ClaudeSession` before it reaches `websocket.ts`:

```typescript
// In ClaudeSession constructor or start(), after wiring logProcessor:
this.logProcessor.onActivity((activity) => {
  if (activity.state === 'idle') {
    // Turn complete — try to drain queue
    if (this.drainNext()) {
      // Sent next message, stay busy. Don't emit idle.
      return;
    }
    // Queue empty — truly idle
    this._isBusy = false;
  }
  this.emit('activity', activity);
});
```

**`drainNext()` — atomic pop + send:**

```typescript
private drainNext(): boolean {
  if (this.messageQueue.length === 0) return false;

  const next = this.messageQueue.shift()!;
  this.emit('queue_drained', { id: next.id, content: next.content });
  this.emit('queue_updated', this.getQueueSnapshot());

  // Send to subprocess — resolve the caller's Promise
  this.protocol!.sendUserMessage(next.content)
    .then(() => next.resolve())
    .catch((err) => next.reject(err));

  return true; // Stays busy
}
```

**`done` event triggers resume:**

```typescript
// In start(), on process exit:
this.child.on('exit', (code, signal) => {
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
        remaining: this.messageQueue,  // Transfer remaining queue to new session
      });
    } else {
      if (code !== 0 && code !== null) {
        this.emit('error', new Error(`Claude CLI exited with code ${code}`));
      }
      this.emit('done', null);
    }
  }
});
```

**Cancel/kill rejects all queued Promises:**

```typescript
kill(): void {
  // Reject all queued messages
  for (const msg of this.messageQueue) {
    msg.reject(new Error('Session killed'));
  }
  this.messageQueue = [];
  this.emit('queue_updated', this.getQueueSnapshot());
  this.child?.kill('SIGTERM');
}
```

**Queue management (for frontend edit/delete):**

```typescript
editQueuedMessage(msgId: string, content: string): boolean {
  const item = this.messageQueue.find(m => m.id === msgId);
  if (!item) return false; // Already drained or doesn't exist
  item.content = content;
  this.emit('queue_updated', this.getQueueSnapshot());
  return true;
}

removeQueuedMessage(msgId: string): boolean {
  const idx = this.messageQueue.findIndex(m => m.id === msgId);
  if (idx === -1) return false;
  const [removed] = this.messageQueue.splice(idx, 1);
  removed.reject(new Error('Removed from queue'));
  this.emit('queue_updated', this.getQueueSnapshot());
  return true;
}

getQueueSnapshot(): Array<{ id: string; content: string }> {
  return this.messageQueue.map(m => ({
    id: m.id,
    content: typeof m.content === 'string' ? m.content : '[multi-part content]',
  }));
}
```

### Backend: `websocket.ts` Changes

**New event listeners in `wireClaudeSession()`:**

```typescript
session.on('queue_updated', (queue: Array<{ id: string; content: string }>) => {
  broadcastEnvelope({
    channel: 'claude',
    sessionId: envelope.sessionId,
    payload: { type: 'queue_updated', queue },
    auth: '',
  });
});

session.on('queue_drained', ({ id, content }) => {
  // Persist the drained message as a user entry
  upsertClaudeEntry(envelope.sessionId, {
    id: `user-${Date.now()}`,
    entryType: { type: 'user_message' },
    content: typeof content === 'string' ? content : '[multi-part content]',
  });
  broadcastEnvelope({
    channel: 'claude',
    sessionId: envelope.sessionId,
    payload: { type: 'queue_drained', msgId: id },
    auth: '',
  });
});

session.on('queue_needs_resume', async ({ content, resolve, reject, remaining }) => {
  // Spawn new session to resume with queued message
  try {
    const oldSession = claudeManager.getSession(envelope.sessionId);
    const newSession = claudeManager.createSession(envelope.sessionId, {
      ...oldSession!.options,
      resumeSessionId: oldSession!.sessionId!,
      resumeAtMessageId: oldSession!.lastMessageId!,
    });
    // Transfer remaining queue to new session
    newSession.transferQueue(remaining);
    wireClaudeSession(ws, envelope, newSession);
    await newSession.start(typeof content === 'string' ? content : '[resume]');
    resolve();
  } catch (err) {
    reject(err as Error);
  }
});
```

**New payload handlers:**

```typescript
// queue_message — explicit queue request from frontend
if (payload.type === 'queue_message') {
  const { id, content } = envelope.payload as { id: string; content: string };
  const session = claudeManager.getSession(envelope.sessionId);
  if (session) {
    session.sendMessage(content, { id }); // Will auto-queue if busy
  }
}

// edit_queued_message
if (payload.type === 'edit_queued_message') {
  const { msgId, content } = envelope.payload as { msgId: string; content: string };
  const session = claudeManager.getSession(envelope.sessionId);
  if (session) {
    const success = session.editQueuedMessage(msgId, content);
    // queue_updated broadcast happens inside editQueuedMessage
  }
}

// remove_queued_message
if (payload.type === 'remove_queued_message') {
  const { msgId } = envelope.payload as { msgId: string };
  const session = claudeManager.getSession(envelope.sessionId);
  if (session) {
    const success = session.removeQueuedMessage(msgId);
    // queue_updated broadcast happens inside removeQueuedMessage
  }
}
```

**`send_message` handler change:**

The existing `send_message` handler calls `session.sendMessage()` which now auto-queues if busy. No other changes needed — it becomes a safety net.

### Frontend: Store Changes

**Remove entirely:**
- `drainQueue()` function (~90 lines)
- `drainInFlight` module-level variable
- Queue drain logic from `session_activity` handler (line 959-961)
- Queue drain logic from `done` handler (line 964-976)
- `setTimeout(500ms)` cooldown

**`messageQueue` becomes a backend mirror:**

```typescript
// State shape stays the same
messageQueue: Record<string, Array<{ id: string; content: string }>>;

// But updates come from backend broadcasts, not local mutations
// In WebSocket message handler:
if (payload.type === 'queue_updated') {
  const { queue } = envelope.payload as { queue: Array<{ id: string; content: string }> };
  set((state) => ({
    messageQueue: { ...state.messageQueue, [sid]: queue },
  }));
}

if (payload.type === 'queue_drained') {
  const { msgId } = envelope.payload as { msgId: string };
  // Add optimistic user entry for the drained message
  const queue = get().messageQueue[sid] ?? [];
  const drained = queue.find(m => m.id === msgId);
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

**Store actions send WebSocket payloads instead of mutating locally:**

```typescript
queueMessage: (content: string) => {
  const { activeClaudeId } = get();
  if (!activeClaudeId) return;
  const id = `q-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  // Optimistic local add (backend will confirm via queue_updated)
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
  zeusWs.send({
    channel: 'claude',
    sessionId: activeClaudeId,
    payload: { type: 'remove_queued_message', msgId },
    auth: '',
  });
},
```

**`done` handler simplifies:**

```typescript
if (payload.type === 'done') {
  // Backend already checked queue. If queue had items, it resumed internally
  // and we never receive 'done'. If we get here, session is truly done.
  set((state) => ({
    claudeSessions: state.claudeSessions.map((s) =>
      s.id === sid ? { ...s, status: 'done' as const } : s,
    ),
    pendingApprovals: state.pendingApprovals.filter((a) => a.sessionId !== sid),
    sessionActivity: { ...state.sessionActivity, [sid]: { state: 'idle' } },
  }));
}
```

**`session_activity` handler simplifies:**

```typescript
if (payload.type === 'session_activity') {
  const { activity } = envelope.payload as { activity: SessionActivity };
  set((state) => ({
    sessionActivity: { ...state.sessionActivity, [sid]: activity },
    lastActivityAt: { ...state.lastActivityAt, [sid]: Date.now() },
  }));
  // No more drainQueue() call here — backend handles it
}
```

### Frontend: ClaudeView.tsx Submit Handler

```typescript
const handleSubmit = (e: React.FormEvent) => {
  e.preventDefault();
  const trimmed = message.trim();
  if (!trimmed) return;

  if (isBusy) {
    // Queue — backend will drain when session is ready
    onQueueMessage(trimmed);
  } else {
    // Send directly
    onSendMessage(trimmed, attachedFiles, attachedImages);
  }
  setMessage('');
  clearAttachments();
};
```

This stays nearly identical to current behavior. The `QueuedMessageItem` component stays the same — it renders from `messageQueue` which is now backend-mirrored.

### State Machine

```
                    ┌──────────────────────────┐
                    │                          │
  start(prompt) ──►│    BUSY (_isBusy=true)    │◄── sendMessage() while idle
                    │  sendMessage() queues     │
                    │                          │
                    └────────┬─────────────────┘
                             │
                      result event
                      (turn complete)
                             │
                    ┌────────▼─────────────────┐
                    │  drainNext()              │
                    │  Queue has items?         │
                    └────┬──────────────┬───────┘
                         │yes           │no
                    ┌────▼────┐    ┌────▼───────┐
                    │ Pop next│    │ IDLE        │
                    │ Send it │    │ _isBusy=f   │
                    │ Stay    │    │ Emit idle   │
                    │ BUSY    │    │ activity    │
                    └─────────┘    └────────────┘

  done event (process exits):
    ┌────────────────────────────┐
    │ Queue has items?           │
    └────┬──────────────┬────────┘
         │yes           │no
    ┌────▼──────────┐  ┌▼───────────────┐
    │ Pop next      │  │ Emit 'done'    │
    │ Emit          │  │ to frontend    │
    │ queue_needs_  │  │ Session ends   │
    │ resume        │  └────────────────┘
    │ Spawn new     │
    │ subprocess    │
    └───────────────┘
```

## Files Changed

| File | Change |
|------|--------|
| `src/main/services/claude-session.ts` | Add messageQueue, _isBusy, drainNext(), queue methods, modify sendMessage(), result/done handlers |
| `src/main/services/websocket.ts` | Wire queue_updated/queue_drained/queue_needs_resume events, add queue_message/edit/remove handlers |
| `src/renderer/src/stores/useZeusStore.ts` | Remove drainQueue + drainInFlight. Queue actions send WS payloads. Add queue_updated/queue_drained handlers. Simplify done/activity handlers. |
| `src/renderer/src/components/ClaudeView.tsx` | Minimal change — submit handler stays similar, queue UI stays similar |
| `src/shared/types.ts` | Add new payload types for queue messages |

## What We're NOT Changing

- `ClaudeLogProcessor` — still emits `idle` activity on `processResult`, `ClaudeSession` intercepts it
- `ProtocolPeer` — no changes
- `ClaudeView.tsx` queue UI (QueuedMessageItem) — stays the same, just reads from backend-mirrored state
- `NewSessionView.tsx` — no queue involvement
- File attachment handling in `send_message` — stays in `websocket.ts`, just needs to also work for queued messages with metadata

## Risks

1. **Queue transfer on resume** — When process exits and we spawn a new subprocess, remaining queued messages need to transfer to the new `ClaudeSession` instance. A `transferQueue()` method handles this.
2. **Race between queue_message and send_message** — Frontend might send `send_message` while session just became busy. Backend handles this gracefully since `sendMessage()` auto-queues if busy.
3. **Multiple rapid result events** — `drainNext()` is synchronous pop + async send. The `_isBusy` flag stays true throughout, preventing double-drain.
