import { useState, useMemo, useCallback } from 'react';
import { X, Plus, ChevronDown } from 'lucide-react';
import { useZeusStore } from '@/stores/useZeusStore';
import type { Room, RoomAgent, RoomAgentStatus } from '../../../shared/room-types';

// ─── Role emoji mapping (matches RoomMessage) ───

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

// ─── Status color mapping ───

const STATUS_COLORS: Record<RoomAgentStatus, string> = {
  spawning: 'text-yellow-400',
  running: 'text-green-400',
  idle: 'text-zinc-400',
  done: 'text-emerald-400',
  paused: 'text-orange-400',
  dismissed: 'text-zinc-600',
  dead: 'text-red-400',
};

const STATUS_DOT_COLORS: Record<RoomAgentStatus, string> = {
  spawning: 'bg-yellow-400',
  running: 'bg-green-400',
  idle: 'bg-zinc-400',
  done: 'bg-emerald-400',
  paused: 'bg-orange-400',
  dismissed: 'bg-zinc-600',
  dead: 'bg-red-400',
};

// ─── Model options ───

const MODEL_OPTIONS = [
  { label: 'Sonnet 4.6', value: 'sonnet' },
  { label: 'Opus 4.6', value: 'opus' },
  { label: 'Haiku 4.5', value: 'haiku' },
];

// ─── Props ───

interface RoomAgentSidebarProps {
  room: Room;
  agents: RoomAgent[];
  onAgentClick?: (agent: RoomAgent) => void;
}

// ─── Component ───

export function RoomAgentSidebar({ room, agents, onAgentClick }: RoomAgentSidebarProps) {
  const spawnRoomAgent = useZeusStore((s) => s.spawnRoomAgent);
  const dismissRoomAgent = useZeusStore((s) => s.dismissRoomAgent);

  const [showSpawnForm, setShowSpawnForm] = useState(false);
  const [spawnRole, setSpawnRole] = useState('');
  const [spawnPrompt, setSpawnPrompt] = useState('');
  const [spawnModel, setSpawnModel] = useState(MODEL_OPTIONS[0].value);
  const [spawnRoomAware, setSpawnRoomAware] = useState(true);

  // Count active agents (spawning, running, idle)
  const activeCount = useMemo(
    () => agents.filter((a) => a.status === 'spawning' || a.status === 'running' || a.status === 'idle').length,
    [agents],
  );

  const canSpawn = spawnRole.trim().length > 0 && spawnPrompt.trim().length > 0;

  const handleSpawn = useCallback(() => {
    if (!canSpawn) return;
    spawnRoomAgent(room.roomId, spawnRole.trim(), spawnPrompt.trim(), spawnModel, spawnRoomAware);
    setSpawnRole('');
    setSpawnPrompt('');
    setSpawnModel(MODEL_OPTIONS[0].value);
    setSpawnRoomAware(true);
    setShowSpawnForm(false);
  }, [canSpawn, room.roomId, spawnRole, spawnPrompt, spawnModel, spawnRoomAware, spawnRoomAgent]);

  const handleDismiss = useCallback(
    (e: React.MouseEvent, agent: RoomAgent) => {
      e.stopPropagation();
      dismissRoomAgent(room.roomId, agent.agentId);
    },
    [room.roomId, dismissRoomAgent],
  );

  return (
    <div className="flex h-full flex-col bg-zinc-900/30">
      {/* ─── Header ─── */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Agents{' '}
          <span className="text-zinc-500">
            ({activeCount} active)
          </span>
        </h3>
      </div>

      {/* ─── Agent List ─── */}
      <div className="flex-1 overflow-y-auto">
        {agents.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-zinc-600">
            No agents spawned yet
          </div>
        )}

        {agents.map((agent) => {
          const isPm = agent.role.toLowerCase() === 'pm';
          const isActive = agent.status === 'running' || agent.status === 'spawning' || agent.status === 'idle';
          const canDismiss = isActive && !isPm;

          return (
            <div
              key={agent.agentId}
              className="group flex cursor-pointer items-center gap-2 border-b border-zinc-800/50 px-3 py-2 transition-colors hover:bg-zinc-800/40"
              onClick={() => onAgentClick?.(agent)}
              title={`${agent.role} — ${agent.agentId}`}
            >
              {/* Role emoji */}
              <span className="shrink-0 text-sm leading-none">
                {getRoleIcon(agent.role)}
              </span>

              {/* Role name + model */}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-zinc-200">
                  {agent.role}
                </div>
                {agent.model && (
                  <div className="truncate text-[10px] text-zinc-500">
                    {agent.model}
                  </div>
                )}
              </div>

              {/* Status dot + label */}
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={`inline-block size-1.5 rounded-full ${STATUS_DOT_COLORS[agent.status]}`}
                />
                <span className={`text-[10px] ${STATUS_COLORS[agent.status]}`}>
                  {agent.status}
                </span>
              </div>

              {/* Dismiss button (hover only) */}
              {canDismiss && (
                <button
                  className="ml-1 hidden shrink-0 rounded p-0.5 text-zinc-600 transition-colors hover:bg-zinc-700 hover:text-zinc-300 group-hover:block"
                  onClick={(e) => handleDismiss(e, agent)}
                  title="Dismiss agent"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* ─── Spawn Form (toggleable) ─── */}
      {showSpawnForm && (
        <div className="border-t border-zinc-800 px-3 py-2 space-y-2">
          {/* Role */}
          <input
            type="text"
            placeholder="Role (e.g. frontend, tester)"
            value={spawnRole}
            onChange={(e) => setSpawnRole(e.target.value)}
            className="w-full rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none ring-1 ring-zinc-700 focus:ring-zinc-500"
          />

          {/* Prompt */}
          <textarea
            placeholder="Agent prompt..."
            rows={3}
            value={spawnPrompt}
            onChange={(e) => setSpawnPrompt(e.target.value)}
            className="w-full resize-none rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none ring-1 ring-zinc-700 focus:ring-zinc-500"
          />

          {/* Model selector */}
          <div className="relative">
            <select
              value={spawnModel}
              onChange={(e) => setSpawnModel(e.target.value)}
              className="w-full appearance-none rounded bg-zinc-800 px-2 py-1 pr-6 text-xs text-zinc-200 outline-none ring-1 ring-zinc-700 focus:ring-zinc-500"
            >
              {MODEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 size-3 -translate-y-1/2 text-zinc-500" />
          </div>

          {/* Room-aware toggle */}
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={spawnRoomAware}
              onChange={(e) => setSpawnRoomAware(e.target.checked)}
              className="rounded border-zinc-700 bg-zinc-800"
            />
            Room-aware
          </label>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button
              disabled={!canSpawn}
              onClick={handleSpawn}
              className="flex-1 rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Spawn
            </button>
            <button
              onClick={() => setShowSpawnForm(false)}
              className="rounded px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ─── Footer ─── */}
      {room.status === 'active' && !showSpawnForm && (
        <div className="border-t border-zinc-800 px-3 py-2">
          <button
            onClick={() => setShowSpawnForm(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded bg-zinc-800 px-2 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-zinc-100"
          >
            <Plus className="size-3" />
            Spawn Agent
          </button>
        </div>
      )}
    </div>
  );
}
