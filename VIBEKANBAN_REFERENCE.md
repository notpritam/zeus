# Vibekanban Reference Architecture Analysis

## Overview

Vibekanban is a sophisticated full-stack application for managing coding tasks with AI agents. It's a monorepo combining Rust backend, Tauri desktop app, and React frontends. The architecture demonstrates enterprise-grade patterns for terminal management, AI integration, real-time updates, and multi-user collaboration.

---

## 1. DIRECTORY STRUCTURE

### Core Architecture
```
vibe-kanban/
├── crates/                          # Rust backend (monorepo)
│   ├── server/                      # Main Axum REST API + WebSocket
│   ├── db/                          # SQLx models + migrations
│   ├── api-types/                   # Shared types (Rust ↔ TS)
│   ├── executors/                   # Executor (agent) integration
│   ├── services/                    # Business logic layer
│   ├── git/                         # Git operations
│   ├── worktree-manager/            # Git worktree lifecycle
│   ├── workspace-manager/           # Workspace orchestration
│   ├── deployment/                  # Self-hosted deployment
│   ├── local-deployment/            # Local/Tauri deployment
│   ├── relay-tunnel/                # Relay server (remote)
│   ├── mcp/                         # MCP server integration
│   ├── review/                      # PR review automation
│   ├── tauri-app/                   # Tauri desktop container
│   └── remote/                      # Remote cloud backend (separate)
│
├── packages/                        # Frontend monorepo
│   ├── local-web/                   # Local Tauri app UI (Vite)
│   ├── remote-web/                  # Remote web UI
│   ├── web-core/                    # Shared React library
│   ├── ui/                          # Reusable component library
│   └── public/                      # Static assets
│
├── shared/                          # Generated types
│   ├── types.ts                     # Generated from crates/api-types
│   ├── remote-types.ts              # Generated from crates/remote
│   └── schemas/                     # Agent tool schemas
│
├── npx-cli/                         # NPX CLI entry point
├── scripts/                         # Dev/build helpers
└── docs/                            # Mintlify documentation
```

### Stack Summary
- **Backend**: Rust + Tokio + Axum + SQLx + SQLite/PostgreSQL
- **Desktop**: Tauri (Rust bridge to Electron-like window)
- **Frontend**: React 18 + TypeScript + Vite + TanStack Router + Tailwind
- **State**: React Query + Zustand (local stores)
- **Real-time**: WebSockets (Axum ws) + Server-Sent Events (SSE)
- **Type Gen**: ts-rs (Rust → TypeScript)
- **Database**: SQLx (compile-time SQL verification)

---

## 2. ARCHITECTURAL PATTERNS

### 2.1 Full-Stack Type Safety
**Pattern**: Rust → TypeScript code generation via ts-rs

```
crates/api-types/src/issue.rs (Rust #[derive(TS)])
    ↓ cargo run --bin generate_types
shared/types.ts (generated)
    ↓ import { Issue } from 'shared/types'
packages/web-core/src/...tsx
```

**Benefits**:
- Single source of truth (Rust enums/structs)
- Compile-time JSON schema validation
- Catch API contract breaks in CI
- Eliminates hand-written TypeScript types

**Key Files**:
- `crates/api-types/src/` — The schema definitions
- `pnpm run generate-types` — Regenerate all types
- `shared/types.ts` — Generated output (do not edit)

### 2.2 Monorepo Organization

**Cargo Workspace** (Rust):
```toml
[workspace]
members = [
    "crates/api-types",
    "crates/server",
    "crates/db",
    ...
]
```
- All crates compiled together
- Shared dependencies via `[workspace.dependencies]`
- Single `Cargo.lock` for reproducibility

**pnpm Workspace** (JavaScript):
```yaml
pnpm-workspace.yaml:
  - packages/**
```
- Workspaces: `@vibe/local-web`, `@vibe/web-core`, `@vibe/ui`, etc.
- Cross-workspace dependencies via `"@vibe/..."` imports
- Shared tsconfig, eslint, prettier

### 2.3 API Layer Design

