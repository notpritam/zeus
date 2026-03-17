import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Square, Trash2, Terminal, Monitor, Code2, Hash, Cpu, Server, HardDrive, Disc } from 'lucide-react';
import type { SessionRecord } from '../../../shared/types';

interface SessionCardProps {
  session: SessionRecord;
  active: boolean;
  onSelect: () => void;
  onStop: () => void;
  onDelete?: () => void;
  onArchive?: () => void;
}

// ─── Auto icon / color for terminal sessions ───

const TERM_ICONS = [Terminal, Monitor, Code2, Hash, Cpu, Server, HardDrive, Disc];
const TERM_COLORS = [
  '#6ee7b7', '#93c5fd', '#c4b5fd', '#fca5a5',
  '#fcd34d', '#a5b4fc', '#67e8f9', '#f9a8d4',
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function formatTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function SessionCard({ session, active, onSelect, onStop, onDelete }: SessionCardProps) {
  const isActive = session.status === 'active';
  const shell = session.shell.split('/').pop() || 'shell';

  const hash = useMemo(() => hashStr(session.id), [session.id]);
  const Icon = TERM_ICONS[hash % TERM_ICONS.length];
  const iconColor = TERM_COLORS[hash % TERM_COLORS.length];

  return (
    <button
      data-testid={`session-card-${session.id}`}
      className={`group relative flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-md px-2 py-1.5 text-left transition-all [-webkit-app-region:no-drag] ${
        active
          ? 'bg-primary/10 text-foreground'
          : 'text-foreground/80 hover:bg-secondary/60'
      }`}
      onClick={onSelect}
    >
      {/* Auto icon */}
      <Icon className="size-4.5 shrink-0" style={{ color: iconColor }} />

      {/* Content */}
      <div className="min-w-0 flex-1">
        <span className={`block truncate text-xs leading-tight ${active ? 'font-medium' : ''}`}>
          {shell}
        </span>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className={`inline-block size-1.5 shrink-0 rounded-full ${
            isActive ? 'bg-green-400 animate-pulse' : 'bg-muted-foreground/30'
          }`} />
          <span className="text-muted-foreground truncate text-[10px]">
            {isActive ? 'Running' : session.status === 'exited' ? 'Exited' : session.status === 'killed' ? 'Killed' : 'Resumed'} · {formatTime(session.startedAt)}
          </span>
        </div>
      </div>

      {/* Actions — overlaid on right side */}
      {isActive ? (
        <div className="bg-inherit absolute inset-y-0 right-0 flex items-center rounded-r-md px-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            data-testid={`session-stop-${session.id}`}
            className="text-muted-foreground hover:text-destructive rounded p-0.5 transition-colors [-webkit-app-region:no-drag]"
            onClick={(e) => { e.stopPropagation(); onStop(); }}
            title="Stop"
          >
            <Square className="size-3.5" />
          </button>
        </div>
      ) : onDelete ? (
        <div className="bg-inherit absolute inset-y-0 right-0 flex items-center rounded-r-md px-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            className="text-muted-foreground hover:text-destructive rounded p-0.5 transition-colors"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            title="Delete"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ) : null}
    </button>
  );
}

export default SessionCard;
