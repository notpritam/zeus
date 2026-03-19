import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Zap,
  SlidersHorizontal,
  FolderOpen,
  X,
  Plus,
  FolderPlus,
} from 'lucide-react';
import { useZeusStore } from '@/stores/useZeusStore';
import { useNewSessionForm } from '@/hooks/useNewSessionForm';
import type { PermissionMode } from '../../../shared/types';

const PERMISSION_MODES: { value: PermissionMode; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'plan', label: 'Plan' },
  { value: 'acceptEdits', label: 'Accept Edits' },
  { value: 'bypassPermissions', label: 'Bypass' },
];

type NewSessionTab = 'quick-start' | 'configure' | 'projects';

const tabs: { id: NewSessionTab; label: string; icon: typeof Zap }[] = [
  { id: 'quick-start', label: 'Quick Start', icon: Zap },
  { id: 'configure', label: 'Configure', icon: SlidersHorizontal },
  { id: 'projects', label: 'Projects', icon: FolderOpen },
];

// ─── Sub-components ───

function AddProjectForm({ form }: { form: ReturnType<typeof useNewSessionForm> }) {
  return (
    <div className="border-border space-y-2 rounded-lg border p-3">
      <Input
        value={form.newProjectName}
        onChange={(e) => form.setNewProjectName(e.target.value)}
        placeholder="Project name"
        className="text-xs"
      />
      <Input
        value={form.newProjectPath}
        onChange={(e) => form.setNewProjectPath(e.target.value)}
        placeholder="/absolute/path/to/project"
        className="text-xs"
      />
      <button
        type="button"
        className="flex items-center gap-1.5 text-[10px]"
        onClick={() => form.setCreateNewDir(!form.createNewDir)}
      >
        <div
          className={`flex size-3.5 items-center justify-center rounded border ${
            form.createNewDir ? 'border-primary bg-primary' : 'border-border'
          }`}
        >
          {form.createNewDir && (
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
        <span
          className={
            form.createNewDir ? 'text-foreground font-medium' : 'text-muted-foreground'
          }
        >
          Create directory if it doesn't exist
        </span>
      </button>
      {form.settingsError && (
        <p className="text-destructive text-[11px]">{form.settingsError}</p>
      )}
      <div className="flex gap-2">
        <Button
          size="xs"
          disabled={!form.newProjectName.trim() || !form.newProjectPath.trim()}
          onClick={form.handleAddProject}
        >
          Save
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => form.setShowAddProject(false)}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function QuickStartTab({
  form,
  onSwitchTab,
}: {
  form: ReturnType<typeof useNewSessionForm>;
  onSwitchTab: (tab: NewSessionTab) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-foreground mb-1">Quick Start</h3>
        <p className="text-muted-foreground text-xs mb-4">
          Select a project and start coding
        </p>
      </div>

      {/* Recent Projects */}
      <div className="space-y-3">
        <Label className="text-xs font-semibold uppercase tracking-wider">
          Project
        </Label>
        {form.savedProjects.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {form.savedProjects.map((project) => (
              <button
                key={project.id}
                className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  form.selectedProjectId === project.id
                    ? 'border-ring/50 bg-primary/10'
                    : 'border-border hover:bg-secondary'
                }`}
                onClick={() => {
                  form.setSelectedProjectId(project.id);
                  form.setShowCustomDir(false);
                }}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-foreground text-xs font-semibold">
                    {project.name}
                  </div>
                  <div className="text-muted-foreground truncate text-[10px]">
                    {project.path}
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <p className="text-muted-foreground text-xs">No projects yet</p>
            <p className="text-muted-foreground text-[10px] mt-1">
              Add a project in the{' '}
              <button
                className="text-primary underline"
                onClick={() => onSwitchTab('projects')}
              >
                Projects
              </button>{' '}
              tab
            </p>
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
      <div className="space-y-3">
        <Label className="text-xs font-semibold uppercase tracking-wider">
          Quick Settings
        </Label>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1.5">
            {PERMISSION_MODES.map((mode) => (
              <Button
                key={mode.value}
                variant={form.permissionMode === mode.value ? 'default' : 'secondary'}
                size="xs"
                className="rounded-full"
                onClick={() => form.setPermissionMode(mode.value)}
              >
                {mode.label}
              </Button>
            ))}
          </div>
          <Input
            value={form.model}
            onChange={(e) => form.setModel(e.target.value)}
            placeholder="Model (default)"
            className="text-xs w-40"
          />
        </div>
      </div>

      {/* Start Button */}
      <Button
        className="w-full"
        disabled={!form.canSubmit}
        onClick={form.handleSubmit}
      >
        Start Session
      </Button>
    </div>
  );
}

function ConfigureTab({ form }: { form: ReturnType<typeof useNewSessionForm> }) {
  return (
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
          <div className="flex max-h-[160px] flex-col gap-1.5 overflow-y-auto">
            {form.savedProjects.map((project) => (
              <button
                key={project.id}
                className={`group flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                  form.selectedProjectId === project.id
                    ? 'border-ring/50 bg-primary/10'
                    : 'border-border hover:bg-secondary'
                }`}
                onClick={() => form.setSelectedProjectId(project.id)}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-foreground text-xs font-semibold">
                    {project.name}
                  </div>
                  <div className="text-muted-foreground truncate text-[10px]">
                    {project.path}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    form.removeProject(project.id);
                  }}
                >
                  <X className="text-muted-foreground hover:text-destructive size-3" />
                </Button>
              </button>
            ))}
          </div>
        )}

        {/* Custom directory / Add Project toggles */}
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

        {/* Add Project inline form */}
        {form.showAddProject && (
          <AddProjectForm form={form} />
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
          <div className="flex flex-wrap gap-1.5">
            {PERMISSION_MODES.map((mode) => (
              <Button
                key={mode.value}
                variant={form.permissionMode === mode.value ? 'default' : 'secondary'}
                size="xs"
                className="rounded-full"
                onClick={() => form.setPermissionMode(mode.value)}
              >
                {mode.label}
              </Button>
            ))}
          </div>
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

        <Separator />

        {/* Feature Toggles */}
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
            <p className="text-muted-foreground text-[10px]">Give Claude browser testing tools via MCP</p>
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
              QA Target URL <span className="text-muted-foreground font-normal">(optional)</span>
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

      <Separator />

      <Button
        className="w-full"
        disabled={!form.canSubmit}
        onClick={form.handleSubmit}
      >
        Start Session
      </Button>
    </div>
  );
}

function ProjectsTab({
  form,
  onSwitchTab,
}: {
  form: ReturnType<typeof useNewSessionForm>;
  onSwitchTab: (tab: NewSessionTab) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-foreground mb-1">Projects</h3>
        <p className="text-muted-foreground text-xs mb-4">
          Manage your saved project directories
        </p>
      </div>

      {/* Saved Projects */}
      {form.savedProjects.length > 0 ? (
        <div className="space-y-1.5">
          {form.savedProjects.map((project) => (
            <div
              key={project.id}
              className="group flex items-center justify-between rounded-lg border px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="text-foreground text-xs font-semibold">
                  {project.name}
                </div>
                <div className="text-muted-foreground truncate text-[10px]">
                  {project.path}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => form.removeProject(project.id)}
              >
                <X className="text-muted-foreground hover:text-destructive size-3" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-muted-foreground text-xs">No saved projects</p>
        </div>
      )}

      <Separator />

      {/* Add Project Form */}
      <div className="space-y-3">
        <Label className="text-xs font-semibold uppercase tracking-wider">
          Add Project
        </Label>
        <AddProjectForm form={form} />
      </div>
    </div>
  );
}

// ─── Main Component ───

function NewSessionView() {
  const [activeTab, setActiveTab] = useState<NewSessionTab>('quick-start');
  const { previousViewMode, setViewMode } = useZeusStore();
  const form = useNewSessionForm();

  // Escape key → return to previous view
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Guard: don't fire if CommandPalette or any dialog is open
        const cmdPaletteOpen = document.querySelector('[cmdk-dialog]');
        if (cmdPaletteOpen) return;
        e.preventDefault();
        setViewMode(previousViewMode);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previousViewMode, setViewMode]);

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
            {activeTab === 'quick-start' && (
              <QuickStartTab form={form} onSwitchTab={setActiveTab} />
            )}
            {activeTab === 'configure' && <ConfigureTab form={form} />}
            {activeTab === 'projects' && (
              <ProjectsTab form={form} onSwitchTab={setActiveTab} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default NewSessionView;