**Route Organization** (`crates/server/src/routes/`):
```
routes/
├── config.rs           # System config + executors
├── sessions/           # Session creation/management
├── workspaces/         # Workspace CRUD + execution
├── terminal.rs         # PTY terminal WebSocket
├── execution_processes.rs  # Process lifecycle
├── approvals.rs        # Tool call approval gates
├── relay_ws.rs         # Relay tunnel WebSocket
├── relay_auth.rs       # Relay authentication
├── remote/             # Remote-specific routes
└── oauth.rs            # OAuth integration
```

**Key Insight**: Route files map to major domain concepts (workspaces, sessions, processes), not HTTP methods. Each route handles GET/POST/PATCH/DELETE for that concept.

### 2.4 Database Layer (SQLx)

**Models** (`crates/db/src/models/`):
- Define with `sqlx::FromRow`, `#[derive(TS)]`
- Compile-time SQL verification (requires `.sqlx/` cache)
- Schema migrations in `crates/db/migrations/`

**Example**: Session model
```rust
#[derive(Debug, Clone, TS, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub workspace_id: String,
    pub executor: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
```

Generates TypeScript:
```typescript
interface Session {
  id: string;
  workspace_id: string;
  executor: string;
  created_at: string; // ISO 8601
  updated_at: string;
}
```

---

## 3. FRONTEND ARCHITECTURE

### 3.1 App Structure (Local Web)

```
packages/local-web/src/
├── app/
│   ├── entry/           # Bootstrap & App root
│   │   ├── App.tsx      # Main component tree
│   │   └── Bootstrap.tsx # React/PostHog/Sentry init
│   ├── providers/       # Context + React Query setup
│   │   ├── ConfigProvider.tsx   # System config (user, executors)
│   │   └── ClickedElementsProvider.tsx
│   ├── router/
│   │   └── index.ts     # TanStack Router config
│   ├── hooks/           # Tauri-specific
│   │   ├── useTauriNotificationNavigation.ts
│   │   └── useTauriUpdateReady.ts
│   └── notifications/   # Desktop notifications
├── routes/              # TanStack Router file-based routes
│   ├── _app.tsx         # Root layout
│   ├── _app.projects.$projectId_.tsx
│   └── ...
├── vite-env.d.ts        # Vite env types
└── routeTree.gen.ts     # Generated route tree
```

### 3.2 Shared Frontend Library (web-core)

The "true" app logic lives in `@vibe/web-core`:

```
packages/web-core/src/
├── features/            # Domain-driven features
│   ├── workspace/       # Workspace UI/logic
│   ├── workspace-chat/  # Chat interface + AI integration
│   ├── kanban/          # Kanban board
│   ├── create-mode/     # Workspace creation flow
│   └── onboarding/      # First-run UX
│
├── shared/              # Cross-feature utilities
│   ├── stores/          # Zustand stores (local UI state)
│   │   ├── useUiPreferencesStore.ts   # Persisted UI prefs
│   │   ├── useIssueSelectionStore.ts  # Selected issues
│   │   ├── useDiffViewStore.ts        # Diff view mode
│   │   └── useOrganizationStore.ts    # Org context
│   │
│   ├── hooks/           # React Query hooks
│   │   ├── useExecutionProcesses.ts   # Real-time process status
│   │   ├── useWorkspaceExecution.ts   # Workspace execution state
│   │   ├── useApprovals.ts            # Approval gates
│   │   ├── workspaceSummaryKeys.ts    # Query key factory
│   │   └── useConversationHistory/    # Conversation derivation
│   │
│   ├── lib/
│   │   ├── api/                       # API client
│   │   ├── auth/                      # Token management
│   │   ├── queryClient.ts             # React Query config
│   │   └── ...
│   │
│   └── components/      # Reusable UI components
│
├── pages/               # Page-level components
├── styles/              # Global styles + Tailwind
├── i18n/                # Internationalization
├── integrations/        # VSCode bridge, ElectricSQL, etc.
└── test/                # Test utilities & fixtures
```

### 3.3 Feature: Workspace Chat (AI Integration)

