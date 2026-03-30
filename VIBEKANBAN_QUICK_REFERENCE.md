# Vibekanban Quick Reference for Zeus

## 1-Minute Overview
Vibekanban is a mature, production-grade reference for AI-powered orchestration. It demonstrates:
- **Full-stack type safety**: Rust structs → TypeScript interfaces via ts-rs
- **Real-time AI chat**: Normalized conversation model + approval gates
- **Complex UI patterns**: Virtual scrolling, entry aggregation, diff viewing
- **Multi-executor support**: Works with Claude Code, Gemini, Copilot, etc.
- **Monorepo organization**: Rust crates + JS workspaces with code generation

---

## Key Architectural Components

### Frontend
| Component | Purpose | Path |
|-----------|---------|------|
| `web-core` | Shared React logic (state, hooks, components) | `packages/web-core/src/` |
| `workspace-chat` | AI chat UI + conversation derivation | `packages/web-core/src/features/workspace-chat/` |
| `DisplayConversationEntry` | Main entry renderer (1400 lines) | `...workspace-chat/ui/DisplayConversationEntry.tsx` |
| `SessionChatBoxContainer` | Chat input + execution status | `...workspace-chat/ui/SessionChatBoxContainer.tsx` |
| `ui` | 160+ reusable components | `packages/ui/src/components/` |

### Backend
| Service | Purpose | Path |
|---------|---------|------|
| `server` | Axum REST API + WebSocket | `crates/server/src/` |
| `db` | SQLx models + migrations | `crates/db/src/models/` |
| `api-types` | Shared Rust types (ts-rs) | `crates/api-types/src/` |
| `services` | Business logic (session, execution) | `crates/services/src/` |
| `executors` | Executor discovery + MCP | `crates/executors/src/` |

### State Management
| Tool | Purpose | Path |
|------|---------|------|
| React Query | Server state + real-time polling | `packages/web-core/src/shared/hooks/` |
| Zustand | Local UI state (persisted) | `packages/web-core/src/shared/stores/` |
| Context API | Feature-scoped state | `packages/web-core/src/features/*/contexts/` |

---

## Critical Patterns Zeus Should Copy

### 1. NormalizedEntry Type
**File**: `shared/types.ts` (generated from Rust)

Single unified type for all conversation items:
```typescript
interface NormalizedEntry {
  entry_type: NormalizedEntryType; // Discriminated union
  content: string;
  metadata?: unknown;
}

type NormalizedEntryType =
  | { type: 'user_message' }
  | { type: 'assistant_message' }
  | { type: 'tool_use'; action_type: ActionType; status: ToolStatus }
  | { type: 'thinking' }
  | { type: 'error_message' }
  | ...;
```

**Why**: Exhaustive pattern matching in rendering, impossible to forget a case.

---

### 2. Conversation Derivation Pipeline
**Files**: `deriveConversationEntries.ts`, `deriveConversationTurns.ts`

Transform raw DB entries → UI-ready entries:
```
Raw Entries (from DB)
  ↓
deriveConversationTurns() [determine turn type]
  ↓
deriveConversationEntries() [group, aggregate, render]
  ↓
PatchTypeWithKey[] → Virtual scrolling
```

**Why**: Separates data transformation from UI rendering.

---

### 3. Entry Aggregation
**File**: `deriveConversationEntries.ts` (lines 1128+)

Groups consecutive similar entries:
```
5x file_read entries → "Read 5 files" (collapsible)
3x file_edit (same file) → "Edited 3 times" (grouped diff)
10x thinking → "Thinking..." (collapsed)
```

**Why**: Reduces visual noise in chat. Zeus terminal output would benefit hugely from this.

---

### 4. Execution Status Computation
**File**: `SessionChatBoxContainer.tsx` (lines 67-84)

```typescript
function computeExecutionStatus(params: {
  isInFeedbackMode: boolean;
  isInEditMode: boolean;
  isStopping: boolean;
  isQueueLoading: boolean;
  isSendingFollowUp: boolean;
  isQueued: boolean;
  isAttemptRunning: boolean;
}): ExecutionStatus {
  if (params.isInFeedbackMode) return 'feedback';
  if (params.isInEditMode) return 'edit';
  if (params.isStopping) return 'stopping';
  // ...
  return 'idle';
}
```

