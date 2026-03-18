import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Plus, Settings, Trash2, Eye, Pencil, Check, X,
  PanelLeftClose, PanelLeftOpen, Zap, Undo2, ChevronDown, ChevronRight,
  Sparkles, Star, Flame, Gem, Hexagon, Pentagon, Triangle, Orbit,
  Atom, Rocket, Leaf, Moon, Sun, Waves, Wind, Snowflake,
  Crown, Diamond, Target, Compass, Anchor, Feather, Ghost,
  Terminal as TerminalIcon, Square,
} from 'lucide-react';
import SessionCard from '@/components/SessionCard';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { BottomSheet, BottomSheetItem } from '@/components/ui/bottom-sheet';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { SessionRecord, ClaudeSessionInfo, SessionActivity, SessionIconName } from '../../../shared/types';
import { SESSION_ICON_COLORS } from '../../../shared/types';
import { useZeusStore } from '@/stores/useZeusStore';

// ─── Long press hook ───

function useLongPress(onLongPress: () => void, delay = 500) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);

  const start = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    // Only handle touch for long-press (desktop has hover actions)
    if (!('touches' in e)) return;
    didLongPress.current = false;
    timerRef.current = setTimeout(() => {
      didLongPress.current = true;
      onLongPress();
    }, delay);
  }, [onLongPress, delay]);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onClick = useCallback((e: React.MouseEvent) => {
    if (didLongPress.current) {
      e.preventDefault();
      e.stopPropagation();
      didLongPress.current = false;
    }
  }, []);

  useEffect(() => cancel, [cancel]);

  return {
    onTouchStart: start,
    onTouchEnd: cancel,
    onTouchMove: cancel,
    onClickCapture: onClick,
  };
}

// ─── Icon name → component map ───

const ICON_MAP: Record<SessionIconName, React.ComponentType<{ className?: string }>> = {
  sparkles: Sparkles, star: Star, flame: Flame, gem: Gem,
  hexagon: Hexagon, pentagon: Pentagon, triangle: Triangle, orbit: Orbit,
  atom: Atom, rocket: Rocket, leaf: Leaf, moon: Moon,
  sun: Sun, waves: Waves, wind: Wind, snowflake: Snowflake,
  bolt: Zap, crown: Crown, diamond: Diamond, target: Target,
  compass: Compass, anchor: Anchor, feather: Feather, ghost: Ghost,
};

const ICON_KEYS = Object.keys(ICON_MAP) as SessionIconName[];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function SessionIcon({ iconName, id, size = 'size-4' }: { iconName?: SessionIconName; id: string; size?: string }) {
  const hash = useMemo(() => hashString(id), [id]);
  const Icon = iconName
    ? (ICON_MAP[iconName] ?? ICON_MAP[ICON_KEYS[hash % ICON_KEYS.length]])
    : ICON_MAP[ICON_KEYS[hash % ICON_KEYS.length]];
  const color = SESSION_ICON_COLORS[hash % SESSION_ICON_COLORS.length];
  return <Icon className={`${size} shrink-0`} style={{ color }} />;
}

interface SessionSidebarProps {
  collapsed?: boolean;
  sessions: SessionRecord[];
  activeSessionId: string | null;
  claudeSessions: ClaudeSessionInfo[];
  activeClaudeId: string | null;
  viewMode: 'terminal' | 'claude' | 'diff';
  sessionActivity: Record<string, SessionActivity>;
  lastActivityAt: Record<string, number>;
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
  onExpandSidebar?: () => void;
}

// ─── Activity helpers ───

function statusDotColor(session: ClaudeSessionInfo, activity: SessionActivity): string {
  if (session.status === 'error') return 'bg-muted-foreground/30';
  if (session.status === 'done') return 'bg-green-400/50';
  if (activity.state === 'waiting_approval') return 'bg-orange-400';
  if (activity.state === 'thinking') return 'bg-yellow-400';
  if (activity.state === 'streaming') return 'bg-green-400';
  if (activity.state === 'tool_running') return 'bg-blue-400';
  if (activity.state === 'starting') return 'bg-purple-400';
  return 'bg-muted-foreground/30';
}