This is the heart of the application. Path: `packages/web-core/src/features/workspace-chat/`

**Model Layer** (`model/`):
- **`deriveConversationEntries.ts`** — Transforms raw DB entries → UI-ready conversation
  - Parses tool use (file_edit, command_run, etc.)
  - Groups consecutive reads/searches
  - Handles aggregation of thinking entries
  - Returns `PatchTypeWithKey[]` for virtual scrolling

- **`deriveConversationTurns.ts`** — Derives conversation state
  - Determines turn type: `agent_running`, `agent_pending_approval`, `setup_script`, etc.
  - Tracks token usage, visible entries per turn
  - Identifies when setup is needed

- **`conversation-row-model.ts`** — Virtual scrolling row factory
  - Creates renderable rows with proper height calculation
  - Supports sticky headers, loading states

- **Hooks**:
  - `useSessionSend.ts` — Send message (new or follow-up session)
  - `useCreateSession.ts` — Create workspace + start session
  - `useSessionQueueInteraction.ts` — Queue/approval interactions
  - `useMessageEditRetry.ts` — Retry/edit failed messages
  - `useConversationHistory.ts` — Fetch & derive conversation

**Contexts** (`contexts/`):
- `EntriesContext.tsx` — Normalized entries + token usage
- `ApprovalFeedbackContext.tsx` — Feedback on denied tools
- `MessageEditContext.tsx` — Track which messages are in edit mode
- `RetryUiContext.tsx` — Retry UI state

**UI Layer** (`ui/`):
- `DisplayConversationEntry.tsx` — Main entry renderer (1400+ lines)
  - Exhaustive switch on entry type (user_message, tool_use, thinking, etc.)
  - For tool_use: delegates to specialized renderers:
    - `FileEditEntry` → `ChatFileEntry` (with diff view)
    - `PlanEntry` → `ChatApprovalCard` (approval UI)
    - `SubagentEntry` → `ChatSubagentEntry`
    - Generic tool → `ChatToolSummary`
  - Handles expansion state via `usePersistedExpanded`

- `SessionChatBoxContainer.tsx` — Main chat interface
  - Computes execution status (running, pending approval, edit mode, etc.)
  - Manages message input, file drops, sending
  - Integrates with model selector, approval form

- `ConversationListContainer.tsx` — Virtual list of entries
  - Uses `useConversationVirtualizer` for large lists
  - Scroll sync + auto-scroll to latest

### 3.4 State Management: Layers

**React Query** (server state, real-time):
```typescript
// In useWorkspaceExecution.ts
const { data: execution } = useQuery({
  queryKey: workspaceSummaryKeys.execution(workspaceId),
  queryFn: () => workspacesApi.getExecution(workspaceId),
  refetchInterval: 1000, // Real-time polling
});
```

**Zustand** (local UI state, persisted):
```typescript
// In useUiPreferencesStore.ts
const useUiPreferencesStore = create<UiPreferences>(
  persist(
    (set) => ({
      rightPanelMode: 'chat',
      leftPanelWidth: 250,
      // ...
    }),
    { name: 'ui-prefs', storage: localStorage }
  )
);
```

**Context API** (feature-scoped):
```typescript
// In EntriesContext.tsx
const EntriesContext = createContext<{
  entries: NormalizedEntry[];
  tokenUsage: TokenUsageInfo | null;
}>(...);
```

### 3.5 UI Component Library (@vibe/ui)

Located in `packages/ui/src/components/`, 160+ components:

**Chat Components**:
- `ChatUserMessage.tsx` — User message with edit/reset
- `ChatAssistantMessage.tsx` — Claude's response
- `ChatFileEntry.tsx` — File diff with inline comments
- `ChatApprovalCard.tsx` — Approval UI for plans/tools
- `ChatToolSummary.tsx` — Tool call summary (read/search/run)
- `ChatTodoList.tsx` — Task management
- `ChatSubagentEntry.tsx` — Nested agent results

**Layout Components**:
- `SessionChatBox.tsx` — Main chat container
- `PierreConversationDiff.tsx` — Advanced diff viewer (syntax highlight)
- `ChangesPanelLayout.tsx` — File changes sidebar

