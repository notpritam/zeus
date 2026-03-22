import { memo, useMemo } from 'react';
import {
  Terminal,
  User,
  FileText,
  HelpCircle,
  Activity,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import Markdown from '@/components/Markdown';
import type { RoomMessage, RoomAgent, RoomMessageType } from '../../../shared/room-types';

// ─── Role emoji mapping ───

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

// ─── Type styling config ───

interface TypeStyle {
  color: string;        // tailwind text color
  bgColor: string;      // tailwind bg color for badge
  icon: typeof Terminal;
  label: string;
}

const TYPE_STYLES: Record<RoomMessageType, TypeStyle> = {
  system:        { color: 'text-zinc-500',    bgColor: 'bg-zinc-500/15 text-zinc-400',    icon: Terminal,     label: 'SYSTEM' },
  directive:     { color: 'text-blue-400',    bgColor: 'bg-blue-400/15 text-blue-400',    icon: User,         label: 'directive' },
  finding:       { color: 'text-green-400',   bgColor: 'bg-green-400/15 text-green-400',  icon: FileText,     label: 'finding' },
  question:      { color: 'text-yellow-400',  bgColor: 'bg-yellow-400/15 text-yellow-400', icon: HelpCircle,  label: 'question' },
  status_update: { color: 'text-purple-400',  bgColor: 'bg-purple-400/15 text-purple-400', icon: Activity,    label: 'status' },
  signal_done:   { color: 'text-emerald-400', bgColor: 'bg-emerald-400/15 text-emerald-400', icon: CheckCircle, label: 'done' },
  error:         { color: 'text-red-400',     bgColor: 'bg-red-400/15 text-red-400',      icon: AlertCircle,  label: 'error' },
};

// ─── Timestamp formatter ───

function formatTime(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '';
  }
}

// ─── Agent lookup helper ───

function findAgent(agents: RoomAgent[], agentId: string | null): RoomAgent | undefined {
  if (!agentId) return undefined;
  return agents.find((a) => a.agentId === agentId);
}

// ─── Props ───

interface RoomMessageProps {
  message: RoomMessage;
  agents: RoomAgent[];
}

// ─── Component ───

export const RoomMessageItem = memo(function RoomMessageItem({ message, agents }: RoomMessageProps) {
  const style = TYPE_STYLES[message.type];
  const sender = useMemo(() => findAgent(agents, message.fromAgentId), [agents, message.fromAgentId]);
  const target = useMemo(() => findAgent(agents, message.toAgentId), [agents, message.toAgentId]);
  const time = formatTime(message.timestamp);

  // ─── System messages: compact single-line ───
  if (message.type === 'system') {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1 text-xs text-zinc-500">
        <Terminal className="size-3 shrink-0" />
        <span className="truncate">{message.content}</span>
      </div>
    );
  }

  // ─── Regular messages: full card ───
  const Icon = style.icon;
  const senderRole = sender?.role ?? 'unknown';
  const senderEmoji = getRoleIcon(senderRole);

  return (
    <div className="group rounded-md px-3 py-2 transition-colors hover:bg-zinc-800/30">
      {/* Header row */}
      <div className="flex items-center gap-2 text-xs">
        {/* Sender: emoji + role name */}
        <span className="text-sm leading-none" title={sender?.agentId}>
          {senderEmoji}
        </span>
        <span className="font-medium text-zinc-200">{senderRole}</span>

        {/* Directed target */}
        {target && (
          <>
            <span className="text-zinc-600">&rarr;</span>
            <span className="text-zinc-400">@{target.role}</span>
          </>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Type badge */}
        <span
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase leading-none ${style.bgColor}`}
        >
          <Icon className="size-3" />
          {style.label}
        </span>

        {/* Timestamp */}
        {time && <span className="text-zinc-600">{time}</span>}
      </div>

      {/* Content */}
      <div className="pl-6 pt-1">
        <Markdown content={message.content} />
      </div>
    </div>
  );
});
