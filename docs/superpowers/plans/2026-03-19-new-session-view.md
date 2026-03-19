# New Session Full-Page View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `NewClaudeSessionModal` dialog with a full-page `NewSessionView` that follows the SettingsView layout pattern (sidebar nav on desktop, horizontal tabs on mobile).

**Architecture:** The Zustand store changes are already complete (`ViewMode` includes `'new-session'`, `previousViewMode` is typed as `ViewMode`, `setViewMode` centralizes tracking, modal state removed). The remaining work is creating the new `NewSessionView` component, updating all consumer files (App.tsx, SessionSidebar, CommandPalette), and deleting the old modal.

**Tech Stack:** React, Zustand, TypeScript, Tailwind CSS, lucide-react icons, shadcn/ui components (Button, Input, Label, Switch, Separator)

**Spec:** `docs/superpowers/specs/2026-03-19-new-session-view-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/renderer/src/components/NewSessionView.tsx` | **Create** | Full-page view with 3-tab layout (Quick Start, Configure, Projects) + `useNewSessionForm` hook |
| `src/renderer/src/App.tsx` | **Modify** | Remove modal import/render, add NewSessionView to view switches, fix Cmd+N and Cmd+, handlers |
| `src/renderer/src/components/SessionSidebar.tsx` | **Modify** | Update `viewMode` prop type to include `'new-session'` |
| `src/renderer/src/components/CommandPalette.tsx` | **Modify** | Rename `openNewClaudeModal` → `openNewSession` in `buildCommands` |
| `src/renderer/src/components/NewClaudeSessionModal.tsx` | **Delete** | No longer needed |

---

### Task 1: Create the `useNewSessionForm` hook and `NewSessionView` component

This is the largest task. We create the new full-page view component with all three tabs, following the exact SettingsView layout pattern.

**Files:**
- Create: `src/renderer/src/components/NewSessionView.tsx`
- Reference: `src/renderer/src/components/SettingsView.tsx` (layout pattern)
- Reference: `src/renderer/src/components/NewClaudeSessionModal.tsx` (form logic to port)

- [ ] **Step 1: Create `NewSessionView.tsx` with the `useNewSessionForm` hook and all three tabs**

The component must:
1. Mirror `SettingsView.tsx` layout: mobile horizontal tab bar + desktop vertical sidebar nav + scrollable content area
2. Encapsulate all form state in a `useNewSessionForm` custom hook (ported from `NewClaudeSessionModal.tsx` lines 58-118)
3. Include Escape key handler with CommandPalette guard
4. Include last-used project persistence in the submit handler via `zeusWs.send()`

