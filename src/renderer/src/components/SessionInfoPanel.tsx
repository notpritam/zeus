import { useMemo } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Info,
  Clock,
  FolderOpen,
  GitBranch,
  Shield,
  Cpu,
  Bell,
  BellOff,
  Eye,
  EyeOff,
  MessageSquare,
  Wrench,
  Brain,
  AlertCircle,
  Bot,
  BarChart3,
  Zap,
} from 'lucide-react';
import { useZeusStore } from '@/stores/useZeusStore';
import type { NormalizedEntry } from '../../../shared/types';

// ─── Helpers ───

function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function formatTimeIST(ts: number): string {
  try {
    return new Date(ts).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return '—';
  }
}

function countEntries(entries: NormalizedEntry[]) {
  let userMessages = 0;
  let assistantMessages = 0;
  let toolCalls = 0;
  let thinkingBlocks = 0;
  let errors = 0;
  let edits = 0;
  let reads = 0;
  let commands = 0;
  let searches = 0;
  let webFetches = 0;
  let agents = 0;

  for (const e of entries) {
    switch (e.entryType.type) {
      case 'user_message': userMessages++; break;
      case 'assistant_message': assistantMessages++; break;
      case 'thinking': thinkingBlocks++; break;
      case 'error_message': errors++; break;
      case 'tool_use': {
        toolCalls++;
        const action = e.entryType.actionType.action;
        if (action === 'file_edit') edits++;
        else if (action === 'file_read') reads++;
        else if (action === 'command_run') commands++;
        else if (action === 'search') searches++;
        else if (action === 'web_fetch') webFetches++;
        else if (action === 'task_create') agents++;
        break;
      }
    }
  }

  return { userMessages, assistantMessages, toolCalls, thinkingBlocks, errors, edits, reads, commands, searches, webFetches, agents };
}

// ─── Row Components ───

function InfoRow({ icon: Icon, label, value, muted }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1.5">
      <div className="flex items-center gap-2">
        <Icon className="text-muted-foreground size-3 shrink-0" />
        <span className="text-muted-foreground text-[11px]">{label}</span>
      </div>
      <span className={`text-right text-[11px] font-medium ${muted ? 'text-muted-foreground' : 'text-foreground'}`}>{value}</span>
    </div>
  );
}

function StatRow({ label, value, color }: { label: string; value: number; color?: string }) {
  if (value === 0) return null;
  return (
    <div className="flex items-center justify-between px-3 py-0.5">
      <span className="text-muted-foreground text-[11px]">{label}</span>
      <Badge variant="secondary" className={`text-[10px] font-mono ${color ?? ''}`}>{value}</Badge>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="border-border border-b px-3 py-1.5">
      <span className="text-foreground text-[10px] font-semibold uppercase tracking-wider">{title}</span>
    </div>
  );
}

// ─── Main Panel ───

