# New Session Full-Page View — Design Spec

**Date:** 2026-03-19
**Status:** Draft
**Replaces:** `NewClaudeSessionModal` (dialog-based session creation)

---

## Problem

The current "New Claude Session" flow uses a modal dialog (`NewClaudeSessionModal`). This constrains the UI to a cramped overlay that can't accommodate an enhanced creation experience (recent projects, quick-start, project management). The user wants a full-page view — like the existing Settings tab — that provides room for a richer session creation flow.

## Solution

Replace the modal with a new `viewMode: 'new-session'` that renders a full-page `NewSessionView` component. This follows the exact same pattern as `SettingsView` — left sidebar navigation on desktop, horizontal tabs on mobile, scrollable content area.

---

## Architecture

### ViewMode Change

```
Current:  'terminal' | 'claude' | 'diff' | 'settings'
Proposed: 'terminal' | 'claude' | 'diff' | 'settings' | 'new-session'
```

### Store Changes

**Remove:**
- `showNewClaudeModal: boolean`
- `openNewClaudeModal(): void`
- `closeNewClaudeModal(): void`

**Modify:**

**1. `previousViewMode` type & initial state:**
- Widen type from `'terminal' | 'claude'` to `ViewMode`
- Update initial state at line 423 from `previousViewMode: 'terminal' as const` to `previousViewMode: 'terminal'` (no cast needed — `'terminal'` satisfies `ViewMode` directly)

**2. Centralize `previousViewMode` tracking in `setViewMode`:**

Current implementation (line 1951):
```typescript
setViewMode: (mode) => set({ viewMode: mode })
```

New implementation:
```typescript
setViewMode: (mode) => set((state) => ({
  viewMode: mode,
  previousViewMode: state.viewMode !== 'diff' ? state.viewMode : state.previousViewMode,
}))
```

This centralizes the `previousViewMode` tracking that is currently duplicated across ~7 diff-tab locations.

**3. Remove narrow casts in diff-tab logic:**

The store has ~7 locations (lines 1042, 1214, 2041, 2067, 2099, 2152, 2317) with:
```typescript
previousViewMode: state.viewMode !== 'diff'
  ? (state.viewMode as 'terminal' | 'claude')
  : state.previousViewMode
```

Since `setViewMode` now handles `previousViewMode` tracking, these diff-tab locations should either:
- (a) Delegate to `setViewMode('diff')` instead of duplicating the pattern, OR
- (b) Remove the `as 'terminal' | 'claude'` cast and use `state.viewMode` directly (since the type is now `ViewMode`)

Option (a) is preferred — it eliminates duplication.

**4. All call sites that invoke `openNewClaudeModal()` → `setViewMode('new-session')`:**
- `App.tsx` `handleKeyDown` callback (Cmd+N handler)
- `App.tsx` `buildCommands` call — rename `openNewClaudeModal` param to `openNewSession` and pass `() => setViewMode('new-session')`
- `SessionSidebar.tsx` — **4 trigger sites:**
  - `onNewClaudeSession` prop usage in collapsed sidebar (line ~385)
  - Direct `openNewClaudeModal()` store call in mobile sidebar (line ~406) — **bypasses the prop, must be changed to `setViewMode('new-session')`**
  - Desktop sidebar section header button (line ~669)
  - Any other `onNewClaudeSession` prop call sites
- `CommandPalette.tsx` `buildCommands` — rename parameter from `openNewClaudeModal` to `openNewSession`

**Add (side effect in NewSessionView):**
- Last-used project persistence via `zeusWs.send()` — this logic currently lives in `App.tsx` (lines 498-510) and must move into `NewSessionView`'s submit handler since the modal wrapper in App.tsx is being deleted

### Files Changed

| File | Change |
|------|--------|
| `src/renderer/src/stores/useZeusStore.ts` | Remove modal state/actions, add `'new-session'` to ViewMode, widen `previousViewMode` type + initial state, centralize tracking in `setViewMode`, remove narrow casts in ~7 diff-tab locations |
| `src/renderer/src/App.tsx` | Remove `NewClaudeSessionModal` import+render, add `NewSessionView` to **both** mobile and desktop view switches, remove last-used-project persistence, update `handleKeyDown` and `buildCommands` |
| `src/renderer/src/components/NewSessionView.tsx` | **New file** — full-page session creation view with `useNewSessionForm` hook |
| `src/renderer/src/components/NewClaudeSessionModal.tsx` | **Delete** (only imported by App.tsx — safe to remove) |
| `src/renderer/src/components/SessionSidebar.tsx` | Update all 4 "new session" trigger sites (including direct store call at line ~406) |
| `src/renderer/src/components/CommandPalette.tsx` | Rename `openNewClaudeModal` param to `openNewSession` in `buildCommands` |
| `src/renderer/src/components/Header.tsx` | No modal-related props — minimal/no changes |

---

## NewSessionView Component

### Layout (mirrors SettingsView)

