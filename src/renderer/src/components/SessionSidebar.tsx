import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Plus, Sparkles, Settings, Trash2, Archive } from 'lucide-react';
import SessionCard from '@/components/SessionCard';
import type { SessionRecord, ClaudeSessionInfo, SessionActivity } from '../../../shared/types';

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
  onDeleteClaudeSession: (id: string) => void;
  onArchiveClaudeSession: (id: string) => void;
  onDeleteTerminalSession: (id: string) => void;
  onArchiveTerminalSession: (id: string) => void;
  onOpenSettings: () => void;
}

// ─── Claude Session Card ───

function ClaudeCard({
  session,
  active,
  activity,
  onSelect,
  onDelete,
  onArchive,
}: {
  session: ClaudeSessionInfo;
  active: boolean;
  activity: SessionActivity;
  onSelect: () => void;
  onDelete: () => void;
  onArchive: () => void;
}) {
  const statusVariant: Record<string, 'default' | 'secondary' | 'destructive'> = {
    running: 'default',
    done: 'secondary',
    error: 'destructive',
  };

  // Color the Sparkles icon based on activity state
  const sparklesColor =
    activity.state === 'thinking' ? 'text-yellow-400' :
    activity.state === 'streaming' ? 'text-green-400' :
    activity.state === 'tool_running' ? 'text-blue-400' :
    activity.state === 'waiting_approval' ? 'text-orange-400' :
    activity.state === 'starting' ? 'text-purple-400' :
    'text-primary';

  const isActive = session.status === 'running' && activity.state !== 'idle';

  return (
    <button
      data-testid={`claude-card-${session.id}`}
      className={`group flex w-full cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors [-webkit-app-region:no-drag] ${
        active
          ? 'border-ring/50 bg-primary/10'
          : 'border-border hover:bg-secondary'
      }`}
      onClick={onSelect}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Sparkles className={`size-3 shrink-0 transition-colors ${sparklesColor} ${isActive ? 'animate-pulse' : ''}`} />
          <span className="text-foreground block max-w-[160px] truncate text-xs">
            {session.name || session.prompt}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <Badge
            variant={statusVariant[session.status] ?? 'secondary'}
            className="text-[9px] uppercase tracking-wider"
          >
            {session.status}
          </Badge>
          <span className="text-muted-foreground text-[10px]">{session.id.slice(-6)}</span>
        </div>
      </div>
      {session.status !== 'running' && (
        <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
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
      )}
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
