import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, Sparkles, Settings, Trash2, Archive, Eye, Pencil, Check, X, Palette, Terminal, Zap } from 'lucide-react';
import SessionCard from '@/components/SessionCard';
import type { SessionRecord, ClaudeSessionInfo, SessionActivity } from '../../../shared/types';

const SESSION_COLORS = [
  null,
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
];

interface SessionSidebarProps {
  sessions: SessionRecord[];
  activeSessionId: string | null;
  claudeSessions: ClaudeSessionInfo[];
  activeClaudeId: string | null;
  viewMode: 'terminal' | 'claude' | 'diff';
  sessionActivity: Record<string, SessionActivity>;
  onNewSession: () => void;
  onNewClaudeSession: () => void;
  onSelectSession: (id: string) => void;
  onStopSession: (id: string) => void;
  onSelectClaudeSession: (id: string) => void;
  onUpdateClaudeSession: (id: string, updates: { name?: string; color?: string | null }) => void;
  onDeleteClaudeSession: (id: string) => void;
  onArchiveClaudeSession: (id: string) => void;
  onDeleteTerminalSession: (id: string) => void;
  onArchiveTerminalSession: (id: string) => void;
  onOpenSettings: () => void;
}

// ─── Color Picker Popover ───

function ColorPicker({
  value,
  onChange,
  onClose,
}: {
  value: string | undefined;
  onChange: (color: string | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="bg-popover border-border absolute top-full left-0 z-50 mt-1 flex gap-1 rounded-lg border p-1.5 shadow-lg"
      onClick={(e) => e.stopPropagation()}
    >
      {SESSION_COLORS.map((c) => (
        <button
          key={c ?? 'none'}
          className={`size-4.5 rounded-full border-2 transition-transform hover:scale-110 ${
            (c ?? undefined) === value ? 'border-foreground scale-110' : 'border-transparent'
          }`}
          style={{ backgroundColor: c ?? 'transparent' }}
          onClick={() => { onChange(c); onClose(); }}
        >
          {!c && <X className="text-muted-foreground size-full p-0.5" />}
        </button>
      ))}
    </div>
  );
}

// ─── Activity Label ───

function activityLabel(activity: SessionActivity): string | null {
  if (activity.state === 'idle') return null;
  if (activity.state === 'tool_running') return activity.toolName || 'tool';
  return activity.state.replace('_', ' ');
}

// ─── Status Dot ───

function StatusDot({ session, activity, color }: { session: ClaudeSessionInfo; activity: SessionActivity; color?: string }) {
  const isActive = session.status === 'running' && activity.state !== 'idle';
  const needsApproval = activity.state === 'waiting_approval';

  const dotColor =
    color ? '' :
    session.status === 'error' ? 'bg-red-400' :
    session.status === 'done' ? 'bg-muted-foreground/40' :
    needsApproval ? 'bg-orange-400' :
    activity.state === 'thinking' ? 'bg-yellow-400' :
    activity.state === 'streaming' ? 'bg-green-400' :
    activity.state === 'tool_running' ? 'bg-blue-400' :
    activity.state === 'starting' ? 'bg-purple-400' :
    'bg-muted-foreground/40';

  return (
    <span
      className={`inline-block size-2 shrink-0 rounded-full ${dotColor} ${isActive || needsApproval ? 'animate-pulse' : ''}`}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}

// ─── Claude Session Card ───

function ClaudeCard({
  session,
  active,
  activity,
  onSelect,
  onUpdate,
  onDelete,
  onArchive,
}: {
  session: ClaudeSessionInfo;
  active: boolean;
  activity: SessionActivity;
  onSelect: () => void;
  onUpdate: (updates: { name?: string; color?: string | null }) => void;
  onDelete: () => void;
  onArchive: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setEditValue(session.name || '');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [editing]);

  const commitRename = () => {
    const trimmed = editValue.trim();
    if (trimmed !== (session.name || '')) {
      onUpdate({ name: trimmed || undefined });
    }
    setEditing(false);
  };

  const needsApproval = activity.state === 'waiting_approval';
  const isActive = session.status === 'running' && activity.state !== 'idle';
  const label = activityLabel(activity);

  const attentionClass =
    needsApproval ? 'zeus-attention-approval' :
    session.status === 'done' ? 'zeus-attention-done' :
    session.status === 'error' ? 'zeus-attention-error' :
    '';

  // Display name: session name > first 40 chars of prompt > fallback
  const displayName = session.name || (session.prompt ? session.prompt.slice(0, 40) : 'Untitled');

  return (
    <button
      data-testid={`claude-card-${session.id}`}
      className={`group relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-all [-webkit-app-region:no-drag] ${
        active
          ? 'bg-primary/10 text-foreground'
          : 'text-foreground/80 hover:bg-secondary/60'
      } ${attentionClass}`}
      style={session.color ? { borderLeft: `2px solid ${session.color}` } : undefined}
      onClick={onSelect}
    >
      {/* Approval ping */}
      {needsApproval && (
        <span className="absolute -top-0.5 -right-0.5 flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-orange-400 opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-orange-400" />
        </span>
      )}

      {/* Status dot */}
      <StatusDot session={session} activity={activity} color={session.color} />

      {/* Content */}
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="flex min-w-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setEditing(false);
              }}
              onBlur={commitRename}
              className="bg-secondary text-foreground min-w-0 flex-1 rounded px-1.5 py-0.5 text-[11px] outline-none"
              placeholder="Session name..."
            />
            <button onClick={commitRename} className="text-green-400 hover:text-green-300">
              <Check className="size-3" />
            </button>
            <button onClick={() => setEditing(false)} className="text-muted-foreground hover:text-foreground">
              <X className="size-3" />
            </button>
          </div>
        ) : (
          <>
            <span className={`block truncate text-[11px] leading-tight ${active ? 'font-medium' : ''}`}>
              {displayName}
            </span>
            {(label || (session.qaAgentCount ?? 0) > 0) && (
              <div className="mt-0.5 flex items-center gap-1.5">
                {label && (
                  <span className={`text-[9px] capitalize ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
                    {label}
                  </span>
                )}
                {(session.qaAgentCount ?? 0) > 0 && (
                  <span className="text-muted-foreground flex items-center gap-0.5 text-[9px]">
                    <Eye className="size-2.5" />
                    {session.qaAgentCount}
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Hover actions — reduced to 2 essential + color */}
      {!editing && (
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <div className="relative">
            <button
              className="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors"
              onClick={(e) => { e.stopPropagation(); setShowColorPicker(!showColorPicker); }}
              title="Color"
            >
              <Palette className="size-3" style={session.color ? { color: session.color } : undefined} />
            </button>
            {showColorPicker && (
              <ColorPicker
                value={session.color}
                onChange={(c) => onUpdate({ color: c })}
                onClose={() => setShowColorPicker(false)}
              />
            )}
          </div>
          <button
            className="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors"
            onClick={(e) => { e.stopPropagation(); setEditing(true); }}
            title="Rename"
          >
            <Pencil className="size-3" />
          </button>
          <button
            className="text-muted-foreground hover:text-destructive rounded p-0.5 transition-colors"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            title="Delete"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      )}
    </button>
  );
}

// ─── Section Header ───

function SectionHeader({ label, count, action }: { label: string; count: number; action?: { icon: React.ReactNode; onClick: () => void; title: string } }) {
  if (count === 0 && !action) return null;
  return (
    <div className="flex items-center justify-between px-2.5 pt-3 pb-1">
      <span className="text-muted-foreground text-[9px] font-semibold uppercase tracking-widest">
        {label}
      </span>
      {action && (
        <button
          className="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors [-webkit-app-region:no-drag]"
          onClick={action.onClick}
          title={action.title}
        >
          {action.icon}
        </button>
      )}
    </div>
  );
}

// ─── Sidebar ───

function SessionSidebar({
  sessions,
  activeSessionId,
  claudeSessions,
  activeClaudeId,
  viewMode,
  sessionActivity,
  onNewSession,
  onNewClaudeSession,
  onSelectSession,
  onStopSession,
  onSelectClaudeSession,
  onUpdateClaudeSession,
  onDeleteClaudeSession,
  onArchiveClaudeSession,
  onDeleteTerminalSession,
  onArchiveTerminalSession,
  onOpenSettings,
}: SessionSidebarProps) {
  const activeSessions = sessions.filter((s) => s.status === 'active');
  const completedSessions = sessions.filter((s) => s.status !== 'active');
  const runningClaude = claudeSessions.filter((s) => s.status === 'running');
  const doneClaude = claudeSessions.filter((s) => s.status !== 'running');

  const allClaude = [...runningClaude, ...doneClaude];
  const allTerminal = [...activeSessions, ...completedSessions];

  return (
    <div
      data-testid="session-sidebar"
      className="bg-card flex h-full flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <Zap className="text-primary size-3.5" />
          <span className="text-foreground text-xs font-semibold tracking-tight">Zeus</span>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground [-webkit-app-region:no-drag]"
          onClick={onOpenSettings}
          title="Settings"
        >
          <Settings className="size-3.5" />
        </Button>
      </div>

      {/* Session List */}
      <ScrollArea className="flex-1">
        <div className="px-1.5 pb-3">
          {/* Claude Section */}
          <SectionHeader
            label="Claude"
            count={allClaude.length}
            action={{ icon: <Plus className="size-3" />, onClick: onNewClaudeSession, title: 'New Claude session' }}
          />
          {allClaude.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              {allClaude.map((s) => (
                <ClaudeCard
                  key={s.id}
                  session={s}
                  active={(viewMode === 'claude' || viewMode === 'diff') && s.id === activeClaudeId}
                  activity={sessionActivity[s.id] ?? { state: 'idle' as const }}
                  onSelect={() => onSelectClaudeSession(s.id)}
                  onUpdate={(updates) => onUpdateClaudeSession(s.id, updates)}
                  onDelete={() => onDeleteClaudeSession(s.id)}
                  onArchive={() => onArchiveClaudeSession(s.id)}
                />
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground/50 px-2.5 py-3 text-center text-[10px]">
              No Claude sessions
            </p>
          )}

          {/* Terminal Section */}
          <SectionHeader
            label="Terminal"
            count={allTerminal.length}
            action={{ icon: <Plus className="size-3" />, onClick: onNewSession, title: 'New terminal session' }}
          />
          {allTerminal.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              {allTerminal.map((s) => (
                <SessionCard
                  key={s.id}
                  session={s}
                  active={viewMode === 'terminal' && s.id === activeSessionId}
                  onSelect={() => onSelectSession(s.id)}
                  onStop={() => onStopSession(s.id)}
                  onDelete={s.status !== 'active' ? () => onDeleteTerminalSession(s.id) : undefined}
                  onArchive={s.status !== 'active' ? () => onArchiveTerminalSession(s.id) : undefined}
                />
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground/50 px-2.5 py-3 text-center text-[10px]">
              No terminal sessions
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export default SessionSidebar;