```
Desktop:
┌──────────────────────────────────────────────┐
│  Left Nav (w-48)  │  Content (max-w-2xl)     │
│                   │                          │
│  ┌─────────────┐  │  ┌──────────────────────┐│
│  │ Quick Start  │  │  │                      ││
│  │ Configure    │  │  │  (active tab content) ││
│  │ Projects     │  │  │                      ││
│  └─────────────┘  │  └──────────────────────┘│
└──────────────────────────────────────────────┘

Mobile:
┌──────────────────────────────────────────────┐
│  [Quick Start] [Configure] [Projects]        │
├──────────────────────────────────────────────┤
│                                              │
│  (active tab content, scrollable)            │
│                                              │
└──────────────────────────────────────────────┘
```

### Internal Tabs

```typescript
type NewSessionTab = 'quick-start' | 'configure' | 'projects';

const tabs: { id: NewSessionTab; label: string; icon: typeof Zap }[] = [
  { id: 'quick-start', label: 'Quick Start', icon: Zap },
  { id: 'configure',   label: 'Configure',   icon: SlidersHorizontal },
  { id: 'projects',    label: 'Projects',     icon: FolderOpen },
];
```

Tab switches within `NewSessionView` use conditional rendering (`activeTab === 'quick-start' && ...`), NOT unmount/remount. This means form state persists when switching between Quick Start, Configure, and Projects tabs within the same session.

### Sidebar Active State

The `new-session` view is ephemeral — **no sidebar highlight**. The sidebar session list shows the previously-active session as selected (dimmed or no highlight). The "New Claude Session" button in the sidebar header could optionally show a subtle active indicator, but this is not required.

---

### Tab 1: Quick Start (default)

Purpose: Get a session running in < 3 clicks for returning users.

**Layout:**
1. **Section: Recent Projects** — Grid of project cards (from `savedProjects`, sorted by last-used)
   - Each card: project name, truncated path, click to select
   - Selected card gets accent border highlight
   - If no saved projects: "No projects yet" message with link to Projects tab

2. **Section: Prompt** — Large textarea
   - Placeholder: "What should Claude do?"
   - Auto-focus when tab is active
   - Cmd+Enter to submit

3. **Section: Quick Settings** — Single row of key defaults
   - Permission mode pill selector (inline, compact)
   - Model selector (small input or dropdown)

4. **Start Session button** — Full-width at bottom, disabled until prompt + project selected
   - Uses `claudeDefaults` for all other settings (notification sound, git watcher, etc.)

### Tab 2: Configure (Full Form)

Purpose: Full control over every session parameter.

**Layout (vertical sections separated by `<Separator />`):**

1. **Project Directory**
   - Saved projects list (selectable cards, same as current modal)
   - "Custom directory" toggle with path input
   - "Add Project" inline form (collapsible)

2. **Session Configuration**
   - Prompt textarea (3 rows)
   - Session Name input (optional)
   - Permission Mode pill selector
   - Model input (optional)

3. **Features**
   - Notification Sound toggle (Switch)
   - Git Watcher toggle (Switch) with description
   - QA Testing toggle (Switch) with description
   - QA Target URL input (conditional, shown when QA enabled)

4. **Start Session button** — Sticky at bottom or inline

### Tab 3: Projects

Purpose: Manage saved projects without starting a session.

**Layout:**
1. **Saved Projects list**
   - Each item: name, path, remove button (with hover reveal)
   - Empty state: "No saved projects"

2. **Add Project form**
   - Project name input
   - Absolute path input
   - "Create directory if it doesn't exist" checkbox
   - Save / Cancel buttons
   - Settings error display (inline)

---

## Data Flow

### State Management

Form state is encapsulated in a **`useNewSessionForm` custom hook** to keep `NewSessionView` focused on layout. The hook manages:
- 12+ `useState` hooks (selectedProjectId, customDir, prompt, sessionName, permissionMode, model, notificationSound, enableGitWatcher, enableQA, qaTargetUrl, showCustomDir, showAddProject, newProjectName, newProjectPath, createNewDir)
- Derived values: `workingDir`, `canSubmit`
- `handleSubmit()` function (calls `startClaudeSession` + persists last-used project)

No Zustand involvement for form fields — all local state.

**From Zustand (read-only):**
- `savedProjects: SavedProject[]`
- `claudeDefaults: ClaudeDefaults`
- `lastUsedProjectId: string | null`
- `settingsError: string | null`
- `previousViewMode: ViewMode`

**Zustand actions called:**
- `startClaudeSession(config)` — creates the session
- `addProject(name, path, createDir?)` — saves a new project
- `removeProject(id)` — deletes a saved project
- `setViewMode(mode)` — navigation

### Session Creation Sequence

```
User clicks "Start Session"
  → validate: prompt + workingDir required
  → call startClaudeSession({ prompt, workingDir, sessionName?, permissionMode?, model?, notificationSound?, enableGitWatcher?, enableQA?, qaTargetUrl? })
  → persist last-used project via zeusWs.send() (if project is from savedProjects)
  → startClaudeSession internally sets viewMode='claude' + activeClaudeId
  → user lands on the new Claude session
```