**Form Components**:
- `RenameSessionDialog.tsx` — Session renaming
- `ApprovalForm.tsx` — Deny/approve with feedback
- `AskUserQuestionBanner.tsx` — Interactive Q&A

**Design System**:
- Tailwind + CSS variables for theming
- Dark/light mode support via `useTheme()` hook
- Responsive layout (mobile-first)

---

## 4. TERMINAL & EXECUTION MODEL

### 4.1 Execution Flow

```
User Message in Chat
    ↓
useSessionSend.send()
    ↓
SessionsAPI.followUp(sessionId, { prompt, executor_config })
    ↓ [Rust backend]
POST /workspaces/{id}/sessions/{id}/follow-up
    ↓
services::execute_session()
    ↓ [Creates]
ExecutionProcess {
  id: UUID,
  workspace_id,
  session_id,
  executor_action: ExecutorAction (MCP tool call or setup script)
  status: ExecutionProcessStatus
  entries: Vec<NormalizedEntry>
}
    ↓ [Streams via]
WebSocket (terminal.rs)
```

### 4.2 Process Model

**ExecutionProcess** (`db/models/execution_process.rs`):
```rust
pub struct ExecutionProcess {
    pub id: String,               // UUID
    pub workspace_id: String,
    pub session_id: String,
    pub created_at: DateTime<Utc>,
    pub executor_action: ExecutorActionType,  // Enum
    pub status: ExecutionProcessStatus,        // Enum
    // ... fields for repo state, exit code, etc.
}
```

**ExecutorActionType** (discriminated enum):
- `Tool(ToolRequest)` — MCP tool invocation
- `ScriptRequest(script)` — Setup/cleanup script
- `Subprocess(cmd)` — Shell command

**Status Flow**:
```
Created → Queued → Running → Completed/Failed/Killed
```

### 4.3 WebSocket Integration

**Terminal Route** (`routes/terminal.rs`):
- Upgrades HTTP to WebSocket
- Handles bidirectional message streaming
- Connects to PTY ring buffer (node-pty in remote mode)

**Message Types** (over WebSocket):
```json
{
  "type": "process_status_update",
  "process_id": "...",
  "status": "running",
  "entries": [{ "entry_type": "tool_use", ... }]
}
```

---

## 5. AI INTEGRATION & EXECUTOR MODEL

### 5.1 Executor Abstraction

**Supported Executors**:
- Claude Code, Gemini CLI, Copilot, Cursor, Codex, Amp, Droid, etc.

**Executor Config** (`shared/types.ts`, generated):
```typescript
interface ExecutorConfig {
  executor: string;           // "claude-code", "gemini-cli", etc.
  variant?: string;           // Model variant
  overrides?: Record<string, unknown>; // Per-executor settings
}
```

**Discovery** (`useExecutorDiscovery.ts`):
- Reads `~/.config/vibe-kanban/profiles.json` on startup
- Populates UI with available executors + models
- Stored in `UserSystemContext` (via ConfigProvider)

### 5.2 Tool Integration

**MCP Servers** (`crates/mcp/`):
- Exposes tools to agents via MCP protocol
- Tools include: file_read, file_edit, command_run, search, web_fetch
- Executors (Claude Code, Gemini) call these tools

**Tool Call Approval** (`ApprovalFeedbackContext.tsx`):
- Agent requests tool → Shown in UI with "Approve/Deny"
- User denies → Feedback sent to agent → Agent adjusts plan
- Approval stored as `NormalizedEntry` in DB

### 5.3 Conversation Model

**NormalizedEntry** (the universal data shape):
```typescript
interface NormalizedEntry {
  id?: string;
  timestamp?: string;
  entry_type: NormalizedEntryType; // Discriminated union
  content: string;
  metadata?: unknown;
}

type NormalizedEntryType =
  | { type: 'user_message' }
  | { type: 'assistant_message' }
  | { type: 'tool_use'; action_type: ActionType; status: ToolStatus; ... }
  | { type: 'thinking' }
  | { type: 'error_message' }
  | { type: 'user_feedback'; denied_tool: string }
  | { type: 'loading' }
  | ...;
```