**Why**: Clear, testable status determination. Each UI mode has explicit precedence.

---

### 5. Query Key Factory
**File**: `workspaceSummaryKeys.ts`

```typescript
export const workspaceSummaryKeys = {
  execution: (workspaceId: string) => 
    ['workspace', workspaceId, 'execution'],
  sessions: (workspaceId: string) => 
    ['workspace', workspaceId, 'sessions'],
};
```

**Why**: Centralized keys. Easy to invalidate related queries together.

```typescript
// Usage
queryClient.invalidateQueries({
  queryKey: workspaceSummaryKeys.execution(workspaceId)
});
```

---

### 6. Persisted Expansion State
**File**: `useUiPreferencesStore.ts`

```typescript
const [expanded, toggle] = usePersistedExpanded(
  `edit:${filePath}:${idx}`,
  status === 'pending_approval' // auto-expand when pending
);
```

**Why**: User preferences persist across refreshes. Auto-expand important items.

---

### 7. Tool-Specific Rendering
**File**: `DisplayConversationEntry.tsx` (lines 338+)

Exhaustive switch on `entry_type.type`, then `action_type.action`:
```typescript
switch (entryType.type) {
  case 'tool_use':
    switch (action_type.action) {
      case 'file_edit': return <FileEditEntry />;
      case 'command_run': return <ToolSummaryEntry />;
      case 'plan_presentation': return <PlanEntry />;
      case 'task_create': return <SubagentEntry />;
      // ...
    }
  case 'user_message': return <UserMessageEntry />;
  // ...
}
```

**Why**: Exhaustive coverage. TypeScript catches missing cases.

---

### 8. Real-time via Polling
**File**: `useWorkspaceExecution.ts`

```typescript
const { data: execution } = useQuery({
  queryKey: workspaceSummaryKeys.execution(workspaceId),
  queryFn: () => workspacesApi.getExecution(workspaceId),
  refetchInterval: 1000, // Poll every 1s
});
```

**Why**: Works over HTTP. Simpler than WebSocket for MVP. Upgrade later if needed.

---

### 9. Type Safety: Rust → TypeScript
**Flow**: `Cargo.toml` → `crates/api-types/src/issue.rs` → `pnpm run generate-types` → `shared/types.ts`

```rust
// Rust
#[derive(TS, Serialize, Deserialize)]
pub struct Session {
  pub id: String,
  pub executor: String,
}
```

becomes

```typescript
// TypeScript (auto-generated, do not edit)
interface Session {
  id: string;
  executor: string;
}
```

**Why**: Single source of truth. No hand-written TS types = fewer bugs.

---

### 10. Feature-Scoped Contexts
**Pattern**: Avoid prop drilling for feature-specific state.

```typescript
// In workspace-chat/
<EntriesContext.Provider value={{entries, tokenUsage}}>
  <MessageEditContext.Provider value={{startEdit, isEntryGreyed}}>
    <ApprovalFeedbackContext.Provider value={{feedback, submit}}>
      <SessionChatBoxContainer />
    </ApprovalFeedbackContext.Provider>
  </MessageEditContext.Provider>
</EntriesContext.Provider>
```

**Why**: Clean API. Easy to test. No prop drilling.

---

## File Structure Template for Zeus

```
src/
├── features/
│   ├── session-chat/           # Main AI chat feature
│   │   ├── model/
│   │   │   ├── deriveSessionEntries.ts      # Transform entries
│   │   │   ├── deriveExecutionTurns.ts      # Determine turn state
│   │   │   ├── contexts/
│   │   │   │   ├── EntriesContext.tsx
│   │   │   │   ├── ExecutionContext.tsx
│   │   │   │   └── ApprovalContext.tsx
│   │   │   └── hooks/
│   │   │       ├── useSendMessage.ts
│   │   │       ├── useExecutionStatus.ts
│   │   │       └── useApprovals.ts
│   │   └── ui/
│   │       ├── DisplaySessionEntry.tsx     # Main renderer
│   │       ├── SessionChatBox.tsx          # Chat container
│   │       └── SessionList.tsx             # Virtual list
│   └── terminal/               # Terminal session feature
│       ├── model/
│       │   ├── deriveTerminalEntries.ts
│       │   └── hooks/
│       │       └── useTerminalHistory.ts
│       └── ui/
│           └── TerminalView.tsx
├── shared/
│   ├── stores/                 # Zustand
│   │   ├── useUiStore.ts
│   │   └── useSessionStore.ts
│   ├── hooks/                  # React Query
│   │   ├── sessionKeys.ts      # Query key factory
│   │   ├── useSession.ts
│   │   └── useExecutionProcesses.ts
│   └── lib/
│       ├── api/
│       ├── auth/
│       └── queryClient.ts
└── types/
    └── session.ts              # TS interface (generated or hand-written)
```