### Navigation

| Trigger | Action |
|---------|--------|
| Cmd+N | `setViewMode('new-session')` |
| Sidebar "New Claude Session" button (all 4 sites) | `setViewMode('new-session')` |
| Command Palette "New Claude Session" | `setViewMode('new-session')` |
| Escape key (while on new-session view) | `setViewMode(previousViewMode)` — guarded: only fires if CommandPalette is NOT open |
| Click session in sidebar | `selectClaudeSession(id)` or `selectSession(id)` — navigates away |
| After session created | Auto-navigates to `viewMode: 'claude'` |
| Cmd+, (while on new-session) | Goes to settings; Cmd+, again returns to `new-session` via `previousViewMode` |

### Last-Used Project Persistence

The current `App.tsx` wraps the modal's `onStart` to send a WebSocket message persisting the last-used project ID. Since the modal is being deleted, this logic moves into the `useNewSessionForm` hook's `handleSubmit`:

```typescript
// Inside useNewSessionForm handleSubmit:
const project = savedProjects.find((p) => p.path === config.workingDir);
if (project) {
  zeusWs.send({
    channel: 'settings',
    sessionId: '',
    payload: { type: 'set_last_used_project', id: project.id },
    auth: '',
  });
}
```

### Form Reset

Form state resets when the component mounts (navigating to `new-session` view). React unmount/remount handles cleanup since the view conditionally renders (`viewMode === 'new-session' && <NewSessionView />`).

**Initialization from defaults:** `useState` initializers read from `claudeDefaults` (permission mode, model, notification sound) and `lastUsedProjectId` (selected project). This mirrors the modal's `useEffect` reset but happens naturally at mount time.

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| No saved projects | Quick Start shows empty state with "Add a project" CTA linking to Projects tab |
| Settings error on add project | Inline error message below add-project form |
| Missing prompt | Start button disabled, no error message needed |
| Missing working directory | Start button disabled |
| Mid-creation navigation (click sidebar session) | Form state lost (acceptable — same as closing the modal) |

---

## Keyboard Shortcuts

| Shortcut | Context | Action | Handler Location |
|----------|---------|--------|-----------------|
| Cmd+N | Global | Navigate to new-session view | `App.tsx` `handleKeyDown` |
| Cmd+Enter | While prompt focused | Submit form (start session) | `NewSessionView` textarea `onKeyDown` |
| Escape | On new-session view | `setViewMode(previousViewMode)` | `NewSessionView` local `useEffect` with `keydown` listener. **Guard:** only fires if CommandPalette is not open (check `showCommandPalette` from store or pass as prop). If CommandPalette is open, Escape closes it instead. |
| Cmd+, | On new-session view | Navigate to settings (existing handler in App.tsx works via `setViewMode`) | `App.tsx` `handleKeyDown` — works automatically since `setViewMode` now saves `previousViewMode` |

---

## Mobile Considerations

- Left sidebar becomes horizontal tab bar at top (same pattern as SettingsView)
- Content area is full-width, scrollable
- Project cards stack vertically
- Start button is full-width
- Same responsive breakpoint: `md` (768px)
- Note: mobile view switch in App.tsx (line ~283) currently handles `settings | claude | terminal` only (no `diff` — confirmed). Add `new-session` case alongside the existing ternary chain.

---

## UX Notes

**No transition animation.** The current modal has enter/exit animation via Dialog. The full-page view swap will be an instant cut, consistent with all other view mode transitions (terminal → claude → settings). This is a minor UX regression from the modal's slide-in but is consistent with the rest of the app.

---

## What's NOT Changing

- `startClaudeSession()` store action — unchanged
- `ClaudeView` — unchanged
- WebSocket protocol — unchanged
- `SavedProject`, `ClaudeDefaults`, `PermissionMode` types — unchanged
- Right panel behavior — unchanged
- Session sidebar session list — unchanged (just the "new session" button handlers change)

---

## Testing Checklist

- [ ] Cmd+N opens new-session view (not modal)
- [ ] Quick Start: select project → type prompt → Start → lands on Claude session
- [ ] Configure: all fields work (project, prompt, name, permission, model, toggles)
- [ ] Projects: add project → appears in list; remove project → disappears
- [ ] QA toggle shows/hides QA URL field
- [ ] Escape returns to previous view
- [ ] Escape does NOT fire when CommandPalette is open
- [ ] Cmd+, from new-session → settings → Cmd+, returns to new-session
- [ ] Clicking a sidebar session navigates away from new-session view
- [ ] Mobile: horizontal tabs work, content scrolls, form submits
- [ ] Empty state: no projects → helpful CTA on Quick Start tab
- [ ] Form validation: Start button disabled without prompt + directory
- [ ] After creation: correct session is active, viewMode is 'claude'
- [ ] Tab switches within NewSessionView preserve form state
- [ ] All 4 SessionSidebar trigger sites open new-session view (including direct store call)
- [ ] Diff tab opened from new-session → close diff → returns to new-session (via `previousViewMode`)
