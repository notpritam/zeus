import { useState, useEffect, useRef } from 'react';
import Modal from '@/components/Modal';
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
  }) => void;
  onAddProject: (name: string, path: string) => void;
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

  const [prompt, setPrompt] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(
    claudeDefaults.permissionMode,
  );
  const [model, setModel] = useState(claudeDefaults.model);
  const [notificationSound, setNotificationSound] = useState(claudeDefaults.notificationSound);
  const [enableGitWatcher, setEnableGitWatcher] = useState(true);

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setPrompt('');
      setSessionName('');
      setPermissionMode(claudeDefaults.permissionMode);
      setModel(claudeDefaults.model);
      setNotificationSound(claudeDefaults.notificationSound);
      setEnableGitWatcher(true);
      setSelectedProjectId(lastUsedProjectId);
      setCustomDir('');
      setShowCustomDir(savedProjects.length === 0);
      setShowAddProject(false);
      setNewProjectName('');
      setNewProjectPath('');
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
    });
    onClose();
  };

  // Auto-select newly added project when it appears in the list
  const prevProjectCountRef = useRef(savedProjects.length);
  useEffect(() => {
    if (savedProjects.length > prevProjectCountRef.current) {
      // A new project was just added — select the latest one
      const newest = savedProjects[savedProjects.length - 1];
      if (newest) {
        setSelectedProjectId(newest.id);
        setShowCustomDir(false);
        setShowAddProject(false);
        setNewProjectName('');
        setNewProjectPath('');
      }
    }
    prevProjectCountRef.current = savedProjects.length;
  }, [savedProjects]);

  const handleAddProject = () => {
    const name = newProjectName.trim();
    const projectPath = newProjectPath.trim();
    if (!name || !projectPath) return;
    onAddProject(name, projectPath);
  };

  return (
    <Modal open={open} onClose={onClose} title="New Claude Session">
      <div className="flex flex-col gap-5 p-5">
        {/* Section 1: Project Selection */}
        <div>
          <label className="text-text-secondary mb-2 block text-xs font-semibold uppercase tracking-wider">
            Project Directory
          </label>

          {savedProjects.length > 0 && !showCustomDir && (
            <div className="flex max-h-[160px] flex-col gap-1.5 overflow-y-auto">
              {savedProjects.map((project) => (
                <button
                  key={project.id}
                  className={`group flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                    selectedProjectId === project.id
                      ? 'border-info-border bg-info-bg'
                      : 'border-border hover:border-border-dim bg-bg-surface hover:bg-bg-card'
                  }`}
                  onClick={() => setSelectedProjectId(project.id)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-text-primary text-xs font-semibold">{project.name}</div>
                    <div className="text-text-faint truncate text-[10px]">{project.path}</div>
                  </div>
                  <button
                    className="text-text-ghost hover:text-danger shrink-0 text-xs opacity-0 transition-all group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveProject(project.id);
                    }}
                  >
                    &times;
                  </button>
                </button>
              ))}
            </div>
          )}

          {/* Custom directory toggle */}
          <div className="mt-2 flex items-center gap-2">
            <button
              className={`text-[10px] transition-colors ${showCustomDir ? 'text-info font-semibold' : 'text-text-faint hover:text-text-secondary'}`}
              onClick={() => setShowCustomDir(!showCustomDir)}
            >
              {showCustomDir ? 'Use saved project' : 'Custom directory'}
            </button>
            {!showAddProject && (
              <button
                className="text-info text-[10px] font-semibold"
                onClick={() => {
                  setShowAddProject(true);
                  setShowCustomDir(false);
                }}
              >
                + Add Project
              </button>
            )}
          </div>

          {showCustomDir && (
            <input
              autoFocus
              type="text"
              value={customDir}
              onChange={(e) => setCustomDir(e.target.value)}
              placeholder="/path/to/project"
              className="bg-bg-surface border-border text-text-secondary placeholder:text-text-ghost focus:border-info mt-2 w-full rounded-lg border px-3 py-2 text-xs outline-none"
            />
          )}

          {/* Add Project inline form */}
          {showAddProject && (
            <div className="border-border mt-2 flex flex-col gap-2 rounded-lg border p-3">
              <input
                autoFocus
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="Project name"
                className="bg-bg-surface border-border text-text-secondary placeholder:text-text-ghost focus:border-info w-full rounded-lg border px-3 py-2 text-xs outline-none"
              />
              <input
                type="text"
                value={newProjectPath}
                onChange={(e) => setNewProjectPath(e.target.value)}
                placeholder="/absolute/path/to/project"
                className="bg-bg-surface border-border text-text-secondary placeholder:text-text-ghost focus:border-info w-full rounded-lg border px-3 py-2 text-xs outline-none"
              />
              {settingsError && (
                <p className="text-danger text-[11px]">{settingsError}</p>
              )}
              <div className="flex gap-2">
                <button
                  disabled={!newProjectName.trim() || !newProjectPath.trim()}
                  onClick={handleAddProject}
                  className="bg-info hover:bg-info/90 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-40"
                >
                  Save
                </button>
                <button
                  onClick={() => setShowAddProject(false)}
                  className="text-text-faint hover:text-text-muted text-xs transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="border-border border-t" />

        {/* Section 2: Session Configuration */}
        <div className="flex flex-col gap-3">
          {/* Prompt */}
          <div>
            <label className="text-text-secondary mb-1 block text-xs font-semibold">Prompt</label>
            <textarea
              autoFocus={savedProjects.length > 0}
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="What should Claude do?"
              className="bg-bg-surface border-border text-text-secondary placeholder:text-text-ghost focus:border-info w-full resize-none rounded-lg border px-3 py-2 text-xs outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSubmit) {
                  handleSubmit();
                }
              }}
            />
          </div>

          {/* Session Name */}
          <div>
            <label className="text-text-secondary mb-1 block text-xs font-semibold">
              Session Name
              <span className="text-text-ghost ml-1 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder="Auto-generated if empty"
              className="bg-bg-surface border-border text-text-secondary placeholder:text-text-ghost focus:border-info w-full rounded-lg border px-3 py-2 text-xs outline-none"
            />
          </div>

          {/* Permission Mode */}
          <div>
            <label className="text-text-secondary mb-1 block text-xs font-semibold">
              Permission Mode
            </label>
            <div className="flex flex-wrap gap-1.5">
              {PERMISSION_MODES.map((mode) => (
                <button
                  key={mode.value}
                  className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                    permissionMode === mode.value
                      ? 'bg-info text-white'
                      : 'bg-bg-surface text-text-faint hover:text-text-secondary border-border border'
                  }`}
                  onClick={() => setPermissionMode(mode.value)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          {/* Model */}
          <div>
            <label className="text-text-secondary mb-1 block text-xs font-semibold">
              Model
              <span className="text-text-ghost ml-1 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Default"
              className="bg-bg-surface border-border text-text-secondary placeholder:text-text-ghost focus:border-info w-full rounded-lg border px-3 py-2 text-xs outline-none"
            />
          </div>

          {/* Notification Sound */}
          <div className="flex items-center justify-between">
            <label className="text-text-secondary text-xs font-semibold">
              Notification Sound
            </label>
            <button
              className={`relative h-5 w-9 rounded-full transition-colors ${
                notificationSound ? 'bg-info' : 'bg-bg-surface border-border border'
              }`}
              onClick={() => setNotificationSound(!notificationSound)}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  notificationSound ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          {/* Git Watcher */}
          <div className="flex items-center justify-between">
            <div>
              <label className="text-text-secondary text-xs font-semibold">Git Watcher</label>
              <p className="text-text-ghost text-[10px]">Track file changes in real-time</p>
            </div>
            <button
              className={`relative h-5 w-9 rounded-full transition-colors ${
                enableGitWatcher ? 'bg-accent' : 'bg-bg-surface border-border border'
              }`}
              onClick={() => setEnableGitWatcher(!enableGitWatcher)}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  enableGitWatcher ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="border-border flex items-center justify-between border-t pt-4">
          <button
            onClick={onClose}
            className="text-text-faint hover:text-text-secondary text-xs transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={!canSubmit}
            onClick={handleSubmit}
            className="bg-info hover:bg-info/90 rounded-lg px-5 py-2 text-xs font-semibold text-white transition-colors disabled:opacity-40"
          >
            Start Session
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default NewClaudeSessionModal;
