import { useState, useRef, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Plus, Settings, Trash2, Eye, Pencil, Check, X, Palette,
  PanelLeftClose, Zap,
  // Session icons pool
  Sparkles, Star, Flame, Gem, Hexagon, Pentagon, Triangle, Orbit,
  Atom, Rocket, Leaf, Moon, Sun, Waves, Wind, Snowflake,
} from 'lucide-react';
import SessionCard from '@/components/SessionCard';
import type { SessionRecord, ClaudeSessionInfo, SessionActivity } from '../../../shared/types';

// ─── Auto icon / color system ───

const ICON_POOL = [
  Sparkles, Star, Flame, Gem, Hexagon, Pentagon, Triangle, Orbit,
  Atom, Rocket, Leaf, Moon, Sun, Waves, Wind, Snowflake,
];

const COLOR_POOL = [
  '#f87171', '#fb923c', '#fbbf24', '#a3e635',
  '#34d399', '#22d3ee', '#60a5fa', '#a78bfa',
  '#f472b6', '#e879f9', '#c084fc', '#38bdf8',
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function SessionIcon({ id, size = 'size-3.5' }: { id: string; size?: string }) {
  const hash = useMemo(() => hashString(id), [id]);
  const Icon = ICON_POOL[hash % ICON_POOL.length];
  const color = COLOR_POOL[hash % COLOR_POOL.length];
  return <Icon className={`${size} shrink-0`} style={{ color }} />;
}

// ─── Session colors for manual override ───

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
  onCloseSidebar?: () => void;
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
          className={`size-4 rounded-full border-2 transition-transform hover:scale-110 ${
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

// ─── Activity helpers ───

function activityLabel(activity: SessionActivity): string | null {
  if (activity.state === 'idle') return null;
  if (activity.state === 'tool_running') return activity.toolName || 'tool';
  return activity.state.replace('_', ' ');
}

function statusDotColor(session: ClaudeSessionInfo, activity: SessionActivity): string {
  if (session.status === 'error') return 'bg-red-400';
  if (session.status === 'done') return 'bg-muted-foreground/30';
  if (activity.state === 'waiting_approval') return 'bg-orange-400';
  if (activity.state === 'thinking') return 'bg-yellow-400';
  if (activity.state === 'streaming') return 'bg-green-400';
  if (activity.state === 'tool_running') return 'bg-blue-400';
  if (activity.state === 'starting') return 'bg-purple-400';
  return 'bg-muted-foreground/30';
}

// ─── Claude Session Card ───

function ClaudeCard({
  session,
  active,
  activity,
  onSelect,
  onUpdate,
  onDelete,
}: {
  session: ClaudeSessionInfo;
  active: boolean;
  activity: SessionActivity;
  onSelect: () => void;
  onUpdate: (updates: { name?: string; color?: string | null }) => void;
  onDelete: () => void;
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
  const dotClass = statusDotColor(session, activity);

  const attentionClass =
    needsApproval ? 'zeus-attention-approval' :
    session.status === 'done' ? 'zeus-attention-done' :
    session.status === 'error' ? 'zeus-attention-error' :
    '';

  const displayName = session.name || (session.prompt ? session.prompt.slice(0, 40) : 'Untitled');

  return (
    <button
      data-testid={`claude-card-${session.id}`}
      className={`group relative flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-md px-2 py-1.5 text-left transition-all [-webkit-app-region:no-drag] ${
        active
          ? 'bg-primary/10 text-foreground'
          : 'text-foreground/80 hover:bg-secondary/60'
      } ${attentionClass}`}
      onClick={onSelect}
    >
      {/* Approval ping */}
      {needsApproval && (
        <span className="absolute -top-0.5 -right-0.5 z-10 flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-orange-400 opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-orange-400" />
        </span>
      )}

      {/* Auto icon */}
      <SessionIcon id={session.id} size="size-3.5" />

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
            <button onClick={commitRename} className="shrink-0 text-green-400 hover:text-green-300">
              <Check className="size-3" />
            </button>
            <button onClick={() => setEditing(false)} className="text-muted-foreground hover:text-foreground shrink-0">
              <X className="size-3" />
            </button>
          </div>
        ) : (
          <>
            <span className={`block truncate text-[11px] leading-tight ${active ? 'font-medium' : ''}`}>
              {displayName}
            </span>
            <div className="mt-0.5 flex items-center gap-1.5">
              {/* Status dot */}
              <span className={`inline-block size-1.5 shrink-0 rounded-full ${dotClass} ${isActive || needsApproval ? 'animate-pulse' : ''}`} />
              {label && (
                <span className={`truncate text-[9px] capitalize ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
                  {label}
                </span>
              )}
              {!label && (
                <span className="text-muted-foreground truncate text-[9px]">
                  {session.status === 'done' ? 'done' : session.status === 'error' ? 'error' : 'idle'}
                </span>
              )}
              {(session.qaAgentCount ?? 0) > 0 && (
                <span className="text-muted-foreground flex shrink-0 items-center gap-0.5 text-[9px]">
                  <Eye className="size-2.5" />
                  {session.qaAgentCount}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Hover actions */}
      {!editing && (
        <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
          <div className="relative">
            <button
              className="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors"
              onClick={(e) => { e.stopPropagation(); setShowColorPicker(!showColorPicker); }}
              title="Color"
            >
              <Palette className="size-3" />
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

function SectionHeader({ label, action }: { label: string; action?: { icon: React.ReactNode; onClick: () => void; title: string } }) {
  return (
    <div className="flex items-center justify-between px-2 pt-3 pb-1">
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
  onCloseSidebar,
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
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <div className="flex items-center gap-2">
          <Zap className="text-primary size-3.5" />
          <span className="text-foreground text-xs font-semibold tracking-tight">Zeus</span>
        </div>
        {onCloseSidebar && (
          <button
            className="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors [-webkit-app-region:no-drag]"
            onClick={onCloseSidebar}
            title="Close sidebar"
          >
            <PanelLeftClose className="size-3.5" />
          </button>
        )}
      </div>

      {/* Session List */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-1.5 pb-3">
          {/* Claude Section */}
          <SectionHeader
            label="Claude"
            action={{ icon: <Plus className="size-3" />, onClick: onNewClaudeSession, title: 'New Claude session' }}
          />
          {allClaude.length > 0 ? (
            <div className="flex flex-col gap-1">
              {allClaude.map((s) => (
                <ClaudeCard
                  key={s.id}
                  session={s}
                  active={(viewMode === 'claude' || viewMode === 'diff') && s.id === activeClaudeId}
                  activity={sessionActivity[s.id] ?? { state: 'idle' as const }}
                  onSelect={() => onSelectClaudeSession(s.id)}
                  onUpdate={(updates) => onUpdateClaudeSession(s.id, updates)}
                  onDelete={() => onDeleteClaudeSession(s.id)}
                />
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground/40 px-2 py-3 text-center text-[10px]">
              No Claude sessions
            </p>
          )}

          {/* Terminal Section */}
          <SectionHeader
            label="Terminal"
            action={{ icon: <Plus className="size-3" />, onClick: onNewSession, title: 'New terminal session' }}
          />
          {allTerminal.length > 0 ? (
            <div className="flex flex-col gap-1">
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
            <p className="text-muted-foreground/40 px-2 py-3 text-center text-[10px]">
              No terminal sessions
            </p>
          )}
        </div>
      </ScrollArea>

      {/* Bottom bar — settings */}
      <div className="border-border flex items-center justify-between border-t px-3 py-2">
        <span className="text-muted-foreground/50 text-[9px]">
          {allClaude.length + allTerminal.length} session{allClaude.length + allTerminal.length !== 1 ? 's' : ''}
        </span>
        <button
          className="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors [-webkit-app-region:no-drag]"
          onClick={onOpenSettings}
          title="Settings"
        >
          <Settings className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

export default SessionSidebar;
