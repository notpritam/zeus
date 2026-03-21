import { useState, useEffect, useRef, useCallback } from 'react';
import { useZeusStore } from '@/stores/useZeusStore';
import { zeusWs } from '@/lib/ws';
import type { PermissionMode } from '../../../shared/types';
import type { GitBranchInfo } from '../../../shared/types';

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

  // Derived
  const workingDir = showCustomDir
    ? customDir.trim()
    : savedProjects.find((p) => p.id === selectedProjectId)?.path ?? '';

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
    mcpProfileId, mcpServerOverrides, startClaudeSession, savedProjects,
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

    // Actions
    canSubmit,
    handleSubmit,
    removeProject,
  };
}