```typescript
import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Zap, SlidersHorizontal, FolderOpen, Plus, X, FolderPlus } from 'lucide-react';
import { useZeusStore } from '@/stores/useZeusStore';
import { zeusWs } from '@/lib/ws';
import type { SavedProject, PermissionMode } from '../../../../shared/types';

// ─── Permission modes (same as old modal) ───

const PERMISSION_MODES: { value: PermissionMode; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'plan', label: 'Plan' },
  { value: 'acceptEdits', label: 'Accept Edits' },
  { value: 'bypassPermissions', label: 'Bypass' },
];

// ─── Tab definitions ───

type NewSessionTab = 'quick-start' | 'configure' | 'projects';

const tabs: { id: NewSessionTab; label: string; icon: typeof Zap }[] = [
  { id: 'quick-start', label: 'Quick Start', icon: Zap },
  { id: 'configure', label: 'Configure', icon: SlidersHorizontal },
  { id: 'projects', label: 'Projects', icon: FolderOpen },
];

// ─── useNewSessionForm hook ───

function useNewSessionForm() {
  const savedProjects = useZeusStore((s) => s.savedProjects);
  const claudeDefaults = useZeusStore((s) => s.claudeDefaults);
  const lastUsedProjectId = useZeusStore((s) => s.lastUsedProjectId);
  const settingsError = useZeusStore((s) => s.settingsError);
  const startClaudeSession = useZeusStore((s) => s.startClaudeSession);
  const addProject = useZeusStore((s) => s.addProject);
  const removeProject = useZeusStore((s) => s.removeProject);

  // Project selection
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(lastUsedProjectId);
  const [customDir, setCustomDir] = useState('');
  const [showCustomDir, setShowCustomDir] = useState(savedProjects.length === 0);

  // Add project form
  const [showAddProject, setShowAddProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectPath, setNewProjectPath] = useState('');
  const [createNewDir, setCreateNewDir] = useState(false);

  // Session config
  const [prompt, setPrompt] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(claudeDefaults.permissionMode);
  const [model, setModel] = useState(claudeDefaults.model);
  const [notificationSound, setNotificationSound] = useState(claudeDefaults.notificationSound);
  const [enableGitWatcher, setEnableGitWatcher] = useState(true);
  const [enableQA, setEnableQA] = useState(false);
  const [qaTargetUrl, setQaTargetUrl] = useState(window.location.origin);

  // Derived
  const workingDir = showCustomDir
    ? customDir.trim()
    : savedProjects.find((p) => p.id === selectedProjectId)?.path ?? '';
  const canSubmit = !!(prompt.trim() && workingDir);

  // Auto-select newly added project
  const prevProjectCountRef = useRef(savedProjects.length);
  useEffect(() => {
    if (savedProjects.length > prevProjectCountRef.current) {
      const newest = savedProjects[savedProjects.length - 1];
      if (newest) {
        setSelectedProjectId(newest.id);
        setShowCustomDir(false);
        setShowAddProject(false);
        setNewProjectName('');
        setNewProjectPath('');
        setCreateNewDir(false);
      }
    }
    prevProjectCountRef.current = savedProjects.length;
  }, [savedProjects]);

  const handleAddProject = useCallback(() => {
    const name = newProjectName.trim();
    const projectPath = newProjectPath.trim();
    if (!name || !projectPath) return;
    addProject(name, projectPath, createNewDir || undefined);
  }, [newProjectName, newProjectPath, createNewDir, addProject]);

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    const config = {
      prompt: prompt.trim(),
      workingDir,
      sessionName: sessionName.trim() || undefined,
      permissionMode,
      model: model.trim() || undefined,
      notificationSound,
      enableGitWatcher,
      enableQA,
      qaTargetUrl: enableQA ? qaTargetUrl.trim() || undefined : undefined,
    };
    startClaudeSession(config);

    // Persist last-used project
    const project = savedProjects.find((p) => p.path === config.workingDir);
    if (project) {
      zeusWs.send({
        channel: 'settings',
        sessionId: '',
        payload: { type: 'set_last_used_project', id: project.id },
        auth: '',
      });
    }
  }, [
    canSubmit, prompt, workingDir, sessionName, permissionMode, model,
    notificationSound, enableGitWatcher, enableQA, qaTargetUrl,
    startClaudeSession, savedProjects,
  ]);

  return {
    // Store data
    savedProjects, settingsError,
    // Project selection
    selectedProjectId, setSelectedProjectId,
    customDir, setCustomDir,
    showCustomDir, setShowCustomDir,
    // Add project
    showAddProject, setShowAddProject,
    newProjectName, setNewProjectName,
    newProjectPath, setNewProjectPath,
    createNewDir, setCreateNewDir,
    handleAddProject,
    removeProject,
    // Session config
    prompt, setPrompt,
    sessionName, setSessionName,
    permissionMode, setPermissionMode,
    model, setModel,
    notificationSound, setNotificationSound,
    enableGitWatcher, setEnableGitWatcher,
    enableQA, setEnableQA,
    qaTargetUrl, setQaTargetUrl,
    // Derived
    workingDir, canSubmit,
    // Actions
    handleSubmit,
  };
}

// ─── Shared sub-components ───

function ProjectCard({
  project,
  selected,
  onSelect,
  onRemove,
}: {
  project: SavedProject;
  selected: boolean;
  onSelect: () => void;
  onRemove?: () => void;
}) {
  return (
    <button
      className={`group flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
        selected
          ? 'border-ring/50 bg-primary/10'
          : 'border-border hover:bg-secondary'
      }`}
      onClick={onSelect}
    >
      <div className="min-w-0 flex-1">
        <div className="text-foreground text-xs font-semibold">{project.name}</div>
        <div className="text-muted-foreground truncate text-[10px]">{project.path}</div>
      </div>
      {onRemove && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <X className="text-muted-foreground hover:text-destructive size-3" />
        </Button>
      )}
    </button>
  );
}

function AddProjectForm({
  newProjectName,
  setNewProjectName,
  newProjectPath,
  setNewProjectPath,
  createNewDir,
  setCreateNewDir,
  settingsError,
  onAdd,
  onCancel,
}: {
  newProjectName: string;
  setNewProjectName: (v: string) => void;
  newProjectPath: string;
  setNewProjectPath: (v: string) => void;
  createNewDir: boolean;
  setCreateNewDir: (v: boolean) => void;
  settingsError: string | null;
  onAdd: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="border-border space-y-2 rounded-lg border p-3">
      <Input
        autoFocus
        value={newProjectName}
        onChange={(e) => setNewProjectName(e.target.value)}
        placeholder="Project name"
        className="text-xs"
      />
      <Input
        value={newProjectPath}
        onChange={(e) => setNewProjectPath(e.target.value)}
        placeholder="/absolute/path/to/project"
        className="text-xs"
      />
      <button
        type="button"
        className="flex items-center gap-1.5 text-[10px]"
        onClick={() => setCreateNewDir(!createNewDir)}
      >
        <div
          className={`flex size-3.5 items-center justify-center rounded border ${
            createNewDir ? 'border-primary bg-primary' : 'border-border'
          }`}
        >
          {createNewDir && (
            <svg viewBox="0 0 12 12" className="size-2.5 text-primary-foreground">
              <path
                d="M2 6l3 3 5-5"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </div>
        <FolderPlus className="text-muted-foreground size-3" />
        <span className={createNewDir ? 'text-foreground font-medium' : 'text-muted-foreground'}>
          Create directory if it doesn't exist
        </span>
      </button>
      {settingsError && <p className="text-destructive text-[11px]">{settingsError}</p>}
      <div className="flex gap-2">
        <Button size="xs" disabled={!newProjectName.trim() || !newProjectPath.trim()} onClick={onAdd}>
          Save
        </Button>
        <Button variant="ghost" size="xs" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function PermissionModePicker({
  value,
  onChange,
}: {
  value: PermissionMode;
  onChange: (v: PermissionMode) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {PERMISSION_MODES.map((mode) => (
        <Button
          key={mode.value}
          variant={value === mode.value ? 'default' : 'secondary'}
          size="xs"
          className="rounded-full"
          onClick={() => onChange(mode.value)}
        >
          {mode.label}
        </Button>
      ))}
    </div>
  );
}

// ─── Main Component ───

function NewSessionView() {
  const [activeTab, setActiveTab] = useState<NewSessionTab>('quick-start');
  const form = useNewSessionForm();
  const setViewMode = useZeusStore((s) => s.setViewMode);
  const previousViewMode = useZeusStore((s) => s.previousViewMode);

  // Escape key — go back (guarded: only if CommandPalette is not open)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Check if CommandPalette or any dialog is open
        const cmdkOpen = document.querySelector('[cmdk-dialog]');
        if (cmdkOpen) return;
        setViewMode(previousViewMode);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setViewMode, previousViewMode]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Mobile tab bar — horizontal */}
      <div className="md:hidden shrink-0 border-b bg-background">
        <nav className="flex gap-1 px-4 py-2 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                  activeTab === tab.id
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                }`}
              >
                <Icon className="size-3.5" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Body: sidebar + content */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Tab nav — vertical on desktop */}
        <nav className="hidden md:flex md:w-48 md:shrink-0 md:flex-col md:border-r md:bg-secondary/20 md:py-3 md:px-2.5 md:space-y-0.5 md:overflow-y-auto">
          <div className="px-2.5 pb-3">
            <h2 className="text-sm font-semibold text-foreground">New Session</h2>
            <p className="text-muted-foreground text-[11px] mt-0.5">Create a Claude session</p>
          </div>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-xs transition-colors ${
                  activeTab === tab.id
                    ? 'bg-background text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
                }`}
              >
                <Icon className="size-3.5" />
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Scrollable content area */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl p-6">
            {/* ── Quick Start tab ── */}
            {activeTab === 'quick-start' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-medium text-foreground mb-1">Quick Start</h3>
                  <p className="text-muted-foreground text-xs mb-4">
                    Select a project and describe the task
                  </p>
                </div>

                {/* Recent Projects */}
                <div className="space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider">
                    Recent Projects
                  </Label>
                  {form.savedProjects.length > 0 ? (
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {form.savedProjects.map((project) => (
                        <ProjectCard
                          key={project.id}
                          project={project}
                          selected={form.selectedProjectId === project.id}
                          onSelect={() => {
                            form.setSelectedProjectId(project.id);
                            form.setShowCustomDir(false);
                          }}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed p-4 text-center">
                      <p className="text-muted-foreground text-xs">No projects yet</p>
                      <Button
                        variant="link"
                        size="xs"
                        className="mt-1 h-auto p-0 text-[11px]"
                        onClick={() => setActiveTab('projects')}
                      >
                        Add a project
                      </Button>
                    </div>
                  )}
                </div>

                {/* Prompt */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Prompt</Label>
                  <textarea
                    autoFocus
                    rows={4}
                    value={form.prompt}
                    onChange={(e) => form.setPrompt(e.target.value)}
                    placeholder="What should Claude do?"
                    className="border-input bg-transparent placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 w-full resize-none rounded-md border px-3 py-2 text-xs shadow-xs outline-none transition-shadow focus-visible:ring-[3px]"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && form.canSubmit) {
                        form.handleSubmit();
                      }
                    }}
                  />
                </div>

                {/* Quick Settings */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Quick Settings</Label>
                  <div className="flex flex-wrap items-center gap-3">
                    <PermissionModePicker
                      value={form.permissionMode}
                      onChange={form.setPermissionMode}
                    />
                    <Input
                      value={form.model}
                      onChange={(e) => form.setModel(e.target.value)}
                      placeholder="Model (default)"
                      className="w-40 text-xs"
                    />
                  </div>
                </div>

                {/* Start */}
                <Button
                  className="w-full"
                  disabled={!form.canSubmit}
                  onClick={form.handleSubmit}
                >
                  Start Session
                </Button>
              </div>
            )}

            {/* ── Configure tab ── */}
            {activeTab === 'configure' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-medium text-foreground mb-1">Configure</h3>
                  <p className="text-muted-foreground text-xs mb-4">
                    Full control over session parameters
                  </p>
                </div>

                {/* Project Directory */}
                <div className="space-y-3">
                  <Label className="text-xs font-semibold uppercase tracking-wider">
                    Project Directory
                  </Label>

                  {form.savedProjects.length > 0 && !form.showCustomDir && (
                    <div className="flex max-h-[200px] flex-col gap-1.5 overflow-y-auto">
                      {form.savedProjects.map((project) => (
                        <ProjectCard
                          key={project.id}
                          project={project}
                          selected={form.selectedProjectId === project.id}
                          onSelect={() => form.setSelectedProjectId(project.id)}
                          onRemove={() => form.removeProject(project.id)}
                        />
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <Button
                      variant="link"
                      size="xs"
                      className={`h-auto p-0 text-[10px] ${form.showCustomDir ? 'text-primary font-semibold' : 'text-muted-foreground'}`}
                      onClick={() => form.setShowCustomDir(!form.showCustomDir)}
                    >
                      {form.showCustomDir ? 'Use saved project' : 'Custom directory'}
                    </Button>
                    {!form.showAddProject && (
                      <Button
                        variant="link"
                        size="xs"
                        className="h-auto p-0 text-[10px] font-semibold"
                        onClick={() => {
                          form.setShowAddProject(true);
                          form.setShowCustomDir(false);
                        }}
                      >
                        <Plus className="size-3" />
                        Add Project
                      </Button>
                    )}
                  </div>

                  {form.showCustomDir && (
                    <Input
                      autoFocus
                      value={form.customDir}
                      onChange={(e) => form.setCustomDir(e.target.value)}
                      placeholder="/path/to/project"
                      className="text-xs"
                    />
                  )}

                  {form.showAddProject && (
                    <AddProjectForm
                      newProjectName={form.newProjectName}
                      setNewProjectName={form.setNewProjectName}
                      newProjectPath={form.newProjectPath}
                      setNewProjectPath={form.setNewProjectPath}
                      createNewDir={form.createNewDir}
                      setCreateNewDir={form.setCreateNewDir}
                      settingsError={form.settingsError}
                      onAdd={form.handleAddProject}
                      onCancel={() => form.setShowAddProject(false)}
                    />
                  )}
                </div>

                <Separator />

                {/* Session Configuration */}
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Prompt</Label>
                    <textarea
                      rows={3}
                      value={form.prompt}
                      onChange={(e) => form.setPrompt(e.target.value)}
                      placeholder="What should Claude do?"
                      className="border-input bg-transparent placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 w-full resize-none rounded-md border px-3 py-2 text-xs shadow-xs outline-none transition-shadow focus-visible:ring-[3px]"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && form.canSubmit) {
                          form.handleSubmit();
                        }
                      }}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">
                      Session Name <span className="text-muted-foreground font-normal">(optional)</span>
                    </Label>
                    <Input
                      value={form.sessionName}
                      onChange={(e) => form.setSessionName(e.target.value)}
                      placeholder="Auto-generated if empty"
                      className="text-xs"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Permission Mode</Label>
                    <PermissionModePicker
                      value={form.permissionMode}
                      onChange={form.setPermissionMode}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">
                      Model <span className="text-muted-foreground font-normal">(optional)</span>
                    </Label>
                    <Input
                      value={form.model}
                      onChange={(e) => form.setModel(e.target.value)}
                      placeholder="Default"
                      className="text-xs"
                    />
                  </div>
                </div>

                <Separator />

                {/* Features */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="ns-notification-sound" className="text-xs font-semibold">
                      Notification Sound
                    </Label>
                    <Switch
                      id="ns-notification-sound"
                      checked={form.notificationSound}
                      onCheckedChange={form.setNotificationSound}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="ns-git-watcher" className="text-xs font-semibold">
                        Git Watcher
                      </Label>
                      <p className="text-muted-foreground text-[10px]">Track file changes in real-time</p>
                    </div>
                    <Switch
                      id="ns-git-watcher"
                      checked={form.enableGitWatcher}
                      onCheckedChange={form.setEnableGitWatcher}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="ns-enable-qa" className="text-xs font-semibold">
                        QA Testing
                      </Label>
                      <p className="text-muted-foreground text-[10px]">
                        Give Claude browser testing tools via MCP
                      </p>
                    </div>
                    <Switch
                      id="ns-enable-qa"
                      checked={form.enableQA}
                      onCheckedChange={form.setEnableQA}
                    />
                  </div>

                  {form.enableQA && (
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">
                        QA Target URL{' '}
                        <span className="text-muted-foreground font-normal">(optional)</span>
                      </Label>
                      <Input
                        value={form.qaTargetUrl}
                        onChange={(e) => form.setQaTargetUrl(e.target.value)}
                        placeholder={window.location.origin}
                        className="text-xs"
                      />
                    </div>
                  )}
                </div>

                <Button
                  className="w-full"
                  disabled={!form.canSubmit}
                  onClick={form.handleSubmit}
                >
                  Start Session
                </Button>
              </div>
            )}

            {/* ── Projects tab ── */}
            {activeTab === 'projects' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-medium text-foreground mb-1">Projects</h3>
                  <p className="text-muted-foreground text-xs mb-4">
                    Manage saved project directories
                  </p>
                </div>

                {/* Saved Projects List */}
                {form.savedProjects.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    {form.savedProjects.map((project) => (
                      <ProjectCard
                        key={project.id}
                        project={project}
                        selected={false}
                        onSelect={() => {}}
                        onRemove={() => form.removeProject(project.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed p-6 text-center">
                    <p className="text-muted-foreground text-xs">No saved projects</p>
                  </div>
                )}

                {/* Add Project Form */}
                <div className="space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider">
                    Add Project
                  </Label>
                  <AddProjectForm
                    newProjectName={form.newProjectName}
                    setNewProjectName={form.setNewProjectName}
                    newProjectPath={form.newProjectPath}
                    setNewProjectPath={form.setNewProjectPath}
                    createNewDir={form.createNewDir}
                    setCreateNewDir={form.setCreateNewDir}
                    settingsError={form.settingsError}
                    onAdd={form.handleAddProject}
                    onCancel={() => {
                      form.setNewProjectName('');
                      form.setNewProjectPath('');
                      form.setCreateNewDir(false);
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default NewSessionView;
```

