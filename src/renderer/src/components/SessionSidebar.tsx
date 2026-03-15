import { useState } from 'react';
import type { SessionRecord, ClaudeSessionInfo } from '../../../shared/types';
import SessionCard from '@/components/SessionCard';
import StatusRow from '@/components/StatusRow';

interface SessionSidebarProps {
  sessions: SessionRecord[];
  activeSessionId: string | null;
  claudeSessions: ClaudeSessionInfo[];
  activeClaudeId: string | null;
  powerBlock: boolean;
  websocket: boolean;
  viewMode: 'terminal' | 'claude';
  onNewSession: () => void;
  onNewClaudeSession: (prompt: string) => void;
  onSelectSession: (id: string) => void;
  onStopSession: (id: string) => void;
  onSelectClaudeSession: (id: string) => void;
  onTogglePower: () => void;
}

// ─── Claude Session Card ───

function ClaudeCard({
  session,
  active,
  onSelect,
}: {
  session: ClaudeSessionInfo;
  active: boolean;
  onSelect: () => void;
}) {
  const statusColors: Record<string, string> = {
    running: 'bg-accent-bg text-accent',
    done: 'bg-bg-surface text-text-faint',
    error: 'bg-danger-bg text-danger',
  };

  return (
    <button
      data-testid={`claude-card-${session.id}`}
      className={`flex w-full cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors [-webkit-app-region:no-drag] ${
        active
          ? 'border-info-border bg-info-bg'
          : 'border-border hover:border-border-dim bg-bg-card hover:bg-bg-surface'
      }`}
      onClick={onSelect}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-info text-[10px] font-bold">AI</span>
          <span className="text-text-secondary truncate text-xs">{session.prompt}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-wider uppercase ${statusColors[session.status]}`}
          >
            {session.status}
          </span>
          <span className="text-text-ghost text-[10px]">{session.id.slice(-6)}</span>
        </div>
      </div>
    </button>
  );
}

// ─── Claude Prompt Input ───

function ClaudePromptInput({ onSubmit }: { onSubmit: (prompt: string) => void }) {
  const [prompt, setPrompt] = useState('');
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        data-testid="new-claude-btn"
        className="bg-info hover:bg-info/90 w-full rounded-lg px-3 py-2 text-xs font-semibold text-white transition-colors [-webkit-app-region:no-drag]"
        onClick={() => setOpen(true)}
      >
        + Claude Session
      </button>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setPrompt('');
    setOpen(false);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <input
        data-testid="claude-prompt-input"
        autoFocus
        type="text"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="What should Claude do?"
        className="bg-bg-surface border-border text-text-secondary placeholder:text-text-ghost focus:border-info rounded-lg border px-3 py-2 text-xs outline-none"
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!prompt.trim()}
          className="bg-info hover:bg-info/90 flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-40"
        >
          Start
        </button>
        <button
          type="button"
          className="text-text-faint hover:text-text-muted rounded-lg px-3 py-1.5 text-xs transition-colors"
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Sidebar ───

function SessionSidebar({
  sessions,
  activeSessionId,
  claudeSessions,
  activeClaudeId,
  powerBlock,
  websocket,
  viewMode,
  onNewSession,
  onNewClaudeSession,
  onSelectSession,
  onStopSession,
  onSelectClaudeSession,
  onTogglePower,
}: SessionSidebarProps) {
  const activeSessions = sessions.filter((s) => s.status === 'active');
  const completedSessions = sessions.filter((s) => s.status !== 'active');
  const runningClaude = claudeSessions.filter((s) => s.status === 'running');
  const doneClaude = claudeSessions.filter((s) => s.status !== 'running');

  return (
    <div
      data-testid="session-sidebar"
      className="bg-bg-card border-border flex h-full flex-col border-r"
    >
      {/* Action Buttons */}
      <div className="border-border flex flex-col gap-2 border-b p-3">
        <button
          data-testid="new-session-btn"
          className="bg-accent hover:bg-accent/90 w-full rounded-lg px-3 py-2 text-xs font-semibold text-white transition-colors [-webkit-app-region:no-drag]"
          onClick={onNewSession}
        >
          + New Session
        </button>
        <ClaudePromptInput onSubmit={onNewClaudeSession} />
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-y-auto p-3">
        {sessions.length === 0 && claudeSessions.length === 0 ? (
          <p data-testid="no-sessions" className="text-text-dim py-4 text-center text-xs">
            No sessions yet
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {/* Claude sessions — running */}
            {runningClaude.map((s) => (
              <ClaudeCard
                key={s.id}
                session={s}
                active={viewMode === 'claude' && s.id === activeClaudeId}
                onSelect={() => onSelectClaudeSession(s.id)}
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
                <div className="border-border my-1 border-t" />
              )}

            {/* Claude sessions — done */}
            {doneClaude.map((s) => (
              <ClaudeCard
                key={s.id}
                session={s}
                active={viewMode === 'claude' && s.id === activeClaudeId}
                onSelect={() => onSelectClaudeSession(s.id)}
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