**ActionType** (tool action details):
```typescript
type ActionType =
  | { action: 'file_read'; path: string }
  | { action: 'file_edit'; path: string; changes: FileChange[] }
  | { action: 'command_run'; command: string; result: CommandResult }
  | { action: 'plan_presentation'; plan: string }
  | { action: 'task_create'; description: string; ... }
  | ...;
```

This is the **single source of truth** for conversation display.

---

## 6. SESSION & WORKSPACE LIFECYCLE

### 6.1 Session Creation

**UI Flow** (`create-mode/`):
1. User selects workspace + executor variant
2. Clicks "Start Task" with initial prompt
3. `useCreateSession()` calls API
4. Backend creates `Session` + `ExecutionProcess`
5. WebSocket connection opens to stream entries
6. Chat opens with loading state

**Backend Flow** (`routes/sessions/create.rs`):
- Validate workspace/executor
- Create `Session` record
- Trigger initial prompt execution
- Return session ID

### 6.2 Session Follow-up

**UI Flow** (`SessionChatBoxContainer.tsx`):
1. User types message → clicks send
2. `useSessionSend.send(message)` called
3. API call: `POST /sessions/{id}/follow-up`
4. WebSocket streams new entries
5. `ConversationListContainer` re-renders

### 6.3 Workspace Model

**Workspace** = Container for multiple sessions + shared git state

```rust
pub struct Workspace {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub description: Option<String>,
    pub branch: String,              // Git branch
    pub repositories: Vec<WorkspaceRepo>, // Linked git repos
    pub created_at: DateTime<Utc>,
}
```

**WorkspaceRepo** = Link to a git repository
- Tracks branch, commit, uncommitted changes
- Updated as sessions make commits

---

## 7. KEY DESIGN PATTERNS

### 7.1 Persistence & Expansion State

**Pattern**: Use `usePersistedExpanded()` for collapsible UI state

```typescript
const [expanded, toggle] = usePersistedExpanded(
  `edit:${filePath}:${idx}` as PersistKey,
  status.status === 'pending_approval' // auto-expand when pending
);
```

Stores in `useUiPreferencesStore` (Zustand + localStorage).

### 7.2 Virtualization

**Pattern**: Large conversations use TanStack Virtual

```typescript
const virtualizer = useVirtualizer({
  count: entries.length,
  getScrollElement: () => scrollElementRef.current,
  estimateSize: () => 200,
  overscan: 20,
});
```

Enables smooth rendering of 1000+ entries.

### 7.3 Entry Aggregation

**Pattern**: Group consecutive similar entries

```typescript
// Consecutive file_read entries → one "Read 5 files" group
// Consecutive file_edit (same file) → one "Edited 3 times" group
// Consecutive thinking → one "Thinking..." group
```

Implemented in `deriveConversationEntries()`.

### 7.4 Real-time Status Updates

**Pattern**: Polling via React Query `refetchInterval`

```typescript
const { data: execution } = useQuery({
  queryKey: ['workspace', workspaceId],
  queryFn: () => getWorkspaceExecution(workspaceId),
  refetchInterval: 1000, // Poll every 1s
});
```

Works over slow networks (no WebSocket required).

### 7.5 Tool-Specific Rendering

**Pattern**: Switch on `entry_type.type` then `action_type.action`

```typescript
switch (entryType.type) {
  case 'tool_use':
    switch (action_type.action) {
      case 'file_edit': return <FileEditEntry />;
      case 'plan_presentation': return <PlanEntry />;
      case 'command_run': return <ToolSummaryEntry />;
    }
}
```

Ensures exhaustive type coverage.

### 7.6 Multi-Executor Support

**Pattern**: Executor-agnostic tool protocol

- All executors (Claude, Gemini, Copilot) call the same MCP tools
- Frontend doesn't need executor-specific code
- Capabilities dynamically fetched via `useUserSystem()`

---

## 8. NOTABLE FEATURES

### 8.1 Approval Gates

