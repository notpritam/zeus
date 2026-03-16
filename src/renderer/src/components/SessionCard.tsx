import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Square, Trash2, Archive } from 'lucide-react';
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
  return `${Math.floor(diff / 3600)}h ago`;
}

const statusVariant: Record<string, 'default' | 'secondary' | 'destructive'> = {
  active: 'default',
  exited: 'secondary',
  killed: 'destructive',
};

function SessionCard({ session, active, onSelect, onStop, onDelete, onArchive }: SessionCardProps) {
  return (
    <button
      data-testid={`session-card-${session.id}`}
      className={`group flex w-full cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors [-webkit-app-region:no-drag] ${
        active
          ? 'border-ring/50 bg-primary/10'
          : 'border-border hover:bg-secondary'
      }`}
      onClick={onSelect}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-foreground truncate font-mono text-xs">
            {session.id.slice(0, 8)}
          </span>
          <Badge
            data-testid={`session-status-${session.id}`}
            variant={statusVariant[session.status] ?? 'secondary'}
            className="text-[9px] uppercase tracking-wider"
          >
            {session.status}
          </Badge>
        </div>
        <div className="text-muted-foreground mt-0.5 text-[10px]">
          {session.shell.split('/').pop()} &middot; {formatTime(session.startedAt)}
        </div>
      </div>
      {session.status === 'active' ? (
        <Button
          data-testid={`session-stop-${session.id}`}
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-destructive [-webkit-app-region:no-drag]"
          onClick={(e) => {
            e.stopPropagation();
            onStop();
          }}
          title="Stop session"
        >
          <Square className="size-3" />
        </Button>
      ) : (
        <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {onArchive && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-foreground"
              onClick={(e) => { e.stopPropagation(); onArchive(); }}
              title="Archive session"
            >
              <Archive className="size-3" />
            </Button>
          )}
          {onDelete && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-destructive"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              title="Delete session"
            >
              <Trash2 className="size-3" />
            </Button>
          )}
        </div>
      )}
    </button>
  );
}

export default SessionCard;