- [ ] **Step 2: Verify the file was created correctly**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30` from the project root.
Expected: May show errors from App.tsx (still references old modal) but NewSessionView.tsx should have no type errors of its own.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/NewSessionView.tsx
git commit -m "feat: add NewSessionView full-page component with useNewSessionForm hook

Replaces the modal-based session creation with a full-page view
following the SettingsView layout pattern (sidebar nav + horizontal tabs)."
```

---

### Task 2: Update App.tsx — remove modal, add NewSessionView, fix shortcuts

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Replace the `NewClaudeSessionModal` import with `NewSessionView`**

In `src/renderer/src/App.tsx`, change line 11:

```typescript
// Old:
import NewClaudeSessionModal from '@/components/NewClaudeSessionModal';
// New:
import NewSessionView from '@/components/NewSessionView';
```

- [ ] **Step 2: Remove modal-related destructured state from the store**

In `src/renderer/src/App.tsx`, remove these three lines from the `useZeusStore()` destructure (lines 88, 115-116):

```typescript
// Remove these lines:
    showNewClaudeModal,
    openNewClaudeModal,
    closeNewClaudeModal,
```

- [ ] **Step 3: Add `previousViewMode` to the destructured store values**

In the same `useZeusStore()` destructure block, add `previousViewMode` (near `viewMode` at line 84):

