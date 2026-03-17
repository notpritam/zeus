import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Plus, Sparkles, Settings, Trash2, Archive, Eye, Pencil, Check, X, Palette } from 'lucide-react';
import SessionCard from '@/components/SessionCard';
import type { SessionRecord, ClaudeSessionInfo, SessionActivity } from '../../../shared/types';

const SESSION_COLORS = [
  null, // default / no color
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
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
          className={`size-5 rounded-full border-2 transition-transform hover:scale-110 ${
            (c ?? undefined) === value ? 'border-foreground scale-110' : 'border-transparent'
          }`}
          style={{ backgroundColor: c ?? 'transparent' }}
          onClick={() => { onChange(c); onClose(); }}
          title={c ? c : 'Default'}
        >
          {!c && (
            <X className="text-muted-foreground size-full p-0.5" />
          )}
        </button>
      ))}
    </div>
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
    const newName = trimmed || undefined;
    if (newName !== (session.name || undefined)) {
      onUpdate({ name: trimmed });
    }
    setEditing(false);
  };

  // Color the Sparkles icon based on session/activity state
  const sparklesColor =
    session.color ? '' :
    session.status === 'error' ? 'text-red-400' :
    session.status === 'done' ? 'text-muted-foreground' :
    activity.state === 'thinking' ? 'text-yellow-400' :
    activity.state === 'streaming' ? 'text-green-400' :
    activity.state === 'tool_running' ? 'text-blue-400' :
    activity.state === 'waiting_approval' ? 'text-orange-400' :
    activity.state === 'starting' ? 'text-purple-400' :
    'text-muted-foreground';

  const isActive = session.status === 'running' && activity.state !== 'idle';
  const needsApproval = activity.state === 'waiting_approval';
  const isDone = session.status === 'done';
  const isError = session.status === 'error';

  // Attention glow class for the card border
  const attentionClass =
    needsApproval ? 'zeus-attention-approval' :
    isDone ? 'zeus-attention-done' :
    isError ? 'zeus-attention-error' :
    '';

  const accentColor = session.color;

  return (
    <button
      data-testid={`claude-card-${session.id}`}
      className={`group relative flex w-full cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors [-webkit-app-region:no-drag] ${
        active
          ? 'border-ring/50 bg-primary/10'
          : 'border-border hover:bg-secondary'
      } ${attentionClass}`}
      style={accentColor ? { borderLeftColor: accentColor, borderLeftWidth: 3 } : undefined}
      onClick={onSelect}
    >
      {/* Attention ping dot */}
      {needsApproval && (
        <span className="absolute -top-1 -right-1 flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-orange-400 opacity-75" />
          <span className="relative inline-flex size-2.5 rounded-full bg-orange-400" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Sparkles
            className={`size-3 shrink-0 transition-colors ${sparklesColor} ${isActive ? 'animate-pulse' : ''}`}
            style={accentColor ? { color: accentColor } : undefined}
          />
          {editing ? (
            <div className="flex min-w-0 flex-1 items-center gap-1" onClick={(e) => e.stopPropagation()}>
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
                className="bg-secondary text-foreground min-w-0 flex-1 rounded px-1.5 py-0.5 text-xs outline-none"
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
            <span className="text-foreground block max-w-[160px] truncate text-xs">
              {session.name || session.prompt}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 pl-5">
          <span className="text-muted-foreground text-[10px]">{session.id.slice(-6)}</span>
          {(session.qaAgentCount ?? 0) > 0 && (
            <span className="text-muted-foreground flex items-center gap-0.5 text-[10px]">
              <Eye className="size-2.5" />
              {session.qaAgentCount}
            </span>
          )}
          {session.status === 'running' && (
            <span className="text-muted-foreground text-[10px] capitalize">
              {activity.state === 'idle' ? '' : activity.state === 'tool_running' ? activity.toolName : activity.state.replace('_', ' ')}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <div className="relative">
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground"
            onClick={(e) => { e.stopPropagation(); setShowColorPicker(!showColorPicker); }}
            title="Change color"
          >
            <Palette className="size-3" style={accentColor ? { color: accentColor } : undefined} />
          </Button>
          {showColorPicker && (
            <ColorPicker
              value={session.color}
              onChange={(c) => onUpdate({ color: c })}
              onClose={() => setShowColorPicker(false)}
            />
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          onClick={(e) => { e.stopPropagation(); setEditing(true); }}
          title="Rename session"
        >
          <Pencil className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          onClick={(e) => { e.stopPropagation(); onArchive(); }}
          title="Archive session"
        >
          <Archive className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-destructive"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Delete session"
        >
          <Trash2 className="size-3" />
        </Button>
      </div>
    </button>
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

  return (
    <div
      data-testid="session-sidebar"
      className="bg-card border-border flex h-full flex-col border-r"
    >
      {/* Action Buttons */}
      <div className="flex flex-col gap-2 p-3">
        <Button
          data-testid="new-session-btn"
          size="sm"
          className="w-full bg-accent text-white hover:bg-accent/90 [-webkit-app-region:no-drag]"
          onClick={onNewSession}
        >
          <Plus className="size-3" />
          New Session
        </Button>
        <Button
          data-testid="new-claude-btn"
          size="sm"
          className="w-full [-webkit-app-region:no-drag]"
          onClick={onNewClaudeSession}
        >
          <Sparkles className="size-3" />
          Claude Session
        </Button>
      </div>

      <Separator />

      {/* Session List */}
      <ScrollArea className="flex-1">
        <div className="p-3">
          {sessions.length === 0 && claudeSessions.length === 0 ? (
            <p data-testid="no-sessions" className="text-muted-foreground py-4 text-center text-xs">
              No sessions yet
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {/* Claude sessions — running */}
              {runningClaude.map((s) => (
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

              {/* Terminal sessions — active */}
              {activeSessions.map((s) => (
                <SessionCard
                  key={s.id}
                  session={s}
                  active={viewMode === 'terminal' && s.id === activeSessionId}
                  onSelect={() => onSelectSession(s.id)}
                  onStop={() => onStopSession(s.id)}
                />
              ))}

              {/* Divider */}
              {(runningClaude.length > 0 || activeSessions.length > 0) &&
                (doneClaude.length > 0 || completedSessions.length > 0) && (
                  <Separator className="my-1" />
                )}

              {/* Claude sessions — done */}
              {doneClaude.map((s) => (
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

              {/* Terminal sessions — completed */}
              {completedSessions.map((s) => (
                <SessionCard
                  key={s.id}
                  session={s}
                  active={viewMode === 'terminal' && s.id === activeSessionId}
                  onSelect={() => onSelectSession(s.id)}
                  onStop={() => onStopSession(s.id)}
                  onDelete={() => onDeleteTerminalSession(s.id)}
                  onArchive={() => onArchiveTerminalSession(s.id)}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Bottom Menu Bar — VS Code style */}
      <Separator />
      <div className="flex items-center justify-between px-3 py-2">
        {/* Profile */}
        <div className="flex items-center gap-2">
          <div className="bg-primary/20 text-primary flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold">
            Z
          </div>
          <span className="text-muted-foreground text-[11px]">Zeus</span>
        </div>

        {/* Settings */}
        <Button
          variant="ghost"
          size="icon-xs"
          className="[-webkit-app-region:no-drag]"
          onClick={onOpenSettings}
          title="Settings (⌘,)"
        >
          <Settings className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export default SessionSidebar;
