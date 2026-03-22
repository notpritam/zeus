import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Send, PanelRightClose, PanelRightOpen, ArrowDown, MessageSquare } from 'lucide-react';
import { useZeusStore } from '@/stores/useZeusStore';
import { RoomMessageItem } from './RoomMessage';
import { RoomAgentSidebar } from './RoomAgentSidebar';
import type { Room, RoomStatus, RoomAgent } from '../../../shared/room-types';

// ─── Status badge config ───

const STATUS_BADGE: Record<RoomStatus, { dot: string; text: string; bg: string }> = {
  active:    { dot: 'bg-green-400',  text: 'text-green-400',  bg: 'bg-green-400/15' },
  completed: { dot: 'bg-zinc-400',   text: 'text-zinc-400',   bg: 'bg-zinc-400/15' },
  paused:    { dot: 'bg-yellow-400', text: 'text-yellow-400', bg: 'bg-yellow-400/15' },
};

// ─── Component ───

export function RoomView() {
  const activeRoomId = useZeusStore((s) => s.activeRoomId);
  const rooms = useZeusStore((s) => s.rooms);
  const roomMessages = useZeusStore((s) => s.roomMessages);
  const roomAgents = useZeusStore((s) => s.roomAgents);
  const postRoomMessage = useZeusStore((s) => s.postRoomMessage);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [inputValue, setInputValue] = useState('');
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);

  const feedRef = useRef<HTMLDivElement>(null);
  const feedEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ─── Derived state ───

  const room: Room | undefined = useMemo(
    () => rooms.find((r) => r.roomId === activeRoomId),
    [rooms, activeRoomId],
  );

  const messages = useMemo(
    () => (activeRoomId ? roomMessages[activeRoomId] ?? [] : []),
    [roomMessages, activeRoomId],
  );

  const agents: RoomAgent[] = useMemo(
    () => (activeRoomId ? roomAgents[activeRoomId] ?? [] : []),
    [roomAgents, activeRoomId],
  );

  const activeAgentCount = useMemo(
    () => agents.filter((a) => a.status === 'spawning' || a.status === 'running' || a.status === 'idle').length,
    [agents],
  );

  // ─── Auto-scroll logic ───

  const scrollToBottom = useCallback(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Auto-scroll when new messages arrive (unless user scrolled up)
  useEffect(() => {
    if (!isUserScrolledUp) {
      feedEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, isUserScrolledUp]);

  // Track scroll position to detect user scrolling up
  const handleScroll = useCallback(() => {
    const el = feedRef.current;
    if (!el) return;
    // Consider "scrolled up" if more than 80px from the bottom
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setIsUserScrolledUp(distanceFromBottom > 80);
  }, []);

  // ─── Input handling ───

  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    if (!text || !activeRoomId) return;
    postRoomMessage(activeRoomId, text);
    setInputValue('');
    setIsUserScrolledUp(false);
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [inputValue, activeRoomId, postRoomMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // Auto-grow textarea
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }, []);

  // Agent click handler (placeholder for Task 15)
  const handleAgentClick = useCallback((_agent: RoomAgent) => {
    // Will be wired in Task 15 to navigate to the agent's individual session
  }, []);

  // ─── No room selected: placeholder ───

  if (!activeRoomId || !room) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-zinc-500">
        <MessageSquare className="size-10 stroke-1" />
        <p className="text-sm">Select a room to view the group chat</p>
      </div>
    );
  }

  // ─── Status badge ───

  const badge = STATUS_BADGE[room.status];

  return (
    <div className="flex h-full flex-col">
      {/* ─── Header ─── */}
      <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2">
        {/* Room name */}
        <h2 className="shrink-0 text-sm font-medium text-zinc-200">{room.name}</h2>

        {/* Task (truncated) */}
        <span className="min-w-0 flex-1 truncate text-xs text-zinc-500" title={room.task}>
          {room.task}
        </span>

        {/* Status badge */}
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${badge.bg} ${badge.text}`}>
          <span className={`inline-block size-1.5 rounded-full ${badge.dot}`} />
          {room.status}
        </span>

        {/* Agent count */}
        <span className="shrink-0 text-xs text-zinc-500">
          {activeAgentCount} agent{activeAgentCount !== 1 ? 's' : ''} active
        </span>

        {/* Toggle sidebar */}
        <button
          onClick={() => setSidebarOpen((v) => !v)}
          className="shrink-0 rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          title={sidebarOpen ? 'Hide agent sidebar' : 'Show agent sidebar'}
        >
          {sidebarOpen ? (
            <PanelRightClose className="size-4" />
          ) : (
            <PanelRightOpen className="size-4" />
          )}
        </button>
      </div>

      {/* ─── Body: Chat Feed + Sidebar ─── */}
      <div className="flex min-h-0 flex-1">
        {/* Chat Feed */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          {/* Scrollable messages */}
          <div
            ref={feedRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto px-2 py-2"
          >
            {messages.length === 0 && (
              <div className="flex h-full items-center justify-center text-xs text-zinc-600">
                No messages yet. Agents will post updates here.
              </div>
            )}

            {messages.map((msg) => (
              <RoomMessageItem key={msg.messageId} message={msg} agents={agents} />
            ))}

            {/* Scroll anchor */}
            <div ref={feedEndRef} />
          </div>

          {/* "New messages" button when scrolled up */}
          {isUserScrolledUp && (
            <button
              onClick={() => {
                scrollToBottom();
                setIsUserScrolledUp(false);
              }}
              className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 shadow-lg transition-colors hover:bg-zinc-600"
            >
              <ArrowDown className="size-3" />
              New messages
            </button>
          )}
        </div>

        {/* Agent Sidebar */}
        {sidebarOpen && (
          <div className="w-56 shrink-0 border-l border-zinc-800">
            <RoomAgentSidebar room={room} agents={agents} onAgentClick={handleAgentClick} />
          </div>
        )}
      </div>

      {/* ─── Input Bar ─── */}
      {room.status === 'active' && (
        <div className="flex items-end gap-2 border-t border-zinc-800 px-4 py-2">
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Send a message to the room..."
            rows={1}
            className="min-h-[32px] flex-1 resize-none rounded bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 outline-none ring-1 ring-zinc-700 focus:ring-zinc-500"
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim()}
            className="shrink-0 rounded bg-blue-600 p-1.5 text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
            title="Send message"
          >
            <Send className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
