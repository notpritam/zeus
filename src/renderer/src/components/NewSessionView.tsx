import { useState, useEffect, useMemo } from 'react';
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
  Plug,
  AlertTriangle,
  Check,
  GitBranch,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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

function GitInfoBar({ form }: { form: ReturnType<typeof useNewSessionForm> }) {
  if (!form.workingDir) return null;

  if (form.gitNotARepo) {
    return (
      <div className="flex items-center justify-between rounded-md border border-yellow-500/20 bg-yellow-500/5 px-3 py-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-3 text-yellow-500" />
          <span className="text-[11px] text-yellow-600 dark:text-yellow-400">Not a git repository</span>
        </div>
        <Button size="xs" variant="outline" className="text-[10px]" onClick={form.initGit}>
          Initialize Git
        </Button>
      </div>
    );
  }

  if (form.currentBranch) {
    const changeCount = (form.gitStatus?.staged?.length ?? 0) + (form.gitStatus?.unstaged?.length ?? 0);
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/30 px-3 py-1.5">
        <GitBranch className="size-3 text-primary" />
        <span className="text-[11px] font-medium">{form.currentBranch}</span>
        {changeCount > 0 && (
          <Badge variant="secondary" className="text-[9px] px-1 py-0">
            {changeCount} change{changeCount !== 1 ? 's' : ''}
          </Badge>
        )}
      </div>
    );
  }

  return null;
}

function TaskModeSection({ form }: { form: ReturnType<typeof useNewSessionForm> }) {
  // Disable task mode if not a git repo
  const disabled = form.gitNotARepo || !form.workingDir;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="size-3.5 text-primary" />
          <Label htmlFor="task-mode" className="text-xs font-semibold">
            Create as Task (Worktree)
          </Label>
        </div>
        <Switch
          id="task-mode"
          checked={form.isTaskMode}
          onCheckedChange={form.setIsTaskMode}
          disabled={disabled}
        />
      </div>
      {disabled && form.gitNotARepo && (
        <p className="text-[10px] text-muted-foreground">Initialize git first to use task mode.</p>
      )}
      {form.isTaskMode && !disabled && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <p className="text-muted-foreground text-[10px]">
            Runs Claude in an isolated git worktree on its own branch. Your main branch stays clean.
          </p>
          <div className="space-y-1.5">
            <Label className="text-[10px] text-muted-foreground">Task Name</Label>
            <Input
              value={form.taskName}
              onChange={(e) => form.setTaskName(e.target.value)}
              placeholder="e.g. fix-login-bug"
              className="text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] text-muted-foreground">Base Branch</Label>
            {form.gitBranches.length > 0 ? (
              <select
                value={form.baseBranch}
                onChange={(e) => form.setBaseBranch(e.target.value)}
                className="border-input bg-transparent w-full rounded-md border px-3 py-1.5 text-xs shadow-xs"
              >
                {form.gitBranches.filter((b) => !b.isRemoteOnly).map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}{b.current ? ' (current)' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                value={form.baseBranch}
                onChange={(e) => form.setBaseBranch(e.target.value)}
                placeholder="main (defaults to current branch)"
                className="text-xs"
              />
            )}
          </div>
        </div>
      )}
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

        {/* Git info for selected project */}
        <GitInfoBar form={form} />
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

      {/* Task Mode Toggle */}
      <TaskModeSection form={form} />

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
        {form.isTaskMode ? 'Create Task' : 'Start Session'}
      </Button>
    </div>
  );
}

