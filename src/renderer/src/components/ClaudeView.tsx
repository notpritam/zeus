import { useState, useRef, useEffect } from 'react';
import Markdown from '@/components/Markdown';
import type {
  NormalizedEntry,
  NormalizedEntryType,
  ActionType,
  ClaudeApprovalInfo,
  ClaudeSessionInfo,
} from '../../../shared/types';

// ─── Entry Renderers ───

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="bg-accent/15 border-accent-border max-w-[80%] rounded-xl rounded-br-sm border px-3 py-2">
        <p className="text-text-secondary text-sm whitespace-pre-wrap">{content}</p>
      </div>
    </div>
  );
}

function AssistantBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-start">
      <div className="bg-bg-card border-border max-w-[85%] rounded-xl rounded-bl-sm border px-3 py-2">
        <Markdown content={content} />
      </div>
    </div>
  );
}

function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const preview = content.slice(0, 120);

  return (
    <button
      className="bg-bg-surface border-border w-full rounded-lg border px-3 py-2 text-left"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="text-text-dim flex items-center gap-2 text-xs">
        <span className="text-info">&#9672;</span>
        <span className="font-medium">Thinking</span>
        <span className="text-text-ghost text-[10px]">{expanded ? 'collapse' : 'expand'}</span>
      </div>
      {expanded ? (
        <div className="text-text-faint mt-1 text-xs">
          <Markdown content={content} />
        </div>
      ) : (
        <p className="text-text-faint mt-1 text-xs whitespace-pre-wrap">
          {preview + (content.length > 120 ? '...' : '')}
        </p>
      )}
    </button>
  );
}

function toolActionLabel(actionType: ActionType): string {
  switch (actionType.action) {
    case 'file_read':
      return `Read ${actionType.path}`;
    case 'file_edit':
      return `Edit ${actionType.path}`;
    case 'command_run':
      return `$ ${actionType.command}`;
    case 'search':
      return `Search: ${actionType.query}`;
    case 'web_fetch':
      return `Fetch: ${actionType.url}`;
    case 'task_create':
      return `Agent: ${actionType.description}`;
    case 'plan_presentation':
      return 'Plan';
    case 'other':
      return actionType.description;
  }
}

function ToolCard({ entryType, content }: { entryType: NormalizedEntryType; content: string }) {
  if (entryType.type !== 'tool_use') return null;
  const { toolName, actionType, status } = entryType;

  const statusLabel = typeof status === 'string' ? status : status.status;
  const statusColor =
    statusLabel === 'success'
      ? 'text-accent'
      : statusLabel === 'failed' || statusLabel === 'denied'
        ? 'text-danger'
        : statusLabel === 'pending_approval'
          ? 'text-warn'
          : 'text-text-dim';

  return (
    <div className="bg-bg-surface border-border rounded-lg border px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="bg-info-bg text-info rounded px-1.5 py-0.5 text-[10px] font-semibold">
            {toolName}
          </span>
          <span className="text-text-muted truncate font-mono text-xs">
            {toolActionLabel(actionType)}
          </span>
        </div>
        <span className={`text-[10px] font-semibold uppercase ${statusColor}`}>{statusLabel}</span>
      </div>
      {content && !content.startsWith(toolName) && (
        <p className="text-text-dim mt-1 truncate text-xs">{content}</p>
      )}
    </div>
  );
}

