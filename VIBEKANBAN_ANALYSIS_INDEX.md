# Vibekanban Reference Analysis - Complete Index

## Documents Created

This analysis includes two comprehensive documents for learning from Vibekanban:

### 1. VIBEKANBAN_REFERENCE.md (26 KB, 854 lines)
**Comprehensive deep-dive into Vibekanban architecture**

Complete walkthrough of:
- Directory structure (crates, packages, shared types)
- Architectural patterns (monorepo, type generation, API design)
- Frontend architecture (app structure, web-core library, features)
- Feature deep-dive: workspace-chat (model, contexts, UI)
- State management layers (React Query, Zustand, Context)
- UI component library (160+ components)
- Terminal & execution model
- AI integration & executor abstraction
- Conversation model (NormalizedEntry)
- Session & workspace lifecycle
- Design patterns (virtualization, aggregation, polling, etc.)
- Deployment strategies

### 2. VIBEKANBAN_QUICK_REFERENCE.md (6 KB, 340 lines)
**Quick reference guide for immediate implementation**

Includes:
- 1-minute overview
- Key architectural components (tables)
- 10 critical patterns with code examples
- File structure template for Zeus
- Top 12 takeaways
- Comparison table: Vibekanban vs Zeus
- Implementation roadmap (4 phases)
- Resources and quick commands
- TL;DR summary

---

## Quick Navigation

### For Understanding Vibekanban
Start with **VIBEKANBAN_QUICK_REFERENCE.md** for:
- Component locations
- Pattern explanations with code
- File structure recommendations

Then read **VIBEKANBAN_REFERENCE.md** sections:
- Section 2: Architectural patterns
- Section 3: Frontend architecture
- Section 5: AI integration model
- Section 7: Key design patterns
- Section 9: Patterns to learn from

### For Implementation in Zeus
Reference **VIBEKANBAN_QUICK_REFERENCE.md** sections:
- Critical Patterns Zeus Should Copy (10 patterns with code)
- File Structure Template for Zeus
- Quick Implementation Roadmap
- Top 12 Takeaways

### For Code Reading
Visit these paths in ref-vibe-kanban:

**UI Components** (study these):
- `/packages/web-core/src/features/workspace-chat/ui/DisplayConversationEntry.tsx` (1400 lines, exhaustive pattern)
- `/packages/web-core/src/features/workspace-chat/ui/SessionChatBoxContainer.tsx` (status computation)
- `/packages/ui/src/components/Chat*.tsx` (160+ components)

**Data Transformation** (copy these):
- `/packages/web-core/src/features/workspace-chat/model/deriveConversationEntries.ts` (entry aggregation)
- `/packages/web-core/src/features/workspace-chat/model/deriveConversationTurns.ts` (turn derivation)

**State Management** (reference these):
- `/packages/web-core/src/shared/stores/useUiPreferencesStore.ts` (Zustand + persist)
- `/packages/web-core/src/shared/hooks/workspaceSummaryKeys.ts` (query key factory)
- `/packages/web-core/src/features/workspace-chat/model/contexts/` (feature contexts)

**Backend** (understand these):
- `/crates/api-types/src/` (Rust types definition)
- `/crates/server/src/routes/` (API organization by domain)
- `/crates/db/src/models/` (SQLx + ts-rs integration)

---

## Key Patterns Extracted

### 1. Type Safety (Rust → TypeScript)
**Source**: ts-rs integration + code generation
**Pattern**: Derive TS = Single source of truth
**Value**: Eliminates manual type duplication, catches API breaks
**For Zeus**: Implement for session types, execution state, etc.

### 2. Normalized Entry Model
**Source**: NormalizedEntry discriminated union
**Pattern**: One type for all conversation items
**Value**: Exhaustive pattern matching in rendering
**For Zeus**: Adopt for session logs (user, assistant, tool, thinking, error, output)

### 3. Conversation Derivation
**Source**: deriveConversationEntries + deriveConversationTurns
**Pattern**: Raw data → transformed → UI-ready
**Value**: Separates logic from rendering
**For Zeus**: Apply to Claude session history + terminal output

### 4. Entry Aggregation
**Source**: Consecutive entry grouping
**Pattern**: Group similar entries (file_read × N, file_edit, thinking)
**Value**: Reduces visual noise
**For Zeus**: Crucial for terminal output (1000+ lines)

### 5. Real-time via Polling
**Source**: React Query refetchInterval
**Pattern**: Polling HTTP every 1-2 seconds
**Value**: Simple, works everywhere
**For Zeus**: Start here, upgrade to WebSocket later

