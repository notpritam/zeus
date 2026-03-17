import { Button } from '@/components/ui/button';
import { Square, Trash2, Terminal } from 'lucide-react';
import type { SessionRecord } from '../../../shared/types';

interface SessionCardProps {
  session: SessionRecord;
  active: boolean;
  onSelect: () => void;
  onStop: () => void;
  onDelete?: () => void;
  onArchive?: () => void;
}

function formatTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function SessionCard({ session, active, onSelect, onStop, onDelete, onArchive }: SessionCardProps) {
  const isActive = session.status === 'active';
  const shell = session.shell.split('/').pop() || 'shell';

  return (
    <button
      data-testid={`session-card-${session.id}`}
      className={`group flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-all [-webkit-app-region:no-drag] ${
        active
          ? 'bg-primary/10 text-foreground'
          : 'text-foreground/80 hover:bg-secondary/60'
      }`}
      onClick={onSelect}
    >
      {/* Status dot */}
      <span className={`inline-block size-2 shrink-0 rounded-full ${
        isActive ? 'bg-green-400 animate-pulse' : 'bg-muted-foreground/40'
      }`} />

      {/* Content */}
      <div className="min-w-0 flex-1">
        <span className={`block truncate text-[11px] leading-tight ${active ? 'font-medium' : ''}`}>
          {shell}
        </span>
        <span className="text-muted-foreground mt-0.5 block text-[9px]">
          {formatTime(session.startedAt)}
        </span>
      </div>

      {/* Actions */}
      {isActive ? (
        <Button
          data-testid={`session-stop-${session.id}`}
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-destructive shrink-0 opacity-0 transition-opacity [-webkit-app-region:no-drag] group-hover:opacity-100"
          onClick={(e) => { e.stopPropagation(); onStop(); }}
          title="Stop"
        >
          <Square className="size-3" />
        </Button>
      ) : (
        <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {onDelete && (
            <button
              className="text-muted-foreground hover:text-destructive rounded p-0.5 transition-colors"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              title="Delete"
            >
              <Trash2 className="size-3" />
            </button>
          )}
        </div>
      )}
    </button>
  );
}

export default SessionCard;
