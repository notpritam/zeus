import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ArrowLeft, ArrowDown, Minimize2, Maximize2 } from 'lucide-react';
import { useZeusStore } from '@/stores/useZeusStore';
import { EntryItem, CompressedGroup, groupEntriesByUser } from '@/components/EntryRenderers';
import type { RoomAgent, RoomAgentStatus } from '../../../shared/room-types';

// ─── Role emoji mapping (matches RoomAgentSidebar) ───

const ROLE_ICONS: Record<string, string> = {
  pm: '\u2605',
  architect: '\uD83C\uDFD7',
  tester: '\uD83E\uDDEA',
  qa: '\uD83D\uDD0D',
  reviewer: '\uD83D\uDCCB',
  frontend: '\uD83C\uDFA8',
  backend: '\u2699\uFE0F',
};

function getRoleIcon(role: string): string {
  return ROLE_ICONS[role.toLowerCase()] ?? '\uD83E\uDD16';
}

const STATUS_DOT_COLORS: Record<RoomAgentStatus, string> = {
  spawning: 'bg-yellow-400',
  running: 'bg-green-400',
  idle: 'bg-zinc-400',
  done: 'bg-emerald-400',
  paused: 'bg-orange-400',
  dismissed: 'bg-zinc-600',
  dead: 'bg-red-400',
};

const STATUS_LABELS: Record<RoomAgentStatus, string> = {
  spawning: 'Spawning...',
  running: 'Running',
  idle: 'Idle',
  done: 'Done',
  paused: 'Paused',
  dismissed: 'Dismissed',
  dead: 'Dead',
};

// ─── Props ───

interface RoomAgentLogPanelProps {
  agent: RoomAgent;
  onClose: () => void;
}

// ─── Component ───

export function RoomAgentLogPanel({ agent, onClose }: RoomAgentLogPanelProps) {
  const entries = useZeusStore((s) => s.roomAgentEntries[agent.agentId] ?? []);
  const [compressed, setCompressed] = useState(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);

  // Track scroll position
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    const handleScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      userScrolledUp.current = !atBottom;
      setShowScrollToBottom(!atBottom);
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [agent.agentId]);

  // Auto-scroll on new entries
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    if (!userScrolledUp.current) {
      el.scrollTop = el.scrollHeight;
    }
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setShowScrollToBottom(!atBottom && el.scrollHeight > el.clientHeight);
  }, [entries.length]);

  const scrollToBottom = useCallback(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, []);

  const groups = useMemo(() => groupEntriesByUser(entries), [entries]);
  const isRunning = agent.status === 'running' || agent.status === 'spawning';

  return (
    <div className="flex h-full flex-col bg-zinc-900/30">
      {/* ─── Header ─── */}
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <button
          onClick={onClose}
          className="shrink-0 rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          title="Back to agent list"
        >
          <ArrowLeft className="size-3.5" />
        </button>

        <span className="text-sm leading-none">{getRoleIcon(agent.role)}</span>

        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-zinc-200">{agent.role}</div>
          <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
            <span className={`inline-block size-1.5 rounded-full ${STATUS_DOT_COLORS[agent.status]}`} />
            <span>{STATUS_LABELS[agent.status]}</span>
            {agent.model && (
              <>
                <span className="text-zinc-700">&middot;</span>
                <span>{agent.model}</span>
              </>
            )}
          </div>
        </div>

        <button
          onClick={() => setCompressed((v) => !v)}
          className="shrink-0 rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          title={compressed ? 'Expand entries' : 'Compress entries'}
        >
          {compressed ? <Maximize2 className="size-3" /> : <Minimize2 className="size-3" />}
        </button>
      </div>

      {/* ─── Log Body ─── */}
      <div ref={logRef} className="relative flex-1 overflow-y-auto px-2 py-2">
        {entries.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-zinc-600">
            {isRunning ? 'Waiting for agent output...' : 'No log entries'}
          </div>
        ) : compressed ? (
          groups.map((group, i, arr) => (
            <CompressedGroup key={group.userEntry?.id ?? group.responses[0]?.id ?? i} group={group} isLast={i === arr.length - 1} sessionDone={!isRunning} />
          ))
        ) : (
          entries.map((entry, i) => (
            <EntryItem key={entry.id} entry={entry} sessionDone={!isRunning} isLastEntry={i === entries.length - 1} />
          ))
        )}

        {/* Scroll-to-bottom */}
        {showScrollToBottom && (
          <button
            onClick={scrollToBottom}
            className="sticky bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-zinc-700 px-2.5 py-1 text-[10px] font-medium text-zinc-200 shadow-lg hover:bg-zinc-600"
          >
            <ArrowDown className="size-2.5" />
            Latest
          </button>
        )}
      </div>

      {/* ─── Footer ─── */}
      <div className="flex items-center gap-2 border-t border-zinc-800 px-3 py-1.5">
        <span className={`inline-block size-2 rounded-full ${STATUS_DOT_COLORS[agent.status]} ${isRunning ? 'animate-pulse' : ''}`} />
        <span className="text-[10px] text-zinc-500">
          {STATUS_LABELS[agent.status]}
        </span>
        <span className="flex-1" />
        <span className="text-[10px] text-zinc-600">
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
        </span>
      </div>
    </div>
  );
}