```typescript
    viewMode,
    previousViewMode,
```

- [ ] **Step 4: Update `buildCommands` — rename `openNewClaudeModal` to `openNewSession`**

In `src/renderer/src/App.tsx`, update the `buildCommands` call (lines 152-164). Replace `openNewClaudeModal` with an inline function:

```typescript
  const commands = useMemo(
    () =>
      buildCommands({
        powerBlock,
        tunnel,
        togglePower,
        startSession,
        openNewSession: () => setViewMode('new-session'),
        toggleRightPanel,
        openSettings,
      }),
    [powerBlock, tunnel, togglePower, startSession, setViewMode, toggleRightPanel, openSettings],
  );
```

- [ ] **Step 5: Fix `handleKeyDown` — Cmd+N and Cmd+, handlers**

In `src/renderer/src/App.tsx`, update the `handleKeyDown` callback (lines 167-197):

For Cmd+N (line 183-185), replace `openNewClaudeModal()` with `setViewMode('new-session')`.

For Cmd+, (lines 172-179), use `previousViewMode` instead of hardcoded `'terminal'`:

```typescript
      if (e.key === ',') {
        e.preventDefault();
        if (viewMode === 'settings') {
          setViewMode(previousViewMode);
        } else {
          setViewMode('settings');
        }
      }
```