function statusTextColor(session: ClaudeSessionInfo, activity: SessionActivity): string {
  if (session.status === 'error') return 'text-muted-foreground';
  if (session.status === 'done') return 'text-green-400/70';
  if (activity.state === 'waiting_approval') return 'text-orange-400';
  if (activity.state === 'thinking') return 'text-yellow-400';
  if (activity.state === 'streaming') return 'text-green-400';
  if (activity.state === 'tool_running') return 'text-blue-400';
  if (activity.state === 'starting') return 'text-purple-400';
  return 'text-muted-foreground';
}

function statusLabel(session: ClaudeSessionInfo, activity: SessionActivity): string {
  if (activity.state === 'thinking') return 'Thinking...';
  if (activity.state === 'streaming') return 'Writing...';
  if (activity.state === 'tool_running') return activity.description || activity.toolName || 'Running tool...';
  if (activity.state === 'waiting_approval') return `Approval: ${activity.toolName}`;
  if (activity.state === 'starting') return 'Starting...';
  if (session.status === 'done') return 'Completed';
  if (session.status === 'error') return 'Resumed';
  return 'Idle';
}

// ─── Claude Session Card ───

function ClaudeCard({
  session,
  active,
  activity,
  onSelect,
  onUpdate,
  onDelete,
  onLongPress,
}: {
  session: ClaudeSessionInfo;
  active: boolean;
  activity: SessionActivity;
  onSelect: () => void;
  onUpdate: (updates: { name?: string; color?: string | null }) => void;
  onDelete: () => void;
  onLongPress: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
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
  const isRunning = session.status === 'running' && activity.state !== 'idle';
  const dotClass = statusDotColor(session, activity);
  const textClass = statusTextColor(session, activity);
  const stLabel = statusLabel(session, activity);

  const displayName = session.name || (session.prompt ? session.prompt.slice(0, 40) : 'Untitled');
  const longPressHandlers = useLongPress(onLongPress);

  return (
    <button
      data-testid={`claude-card-${session.id}`}
      className={`group relative flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-all [-webkit-app-region:no-drag] ${
        active
          ? 'bg-primary/10 text-foreground'
          : 'text-foreground/80 hover:bg-secondary/60'
      }`}
      onClick={onSelect}
      {...longPressHandlers}
    >
      {/* Approval ping */}
      {needsApproval && (
        <span className="absolute -top-0.5 -right-0.5 z-10 flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-orange-400 opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-orange-400" />
        </span>
      )}

      {/* Auto icon — uses stored icon name */}
      <SessionIcon iconName={session.icon} id={session.id} size="size-4.5" />

      {/* Content */}
      <div className="min-w-0 flex-1 overflow-hidden">
        {editing ? (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
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
            <button onClick={commitRename} className="shrink-0 text-green-400 hover:text-green-300">
              <Check className="size-3.5" />
            </button>
            <button onClick={() => setEditing(false)} className="text-muted-foreground hover:text-foreground shrink-0">
              <X className="size-3.5" />
            </button>
          </div>
        ) : (
          <>
            <span className={`block truncate text-xs leading-tight ${active ? 'font-medium' : ''}`}>
              {displayName}
            </span>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className={`inline-block size-1.5 shrink-0 rounded-full ${dotClass} ${isRunning || needsApproval ? 'animate-pulse' : ''}`} />
              <span className={`truncate text-[10px] ${textClass}`}>
                {stLabel}
              </span>
              {(session.qaAgentCount ?? 0) > 0 && (
                <span className="text-muted-foreground flex shrink-0 items-center gap-0.5 text-[10px]">
                  <Eye className="size-3" />
                  {session.qaAgentCount}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Hover actions — overlaid on right side */}
      {!editing && (
        <div className="bg-inherit absolute inset-y-0 right-0 flex items-center gap-0.5 rounded-r-md px-1 opacity-0 transition-opacity group-hover:opacity-100">
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
    <div className="flex items-center justify-between px-2 pt-3 pb-1.5">
      <span className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">
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

// ─── Collapsed Activity Bar ───

function CollapsedSidebar({
  sessions,
  claudeSessions,
  activeSessionId,
  activeClaudeId,
  viewMode,
  sessionActivity,
  lastActivityAt,
  onExpandSidebar,
  onNewClaudeSession,
  onNewSession,
  onSelectClaudeSession,
  onSelectSession,
  onOpenSettings,
}: {
  sessions: SessionRecord[];
  claudeSessions: ClaudeSessionInfo[];
  activeSessionId: string | null;
  activeClaudeId: string | null;
  viewMode: 'terminal' | 'claude' | 'diff';
  sessionActivity: Record<string, SessionActivity>;
  lastActivityAt: Record<string, number>;
  onExpandSidebar?: () => void;
  onNewClaudeSession: () => void;
  onNewSession: () => void;
  onSelectClaudeSession: (id: string) => void;
  onSelectSession: (id: string) => void;
  onOpenSettings: () => void;
}) {
  // Sort by last activity (most recent first), fallback to startedAt
  const byActivity = (a: { id: string; startedAt: number }, b: { id: string; startedAt: number }) => {
    const aTime = lastActivityAt[a.id] ?? a.startedAt;
    const bTime = lastActivityAt[b.id] ?? b.startedAt;
    return bTime - aTime;
  };

  const allClaude = [...claudeSessions].sort(byActivity);
  const allTerminal = [...sessions].sort(byActivity);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="bg-card border-border flex h-full w-10 flex-col items-center border-r pt-2">
        {/* Expand button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="text-muted-foreground hover:text-foreground flex w-full items-center justify-center py-1.5 transition-colors [-webkit-app-region:no-drag]"
              onClick={onExpandSidebar}
            >
              <PanelLeftOpen className="size-4.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={4}>Expand sidebar</TooltipContent>
        </Tooltip>

        <div className="bg-border mx-2 my-1 h-px w-5" />

        {/* New Claude session */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="flex w-full items-center justify-center py-1 text-muted-foreground/60 hover:text-foreground transition-colors [-webkit-app-region:no-drag]"
              onClick={onNewClaudeSession}
            >
              <Plus className="size-4.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={4}>New Claude session</TooltipContent>
        </Tooltip>

        {/* Claude session icons */}
        <ScrollArea className="min-h-0 flex-1 w-full">
          <div className="flex flex-col items-center gap-0.5 py-1">
            {allClaude.map((s) => {
              const activity = sessionActivity[s.id] ?? { state: 'idle' as const };
              const isActive = (viewMode === 'claude' || viewMode === 'diff') && s.id === activeClaudeId;
              const needsApproval = activity.state === 'waiting_approval';
              const dotClass = statusDotColor(s, activity);
              const isSessionRunning = s.status === 'running' && activity.state !== 'idle';
              const displayName = s.name || (s.prompt ? s.prompt.slice(0, 30) : 'Untitled');

              return (
                <Tooltip key={s.id}>
                  <TooltipTrigger asChild>
                    <button
                      className={`relative flex w-full items-center justify-center py-1.5 transition-colors [-webkit-app-region:no-drag] ${
                        isActive
                          ? 'border-primary bg-primary/10 text-foreground border-l-2'
                          : 'text-muted-foreground/60 hover:text-foreground border-l-2 border-transparent'
                      }`}
                      onClick={() => onSelectClaudeSession(s.id)}
                    >
                      <SessionIcon iconName={s.icon} id={s.id} size="size-4.5" />
                      {/* Status dot */}
                      <span className={`absolute bottom-0.5 right-1.5 size-1.5 rounded-full ${dotClass} ${isSessionRunning || needsApproval ? 'animate-pulse' : ''}`} />
                      {/* Approval ping */}
                      {needsApproval && (
                        <span className="absolute top-0.5 right-1 flex size-2">
                          <span className="absolute inline-flex size-full animate-ping rounded-full bg-orange-400 opacity-75" />
                          <span className="relative inline-flex size-2 rounded-full bg-orange-400" />
                        </span>
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={4}>{displayName}</TooltipContent>
                </Tooltip>
              );
            })}

            {allTerminal.length > 0 && (
              <div className="bg-border mx-2 my-1 h-px w-5" />
            )}

            {allTerminal.map((s) => {
              const isActive = viewMode === 'terminal' && s.id === activeSessionId;
              const isTermRunning = s.status === 'active';
              const hash = hashString(s.id);
              const color = SESSION_ICON_COLORS[hash % SESSION_ICON_COLORS.length];

              return (
                <Tooltip key={s.id}>
                  <TooltipTrigger asChild>
                    <button
                      className={`relative flex w-full items-center justify-center py-1.5 transition-colors [-webkit-app-region:no-drag] ${
                        isActive
                          ? 'border-primary bg-primary/10 text-foreground border-l-2'
                          : 'text-muted-foreground/60 hover:text-foreground border-l-2 border-transparent'
                      }`}
                      onClick={() => onSelectSession(s.id)}
                    >
                      <TerminalIcon className="size-4.5" style={{ color }} />
                      <span className={`absolute bottom-0.5 right-1.5 size-1.5 rounded-full ${isTermRunning ? 'bg-green-400 animate-pulse' : 'bg-muted-foreground/30'}`} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={4}>
                    {s.shell.split('/').pop() || 'shell'}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </ScrollArea>

        {/* Settings at bottom */}
        <div className="border-border border-t">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="flex w-full items-center justify-center py-3 text-muted-foreground/60 hover:text-foreground transition-colors [-webkit-app-region:no-drag]"
                onClick={onOpenSettings}
              >
                <Settings className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={4}>Settings</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}

// ─── Sidebar ───

// ─── Recently Deleted Section ───

function RecentlyDeletedSection() {
  const [expanded, setExpanded] = useState(false);
  const deletedSessions = useZeusStore((s) => s.deletedClaudeSessions);
  const restoreClaudeSession = useZeusStore((s) => s.restoreClaudeSession);
  const fetchDeletedSessions = useZeusStore((s) => s.fetchDeletedSessions);

  useEffect(() => {
    if (expanded) fetchDeletedSessions();
  }, [expanded, fetchDeletedSessions]);

  return (
    <div className="mt-1">
      <button
        className="flex w-full items-center gap-1.5 px-2 pt-3 pb-1.5 [-webkit-app-region:no-drag]"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="text-muted-foreground size-3" /> : <ChevronRight className="text-muted-foreground size-3" />}
        <Trash2 className="text-muted-foreground size-3" />
        <span className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">
          Recently Deleted
        </span>
        {deletedSessions.length > 0 && !expanded && (
          <span className="text-muted-foreground/60 ml-auto text-[10px]">{deletedSessions.length}</span>
        )}
      </button>
      {expanded && (
        deletedSessions.length > 0 ? (
          <div className="flex flex-col gap-0.5">
            {deletedSessions.map((s) => {
              const displayName = s.name || (s.prompt ? s.prompt.slice(0, 40) : 'Untitled');
              const deletedAt = (s as { deletedAt?: number }).deletedAt;
              const daysAgo = deletedAt ? Math.floor((Date.now() - deletedAt) / (1000 * 60 * 60 * 24)) : null;
              const timeLabel = daysAgo === 0 ? 'Today' : daysAgo === 1 ? '1 day ago' : daysAgo != null ? `${daysAgo}d ago` : '';
              return (
                <div
                  key={s.id}
                  className="group mx-1 flex items-center gap-2 rounded-md px-2 py-1.5 opacity-60 hover:opacity-100 transition-opacity"
                >
                  <SessionIcon iconName={s.icon} id={s.id} size="size-3.5" />
                  <div className="min-w-0 flex-1">
                    <div className="text-muted-foreground truncate text-[11px]">{displayName}</div>
                    {timeLabel && <div className="text-muted-foreground/50 text-[9px]">{timeLabel}</div>}
                  </div>
                  <button
                    className="text-muted-foreground hover:text-foreground shrink-0 rounded p-1 opacity-0 transition-all group-hover:opacity-100"
                    onClick={() => restoreClaudeSession(s.id)}
                    title="Restore session"
                  >
                    <Undo2 className="size-3" />
                  </button>
                </div>
              );
            })}
            <p className="text-muted-foreground/40 px-2 py-1 text-center text-[9px]">
              Auto-deleted after 30 days
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground/40 px-2 py-2 text-center text-[10px]">
            No deleted sessions
          </p>
        )
      )}
    </div>
  );
}

function SessionSidebar({
  collapsed,
  sessions,
  activeSessionId,
  claudeSessions,
  activeClaudeId,
  viewMode,
  sessionActivity,
  lastActivityAt,
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
  onExpandSidebar,
}: SessionSidebarProps) {
  // ─── Bottom sheet / edit modal state ───
  type SheetTarget =
    | { type: 'claude'; session: ClaudeSessionInfo }
    | { type: 'terminal'; session: SessionRecord };
  const [sheetTarget, setSheetTarget] = useState<SheetTarget | null>(null);
  const [editModal, setEditModal] = useState<{ id: string; name: string } | null>(null);
  const [editName, setEditName] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<SheetTarget | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editModal) {
      setEditName(editModal.name);
      requestAnimationFrame(() => editInputRef.current?.focus());
    }
  }, [editModal]);

  const closeSheet = () => setSheetTarget(null);

  // Collapsed view — thin activity bar with session icons
  if (collapsed) {
    return (
      <CollapsedSidebar
        sessions={sessions}
        claudeSessions={claudeSessions}
        activeSessionId={activeSessionId}
        activeClaudeId={activeClaudeId}
        viewMode={viewMode}
        sessionActivity={sessionActivity}
        lastActivityAt={lastActivityAt}
        onExpandSidebar={onExpandSidebar}
        onNewClaudeSession={onNewClaudeSession}
        onNewSession={onNewSession}
        onSelectClaudeSession={onSelectClaudeSession}
        onSelectSession={onSelectSession}
        onOpenSettings={onOpenSettings}
      />
    );
  }

  // Sort by last activity (most recent first), fallback to startedAt
  const byActivity = (a: { id: string; startedAt: number }, b: { id: string; startedAt: number }) => {
    const aTime = lastActivityAt[a.id] ?? a.startedAt;
    const bTime = lastActivityAt[b.id] ?? b.startedAt;
    return bTime - aTime;
  };

  const allClaude = [...claudeSessions].sort(byActivity);
  const allTerminal = [...sessions].sort(byActivity);

  return (
    <div
      data-testid="session-sidebar"
      className="bg-card flex h-full flex-col"
    >
      {/* Header */}
      <div className="border-border flex items-center justify-between border-b px-3 py-3">
        <div className="flex items-center gap-2">
          <Zap className="text-primary size-4" />
          <span className="text-primary text-sm font-bold tracking-tight">Zeus</span>
        </div>
        {onCloseSidebar && (
          <button
            className="text-muted-foreground hover:text-foreground flex size-7 items-center justify-center rounded transition-colors [-webkit-app-region:no-drag]"
            onClick={onCloseSidebar}
            title="Close sidebar"
          >
            <PanelLeftClose className="size-4" />
          </button>
        )}
      </div>

      {/* Session List */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-1.5 pb-3">
          {/* Claude Section */}
          <SectionHeader
            label="Claude"
            action={{ icon: <Plus className="size-3.5" />, onClick: onNewClaudeSession, title: 'New Claude session' }}
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
                  onDelete={() => setDeleteConfirm({ type: 'claude', session: s })}
                  onLongPress={() => setSheetTarget({ type: 'claude', session: s })}
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
            action={{ icon: <Plus className="size-3.5" />, onClick: onNewSession, title: 'New terminal session' }}
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
                  onDelete={s.status !== 'active' ? () => setDeleteConfirm({ type: 'terminal', session: s }) : undefined}
                  onArchive={s.status !== 'active' ? () => onArchiveTerminalSession(s.id) : undefined}
                  onLongPress={() => setSheetTarget({ type: 'terminal', session: s })}
                />
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground/40 px-2 py-3 text-center text-[10px]">
              No terminal sessions
            </p>
          )}

          {/* Recently Deleted Section */}
          <RecentlyDeletedSection />
        </div>
      </ScrollArea>

      {/* ─── Long-press bottom sheet ─── */}
      <BottomSheet open={!!sheetTarget} onClose={closeSheet}>
        {sheetTarget?.type === 'claude' && (() => {
          const s = sheetTarget.session;
          const displayName = s.name || (s.prompt ? s.prompt.slice(0, 40) : 'Untitled');
          return (
            <>
              <div className="mb-1 flex items-center gap-2 px-4 py-2">
                <SessionIcon iconName={s.icon} id={s.id} size="size-5" />
                <span className="truncate text-sm font-medium">{displayName}</span>
              </div>
              <BottomSheetItem
                icon={<Pencil className="size-4" />}
                label="Rename"
                onClick={() => {
                  closeSheet();
                  setEditModal({ id: s.id, name: s.name || '' });
                }}
              />
              <BottomSheetItem
                icon={<Trash2 className="size-4" />}
                label="Delete"
                destructive
                onClick={() => {
                  closeSheet();
                  setDeleteConfirm(sheetTarget);
                }}
              />
            </>
          );
        })()}
        {sheetTarget?.type === 'terminal' && (() => {
          const s = sheetTarget.session;
          const shell = s.shell.split('/').pop() || 'shell';
          const isActive = s.status === 'active';
          return (
            <>
              <div className="mb-1 flex items-center gap-2 px-4 py-2">
                <TerminalIcon className="size-5 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm font-medium">{shell}</span>
              </div>
              {isActive && (
                <BottomSheetItem
                  icon={<Square className="size-4" />}
                  label="Stop"
                  destructive
                  onClick={() => { closeSheet(); onStopSession(s.id); }}
                />
              )}
              {!isActive && (
                <BottomSheetItem
                  icon={<Trash2 className="size-4" />}
                  label="Delete"
                  destructive
                  onClick={() => {
                    closeSheet();
                    setDeleteConfirm(sheetTarget);
                  }}
                />
              )}
            </>
          );
        })()}
      </BottomSheet>

      {/* ─── Rename modal ─── */}
      <Dialog open={!!editModal} onOpenChange={(open) => { if (!open) setEditModal(null); }}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-base">Rename Session</DialogTitle>
          </DialogHeader>
          <Input
            ref={editInputRef}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && editModal) {
                onUpdateClaudeSession(editModal.id, { name: editName.trim() || undefined });
                setEditModal(null);
              }
            }}
            placeholder="Session name..."
          />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setEditModal(null)}>Cancel</Button>
            <Button
              size="sm"
              onClick={() => {
                if (editModal) {
                  onUpdateClaudeSession(editModal.id, { name: editName.trim() || undefined });
                  setEditModal(null);
                }
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Delete confirmation modal ─── */}
      <Dialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-base">Delete Session?</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">Session will be moved to trash. You can recover it within 30 days.</p>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (deleteConfirm?.type === 'claude') {
                  onDeleteClaudeSession(deleteConfirm.session.id);
                } else if (deleteConfirm?.type === 'terminal') {
                  onDeleteTerminalSession(deleteConfirm.session.id);
                }
                setDeleteConfirm(null);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bottom bar — settings */}
      <div className="border-border bg-card flex items-center justify-between border-t px-4 py-3.5">
        <span className="text-muted-foreground/50 text-sm">
          {allClaude.length + allTerminal.length} session{allClaude.length + allTerminal.length !== 1 ? 's' : ''}
        </span>
        <button
          className="text-muted-foreground hover:text-foreground flex size-8 items-center justify-center rounded transition-colors [-webkit-app-region:no-drag]"
          onClick={onOpenSettings}
          title="Settings"
        >
          <Settings className="size-4" />
        </button>
      </div>
    </div>
  );
}

export default SessionSidebar;