function SessionInfoPanel() {
  const activeClaudeId = useZeusStore((s) => s.activeClaudeId);
  const session = useZeusStore((s) => s.claudeSessions.find((cs) => cs.id === s.activeClaudeId));
  const entries = useZeusStore((s) => activeClaudeId ? (s.claudeEntries[activeClaudeId] ?? []) : []);
  const activity = useZeusStore((s) => activeClaudeId ? s.sessionActivity[activeClaudeId] : undefined);
  const gitStatus = useZeusStore((s) => activeClaudeId ? s.gitStatus[activeClaudeId] : undefined);
  const gitConnected = useZeusStore((s) => activeClaudeId ? s.gitWatcherConnected[activeClaudeId] === true : false);
  const fileTreeConnected = useZeusStore((s) => activeClaudeId ? s.fileTreeConnected[activeClaudeId] === true : false);
  const qaAgents = useZeusStore((s) => activeClaudeId ? (s.qaAgents[activeClaudeId] ?? []) : []);
  const pendingApprovals = useZeusStore((s) => s.pendingApprovals.filter((a) => a.sessionId === activeClaudeId));
  const queue = useZeusStore((s) => activeClaudeId ? (s.messageQueue[activeClaudeId] ?? []) : []);

  const stats = useMemo(() => countEntries(entries), [entries]);

  if (!activeClaudeId || !session) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4">
        <Info className="text-muted-foreground size-6" />
        <p className="text-muted-foreground text-xs">No active session</p>
      </div>
    );
  }

  const elapsed = Date.now() - session.startedAt;
  const statusColor =
    session.status === 'running' ? 'text-green-400' :
    session.status === 'done' ? 'text-muted-foreground' :
    session.status === 'error' ? 'text-red-400' :
    'text-muted-foreground';

  const activityLabel =
    !activity || activity.state === 'idle' ? 'Idle' :
    activity.state === 'thinking' ? 'Thinking' :
    activity.state === 'streaming' ? 'Writing' :
    activity.state === 'tool_running' ? `Running: ${activity.toolName}` :
    activity.state === 'waiting_approval' ? `Awaiting: ${activity.toolName}` :
    activity.state === 'starting' ? 'Starting' : 'Unknown';

  const gitChanges = gitStatus ? gitStatus.staged.length + gitStatus.unstaged.length : 0;
  const runningQaAgents = qaAgents.filter((a) => a.info.status === 'running').length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="border-border flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <Info className="text-muted-foreground size-3.5" />
        <span className="text-foreground text-xs font-semibold">Session Info</span>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {/* Session Details */}
        <SectionHeader title="Session" />
        <InfoRow icon={Zap} label="Name" value={session.name || '—'} muted={!session.name} />
        <InfoRow icon={AlertCircle} label="Status" value={
          <span className={`font-semibold ${statusColor}`}>{session.status}</span>
        } />
        <InfoRow icon={Zap} label="Activity" value={activityLabel} />
        <InfoRow icon={Clock} label="Started" value={formatTimeIST(session.startedAt)} />
        <InfoRow icon={Clock} label="Duration" value={formatDuration(elapsed)} />
        <InfoRow icon={FolderOpen} label="Working Dir" value={
          <span className="max-w-[140px] truncate block" title={session.workingDir}>{session.workingDir?.split('/').pop() || '—'}</span>
        } />
        {session.claudeSessionId && (
          <InfoRow icon={Bot} label="Session ID" value={
            <span className="font-mono max-w-[100px] truncate block text-[10px]" title={session.claudeSessionId}>{session.claudeSessionId.slice(0, 12)}...</span>
          } />
        )}

        {/* Configuration */}
        <SectionHeader title="Configuration" />
        <InfoRow icon={Shield} label="Permission" value={
          <Badge variant="outline" className="text-[9px]">{session.permissionMode || 'default'}</Badge>
        } />
        <InfoRow icon={Cpu} label="Model" value={session.model || 'default'} muted={!session.model} />
        <InfoRow icon={session.notificationSound ? Bell : BellOff} label="Sound" value={session.notificationSound !== false ? 'On' : 'Off'} />
        <InfoRow icon={GitBranch} label="Git Watcher" value={session.enableGitWatcher !== false ? 'Enabled' : 'Disabled'} />
        <InfoRow icon={session.enableQA ? Eye : EyeOff} label="QA" value={session.enableQA ? 'Enabled' : 'Disabled'} />

        {/* Watchers */}
        <SectionHeader title="Watchers" />
        <InfoRow icon={GitBranch} label="Git" value={
          <span className={`flex items-center gap-1`}>
            <span className={`size-1.5 rounded-full ${gitConnected ? 'bg-green-400' : 'bg-muted-foreground/30'}`} />
            {gitConnected ? (gitStatus?.branch || 'Connected') : 'Disconnected'}
          </span>
        } />
        {gitStatus && (
          <>
            {gitStatus.staged.length > 0 && <StatRow label="  Staged" value={gitStatus.staged.length} color="text-accent" />}
            {gitStatus.unstaged.length > 0 && <StatRow label="  Unstaged" value={gitStatus.unstaged.length} color="text-warn" />}
          </>
        )}
        <InfoRow icon={FolderOpen} label="File Tree" value={
          <span className={`flex items-center gap-1`}>
            <span className={`size-1.5 rounded-full ${fileTreeConnected ? 'bg-green-400' : 'bg-muted-foreground/30'}`} />
            {fileTreeConnected ? 'Connected' : 'Disconnected'}
          </span>
        } />

        {/* Message Stats */}
        <SectionHeader title="Messages" />
        <StatRow label="User Messages" value={stats.userMessages} />
        <StatRow label="Assistant Messages" value={stats.assistantMessages} />
        <StatRow label="Thinking Blocks" value={stats.thinkingBlocks} />
        <StatRow label="Errors" value={stats.errors} color="text-destructive" />
        {pendingApprovals.length > 0 && <StatRow label="Pending Approvals" value={pendingApprovals.length} color="text-orange-400" />}
        {queue.length > 0 && <StatRow label="Queued Messages" value={queue.length} color="text-primary" />}

        {/* Tool Usage */}
        <SectionHeader title="Tool Usage" />
        <InfoRow icon={Wrench} label="Total Calls" value={stats.toolCalls} />
        <StatRow label="File Edits" value={stats.edits} />
        <StatRow label="File Reads" value={stats.reads} />
        <StatRow label="Commands" value={stats.commands} />
        <StatRow label="Searches" value={stats.searches} />
        <StatRow label="Web Fetches" value={stats.webFetches} />
        <StatRow label="Agents Spawned" value={stats.agents} />

        {/* QA Agents */}
        {qaAgents.length > 0 && (
          <>
            <SectionHeader title="QA Agents" />
            <InfoRow icon={Eye} label="Total" value={qaAgents.length} />
            {runningQaAgents > 0 && <StatRow label="Running" value={runningQaAgents} color="text-green-400" />}
            {qaAgents.map((a) => (
              <div key={a.info.qaAgentId} className="flex items-center justify-between px-3 py-0.5">
                <span className="text-muted-foreground truncate text-[11px] max-w-[140px]">{a.info.name || a.info.task.slice(0, 30)}</span>
                <Badge variant={a.info.status === 'running' ? 'default' : 'secondary'} className="text-[9px]">{a.info.status}</Badge>
              </div>
            ))}
          </>
        )}

        {/* Initial Prompt */}
        <SectionHeader title="Initial Prompt" />
        <div className="px-3 py-2">
          <p className="text-muted-foreground text-[11px] leading-relaxed whitespace-pre-wrap line-clamp-6">{session.prompt}</p>
        </div>
      </ScrollArea>
    </div>
  );
}

export default SessionInfoPanel;