Update the dependency array to include `previousViewMode` and remove `openNewClaudeModal`:

```typescript
    [startSession, toggleRightPanel, toggleSessionTerminalPanel, activeClaudeId, viewMode, previousViewMode, setViewMode],
```

- [ ] **Step 6: Add `NewSessionView` to the mobile view switch**

In `src/renderer/src/App.tsx`, update the mobile content area (lines 282-319). Add `new-session` case before the settings check:

```typescript
          {viewMode === 'new-session' ? (
            <NewSessionView />
          ) : viewMode === 'settings' ? (
            <SettingsView ... />
          ) : viewMode === 'claude' ? (
            <ClaudeView ... />
          ) : (
            <TerminalView sessionId={activeSessionId} />
          )}
```

- [ ] **Step 7: Add `NewSessionView` to the desktop view switch**

In `src/renderer/src/App.tsx`, update the desktop content area (lines 431-462). Add `new-session` case before the settings check:

```typescript
                {viewMode === 'new-session' ? (
                  <NewSessionView />
                ) : viewMode === 'settings' ? (
                  <SettingsView ... />
                ) : viewMode === 'diff' ? (
                  ...
                ) : viewMode === 'claude' ? (
                  ...
                ) : (
                  <TerminalView sessionId={activeSessionId} />
                )}
```

