import type { SessionRecord } from '../../../shared/types';

interface SessionCardProps {
  session: SessionRecord;
  active: boolean;
  onSelect: () => void;
  onStop: () => void;
}

function formatTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

const statusColors: Record<string, string> = {
  active: 'bg-accent text-white',
  exited: 'bg-bg-surface text-text-faint',
  killed: 'bg-danger-bg text-danger',
};

function SessionCard({ session, active, onSelect, onStop }: SessionCardProps) {
  return (
    <button
      data-testid={`session-card-${session.id}`}
      className={`flex w-full cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors [-webkit-app-region:no-drag] ${
        active
          ? 'border-accent-border bg-accent-bg'
          : 'border-border hover:border-border-dim bg-bg-card hover:bg-bg-surface'
      }`}
      onClick={onSelect}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-text-secondary truncate font-mono text-xs">
            {session.id.slice(0, 8)}
          </span>
          <span
            data-testid={`session-status-${session.id}`}
            className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-wider uppercase ${statusColors[session.status]}`}
          >
            {session.status}
          </span>
        </div>
        <div className="text-text-dim mt-0.5 text-[10px]">
          {session.shell.split('/').pop()} &middot; {formatTime(session.startedAt)}
        </div>
      </div>
      {session.status === 'active' && (
        <button
          data-testid={`session-stop-${session.id}`}
          className="text-text-faint hover:text-danger shrink-0 rounded p-1 text-xs transition-colors [-webkit-app-region:no-drag]"
          onClick={(e) => {
            e.stopPropagation();
            onStop();
          }}
          title="Stop session"
        >
          &#x25A0;
        </button>
      )}
    </button>
  );
}

export default SessionCard;