---

## Top 12 Takeaways

1. **NormalizedEntry**: Single unified type for all conversation items
2. **Derivation pipeline**: Raw data → turns → visible entries
3. **Entry aggregation**: Group similar consecutive entries
4. **Execution status**: Explicit state machine (idle, running, pending, error)
5. **Query key factory**: Centralize cache invalidation
6. **Persisted expansion**: Remember which items user expanded
7. **Exhaustive rendering**: Switch on discriminated unions
8. **Polling first**: HTTP + React Query before WebSocket
9. **Rust → TypeScript**: Type safety across full stack
10. **Feature contexts**: Encapsulate feature-specific state
11. **Monorepo**: Shared types + domain-specific packages
12. **Virtual scrolling**: Smooth 1000+ item lists

---

## Comparison: Vibekanban vs Zeus

| Aspect | Vibekanban | Zeus |
|--------|-----------|------|
| **Purpose** | Task management + AI agents | Remote OS orchestration + AI CLI |
| **UI Focus** | Conversation + kanban board | Terminal + session logs |
| **Executors** | Claude, Gemini, Copilot, etc. | Claude CLI primary |
| **Interaction** | Approval gates for tool calls | Terminal interactivity |
| **Scale** | Multi-user, cloud + local | Single user, local primary |
| **Data** | SQLite/PostgreSQL persistent | In-memory + PTY buffer |

**Common patterns**: Both need real-time updates, conversation model, terminal output handling, approval gates, entry aggregation.

---

## Quick Implementation Roadmap

### Phase 1 (Week 1)
- [ ] Define NormalizedEntry types for Zeus
- [ ] Create SessionContext + MessageContext
- [ ] Build DisplaySessionEntry (entry type switch)

### Phase 2 (Week 2)
- [ ] Implement deriveSessionEntries() (aggregation)
- [ ] Set up React Query polling for session status
- [ ] Create SessionChatBox UI

### Phase 3 (Week 3)
- [ ] Add execution status computation
- [ ] Build terminal output virtualization
- [ ] Implement approval gates for sensitive ops

### Phase 4+ (Later)
- [ ] WebSocket for low-latency streaming
- [ ] Advanced diff viewer
- [ ] Multi-session comparison UI

---

## Resources

**Full documentation**: `/Users/notpritamm/Documents/Projects/zeus/VIBEKANBAN_REFERENCE.md` (854 lines)

**Key files to read**:
1. `/crates/api-types/src/` — Type definitions
2. `/packages/web-core/src/features/workspace-chat/` — Main chat logic
3. `/packages/ui/src/components/Chat*.tsx` — UI components
4. `/crates/server/src/routes/` — API structure

**Commands**:
```bash
# Explore the codebase
cd /Users/notpritamm/Documents/Projects/zeus/ref-vibe-kanban

# View types
cat crates/api-types/src/lib.rs

# View chat feature
ls packages/web-core/src/features/workspace-chat/

# View types generation
cargo run --bin generate_types
```

---

## TL;DR

Vibekanban is a **10/10 reference** for Zeus. Copy these patterns:
1. Normalized conversation model
2. Entry derivation pipeline
3. Feature-scoped contexts
4. Query key factory
5. Persisted UI preferences
6. Real-time polling (React Query)
7. Exhaustive type rendering
8. Virtual scrolling
9. Type generation (Rust → TS)
10. Monorepo structure

Start with these patterns in Phase 1. They'll save 100+ hours of design decisions later.
