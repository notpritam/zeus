# QA Agent Event Handling Fix — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix QA agent log display being stuck/incomplete by handling all Claude Code stream-json events correctly.

**Architecture:** Four-layer fix: (1) ClaudeLogProcessor gains tool streaming + tool result emission, (2) wireQAAgent gets robust text flush + new entry kinds, (3) shared types expand to cover thinking/status/system entries, (4) QAPanel renders them.

**Tech Stack:** TypeScript, Electron, React, Zustand

---

## Root Causes

1. **Text never flushes between back-to-back text blocks** — `wireQAAgent` only flushes pending text when a non-text entry arrives. Two consecutive `assistant_message` entries with different IDs should flush the first, but the ID-change check (line 486) has a subtle issue: it flushes the old one and starts accumulating the new one, which is correct — BUT the final text block before session end or a long gap never flushes because no subsequent entry triggers it.

2. **Tool results never emitted** — `ClaudeLogProcessor.processToolResult()` returns `[]`. The tool_use entries only arrive with `status: 'created'`. The actual result comes as a separate `tool_result` message type which the processor silently drops. `wireQAAgent` checks for `status === 'success'|'failed'` but these entries never arrive.

3. **`input_json_delta` silently dropped** — `processStreamEvent` handles `text_delta` and `thinking_delta` but not `input_json_delta`, creating gaps where the agent appears to do nothing while tool inputs stream.

4. **Missing entry kinds** — QA log only has 5 kinds. No `thinking`, `status`, or `system` entries, so reasoning and lifecycle events are invisible.

---

## Chunk 1: Fix ClaudeLogProcessor

### Task 1: Add tool_use streaming via input_json_delta

**Files:**
- Modify: `src/main/services/claude-log-processor.ts:16-175`
- Modify: `src/main/services/claude-types.ts:140-143`

- [ ] **Step 1: Add streaming tool state to ClaudeLogProcessor**

In `claude-log-processor.ts`, add new state fields after line 24:

```typescript
// Tool streaming state
private streamingToolId: string | null = null;
private streamingToolName: string | null = null;
private streamingToolInput = '';
private streamingToolEntryId: string | null = null;
```

- [ ] **Step 2: Handle content_block_start for tool_use blocks**

In `processStreamEvent`, inside the `content_block_start` case (after the thinking block at line 141), add:

```typescript
} else if (block.type === 'tool_use') {
  const toolBlock = block as { id: string; name: string };
  this.streamingToolId = toolBlock.id;
  this.streamingToolName = toolBlock.name;
  this.streamingToolInput = '';
  this.streamingToolEntryId = crypto.randomUUID();
  this.setActivity({ state: 'tool_running', toolName: toolBlock.name });
}
```

- [ ] **Step 3: Handle input_json_delta in content_block_delta**

In the `content_block_delta` case (after `thinking_delta` at line 162), add:

```typescript
} else if (delta.type === 'input_json_delta' && this.streamingToolEntryId) {
  this.streamingToolInput += (delta as { partial_json: string }).partial_json;
}
```

Also add `input_json_delta` to the `ContentBlockDelta` union in `claude-types.ts`:

```typescript
export type ContentBlockDelta =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; thinking: string }
  | { type: 'signature_delta'; signature: string }
  | { type: 'input_json_delta'; partial_json: string };
```

- [ ] **Step 4: Emit tool_use entry on content_block_stop for tool blocks**

In the `content_block_stop` case (line 166), replace the simple reset with:

```typescript
case 'content_block_stop':
  // Finalize any streaming text block
  this.streamingEntryId = null;
  this.thinkingEntryId = null;
  this.streamingText = '';
  this.streamingThinking = '';

  // Finalize any streaming tool_use block
  if (this.streamingToolEntryId && this.streamingToolName) {
    const toolName = this.streamingToolName;
    let parsedInput: Record<string, unknown> = {};
    try {
      parsedInput = JSON.parse(this.streamingToolInput);
    } catch { /* partial JSON — use raw */ }

    const actionType = this.extractActionType(toolName, parsedInput);
    const content = this.generateToolContent(toolName, parsedInput);

    if (this.streamingToolId) {
      this.toolMap.set(this.streamingToolId, {
        entryId: this.streamingToolEntryId,
        toolName,
        content,
      });
    }

    entries.push({
      id: this.streamingToolEntryId,
      entryType: { type: 'tool_use', toolName, actionType, status: 'created' },
      content,
    });

    this.streamingToolId = null;
    this.streamingToolName = null;
    this.streamingToolInput = '';
    this.streamingToolEntryId = null;
  }
  break;
```

Note: `content_block_stop` currently doesn't use `entries` — need to move the return to after the switch or collect entries across cases.

### Task 2: Fix processToolResult to emit status-updated entries

**Files:**
- Modify: `src/main/services/claude-log-processor.ts:108-115`

- [ ] **Step 1: Rewrite processToolResult**

Replace the empty `processToolResult` with one that emits updated tool entries:

```typescript
private processToolResult(msg: ClaudeJson): NormalizedEntry[] {
  const resultMsg = msg as {
    tool_use_id?: string;
    result?: unknown;
    is_error?: boolean;
  };

  const toolUseId = resultMsg.tool_use_id;
  if (!toolUseId) {
    this.setActivity({ state: 'streaming' });
    return [];
  }

  const tracked = this.toolMap.get(toolUseId);
  if (!tracked) {
    this.setActivity({ state: 'streaming' });
    return [];
  }

  const status = resultMsg.is_error ? 'failed' : 'success';
  const resultContent = typeof resultMsg.result === 'string'
    ? resultMsg.result
    : JSON.stringify(resultMsg.result ?? '').slice(0, 500);

  this.toolMap.delete(toolUseId);
  this.setActivity({ state: 'streaming' });

  return [{
    id: tracked.entryId,
    entryType: {
      type: 'tool_use',
      toolName: tracked.toolName,
      actionType: { action: 'other', description: tracked.toolName },
      status,
    },
    content: resultContent,
  }];
}
```

- [ ] **Step 2: Pass msg argument to processToolResult call**

At line 69, change:
```typescript
return this.processToolResult(msg);
```
(It's already correct — just verify the signature matches.)

---

## Chunk 2: Fix wireQAAgent + Add New Entry Kinds

### Task 3: Add new QA entry kinds to shared types

**Files:**
- Modify: `src/shared/types.ts:434-439`

- [ ] **Step 1: Expand QaAgentLogEntry union**

Replace the current union with:

```typescript
export type QaAgentLogEntry =
  | { kind: 'tool_call'; tool: string; args: string; timestamp: number }
  | { kind: 'tool_result'; tool: string; summary: string; success: boolean; timestamp: number }
  | { kind: 'text'; content: string; timestamp: number }
  | { kind: 'error'; message: string; timestamp: number }
  | { kind: 'user_message'; content: string; timestamp: number }
  | { kind: 'thinking'; content: string; timestamp: number }
  | { kind: 'status'; message: string; timestamp: number };
```

### Task 4: Fix wireQAAgent text flush and handle all entry types

**Files:**
- Modify: `src/main/services/websocket.ts:459-594`

- [ ] **Step 1: Add thinking entry handling**

After the `assistant_message` check (line 494), add handling for thinking entries:

```typescript
if (entry.entryType.type === 'thinking') {
  // Emit thinking as a separate entry kind
  broadcastEnvelope({
    channel: 'qa', sessionId: '', auth: '',
    payload: {
      type: 'qa_agent_entry',
      qaAgentId,
      parentSessionId,
      entry: { kind: 'thinking', content: entry.content.slice(0, 300), timestamp: now },
    },
  });
  return;
}
```

- [ ] **Step 2: Handle tool_use with ALL statuses**

The current code at line 502 checks `entry.entryType.type === 'tool_use'` and handles `created` and `success/failed/timed_out` separately. The fix is to ensure that when `processToolResult` now emits entries with `status: 'success'|'failed'`, they flow through here. The existing code at lines 528-545 already handles this correctly — the bug was that entries never arrived. Task 2 fixes the source. No changes needed here.

- [ ] **Step 3: Add status entries for session lifecycle**

After the error_message handler (line 559), add:

```typescript
if (entry.entryType.type === 'token_usage') {
  broadcastEnvelope({
    channel: 'qa', sessionId: '', auth: '',
    payload: {
      type: 'qa_agent_entry',
      qaAgentId,
      parentSessionId,
      entry: {
        kind: 'status',
        message: `Turn complete — ${(entry.entryType as { totalTokens: number }).totalTokens.toLocaleString()} tokens used`,
        timestamp: now,
      },
    },
  });
}
```

- [ ] **Step 4: Flush pending text on 'done' event** (already exists at line 568-569, verify it works)

The `session.on('done')` handler already calls `flushPendingText()` — this is correct. The real fix is in Task 2 making tool_result entries arrive, which causes the `flushPendingText()` at line 497 to fire more reliably.

---

## Chunk 3: Update QAPanel UI

### Task 5: Render new entry kinds in AgentLogEntry component

**Files:**
- Modify: `src/renderer/src/components/QAPanel.tsx:31-75`

- [ ] **Step 1: Add thinking entry rendering**

After the `user_message` block (line 73), add:

```typescript
if (entry.kind === 'thinking') {
  return (
    <div className="rounded bg-purple-500/10 px-1.5 py-0.5 text-[10px] text-purple-400 italic">
      <span className="mr-1 text-[9px] font-bold uppercase">Think</span>
      {entry.content}
    </div>
  );
}
if (entry.kind === 'status') {
  return (
    <div className="text-muted-foreground rounded px-1.5 py-0.5 text-center text-[9px] italic">
      {entry.message}
    </div>
  );
}
```

---

## Execution Order

1. Task 1 + Task 2 (ClaudeLogProcessor fixes) — these are the core bug fixes
2. Task 3 (shared types) — prerequisite for Tasks 4 and 5
3. Task 4 (wireQAAgent) — depends on Task 3
4. Task 5 (QAPanel UI) — depends on Task 3
5. Build and verify