function TokenUsageBar({ entryType }: { entryType: NormalizedEntryType }) {
  if (entryType.type !== 'token_usage') return null;
  const pct = Math.min((entryType.totalTokens / entryType.contextWindow) * 100, 100);

  return (
    <div className="bg-bg-surface border-border rounded-lg border px-3 py-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-dim">Tokens used</span>
        <span className="text-text-muted font-mono">
          {entryType.totalTokens.toLocaleString()} / {entryType.contextWindow.toLocaleString()}
        </span>
      </div>
      <div className="bg-bg-elevated mt-1.5 h-1 overflow-hidden rounded-full">
        <div
          className="bg-accent h-full rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function EntryItem({ entry }: { entry: NormalizedEntry }) {
  switch (entry.entryType.type) {
    case 'user_message':
      return <UserBubble content={entry.content} />;
    case 'assistant_message':
      return <AssistantBubble content={entry.content} />;
    case 'thinking':
      return <ThinkingBlock content={entry.content} />;
    case 'tool_use':
      return <ToolCard entryType={entry.entryType} content={entry.content} />;
    case 'token_usage':
      return <TokenUsageBar entryType={entry.entryType} />;
    case 'system_message':
      return <div className="text-text-dim text-center text-xs italic">{entry.content}</div>;
    case 'error_message':
      return (
        <div className="bg-danger-bg border-danger-border text-danger rounded-lg border px-3 py-2 text-sm">
          {entry.content}
        </div>
      );
    case 'loading':
      return (
        <div className="text-text-dim flex items-center gap-2 text-sm">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Working...
        </div>
      );
    default:
      return null;
  }
}

// ─── Approval Banner ───

function ApprovalBanner({
  approval,
  onApprove,
  onDeny,
}: {
  approval: ClaudeApprovalInfo;
  onApprove: () => void;
  onDeny: () => void;
}) {
  return (
    <div className="bg-warn-bg border-warn-border flex items-center justify-between rounded-lg border px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-warn text-xs font-semibold">Tool Approval Required</p>
        <p className="text-text-muted mt-0.5 truncate font-mono text-xs">{approval.toolName}</p>
      </div>
      <div className="flex gap-2">
        <button
          className="bg-accent hover:bg-accent/90 rounded px-3 py-1 text-xs font-semibold text-white transition-colors"
          onClick={onApprove}
        >
          Allow
        </button>
        <button
          className="bg-danger hover:bg-danger/90 rounded px-3 py-1 text-xs font-semibold text-white transition-colors"
          onClick={onDeny}
        >
          Deny
        </button>
      </div>
    </div>
  );
}

// ─── Main ClaudeView ───

interface ClaudeViewProps {
  session: ClaudeSessionInfo | null;
  entries: NormalizedEntry[];
  approvals: ClaudeApprovalInfo[];
  onSendMessage: (content: string) => void;
  onApprove: (approvalId: string) => void;
  onDeny: (approvalId: string) => void;
  onInterrupt: () => void;
}

function ClaudeView({
  session,
  entries,
  approvals,
  onSendMessage,
  onApprove,
  onDeny,
  onInterrupt,
}: ClaudeViewProps) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length]);

  if (!session) {
    return (
      <div
        data-testid="claude-empty"
        className="bg-bg text-text-dim flex h-full flex-col items-center justify-center gap-2"
      >
        <p className="text-lg font-semibold">Claude Code</p>
        <p className="text-sm">Start a new Claude session from the sidebar</p>
      </div>
    );
  }

  const sessionApprovals = approvals.filter((a) => a.sessionId === session.id);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setInput('');
  };

  return (
    <div data-testid="claude-view" className="bg-bg flex h-full flex-col">
      {/* Header bar */}
      <div className="border-border bg-bg-card flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-info text-sm font-bold">Claude</span>
          <span
            className={`rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-wider uppercase ${
              session.status === 'running'
                ? 'bg-accent-bg text-accent'
                : session.status === 'done'
                  ? 'bg-bg-surface text-text-faint'
                  : 'bg-danger-bg text-danger'
            }`}
          >
            {session.status}
          </span>
        </div>
        {session.status === 'running' && (
          <button
            className="text-text-faint hover:text-danger text-xs transition-colors"
            onClick={onInterrupt}
          >
            Interrupt
          </button>
        )}
      </div>

      {/* Entry list */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {entries.map((entry) => (
          <EntryItem key={entry.id} entry={entry} />
        ))}

        {entries.length === 0 && session.status === 'running' && (
          <div className="text-text-dim flex items-center gap-2 text-sm">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Starting Claude session...
          </div>
        )}
      </div>

      {/* Approval banners */}
      {sessionApprovals.length > 0 && (
        <div className="border-border space-y-2 border-t px-4 py-2">
          {sessionApprovals.map((a) => (
            <ApprovalBanner
              key={a.approvalId}
              approval={a}
              onApprove={() => onApprove(a.approvalId)}
              onDeny={() => onDeny(a.approvalId)}
            />
          ))}
        </div>
      )}

      {/* Input bar */}
      <form
        onSubmit={handleSubmit}
        className="border-border bg-bg-card flex gap-2 border-t px-4 py-3"
      >
        <input
          data-testid="claude-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={session.status === 'running' ? 'Send follow-up...' : 'Session ended'}
          disabled={session.status !== 'running'}
          className="bg-bg-surface border-border text-text-secondary placeholder:text-text-ghost focus:border-info min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm outline-none disabled:opacity-50"
        />
        <button
          data-testid="claude-send"
          type="submit"
          disabled={session.status !== 'running' || !input.trim()}
          className="bg-info hover:bg-info/90 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}

export default ClaudeView;