- [ ] **Step 8: Remove the `NewClaudeSessionModal` render block**

In `src/renderer/src/App.tsx`, delete lines 491-514 (the `{/* New Claude Session Modal */}` comment and the entire `<NewClaudeSessionModal ... />` block).

- [ ] **Step 9: Verify App.tsx compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -40`
Expected: No errors from App.tsx. May still have errors from CommandPalette (param rename pending).

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "refactor: replace NewClaudeSessionModal with NewSessionView in App.tsx

- Remove modal import/state/render
- Add NewSessionView to mobile + desktop view switches
- Fix Cmd+N to setViewMode('new-session')
- Fix Cmd+, to use previousViewMode instead of hardcoded 'terminal'"
```

---

### Task 3: Update CommandPalette.tsx — rename parameter

**Files:**
- Modify: `src/renderer/src/components/CommandPalette.tsx`

- [ ] **Step 1: Rename `openNewClaudeModal` to `openNewSession` in `buildCommands`**

In `src/renderer/src/components/CommandPalette.tsx`, update the `buildCommands` function (lines 94-163):

Change the parameter name and type from `openNewClaudeModal` to `openNewSession` (lines 99, 107):

```typescript
export function buildCommands({
  powerBlock,
  tunnel,
  togglePower,
  startSession,
  openNewSession,
  toggleRightPanel,
  openSettings,
}: {
  powerBlock: boolean;
  tunnel: string | null;
  togglePower: () => void;
  startSession: () => void;
  openNewSession: () => void;
  toggleRightPanel: () => void;
  openSettings: () => void;
}): PaletteCommand[] {
```

