import { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { X, Plus, FolderPlus } from 'lucide-react';
import type { SavedProject, ClaudeDefaults, PermissionMode } from '../../../shared/types';

interface NewClaudeSessionModalProps {
  open: boolean;
  onClose: () => void;
  savedProjects: SavedProject[];
  claudeDefaults: ClaudeDefaults;
  lastUsedProjectId: string | null;
  onStart: (config: {
    prompt: string;
    workingDir: string;
    sessionName?: string;
    permissionMode?: PermissionMode;
    model?: string;
    notificationSound?: boolean;
    enableGitWatcher?: boolean;
    enableQA?: boolean;
    qaTargetUrl?: string;
  }) => void;
  onAddProject: (name: string, path: string, createDir?: boolean) => void;
  onRemoveProject: (id: string) => void;
  settingsError: string | null;
}

const PERMISSION_MODES: { value: PermissionMode; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'plan', label: 'Plan' },
  { value: 'acceptEdits', label: 'Accept Edits' },
  { value: 'bypassPermissions', label: 'Bypass' },
];

function NewClaudeSessionModal({
  open,
  onClose,
  savedProjects,
  claudeDefaults,
  lastUsedProjectId,
  onStart,
  onAddProject,
  onRemoveProject,
  settingsError,
}: NewClaudeSessionModalProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [customDir, setCustomDir] = useState('');
  const [showCustomDir, setShowCustomDir] = useState(false);
  const [showAddProject, setShowAddProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectPath, setNewProjectPath] = useState('');
  const [createNewDir, setCreateNewDir] = useState(false);

  const [prompt, setPrompt] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(
    claudeDefaults.permissionMode,
  );
  const [model, setModel] = useState(claudeDefaults.model);
  const [notificationSound, setNotificationSound] = useState(claudeDefaults.notificationSound);
  const [enableGitWatcher, setEnableGitWatcher] = useState(true);
  const [enableQA, setEnableQA] = useState(false);
  const [qaTargetUrl, setQaTargetUrl] = useState('http://localhost:5173');

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setPrompt('');
      setSessionName('');
      setPermissionMode(claudeDefaults.permissionMode);
      setModel(claudeDefaults.model);
      setNotificationSound(claudeDefaults.notificationSound);
      setEnableGitWatcher(true);
      setEnableQA(false);
      setQaTargetUrl('http://localhost:5173');
      setSelectedProjectId(lastUsedProjectId);
      setCustomDir('');
      setShowCustomDir(savedProjects.length === 0);
      setShowAddProject(false);
      setNewProjectName('');
      setNewProjectPath('');
      setCreateNewDir(false);
    }
  }, [open, claudeDefaults, lastUsedProjectId, savedProjects.length]);

  const workingDir = showCustomDir
    ? customDir.trim()
    : savedProjects.find((p) => p.id === selectedProjectId)?.path ?? '';

  const canSubmit = prompt.trim() && workingDir;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onStart({
      prompt: prompt.trim(),
      workingDir,
      sessionName: sessionName.trim() || undefined,
      permissionMode,
      model: model.trim() || undefined,
      notificationSound,
      enableGitWatcher,
      enableQA,
      qaTargetUrl: enableQA ? qaTargetUrl.trim() || undefined : undefined,
    });
    onClose();
  };

  // Auto-select newly added project when it appears in the list
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

  const handleAddProject = () => {
    const name = newProjectName.trim();
    const projectPath = newProjectPath.trim();
    if (!name || !projectPath) return;
    onAddProject(name, projectPath, createNewDir || undefined);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[640px]">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle className="text-sm">New Claude Session</DialogTitle>
          <DialogDescription className="sr-only">
            Configure and start a new Claude session
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-4">
          {/* Section 1: Project Selection */}
          <div className="space-y-3">
            <Label className="text-xs font-semibold uppercase tracking-wider">
              Project Directory
            </Label>

            {savedProjects.length > 0 && !showCustomDir && (
              <div className="flex max-h-[160px] flex-col gap-1.5 overflow-y-auto">
                {savedProjects.map((project) => (
                  <button
                    key={project.id}
                    className={`group flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                      selectedProjectId === project.id
                        ? 'border-ring/50 bg-primary/10'
                        : 'border-border hover:bg-secondary'
                    }`}
                    onClick={() => setSelectedProjectId(project.id)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-foreground text-xs font-semibold">{project.name}</div>
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
                        onRemoveProject(project.id);
                      }}
                    >
                      <X className="text-muted-foreground hover:text-destructive size-3" />
                    </Button>
                  </button>
                ))}
              </div>
            )}

            {/* Custom directory toggle */}
            <div className="flex items-center gap-2">
              <Button
                variant="link"
                size="xs"
                className={`h-auto p-0 text-[10px] ${showCustomDir ? 'text-primary font-semibold' : 'text-muted-foreground'}`}
                onClick={() => setShowCustomDir(!showCustomDir)}
              >
                {showCustomDir ? 'Use saved project' : 'Custom directory'}
              </Button>
              {!showAddProject && (
                <Button
                  variant="link"
                  size="xs"
                  className="h-auto p-0 text-[10px] font-semibold"
                  onClick={() => {
                    setShowAddProject(true);
                    setShowCustomDir(false);
                  }}
                >
                  <Plus className="size-3" />
                  Add Project
                </Button>
              )}
            </div>

            {showCustomDir && (
              <Input
                autoFocus
                value={customDir}
                onChange={(e) => setCustomDir(e.target.value)}
                placeholder="/path/to/project"
                className="text-xs"
              />
            )}

            {/* Add Project inline form */}
            {showAddProject && (
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
                  <div className={`flex size-3.5 items-center justify-center rounded border ${
                    createNewDir ? 'border-primary bg-primary' : 'border-border'
                  }`}>
                    {createNewDir && (
                      <svg viewBox="0 0 12 12" className="size-2.5 text-primary-foreground">
                        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <FolderPlus className="text-muted-foreground size-3" />
                  <span className={createNewDir ? 'text-foreground font-medium' : 'text-muted-foreground'}>
                    Create directory if it doesn't exist
                  </span>
                </button>
                {settingsError && (
                  <p className="text-destructive text-[11px]">{settingsError}</p>
                )}
                <div className="flex gap-2">
                  <Button
                    size="xs"
                    disabled={!newProjectName.trim() || !newProjectPath.trim()}
                    onClick={handleAddProject}
                  >
                    Save
                  </Button>
                  <Button variant="ghost" size="xs" onClick={() => setShowAddProject(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* Section 2: Session Configuration */}
          <div className="space-y-4">
            {/* Prompt */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Prompt</Label>
              <textarea
                autoFocus={savedProjects.length > 0}
                rows={3}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="What should Claude do?"
                className="border-input bg-transparent placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 w-full resize-none rounded-md border px-3 py-2 text-xs shadow-xs outline-none transition-shadow focus-visible:ring-[3px]"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSubmit) {
                    handleSubmit();
                  }
                }}
              />
            </div>

            {/* Session Name */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">
                Session Name{' '}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
                placeholder="Auto-generated if empty"
                className="text-xs"
              />
            </div>

            {/* Permission Mode */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Permission Mode</Label>
              <div className="flex flex-wrap gap-1.5">
                {PERMISSION_MODES.map((mode) => (
                  <Button
                    key={mode.value}
                    variant={permissionMode === mode.value ? 'default' : 'secondary'}
                    size="xs"
                    className="rounded-full"
                    onClick={() => setPermissionMode(mode.value)}
                  >
                    {mode.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Model */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">
                Model <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Default"
                className="text-xs"
              />
            </div>

            {/* Notification Sound */}
            <div className="flex items-center justify-between">
              <Label htmlFor="notification-sound" className="text-xs font-semibold">
                Notification Sound
              </Label>
              <Switch
                id="notification-sound"
                checked={notificationSound}
                onCheckedChange={setNotificationSound}
              />
            </div>

            {/* Git Watcher */}
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="git-watcher" className="text-xs font-semibold">
                  Git Watcher
                </Label>
                <p className="text-muted-foreground text-[10px]">Track file changes in real-time</p>
              </div>
              <Switch
                id="git-watcher"
                checked={enableGitWatcher}
                onCheckedChange={setEnableGitWatcher}
              />
            </div>

            {/* QA Testing */}
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="enable-qa" className="text-xs font-semibold">
                  QA Testing
                </Label>
                <p className="text-muted-foreground text-[10px]">Give Claude browser testing tools via MCP</p>
              </div>
              <Switch
                id="enable-qa"
                checked={enableQA}
                onCheckedChange={setEnableQA}
              />
            </div>

            {enableQA && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">
                  QA Target URL{' '}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Input
                  value={qaTargetUrl}
                  onChange={(e) => setQaTargetUrl(e.target.value)}
                  placeholder="http://localhost:5173"
                  className="text-xs"
                />
              </div>
            )}
          </div>
        </div>

        <Separator />

        <DialogFooter className="px-6 py-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={handleSubmit}>
            Start Session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default NewClaudeSessionModal;
