import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useZeusStore } from '@/stores/useZeusStore';
import { zeusWs } from '@/lib/ws';
import type { PermissionMode, GitBranchInfo } from '../../../shared/types';

const EMPTY_BRANCHES: GitBranchInfo[] = [];

export function useNewSessionForm() {
  const {
    savedProjects,
    claudeDefaults,
    lastUsedProjectId,
    settingsError,
    startClaudeSession,
    addProject,
    removeProject,
  } = useZeusStore();

  // Project selection
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(lastUsedProjectId);
  const [customDir, setCustomDir] = useState('');
  const [showCustomDir, setShowCustomDir] = useState(savedProjects.length === 0);

  // Add project form
  const [showAddProject, setShowAddProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectPath, setNewProjectPath] = useState('');
  const [createNewDir, setCreateNewDir] = useState(false);

  // Task mode (worktree)
  const [isTaskMode, setIsTaskMode] = useState(false);
  const [taskName, setTaskName] = useState('');
  const [baseBranch, setBaseBranch] = useState('');

  // Session config
  const [prompt, setPrompt] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(claudeDefaults.permissionMode);
  const [model, setModel] = useState(claudeDefaults.model);
  const [notificationSound, setNotificationSound] = useState(claudeDefaults.notificationSound);
  const [enableGitWatcher, setEnableGitWatcher] = useState(true);
  const [enableQA, setEnableQA] = useState(false);
  const [qaTargetUrl, setQaTargetUrl] = useState(window.location.origin);

  // MCP config
  const [mcpProfileId, setMcpProfileId] = useState<string | undefined>(undefined);
  const [mcpServerOverrides, setMcpServerOverrides] = useState<Record<string, boolean>>({});

  // Permission rules editor
  const [showRulesEditor, setShowRulesEditor] = useState(false);

  // Derived
  const workingDir = showCustomDir
    ? customDir.trim()
    : savedProjects.find((p) => p.id === selectedProjectId)?.path ?? '';

  // Git watcher key — use a stable prefix so it doesn't clash with session IDs
  const gitWatcherKey = workingDir ? `project:${workingDir}` : '';

  // Auto-start git watcher when project changes
  const prevWorkingDirRef = useRef('');
  useEffect(() => {
    if (workingDir && workingDir !== prevWorkingDirRef.current) {
      prevWorkingDirRef.current = workingDir;
      // Start watching to detect if it's a git repo and get branches
      zeusWs.send({
        channel: 'git',
        sessionId: gitWatcherKey,
        payload: { type: 'start_watching', workingDir },
        auth: '',
      });
      // Also fetch branches
      zeusWs.send({
        channel: 'git',
        sessionId: gitWatcherKey,
        payload: { type: 'git_list_branches' },
        auth: '',
      });
    }
  }, [workingDir, gitWatcherKey]);

  // Read git state from store keyed by our watcher key
  const gitBranches = useZeusStore((s) => s.gitBranches[gitWatcherKey] ?? EMPTY_BRANCHES);
  const gitNotARepo = useZeusStore((s) => s.gitNotARepo[gitWatcherKey] ?? false);
  const gitWatcherConnected = useZeusStore((s) => s.gitWatcherConnected[gitWatcherKey] ?? false);
  const gitStatus = useZeusStore((s) => s.gitStatus[gitWatcherKey]);

  const currentBranch = useMemo(() => gitBranches.find((b) => b.current)?.name ?? '', [gitBranches]);

  // Auto-set baseBranch when branches load
  useEffect(() => {
    if (currentBranch && !baseBranch) {
      setBaseBranch(currentBranch);
    }
  }, [currentBranch, baseBranch]);

  const canSubmit = isTaskMode
    ? !!(prompt.trim() && workingDir && taskName.trim())
    : !!(prompt.trim() && workingDir);

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

  const initGit = useCallback(() => {
    if (!workingDir) return;
    zeusWs.send({
      channel: 'git',
      sessionId: gitWatcherKey,
      payload: { type: 'git_init', workingDir },
      auth: '',
    });
  }, [workingDir, gitWatcherKey]);

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;

    if (isTaskMode) {
      // Create a worktree-based task
      const { createTask } = useZeusStore.getState();
      const opts: { baseBranch?: string; permissionMode?: PermissionMode; model?: string } = {};
      if (baseBranch.trim()) opts.baseBranch = baseBranch.trim();
      if (permissionMode !== 'default') opts.permissionMode = permissionMode;
      if (model.trim()) opts.model = model.trim();
      createTask(taskName.trim(), prompt.trim(), workingDir, Object.keys(opts).length ? opts : undefined);

      // Persist last-used project
      const project = savedProjects.find((p) => p.path === workingDir);
      if (project) {
        zeusWs.send({
          channel: 'settings',
          sessionId: '',
          payload: { type: 'set_last_used_project', id: project.id },
          auth: '',
        });
      }
      return;
    }

    // Compute MCP additive/subtractive overrides from the toggle map
    const mcpServerIds = Object.entries(mcpServerOverrides)
      .filter(([, enabled]) => enabled)
      .map(([id]) => id);
    const mcpExcludeIds = Object.entries(mcpServerOverrides)
      .filter(([, enabled]) => !enabled)
      .map(([id]) => id);

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
      mcpProfileId,
      mcpServerIds: mcpServerIds.length > 0 ? mcpServerIds : undefined,
      mcpExcludeIds: mcpExcludeIds.length > 0 ? mcpExcludeIds : undefined,
      projectId: selectedProjectId ?? undefined,
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
    canSubmit, isTaskMode, taskName, baseBranch, prompt, workingDir, sessionName, permissionMode, model,
    notificationSound, enableGitWatcher, enableQA, qaTargetUrl,
    mcpProfileId, mcpServerOverrides, startClaudeSession, savedProjects, selectedProjectId,
  ]);

  return {
    // Project selection
    savedProjects,
    selectedProjectId,
    setSelectedProjectId,
    customDir,
    setCustomDir,
    showCustomDir,
    setShowCustomDir,
    workingDir,

    // Add project
    showAddProject,
    setShowAddProject,
    newProjectName,
    setNewProjectName,
    newProjectPath,
    setNewProjectPath,
    createNewDir,
    setCreateNewDir,
    handleAddProject,
    settingsError,

    // Task mode
    isTaskMode,
    setIsTaskMode,
    taskName,
    setTaskName,
    baseBranch,
    setBaseBranch,

    // Git info (auto-fetched for selected project)
    gitBranches,
    gitNotARepo,
    gitWatcherConnected,
    gitStatus,
    currentBranch,
    initGit,

    // Session config
    prompt,
    setPrompt,
    sessionName,
    setSessionName,
    permissionMode,
    setPermissionMode,
    model,
    setModel,
    notificationSound,
    setNotificationSound,
    enableGitWatcher,
    setEnableGitWatcher,
    enableQA,
    setEnableQA,
    qaTargetUrl,
    setQaTargetUrl,

    // MCP config
    mcpProfileId,
    setMcpProfileId,
    mcpServerOverrides,
    setMcpServerOverrides,

    // Permission rules editor
    showRulesEditor,
    setShowRulesEditor,

    // Actions
    canSubmit,
    handleSubmit,
    removeProject,
  };
}
