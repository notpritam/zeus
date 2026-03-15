import type { SessionRecord } from '../../../shared/types';
import SessionCard from '@/components/SessionCard';
import StatusRow from '@/components/StatusRow';

interface SessionSidebarProps {
  sessions: SessionRecord[];
  activeSessionId: string | null;
  powerBlock: boolean;
  websocket: boolean;
  onNewSession: () => void;
  onSelectSession: (id: string) => void;
  onStopSession: (id: string) => void;
  onTogglePower: () => void;
}

function SessionSidebar({
  sessions,
  activeSessionId,
  powerBlock,
  websocket,
  onNewSession,
  onSelectSession,
  onStopSession,
  onTogglePower,
}: SessionSidebarProps) {
  const activeSessions = sessions.filter((s) => s.status === 'active');
  const completedSessions = sessions.filter((s) => s.status !== 'active');

  return (
    <div
      data-testid="session-sidebar"
      className="bg-bg-card border-border flex h-full flex-col border-r"
    >
      {/* New Session Button */}
      <div className="border-border border-b p-3">
        <button
          data-testid="new-session-btn"
          className="bg-accent hover:bg-accent/90 w-full rounded-lg px-3 py-2 text-xs font-semibold text-white transition-colors [-webkit-app-region:no-drag]"
          onClick={onNewSession}
        >
          + New Session
        </button>
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-y-auto p-3">
        {sessions.length === 0 ? (
          <p data-testid="no-sessions" className="text-text-dim py-4 text-center text-xs">
            No sessions yet
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {activeSessions.map((s) => (
              <SessionCard
                key={s.id}
                session={s}
                active={s.id === activeSessionId}
                onSelect={() => onSelectSession(s.id)}
                onStop={() => onStopSession(s.id)}
              />
            ))}
            {completedSessions.length > 0 && activeSessions.length > 0 && (
              <div className="border-border my-1 border-t" />
            )}
            {completedSessions.map((s) => (
              <SessionCard
                key={s.id}
                session={s}
                active={s.id === activeSessionId}
                onSelect={() => onSelectSession(s.id)}
                onStop={() => onStopSession(s.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Status Footer */}
      <div className="border-border border-t px-4 py-2">
        <button className="w-full [-webkit-app-region:no-drag]" onClick={onTogglePower}>
          <StatusRow
            label="Power Lock"
            status={powerBlock ? 'ACTIVE' : 'OFF'}
            active={powerBlock}
          />
        </button>
        <StatusRow label="WebSocket" status={websocket ? 'ACTIVE' : 'OFFLINE'} active={websocket} />
      </div>
    </div>
  );
}

export default SessionSidebar;