**Pending Approval States** (`ChatApprovalCard`):
- Plan reviews → user approves before execution
- Tool calls → user denies/provides feedback
- Expanded by default when pending
- Feedback sent back to agent in next message

### 8.2 Edit & Retry

**Message Edit** (`useMessageEditRetry.ts`):
- User can edit previous user message
- Greys out subsequent entries
- Executor doesn't have fork capability? Disabled.
- Uses `RetryUiContext` to track edit mode

### 8.3 File Changes Panel

**Pattern**: Sidebar with git diff
- Lists all modified files
- Click to open file details
- "Open in VS Code" button
- Integrated with chat (click code → highlights in changes)

### 8.4 Git Integration

**Features**:
- Branch switching via `useChangeTargetBranch()`
- Conflict resolution modal
- PR creation + linking to GitHub
- Commit history tracking per session

### 8.5 Multi-language Support

**i18n** (`packages/web-core/src/i18n/`):
- Uses react-i18next
- Translation keys: `t('conversation.toolSummary.read', { path })`
- Language switcher in settings
- Stored in `useUserSystem().config.language`

---

## 9. PATTERNS ZEUS SHOULD LEARN FROM

### 9.1 ✅ Type Generation (ts-rs)
**Why**: Single source of truth. Eliminates API contract drift.
```
Rust struct → TypeScript interface (compile-time)
```
**Zeus Insight**: Use for Claude session types, terminal state, etc.

### 9.2 ✅ Normalized Entry Model
**Why**: Unified conversation representation. Exhaustive pattern matching.
```
NormalizedEntry + ActionType discriminated unions = Bullet-proof rendering
```
**Zeus Insight**: Adopt for session log entries (user, assistant, tool, thinking, error, etc.)

### 9.3 ✅ Real-time via Polling
**Why**: Works over HTTP, simpler than WebSocket for many cases.
```
React Query refetchInterval: 1000 → seamless real-time
```
**Zeus Insight**: Start with polling for session updates, upgrade to WebSocket later if needed.

### 9.4 ✅ Feature-Scoped Contexts
**Why**: Avoid prop drilling. Encapsulates feature logic.
```
<EntriesContext> → {entries, dispatch}
<MessageEditContext> → {startEdit, isEntryGreyed}
<ApprovalFeedbackContext> → {feedback, submit}
```
**Zeus Insight**: Create `WorkspaceContext`, `SessionContext` to avoid passing props 10 levels deep.

### 9.5 ✅ UI Preferences Store (Zustand)
**Why**: Persisted, reactive, minimal boilerplate.
```typescript
const store = create(persist((set) => ({...}), {name: 'key', storage: localStorage}))
```
**Zeus Insight**: Use for diff view mode, panel widths, expanded sections.

### 9.6 ✅ Virtual Scrolling for Large Lists
**Why**: 1000+ entries rendered smoothly.
```
useVirtualizer({count, getScrollElement, estimateSize, overscan})
```
**Zeus Insight**: For terminal output and session logs.

### 9.7 ✅ Entry Aggregation (UI Optimization)
**Why**: Groups 50+ file_read entries → "Read 50 files" button.
```
deriveConversationEntries() → identifies consecutive similar actions
```
**Zeus Insight**: Reduce visual noise in session logs.

### 9.8 ✅ Query Key Factory Pattern
**Why**: Centralized key generation. Easy to invalidate related queries.
```typescript
// In workspaceSummaryKeys.ts
export const workspaceSummaryKeys = {
  execution: (workspaceId) => ['workspace', workspaceId, 'execution'],
  sessions: (workspaceId) => ['workspace', workspaceId, 'sessions'],
};
```
**Zeus Insight**: Create `sessionKeys`, `terminalKeys` factories.

### 9.9 ✅ Executor-Agnostic Tool Protocol
**Why**: Swap executors without frontend changes.
```
All agents call same MCP tools → Capabilities fetched at runtime
```
**Zeus Insight**: Design Zeus to support multiple executor types from day one.

