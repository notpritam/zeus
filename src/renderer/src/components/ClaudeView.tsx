import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Send, Loader2, Brain, ShieldAlert, Check, X, StopCircle, File, Folder } from 'lucide-react';
import Markdown from '@/components/Markdown';
import FileMentionPopover from '@/components/FileMentionPopover';
import type {
  NormalizedEntry,
  NormalizedEntryType,
  ActionType,
  ClaudeApprovalInfo,
  ClaudeSessionInfo,
} from '../../../shared/types';

// ─── Entry Renderers ───

function UserBubble({ content, metadata }: { content: string; metadata?: unknown }) {
  const files = (metadata as { files?: string[] } | undefined)?.files;
  return (
    <div className="flex justify-end">
      <div className="bg-primary/10 border-primary/20 max-w-[80%] rounded-xl rounded-br-sm border px-3 py-2">
        <p className="text-foreground text-sm whitespace-pre-wrap">{content}</p>
        {files && files.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {files.map((f) => (
              <Badge key={f} variant="outline" className="gap-1 text-[10px]">
                <File className="size-2.5" />
                {f.split('/').pop()}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AssistantBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-start">
      <div className="bg-card border-border max-w-[85%] rounded-xl rounded-bl-sm border px-3 py-2">
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
      className="bg-secondary border-border w-full rounded-lg border px-3 py-2 text-left"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <Brain className="text-primary size-3" />
        <span className="font-medium">Thinking</span>
        <span className="text-muted-foreground/50 text-[10px]">{expanded ? 'collapse' : 'expand'}</span>
      </div>
      {expanded ? (
        <div className="text-muted-foreground mt-1 text-xs">
          <Markdown content={content} />
        </div>
      ) : (
        <p className="text-muted-foreground mt-1 text-xs whitespace-pre-wrap">
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
  const statusVariant: Record<string, 'default' | 'secondary' | 'destructive'> = {
    success: 'default',
    pending_approval: 'secondary',
    failed: 'destructive',
    denied: 'destructive',
  };

  return (
    <div className="bg-secondary border-border rounded-lg border px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-primary text-[10px] font-semibold">
            {toolName}
          </Badge>
          <span className="text-muted-foreground truncate font-mono text-xs">
            {toolActionLabel(actionType)}
          </span>
        </div>
        <Badge
          variant={statusVariant[statusLabel] ?? 'secondary'}
          className="text-[9px] uppercase tracking-wider"
        >
          {statusLabel}
        </Badge>
      </div>
      {content && !content.startsWith(toolName) && (
        <p className="text-muted-foreground mt-1 truncate text-xs">{content}</p>
      )}
    </div>
  );
}

function TokenUsageBar({ entryType }: { entryType: NormalizedEntryType }) {
  if (entryType.type !== 'token_usage') return null;
  const pct = Math.min((entryType.totalTokens / entryType.contextWindow) * 100, 100);

  return (
    <div className="bg-secondary border-border rounded-lg border px-3 py-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Tokens used</span>
        <span className="text-foreground font-mono">
          {entryType.totalTokens.toLocaleString()} / {entryType.contextWindow.toLocaleString()}
        </span>
      </div>
      <div className="bg-muted mt-1.5 h-1 overflow-hidden rounded-full">
        <div
          className="bg-primary h-full rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function EntryItem({ entry }: { entry: NormalizedEntry }) {
  switch (entry.entryType.type) {
    case 'user_message':
      return <UserBubble content={entry.content} metadata={entry.metadata} />;
    case 'assistant_message':
      return <AssistantBubble content={entry.content} />;
    case 'thinking':
      return <ThinkingBlock content={entry.content} />;
    case 'tool_use':
      return <ToolCard entryType={entry.entryType} content={entry.content} />;
    case 'token_usage':
      return <TokenUsageBar entryType={entry.entryType} />;
    case 'system_message':
      return <div className="text-muted-foreground text-center text-xs italic">{entry.content}</div>;
    case 'error_message':
      return (
        <div className="bg-destructive/10 border-destructive/20 text-destructive rounded-lg border px-3 py-2 text-sm">
          {entry.content}
        </div>
      );
    case 'loading':
      return (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-3 animate-spin" />
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
        <div className="flex items-center gap-2">
          <ShieldAlert className="text-warn size-4 shrink-0" />
          <p className="text-warn text-xs font-semibold">Tool Approval Required</p>
        </div>
        <p className="text-muted-foreground mt-0.5 truncate font-mono text-xs">{approval.toolName}</p>
      </div>
      <div className="flex gap-2">
        <Button
          size="xs"
          className="bg-accent text-white hover:bg-accent/90"
          onClick={onApprove}
        >
          <Check className="size-3" />
          Allow
        </Button>
        <Button size="xs" variant="destructive" onClick={onDeny}>
          <X className="size-3" />
          Deny
        </Button>
      </div>
    </div>
  );
}

// ─── Main ClaudeView ───

interface ClaudeViewProps {
  session: ClaudeSessionInfo | null;
  entries: NormalizedEntry[];
  approvals: ClaudeApprovalInfo[];
  onSendMessage: (content: string, files?: string[]) => void;
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
  const [attachedFiles, setAttachedFiles] = useState<Array<{ path: string; type: 'file' | 'directory' }>>([]);
  const [showMentionPopover, setShowMentionPopover] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInput(value);

    const cursorPos = e.target.selectionStart ?? value.length;
    const beforeCursor = value.substring(0, cursorPos);
    const atMatch = beforeCursor.match(/@(\S*)$/);
    if (atMatch) {
      setShowMentionPopover(true);
      setMentionQuery(atMatch[1]);
    } else {
      setShowMentionPopover(false);
    }
  }, []);

  const handleFileSelect = useCallback((filePath: string, type: 'file' | 'directory') => {
    setAttachedFiles((prev) => {
      if (prev.some((f) => f.path === filePath)) return prev;
      return [...prev, { path: filePath, type }];
    });
    // Remove the @query text from input
    setInput((prev) => prev.replace(/@\S*$/, ''));
    setShowMentionPopover(false);
    // Refocus the input
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const removeFile = useCallback((filePath: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.path !== filePath));
  }, []);

  if (!session) {
    return (
      <div
        data-testid="claude-empty"
        className="bg-background text-muted-foreground flex h-full flex-col items-center justify-center gap-2"
      >
        <p className="text-lg font-semibold">Claude Code</p>
        <p className="text-sm">Start a new Claude session from the sidebar</p>
      </div>
    );
  }

  const statusVariant: Record<string, 'default' | 'secondary' | 'destructive'> = {
    running: 'default',
    done: 'secondary',
    error: 'destructive',
  };

  const sessionApprovals = approvals.filter((a) => a.sessionId === session.id);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed && attachedFiles.length === 0) return;
    onSendMessage(trimmed, attachedFiles.length > 0 ? attachedFiles.map((f) => f.path) : undefined);
    setInput('');
    setAttachedFiles([]);
    setShowMentionPopover(false);
  };

  return (
    <div data-testid="claude-view" className="bg-background flex h-full flex-col">
      {/* Header bar */}
      <div className="border-border bg-card flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-primary text-sm font-bold">Claude</span>
          <Badge
            variant={statusVariant[session.status] ?? 'secondary'}
            className="text-[9px] uppercase tracking-wider"
          >
            {session.status}
          </Badge>
        </div>
        {session.status === 'running' && (
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground hover:text-destructive"
            onClick={onInterrupt}
          >
            <StopCircle className="size-3" />
            Interrupt
          </Button>
        )}
      </div>

      {/* Entry list */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {entries.map((entry) => (
          <EntryItem key={entry.id} entry={entry} />
        ))}

        {entries.length === 0 && session.status === 'running' && (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-3 animate-spin" />
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

      {/* Input area */}
      <div className="border-border bg-card border-t">
        {/* Attached file chips */}
        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-4 pt-2">
            {attachedFiles.map((f) => (
              <Badge key={f.path} variant="secondary" className="gap-1 text-xs">
                {f.type === 'directory' ? <Folder className="size-3" /> : <File className="size-3" />}
                {f.path}
                <button
                  type="button"
                  onClick={() => removeFile(f.path)}
                  className="hover:text-destructive ml-0.5"
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}

        {/* Input bar with popover */}
        <form onSubmit={handleSubmit} className="relative flex gap-2 px-4 py-3">
          {showMentionPopover && session.status === 'running' && (
            <FileMentionPopover
              sessionId={session.id}
              initialQuery={mentionQuery}
              onSelect={handleFileSelect}
              onClose={() => setShowMentionPopover(false)}
            />
          )}
          <Input
            ref={inputRef}
            data-testid="claude-input"
            value={input}
            onChange={handleInputChange}
            placeholder={session.status === 'running' ? 'Send follow-up... (@ to attach files)' : 'Session ended'}
            disabled={session.status !== 'running'}
            className="text-sm"
          />
          <Button
            data-testid="claude-send"
            type="submit"
            disabled={session.status !== 'running' || (!input.trim() && attachedFiles.length === 0)}
            size="sm"
          >
            <Send className="size-3" />
            Send
          </Button>
        </form>
      </div>
    </div>
  );
}

export default ClaudeView;
