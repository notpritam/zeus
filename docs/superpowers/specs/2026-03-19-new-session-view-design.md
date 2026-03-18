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
- `setViewMode(mode)` — update to save current `viewMode` into `previousViewMode` before transitioning (enables Escape-back navigation)
- `previousViewMode` type — widen from `'terminal' | 'claude'` to `ViewMode` to support back-navigation from any view
- **All `previousViewMode` assignment sites in diff-tab logic** — the store currently has 13+ locations that cast `state.viewMode as 'terminal' | 'claude'` when setting `previousViewMode`. These narrow casts must be removed so that `'settings'`, `'new-session'`, and `'diff'` are preserved as valid return targets. Without this, closing a diff while on settings/new-session would navigate to the wrong view. Search for `previousViewMode` in the store and remove all `as 'terminal' | 'claude'` casts.
- All call sites that invoke `openNewClaudeModal()` → `setViewMode('new-session')`
  - `App.tsx` `handleKeyDown` callback (Cmd+N handler, line ~183)
  - `App.tsx` `buildCommands` call — rename `openNewClaudeModal` param to `openNewSession` and pass `() => setViewMode('new-session')`
  - `SessionSidebar.tsx` "New Claude Session" button `onNewClaudeSession` prop
  - `CommandPalette.tsx` `buildCommands` — rename parameter from `openNewClaudeModal` to `openNewSession`

**Add (side effect in NewSessionView):**
- Last-used project persistence via `zeusWs.send()` — this logic currently lives in `App.tsx` (lines 477-487) and must move into `NewSessionView`'s submit handler since the modal wrapper in App.tsx is being deleted

### Files Changed

| File | Change |
|------|--------|
| `src/renderer/src/stores/useZeusStore.ts` | Remove modal state/actions, add `'new-session'` to ViewMode, widen `previousViewMode` type, update `setViewMode` to track previous |
| `src/renderer/src/App.tsx` | Remove `NewClaudeSessionModal` import+render, add `NewSessionView` to **both** mobile (line ~275) and desktop (line ~410) view switches, remove last-used-project persistence from App, update `handleKeyDown` and `buildCommands` |
| `src/renderer/src/components/NewSessionView.tsx` | **New file** — full-page session creation view |
| `src/renderer/src/components/NewClaudeSessionModal.tsx` | **Delete** |
| `src/renderer/src/components/SessionSidebar.tsx` | Update "new session" button handler |
| `src/renderer/src/components/CommandPalette.tsx` | Rename `openNewClaudeModal` param to `openNewSession` in `buildCommands` |
| `src/renderer/src/components/Header.tsx` | Remove modal-related props if any |

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

All form state lives in **local React state** (useState) inside `NewSessionView`. No Zustand involvement for form fields.

**From Zustand (read-only):**
- `savedProjects: SavedProject[]`
- `claudeDefaults: ClaudeDefaults`
- `lastUsedProjectId: string | null`
- `settingsError: string | null`

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
  → persist last-used project via WebSocket (if project is from savedProjects)
  → startClaudeSession internally sets viewMode='claude' + activeClaudeId
  → user lands on the new Claude session
```

### Navigation

| Trigger | Action |
|---------|--------|
| Cmd+N | `setViewMode('new-session')` |
| Sidebar "New Claude Session" button | `setViewMode('new-session')` |
| Command Palette "New Claude Session" | `setViewMode('new-session')` |
| Escape key (while on new-session view) | `setViewMode(previousViewMode)` — returns to the view the user was on before navigating here |
| Click session in sidebar | `selectClaudeSession(id)` or `selectSession(id)` — navigates away |
| After session created | Auto-navigates to `viewMode: 'claude'` |

### Last-Used Project Persistence

The current `App.tsx` wraps the modal's `onStart` to send a WebSocket message persisting the last-used project ID. Since the modal is being deleted, this logic moves into `NewSessionView`'s submit handler:

```typescript
// Inside NewSessionView handleSubmit:
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
| Escape | On new-session view | `setViewMode(previousViewMode)` | `NewSessionView` local `useEffect` with `keydown` listener (only active when `viewMode === 'new-session'`) |

---

## Mobile Considerations

- Left sidebar becomes horizontal tab bar at top (same pattern as SettingsView)
- Content area is full-width, scrollable
- Project cards stack vertically
- Start button is full-width
- Same responsive breakpoint: `md` (768px)

---

## What's NOT Changing

- `startClaudeSession()` store action — unchanged
- `ClaudeView` — unchanged
- WebSocket protocol — unchanged
- `SavedProject`, `ClaudeDefaults`, `PermissionMode` types — unchanged
- Right panel behavior — unchanged
- Session sidebar session list — unchanged (just the "new session" button handler changes)

---

## Testing Checklist

- [ ] Cmd+N opens new-session view (not modal)
- [ ] Quick Start: select project → type prompt → Start → lands on Claude session
- [ ] Configure: all fields work (project, prompt, name, permission, model, toggles)
- [ ] Projects: add project → appears in list; remove project → disappears
- [ ] QA toggle shows/hides QA URL field
- [ ] Escape returns to previous view
- [ ] Clicking a sidebar session navigates away from new-session view
- [ ] Mobile: horizontal tabs work, content scrolls, form submits
- [ ] Empty state: no projects → helpful CTA on Quick Start tab
- [ ] Form validation: Start button disabled without prompt + directory
- [ ] After creation: correct session is active, viewMode is 'claude'
