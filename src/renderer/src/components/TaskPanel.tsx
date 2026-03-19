import { useState } from 'react';
import { useZeusStore } from '@/stores/useZeusStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Plus, GitBranch, GitMerge, GitPullRequest,
  Archive, Trash2, Play, RefreshCw, ChevronDown, ChevronRight,
} from 'lucide-react';
import type { TaskRecord, TaskStatus } from '../../../shared/types';

const STATUS_COLORS: Record<TaskStatus, string> = {
  creating: 'bg-yellow-500/20 text-yellow-400',
  running: 'bg-blue-500/20 text-blue-400',
  completed: 'bg-green-500/20 text-green-400',
  merged: 'bg-purple-500/20 text-purple-400',
  pr_created: 'bg-cyan-500/20 text-cyan-400',
  archived: 'bg-zinc-500/20 text-zinc-400',
  discarded: 'bg-red-500/20 text-red-400',
  error: 'bg-red-500/20 text-red-400',
};

function TaskCard({ task }: { task: TaskRecord }) {
  const [expanded, setExpanded] = useState(false);
  const {
    selectTask, activeTaskId, mergeTask, createTaskPR,
    archiveTask, discardTask, continueTask, selectClaudeSession,
  } = useZeusStore();

  const isActive = activeTaskId === task.id;
  const [continuePrompt, setContinuePrompt] = useState('');

  return (
    <div
      className={`border-border rounded-lg border p-3 transition-colors ${
        isActive ? 'border-primary/50 bg-primary/5' : 'hover:bg-muted/30'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
          onClick={() => {
            selectTask(isActive ? null : task.id);
            if (task.sessionId) selectClaudeSession(task.sessionId);
          }}
        >
          <GitBranch className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium">{task.name}</div>
            <div className="text-muted-foreground mt-0.5 truncate text-[10px] font-mono">
              {task.branch}
            </div>
          </div>
        </button>
        <Badge variant="outline" className={`shrink-0 text-[9px] ${STATUS_COLORS[task.status]}`}>
          {task.status}
        </Badge>
      </div>

      {task.diffSummary && (
        <div className="text-muted-foreground mt-1.5 text-[10px]">{task.diffSummary}</div>
      )}

      {/* Expand/collapse actions */}
      <button
        className="text-muted-foreground hover:text-foreground mt-2 flex items-center gap-1 text-[10px]"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        Actions
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {/* Resolution actions — only for completed/error tasks */}
          {(task.status === 'completed' || task.status === 'error') && (
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => mergeTask(task.id)}>
                <GitMerge className="mr-1 size-3" /> Merge
              </Button>
              <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => createTaskPR(task.id)}>
                <GitPullRequest className="mr-1 size-3" /> Create PR
              </Button>
              <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => archiveTask(task.id)}>
                <Archive className="mr-1 size-3" /> Archive
              </Button>
              <Button size="sm" variant="ghost" className="h-6 text-[10px] text-red-400" onClick={() => discardTask(task.id)}>
                <Trash2 className="mr-1 size-3" /> Discard
              </Button>
            </div>
          )}

          {/* Continue — send follow-up prompt */}
          {(task.status === 'completed' || task.status === 'error') && (
            <div className="flex gap-1.5">
              <Input
                value={continuePrompt}
                onChange={(e) => setContinuePrompt(e.target.value)}
                placeholder="Follow-up prompt..."
                className="h-6 text-[10px]"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && continuePrompt.trim()) {
                    continueTask(task.id, continuePrompt.trim());
                    setContinuePrompt('');
                  }
                }}
              />
              <Button
                size="sm" variant="outline" className="h-6 text-[10px]"
                disabled={!continuePrompt.trim()}
                onClick={() => {
                  if (continuePrompt.trim()) {
                    continueTask(task.id, continuePrompt.trim());
                    setContinuePrompt('');
                  }
                }}
              >
                <Play className="size-3" />
              </Button>
            </div>
          )}

          {/* Archived — unarchive */}
          {task.status === 'archived' && (
            <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => useZeusStore.getState().unarchiveTask(task.id)}>
              <RefreshCw className="mr-1 size-3" /> Unarchive
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function TaskPanel() {
  const { tasks, savedProjects, lastUsedProjectId, createTask, taskError } = useZeusStore();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');

  const currentProject = savedProjects.find((p) => p.id === lastUsedProjectId);
  const activeTasks = tasks.filter((t) => t.status === 'running' || t.status === 'creating');
  const completedTasks = tasks.filter((t) => t.status === 'completed' || t.status === 'error');
  const resolvedTasks = tasks.filter((t) => ['merged', 'pr_created', 'archived'].includes(t.status));

  const handleCreate = () => {
    if (!name.trim() || !prompt.trim() || !currentProject) return;
    createTask(name.trim(), prompt.trim(), currentProject.path);
    setName('');
    setPrompt('');
    setShowCreate(false);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-border flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-medium">Tasks</span>
        <Button size="sm" variant="ghost" className="size-6 p-0" onClick={() => setShowCreate(!showCreate)}>
          <Plus className="size-3.5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {/* Create form */}
        {showCreate && (
          <div className="border-border space-y-2 rounded-lg border p-3">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Task name" className="text-xs" />
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="What should Claude do?"
              className="border-border bg-background text-foreground w-full rounded-md border px-2 py-1.5 text-xs"
              rows={3}
            />
            <div className="flex gap-2">
              <Button size="sm" className="h-7 flex-1 text-xs" onClick={handleCreate} disabled={!name.trim() || !prompt.trim() || !currentProject}>
                Create Task
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {taskError && (
          <div className="rounded bg-red-500/10 p-2 text-[10px] text-red-400">{taskError}</div>
        )}

        {/* Active tasks */}
        {activeTasks.length > 0 && (
          <div>
            <div className="text-muted-foreground mb-1.5 text-[10px] font-medium uppercase">Active</div>
            <div className="space-y-1.5">
              {activeTasks.map((t) => <TaskCard key={t.id} task={t} />)}
            </div>
          </div>
        )}

        {/* Completed tasks */}
        {completedTasks.length > 0 && (
          <div>
            <div className="text-muted-foreground mb-1.5 text-[10px] font-medium uppercase">Completed</div>
            <div className="space-y-1.5">
              {completedTasks.map((t) => <TaskCard key={t.id} task={t} />)}
            </div>
          </div>
        )}

        {/* Resolved tasks */}
        {resolvedTasks.length > 0 && (
          <div>
            <div className="text-muted-foreground mb-1.5 text-[10px] font-medium uppercase">Resolved</div>
            <div className="space-y-1.5">
              {resolvedTasks.map((t) => <TaskCard key={t.id} task={t} />)}
            </div>
          </div>
        )}

        {tasks.length === 0 && !showCreate && (
          <div className="text-muted-foreground py-8 text-center text-xs">
            No tasks yet. Click + to create one.
          </div>
        )}
      </div>
    </div>
  );
}