And update the usage at line 125:

```typescript
      action: openNewSession,
```

- [ ] **Step 2: Verify CommandPalette compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -10`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/CommandPalette.tsx
git commit -m "refactor: rename openNewClaudeModal to openNewSession in CommandPalette"
```

---

### Task 4: Update SessionSidebar.tsx — fix viewMode type

**Files:**
- Modify: `src/renderer/src/components/SessionSidebar.tsx`

- [ ] **Step 1: Widen `viewMode` prop type in `SessionSidebarProps`**

In `src/renderer/src/components/SessionSidebar.tsx`, update line 110:

```typescript
// Old:
  viewMode: 'terminal' | 'claude' | 'diff' | 'settings';
// New:
  viewMode: 'terminal' | 'claude' | 'diff' | 'settings' | 'new-session';
```

- [ ] **Step 2: Widen `viewMode` type in `CollapsedSidebar` props**

In `src/renderer/src/components/SessionSidebar.tsx`, update line 342:

```typescript
// Old:
  viewMode: 'terminal' | 'claude' | 'diff' | 'settings';
// New:
  viewMode: 'terminal' | 'claude' | 'diff' | 'settings' | 'new-session';
```

- [ ] **Step 3: Verify full build compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/SessionSidebar.tsx
git commit -m "refactor: widen viewMode prop type in SessionSidebar to include 'new-session'"
```

---

### Task 5: Delete `NewClaudeSessionModal.tsx` and verify

**Files:**
- Delete: `src/renderer/src/components/NewClaudeSessionModal.tsx`

- [ ] **Step 1: Verify no remaining imports of the old modal**

Run: `grep -rn "NewClaudeSessionModal" src/renderer/src/`
Expected: No matches (App.tsx import was already removed in Task 2).

- [ ] **Step 2: Delete the file**

```bash
rm src/renderer/src/components/NewClaudeSessionModal.tsx
```

- [ ] **Step 3: Full type check**

Run: `npx tsc --noEmit --pretty`
Expected: Clean — zero errors.

- [ ] **Step 4: Full build**

Run: `npm run build 2>&1 | tail -20`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add -u
git commit -m "chore: delete NewClaudeSessionModal (replaced by NewSessionView)"
```

---

### Task 6: Smoke test with QA agent

- [ ] **Step 1: Start the dev server if not running**

Run: `npm run dev`

- [ ] **Step 2: Run QA agent to verify the new session flow**

Use `zeus_qa_run` with task:

```
Test the new session creation flow:
1. Press Cmd+N — verify a full-page "New Session" view appears (not a modal dialog)
2. On Quick Start tab: verify project cards render, prompt textarea is auto-focused, permission mode pills work
3. Switch to Configure tab — verify all form fields (project list, prompt, session name, permission mode, model, toggles)
4. Switch to Projects tab — verify add/remove project works
5. Select a project, type a prompt, click "Start Session" — verify it creates a session and navigates to Claude view
6. Press Cmd+N again, then Escape — verify it returns to the previous view
7. Press Cmd+N, then Cmd+, — verify it goes to settings. Press Cmd+, again — verify it returns to new-session view
```

- [ ] **Step 3: Fix any issues found by QA**

Address any failures identified in the QA summary.

- [ ] **Step 4: Final commit if fixes were needed**

```bash
git add -A
git commit -m "fix: address QA feedback for NewSessionView"
```