### 9.10 ✅ Config as Context + React Query
**Why**: System config (executors, language, integrations) always in sync.
```typescript
<ConfigProvider> → useQuery('user-system')
```
**Zeus Insight**: Great pattern for managing system state + executor discovery.

### 9.11 ✅ Monorepo Structure
**Why**: Code reuse, consistent tooling, single deployment.
```
crates/ (Rust): shared types + APIs
packages/ (JS): web-core (shared) + app-specific (local-web, remote-web)
```
**Zeus Insight**: Build like this from the start.

### 9.12 ✅ Error Boundaries + Sentry
**Why**: Crash tracking + user feedback loop.
```typescript
<Sentry.ErrorBoundary fallback={<ErrorUI />} showDialog>
  <App />
</Sentry.ErrorBoundary>
```
**Zeus Insight**: Essential for remote orchestration (need to know when things fail).

---

## 10. IMPLEMENTATION RECOMMENDATIONS FOR ZEUS

### Start With
1. **Feature structure** (mimic workspace-chat/)
   - `model/` — Data derivation, hooks, contexts
   - `ui/` — React components (presentation layer)

2. **State shape** (define NormalizedEntry for Claude session)
   - User messages
   - Assistant responses
   - Tool calls (file_read, command_run, etc.)
   - Errors, thinking
   - Terminal output

3. **Real-time updates** (polling first, WebSocket later)
   - Fetch session status every 1-2 seconds
   - Display running/idle/error states

4. **Type safety** (generate types from Rust)
   - Define Rust structs → ts-rs → TypeScript interfaces
   - CI check: `pnpm run generate-types:check`

### Medium Term
- Approval gates for sensitive operations
- Virtual scrolling for large session logs
- Syntax-highlighted diff viewer (use Vibekanban's PierreConversationDiff)
- Entry aggregation to reduce noise

### Long Term
- WebSocket for low-latency streaming (PTY output)
- Multi-executor support
- Relay tunnel for remote access (copy from Vibekanban's relay-tunnel/)

---

## 11. CODE QUALITY & PATTERNS

### Testing
- **Rust**: Unit tests in `#[cfg(test)]` modules
- **TypeScript**: Vitest for component/hook tests
- **Integration**: Manual testing via `pnpm run dev`

### Linting & Formatting
- **Rust**: `cargo fmt` (rustfmt) + `cargo clippy`
- **TypeScript**: Prettier (2 spaces, 80 cols) + ESLint
- **Pre-commit**: `pnpm run format && pnpm run lint`

### Performance
- Code splitting: TanStack Router lazy routes
- Image optimization: WebP + srcset
- Bundle size: `pnpm run build` and check with `bundle-analyzer`

### Accessibility
- Semantic HTML (`<button>`, `<input>`, labels)
- ARIA attributes for screen readers
- Keyboard navigation (via `react-hotkeys-hook`)

---

## 12. DEPLOYMENT

### Local (Tauri)
```bash
pnpm run tauri:dev      # Local development
pnpm run tauri:build    # Release build → DMG/EXE/APK
```
Binary bundles desktop app with embedded web UI.

### Remote (Web)
```bash
# Self-hosted via Docker
docker build . -t vibe-kanban
docker run -p 3000:3000 vibe-kanban
```

### Relay (Tunneling)
```bash
# Remote machine → accessible via ngrok/CloudFlare tunnel
VK_TUNNEL=true VK_SHARED_RELAY_API_BASE=... pnpm run dev
```

---

## SUMMARY

Vibekanban is a **mature reference** for:
- ✅ **Full-stack type safety** (Rust → TypeScript)
- ✅ **Real-time AI integration** (WebSocket + polling)
- ✅ **Complex conversation UI** (virtualization, aggregation, approval gates)
- ✅ **Monorepo organization** (Rust crates + JS workspaces)
- ✅ **Responsive design system** (Tailwind + CSS variables)
- ✅ **Deployment flexibility** (Local Tauri, remote web, relay tunnel)

**For Zeus**: Adopt patterns #1, #2, #3, #4, #5, #6, #7, #8, #10, #11 early. They compound in value as the codebase grows.