function McpSessionConfig({ form }: { form: ReturnType<typeof useNewSessionForm> }) {
  const mcpServers = useZeusStore((s) => s.mcpServers);
  const mcpProfiles = useZeusStore((s) => s.mcpProfiles);
  const mcpHealthResults = useZeusStore((s) => s.mcpHealthResults);
  const fetchMcpServers = useZeusStore((s) => s.fetchMcpServers);
  const fetchMcpProfiles = useZeusStore((s) => s.fetchMcpProfiles);
  const healthCheckMcp = useZeusStore((s) => s.healthCheckMcp);

  useEffect(() => {
    fetchMcpServers();
    fetchMcpProfiles();
  }, []);

  // Resolve which servers come from the selected profile
  const selectedProfile = mcpProfiles.find((p) => p.id === form.mcpProfileId)
    ?? mcpProfiles.find((p) => p.isDefault);

  const profileServerIds = new Set(selectedProfile?.servers.map((s) => s.id) ?? []);

  // Build resolved server list: profile servers + overrides
  const resolvedServers = mcpServers
    .filter((s) => s.enabled)
    .map((s) => {
      const fromProfile = profileServerIds.has(s.id);
      const override = form.mcpServerOverrides[s.id];
      // If override exists, use it; otherwise use profile membership
      const included = override !== undefined ? override : fromProfile;
      return { server: s, included, fromProfile };
    });

  const includedCount = resolvedServers.filter((r) => r.included).length;
  const unhealthyCount = resolvedServers.filter(
    (r) => r.included && mcpHealthResults[r.server.id] && !mcpHealthResults[r.server.id].healthy,
  ).length;

  const toggleServer = (serverId: string, fromProfile: boolean) => {
    form.setMcpServerOverrides((prev: Record<string, boolean>) => {
      const current = prev[serverId];
      const currentlyIncluded = current !== undefined ? current : fromProfile;
      return { ...prev, [serverId]: !currentlyIncluded };
    });
  };

  if (mcpServers.length === 0) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Plug className="size-3.5 text-muted-foreground" />
          <Label className="text-xs font-semibold">MCP Servers</Label>
        </div>
        <p className="text-[10px] text-muted-foreground">
          No MCP servers registered. Add servers in Settings &rarr; MCP Servers.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Plug className="size-3.5 text-primary" />
          <Label className="text-xs font-semibold">MCP Servers</Label>
          <Badge variant="secondary" className="text-[9px] px-1 py-0">
            {includedCount} selected
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 text-[10px] px-1.5"
          onClick={() => healthCheckMcp()}
        >
          Check Health
        </Button>
      </div>

      {/* Profile selector */}
      {mcpProfiles.length > 0 && (
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">Profile</label>
          <div className="flex flex-wrap gap-1.5">
            <Button
              variant={!form.mcpProfileId ? 'default' : 'secondary'}
              size="xs"
              className="rounded-full text-[10px]"
              onClick={() => {
                form.setMcpProfileId(undefined);
                form.setMcpServerOverrides({});
              }}
            >
              {mcpProfiles.find((p) => p.isDefault) ? 'Default' : 'None'}
            </Button>
            {mcpProfiles.map((profile) => (
              <Button
                key={profile.id}
                variant={form.mcpProfileId === profile.id ? 'default' : 'secondary'}
                size="xs"
                className="rounded-full text-[10px]"
                onClick={() => {
                  form.setMcpProfileId(profile.id);
                  form.setMcpServerOverrides({});
                }}
              >
                {profile.name}
                <span className="text-muted-foreground ml-0.5">({profile.servers.length})</span>
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Server toggles */}
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {resolvedServers.map(({ server, included, fromProfile }) => {
          const health = mcpHealthResults[server.id];
          return (
            <button
              key={server.id}
              onClick={() => toggleServer(server.id, fromProfile)}
              className={`w-full flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
                included
                  ? 'bg-primary/10 text-foreground'
                  : 'hover:bg-secondary/60 text-muted-foreground'
              }`}
            >
              {/* Checkbox */}
              <span className={`flex size-3.5 items-center justify-center rounded border shrink-0 ${
                included
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border'
              }`}>
                {included && <Check className="size-2" />}
              </span>

              {/* Health dot */}
              {health ? (
                health.healthy ? (
                  <span className="size-1.5 shrink-0 rounded-full bg-green-500" />
                ) : (
                  <span className="size-1.5 shrink-0 rounded-full bg-red-500" title={health.error} />
                )
              ) : (
                <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/30" />
              )}

              <span className="flex-1 truncate">{server.name}</span>

              {health && (
                <span className="text-[9px] text-muted-foreground shrink-0">{health.latencyMs}ms</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Unhealthy warning */}
      {unhealthyCount > 0 && (
        <div className="flex items-center gap-2 rounded-md bg-yellow-500/10 border border-yellow-500/20 px-2.5 py-1.5">
          <AlertTriangle className="size-3 text-yellow-500 shrink-0" />
          <span className="text-[10px] text-yellow-600 dark:text-yellow-400">
            {unhealthyCount} server{unhealthyCount > 1 ? 's' : ''} unreachable — session will start but {unhealthyCount > 1 ? 'these MCPs' : 'this MCP'} may not work
          </span>
        </div>
      )}
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

        {/* Git info for selected project */}
        <GitInfoBar form={form} />
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

        <Separator />

        {/* Task Mode */}
        <TaskModeSection form={form} />

        <Separator />

        {/* MCP Server Selection */}
        <McpSessionConfig form={form} />
      </div>

      <Separator />

      <Button
        className="w-full"
        disabled={!form.canSubmit}
        onClick={form.handleSubmit}
      >
        {form.isTaskMode ? 'Create Task' : 'Start Session'}
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