### 6. Feature-Scoped Contexts
**Source**: EntriesContext, MessageEditContext, ApprovalFeedbackContext
**Pattern**: Context per feature + domain logic
**Value**: No prop drilling, encapsulated state
**For Zeus**: Create SessionContext, TerminalContext, ApprovalContext

### 7. Query Key Factory
**Source**: workspaceSummaryKeys pattern
**Pattern**: Centralized key generation
**Value**: Easy cache invalidation
**For Zeus**: sessionKeys, terminalKeys factories

### 8. Persisted Expansion State
**Source**: usePersistedExpanded + Zustand
**Pattern**: Store UI prefs in localStorage
**Value**: Survives page refresh
**For Zeus**: Remember expanded sections, panel widths

### 9. Execution Status Machine
**Source**: computeExecutionStatus function
**Pattern**: Explicit state precedence
**Value**: Clear, testable status logic
**For Zeus**: Model: idle, running, waiting, error, complete

### 10. Monorepo Structure
**Source**: Cargo workspace + pnpm workspace
**Pattern**: Shared types + domain packages
**Value**: Code reuse, consistent tooling
**For Zeus**: Build this way from day one

---

## Learning Path (Recommended)

### Day 1: Overview
- Read VIBEKANBAN_QUICK_REFERENCE.md (30 min)
- Skim directory structure in VIBEKANBAN_REFERENCE.md (20 min)
- Explore project files: `ls -R ref-vibe-kanban/crates/` (10 min)

### Day 2: Frontend Deep-Dive
- Read Section 3 (Frontend Architecture) in VIBEKANBAN_REFERENCE.md (60 min)
- Read `DisplayConversationEntry.tsx` with annotations (60 min)
- Study `deriveConversationEntries.ts` (30 min)

### Day 3: State Management
- Read Section 3.4 (State Management: Layers) (30 min)
- Read `useUiPreferencesStore.ts` (20 min)
- Read `workspaceSummaryKeys.ts` (10 min)
- Study feature context example in workspace-chat/ (30 min)

### Day 4: Backend & Types
- Read Section 2.1 (Full-Stack Type Safety) (30 min)
- Explore `/crates/api-types/src/` files (30 min)
- Read `/crates/server/src/main.rs` (20 min)
- Review route organization (20 min)

### Day 5: Patterns & Implementation
- Read Section 7 (Key Design Patterns) (45 min)
- Read Section 9 (Patterns Zeus Should Learn) (45 min)
- Read Quick Implementation Roadmap (15 min)
- Plan Zeus architecture using template (30 min)

---

## Code Examples to Copy

### NormalizedEntry Type (pattern #1)
```typescript
// src/types/session.ts
interface NormalizedEntry {
  id?: string;
  timestamp?: string;
  entry_type: NormalizedEntryType;
  content: string;
  metadata?: unknown;
}

type NormalizedEntryType =
  | { type: 'user_message' }
  | { type: 'assistant_message' }
  | { type: 'tool_use'; action_type: ActionType; status: ToolStatus }
  | { type: 'thinking' }
  | { type: 'error_message' }
  | { type: 'system_message' }
  | { type: 'terminal_output'; session_id: string }
  | { type: 'loading' };
```

### Derivation Pipeline (pattern #2)
```typescript
// src/features/session-chat/model/deriveSessionEntries.ts
export function deriveSessionEntries(
  rawEntries: NormalizedEntry[]
): PatchTypeWithKey[] {
  // 1. Group consecutive similar entries
  // 2. Aggregate tool uses (5x file_read → "Read 5 files")
  // 3. Determine visibility + expansion state
  // 4. Return UI-ready patches for virtual scrolling
}
```

### Status Computation (pattern #4)
```typescript
// src/features/session-chat/model/computeExecutionStatus.ts
function computeExecutionStatus(params: {
  isInFeedbackMode: boolean;
  isRunning: boolean;
  isWaiting: boolean;
  hasError: boolean;
}): ExecutionStatus {
  if (params.isInFeedbackMode) return 'feedback';
  if (params.isRunning) return 'running';
  if (params.isWaiting) return 'waiting';
  if (params.hasError) return 'error';
  return 'idle';
}
```

### Query Key Factory (pattern #5)
```typescript
// src/shared/hooks/sessionKeys.ts
export const sessionKeys = {
  all: () => ['session'] as const,
  lists: () => [...sessionKeys.all(), 'list'] as const,
  list: (workspaceId: string) =>
    [...sessionKeys.lists(), workspaceId] as const,
  details: () => [...sessionKeys.all(), 'detail'] as const,
  detail: (sessionId: string) =>
    [...sessionKeys.details(), sessionId] as const,
};

// Usage:
queryClient.invalidateQueries({
  queryKey: sessionKeys.detail(sessionId)
});
```

### Persisted UI Store (pattern #6)
```typescript
// src/shared/stores/useUiStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useUiStore = create<UiState>(
  persist(
    (set) => ({
      rightPanelMode: 'chat',
      expandedSections: new Set<string>(),
      
      setRightPanelMode: (mode) =>
        set({ rightPanelMode: mode }),
      
      toggleSection: (key) =>
        set((state) => {
          const expanded = new Set(state.expandedSections);
          if (expanded.has(key)) {
            expanded.delete(key);
          } else {
            expanded.add(key);
          }
          return { expandedSections: expanded };
        }),
    }),
    { name: 'zeus-ui' }
  )
);
```

---

## Common Questions Answered

### Q: Which file has the main conversation rendering?
A: `DisplayConversationEntry.tsx` (1400 lines). It exhaustively switches on entry type and delegates to specific renderers.

### Q: How does Vibekanban handle 1000+ log entries without lag?
A: Virtual scrolling (TanStack Virtual) + entry aggregation. Groups consecutive reads/searches/thinking into single collapsible items.

### Q: How are types kept in sync between Rust and TypeScript?
A: ts-rs code generation. Annotate Rust structs with `#[derive(TS)]`, run `cargo run --bin generate_types`, TypeScript interfaces auto-update.

### Q: What's the state management strategy?
A: 3 layers:
1. React Query — Server state (sessions, execution, processes) with polling
2. Zustand — Local UI state (panel width, expanded sections) with localStorage
3. Context API — Feature-scoped state (chat entries, approval feedback)

### Q: How does the app stay responsive during long operations?
A: Real-time polling (every 1 second) updates execution status without WebSocket. User sees: running → complete instantly.

### Q: Why group consecutive entries?
A: UX. Instead of 50 "Read /src/foo.ts" lines, show "Read 50 files" (collapsible). Reduces cognitive load.

### Q: How should I structure a feature in Zeus?
A: Follow workspace-chat:
```
src/features/my-feature/
├── model/
│   ├── deriveSomething.ts
│   ├── contexts/MyContext.tsx
│   └── hooks/useMyHook.ts
└── ui/
    └── MyComponent.tsx
```

### Q: Should I use WebSocket from day one?
A: No. Start with polling (React Query `refetchInterval`). Much simpler. Upgrade to WebSocket later if latency becomes critical.

---

## Checklist: Before Starting Zeus

- [ ] Read VIBEKANBAN_QUICK_REFERENCE.md
- [ ] Copy pattern #1 (NormalizedEntry type)
- [ ] Copy pattern #2 (Derivation pipeline structure)
- [ ] Copy pattern #5 (Query key factory)
- [ ] Copy pattern #6 (Zustand + persist)
- [ ] Review `DisplayConversationEntry.tsx` exhaustive switch
- [ ] Plan feature structure using template
- [ ] Set up Zustand + React Query
- [ ] Define session + terminal types
- [ ] Build first entry renderer component

---

## Files to Keep Handy

When building Zeus, reference these files from Vibekanban:

**Pattern Examples**:
1. `packages/web-core/src/features/workspace-chat/model/deriveConversationEntries.ts` — Entry aggregation
2. `packages/web-core/src/shared/hooks/workspaceSummaryKeys.ts` — Query key factory
3. `packages/web-core/src/shared/stores/useUiPreferencesStore.ts` — Persisted store
4. `packages/web-core/src/features/workspace-chat/model/contexts/EntriesContext.tsx` — Feature context
5. `packages/web-core/src/features/workspace-chat/ui/DisplayConversationEntry.tsx` — Entry rendering

**Architecture Examples**:
1. `crates/api-types/src/lib.rs` — Type definitions
2. `crates/server/src/routes/mod.rs` — API organization
3. `crates/db/src/models/mod.rs` — SQLx models
4. `packages/web-core/src/shared/lib/api.ts` — API client pattern
5. `packages/web-core/src/app/entry/Bootstrap.tsx` — App initialization

---

## Summary

Vibekanban is a **complete reference implementation** for building AI-powered orchestration tools. The analysis documents extract 12 core patterns that Zeus should adopt immediately.

**Estimated value**: Following these patterns will save 100+ hours of architecture decisions and 50+ hours of refactoring.

**Next step**: Read VIBEKANBAN_QUICK_REFERENCE.md, then start building Zeus Phase 1 using the file structure template.
