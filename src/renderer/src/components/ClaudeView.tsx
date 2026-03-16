import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Send, Loader2, Brain, ShieldAlert, Check, X, StopCircle, File, Folder, Copy, ClipboardCheck, RotateCcw, ChevronDown, ChevronUp, ImagePlus, Pencil, Trash2, Terminal, Sparkles } from 'lucide-react';
import Markdown from '@/components/Markdown';
import FileMentionPopover from '@/components/FileMentionPopover';
import type {
  NormalizedEntry,
  NormalizedEntryType,
  ActionType,
  ClaudeApprovalInfo,
  ClaudeSessionInfo,
  SessionActivity,
} from '../../../shared/types';

// ─── Entry Renderers ───

function CopyAction({ text, align = 'left' }: { text: string; align?: 'left' | 'right' }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={`flex ${align === 'right' ? 'justify-end' : 'justify-start'} ${copied ? '' : 'opacity-0 group-hover/msg:opacity-100'} transition-opacity`}>
      <button
        onClick={handleCopy}
        className="text-muted-foreground hover:text-foreground mt-1 flex items-center gap-1 px-1 text-[10px] transition-colors"
      >
        {copied ? <ClipboardCheck className="size-3" /> : <Copy className="size-3" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

const USER_BUBBLE_MAX_H = 150; // px – collapsed height limit

function UserBubble({ content, metadata }: { content: string; metadata?: unknown }) {
  const meta = metadata as { files?: string[]; images?: Array<{ filename: string; dataUrl: string }> } | undefined;
  const files = meta?.files;
  const images = meta?.images;
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const contentRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (contentRef.current) {
      setOverflows(contentRef.current.scrollHeight > USER_BUBBLE_MAX_H);
    }
  }, [content]);

  return (
    <div className="group/msg flex flex-col items-end">
      <div className="bg-primary/10 border-primary/20 max-w-[80%] rounded-xl rounded-br-sm border px-3 py-2">
        {images && images.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {images.map((img, i) => (
              <img
                key={i}
                src={img.dataUrl}
                alt={img.filename}
                className="max-h-40 rounded-md border border-primary/20 object-cover"
              />
            ))}
          </div>
        )}
        <div className="relative">
          <p
            ref={contentRef}
            className="text-foreground select-text text-sm whitespace-pre-wrap overflow-hidden transition-[max-height] duration-200"
            style={{ maxHeight: expanded || !overflows ? 'none' : `${USER_BUBBLE_MAX_H}px` }}
          >
            {content}
          </p>
          {overflows && !expanded && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-primary/10 to-transparent" />
          )}
        </div>
        {overflows && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-muted-foreground hover:text-foreground mt-1 flex items-center gap-0.5 text-[10px] transition-colors"
          >
            {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
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
      <CopyAction text={content} align="right" />
    </div>
  );
}

function AssistantBubble({ content }: { content: string }) {
  return (
    <div className="group/msg flex flex-col items-start">
      <div className="bg-card border-border max-w-[85%] rounded-xl rounded-bl-sm border px-3 py-2">
        <div className="select-text">
          <Markdown content={content} />
        </div>
      </div>
      <CopyAction text={content} align="left" />
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
        <div className="text-muted-foreground mt-1 select-text text-xs">
          <Markdown content={content} />
        </div>
      ) : (
        <p className="text-muted-foreground mt-1 select-text text-xs whitespace-pre-wrap">
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
  const [expanded, setExpanded] = useState(false);

  const statusLabel = typeof status === 'string' ? status : status.status;
  const isRunning = statusLabel === 'created';
  const isPending = statusLabel === 'pending_approval';
  const isDenied = statusLabel === 'denied';
  const isFailed = statusLabel === 'failed';

  const borderColor =
    isPending ? 'border-orange-400/40 bg-orange-400/5' :
    isDenied ? 'border-red-400/40 bg-red-400/5' :
    isFailed ? 'border-red-400/30' :
    isRunning ? 'border-primary/30' :
    '';

  const statusDotColor =
    isRunning ? 'bg-primary' :
    isPending ? 'bg-orange-400' :
    statusLabel === 'success' ? 'bg-green-400' :
    (isDenied || isFailed) ? 'bg-red-400' :
    'bg-muted-foreground';

  // Extract meaningful detail from actionType
  const detail = toolActionLabel(actionType);
  const hasContent = content && !content.startsWith(toolName) && content.length > 0;

  return (
    <div className={`bg-secondary border-border rounded-lg border px-3 py-2 ${borderColor}`}>
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`inline-block size-1.5 shrink-0 rounded-full ${statusDotColor} ${(isRunning || isPending) ? 'animate-pulse' : ''}`} />
          <span className={`text-[10px] font-semibold ${isRunning ? 'zeus-shimmer-accent' : isPending ? 'text-orange-400' : 'text-primary'}`}>
            {toolName}
          </span>
          <span className={`min-w-0 truncate font-mono text-xs ${isRunning ? 'zeus-shimmer' : 'text-muted-foreground'}`}>
            {detail}
          </span>
        </div>
        {hasContent && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-muted-foreground hover:text-foreground shrink-0 transition-colors"
          >
            {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          </button>
        )}
      </div>

      {/* Expanded content — show tool output/details */}
      {expanded && hasContent && (
        <div className="border-border mt-2 max-h-60 overflow-auto rounded border bg-black/20 p-2">
          <pre className="text-muted-foreground whitespace-pre-wrap font-mono text-[11px]">{content}</pre>
        </div>
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

function formatApprovalDetail(approval: ClaudeApprovalInfo): { label: string; detail: string; body?: string } {
  const input = approval.toolInput as Record<string, unknown> | null;
  if (!input) return { label: approval.toolName, detail: '' };

  switch (approval.toolName) {
    case 'Edit':
    case 'Write':
      return {
        label: approval.toolName === 'Edit' ? 'Edit File' : 'Write File',
        detail: (input.file_path as string) ?? '',
        body: input.new_string != null
          ? `- ${String(input.old_string ?? '').slice(0, 120)}\n+ ${String(input.new_string).slice(0, 120)}`
          : input.content != null
            ? String(input.content).slice(0, 200)
            : undefined,
      };
    case 'Bash':
      return {
        label: 'Run Command',
        detail: String(input.command ?? ''),
      };
    case 'Read':
      return {
        label: 'Read File',
        detail: (input.file_path as string) ?? '',
      };
    case 'Glob':
    case 'Grep':
      return {
        label: approval.toolName === 'Glob' ? 'Find Files' : 'Search',
        detail: String(input.pattern ?? input.query ?? ''),
      };
    case 'WebFetch':
      return {
        label: 'Fetch URL',
        detail: String(input.url ?? ''),
      };
    case 'AskUserQuestion':
      return {
        label: 'Question',
        detail: String(input.question ?? ''),
      };
    default:
      return {
        label: approval.toolName,
        detail: JSON.stringify(input).slice(0, 150),
      };
  }
}

function ApprovalBanner({
  approval,
  onApprove,
  onDeny,
}: {
  approval: ClaudeApprovalInfo;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const { label, detail, body } = formatApprovalDetail(approval);
  const [showBody, setShowBody] = useState(true);

  return (
    <div className="zeus-attention-approval border-warn-border overflow-hidden rounded-lg border">
      {/* Header */}
      <div className="bg-warn-bg flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <ShieldAlert className="text-warn size-4 shrink-0 animate-pulse" />
          <span className="text-warn text-xs font-semibold">{label}</span>
        </div>
        <div className="flex shrink-0 gap-2">
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

      {/* Detail — file path, command, etc. */}
      {detail && (
        <div className="bg-warn-bg/50 border-warn-border border-t px-3 py-1.5">
          <p className="text-foreground truncate font-mono text-xs">{detail}</p>
        </div>
      )}

      {/* Body — diff preview, content, etc. */}
      {body && (
        <div className="border-warn-border border-t">
          <button
            onClick={() => setShowBody(!showBody)}
            className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1 px-3 py-1 text-[10px]"
          >
            {showBody ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            {showBody ? 'Hide changes' : 'Show changes'}
          </button>
          {showBody && (
            <pre className="text-muted-foreground max-h-40 overflow-auto px-3 pb-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
              {body}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main ClaudeView ───

// ─── Text Shimmer (opencode-style) ───

function TextShimmer({ text, active = true }: { text: string; active?: boolean }) {
  return <span className={active ? 'zeus-shimmer' : 'text-muted-foreground'}>{text}</span>;
}

// ─── Activity Indicator ───

function ActivityIndicator({ activity }: { activity: SessionActivity }) {
  if (activity.state === 'idle') return null;

  return (
    <div className="flex justify-start">
      <div className="bg-card border-border inline-flex items-center gap-2.5 rounded-xl rounded-bl-sm border px-3 py-2">
        {/* Icon */}
        {activity.state === 'thinking' && <Brain className="text-primary size-3.5" />}
        {activity.state === 'streaming' && <Sparkles className="text-primary size-3.5" />}
        {activity.state === 'tool_running' && <Terminal className="text-primary size-3.5" />}
        {activity.state === 'waiting_approval' && <ShieldAlert className="text-warn size-3.5" />}
        {activity.state === 'starting' && <Loader2 className="text-primary size-3.5 animate-spin" />}

        {/* Shimmer label */}
        <span className="text-xs font-medium">
          {activity.state === 'thinking' && <TextShimmer text="Thinking..." />}
          {activity.state === 'streaming' && <TextShimmer text="Writing..." />}
          {activity.state === 'tool_running' && <TextShimmer text={activity.description} />}
          {activity.state === 'waiting_approval' && (
            <span className="text-warn">Waiting for approval: {activity.toolName}</span>
          )}
          {activity.state === 'starting' && <TextShimmer text="Starting session..." />}
        </span>
      </div>
    </div>
  );
}

// ─── Queue Item ───

function QueuedMessageItem({
  msg,
  onEdit,
  onRemove,
}: {
  msg: { id: string; content: string };
  onEdit: (id: string, content: string) => void;
  onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(msg.content);

  const handleSave = () => {
    onEdit(msg.id, editValue);
    setEditing(false);
  };

  return (
    <div className="bg-secondary/50 border-border flex items-start gap-2 rounded-lg border px-3 py-2">
      <Badge variant="outline" className="text-[9px] shrink-0 mt-0.5">queued</Badge>
      {editing ? (
        <div className="flex min-w-0 flex-1 gap-1">
          <Input
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            className="text-xs h-7"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false); }}
          />
          <Button size="xs" onClick={handleSave}><Check className="size-3" /></Button>
          <Button size="xs" variant="ghost" onClick={() => setEditing(false)}><X className="size-3" /></Button>
        </div>
      ) : (
        <>
          <p className="text-foreground min-w-0 flex-1 truncate text-xs">{msg.content}</p>
          <button onClick={() => { setEditValue(msg.content); setEditing(true); }} className="text-muted-foreground hover:text-foreground shrink-0">
            <Pencil className="size-3" />
          </button>
          <button onClick={() => onRemove(msg.id)} className="text-muted-foreground hover:text-destructive shrink-0">
            <Trash2 className="size-3" />
          </button>
        </>
      )}
    </div>
  );
}

const ACCEPTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

interface ImageAttachmentLocal {
  id: string;
  filename: string;
  mediaType: string;
  dataUrl: string;
}

function fileToDataUrl(file: globalThis.File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result as string));
    reader.readAsDataURL(file);
  });
}

interface ClaudeViewProps {
  session: ClaudeSessionInfo | null;
  entries: NormalizedEntry[];
  approvals: ClaudeApprovalInfo[];
  activity: SessionActivity;
  queue: Array<{ id: string; content: string }>;
  onSendMessage: (content: string, files?: string[], images?: Array<{ filename: string; mediaType: string; dataUrl: string }>) => void;
  onApprove: (approvalId: string) => void;
  onDeny: (approvalId: string) => void;
  onInterrupt: () => void;
  onResume: () => void;
  onQueueMessage: (content: string) => void;
  onEditQueued: (id: string, content: string) => void;
  onRemoveQueued: (id: string) => void;
}

function ClaudeView({
  session,
  entries,
  approvals,
  activity,
  queue,
  onSendMessage,
  onApprove,
  onDeny,
  onInterrupt,
  onResume,
  onQueueMessage,
  onEditQueued,
  onRemoveQueued,
}: ClaudeViewProps) {
  const [input, setInput] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<Array<{ path: string; type: 'file' | 'directory' }>>([]);
  const [attachedImages, setAttachedImages] = useState<ImageAttachmentLocal[]>([]);
  const [showMentionPopover, setShowMentionPopover] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

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

  const addImageFiles = useCallback(async (files: globalThis.File[]) => {
    for (const file of files) {
      if (!ACCEPTED_IMAGE_TYPES.has(file.type)) continue;
      const dataUrl = await fileToDataUrl(file);
      setAttachedImages((prev) => [
        ...prev,
        { id: `img-${Date.now()}-${Math.random()}`, filename: file.name, mediaType: file.type, dataUrl },
      ]);
    }
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles: globalThis.File[] = [];
      for (const item of items) {
        if (item.kind === 'file' && ACCEPTED_IMAGE_TYPES.has(item.type)) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        addImageFiles(imageFiles);
      }
    },
    [addImageFiles],
  );

  const handleImagePick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      addImageFiles(files);
      e.target.value = '';
    },
    [addImageFiles],
  );

  const removeImage = useCallback((id: string) => {
    setAttachedImages((prev) => prev.filter((img) => img.id !== id));
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

  const isBusy = session?.status === 'running' && activity.state !== 'idle';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed && attachedFiles.length === 0 && attachedImages.length === 0) return;

    if (isBusy && attachedFiles.length === 0 && attachedImages.length === 0) {
      // Queue text-only messages when busy
      onQueueMessage(trimmed);
    } else {
      onSendMessage(
        trimmed,
        attachedFiles.length > 0 ? attachedFiles.map((f) => f.path) : undefined,
        attachedImages.length > 0 ? attachedImages.map((img) => ({ filename: img.filename, mediaType: img.mediaType, dataUrl: img.dataUrl })) : undefined,
      );
    }
    setInput('');
    setAttachedFiles([]);
    setAttachedImages([]);
    setShowMentionPopover(false);
  };

  return (
    <div data-testid="claude-view" className="bg-background flex h-full flex-col">
      {/* Header bar */}
      <div className="border-border bg-card flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-primary text-sm font-bold">Claude</span>
        </div>
        <div className="flex items-center gap-2">
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
          {(session.status === 'error' || session.status === 'done') && (
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground hover:text-primary"
              onClick={onResume}
            >
              <RotateCcw className="size-3" />
              Resume
            </Button>
          )}
        </div>
      </div>

      {/* Entry list */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {entries.map((entry) => (
          <EntryItem key={entry.id} entry={entry} />
        ))}

        {/* Activity indicator */}
        {session.status === 'running' && entries.length > 0 && (
          <ActivityIndicator activity={activity} />
        )}

        {/* Queued messages */}
        {queue.length > 0 && (
          <div className="space-y-2">
            {queue.map((msg) => (
              <QueuedMessageItem key={msg.id} msg={msg} onEdit={onEditQueued} onRemove={onRemoveQueued} />
            ))}
          </div>
        )}

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

      {/* Activity bar — always visible at bottom when busy */}
      {isBusy && (
        <div className="border-border flex items-center gap-2 border-t px-4 py-1.5">
          <Sparkles className={`size-3.5 animate-pulse ${
            activity.state === 'thinking' ? 'text-yellow-400' :
            activity.state === 'streaming' ? 'text-green-400' :
            activity.state === 'tool_running' ? 'text-blue-400' :
            activity.state === 'waiting_approval' ? 'text-orange-400' :
            'text-purple-400'
          }`} />
          <span className="text-muted-foreground text-xs font-medium">
            {activity.state === 'thinking' && 'Thinking...'}
            {activity.state === 'streaming' && 'Writing...'}
            {activity.state === 'tool_running' && activity.description}
            {activity.state === 'waiting_approval' && `Approval: ${activity.toolName}`}
            {activity.state === 'starting' && 'Starting...'}
          </span>
        </div>
      )}

      {/* Input area */}
      <div className="border-border bg-card border-t">
        {(session.status === 'error' || session.status === 'done') ? (
          <div className="flex items-center justify-between px-4 py-3">
            <p className="text-muted-foreground text-sm">
              {session.status === 'error' ? 'Session errored out.' : 'Session ended.'}
            </p>
            <Button size="sm" variant="outline" onClick={onResume}>
              <RotateCcw className="size-3" />
              Resume Session
            </Button>
          </div>
        ) : (
          <>
            {/* Attached file chips + image thumbnails */}
            {(attachedFiles.length > 0 || attachedImages.length > 0) && (
              <div className="flex flex-wrap gap-1.5 px-4 pt-2">
                {attachedImages.map((img) => (
                  <div key={img.id} className="group/thumb relative">
                    <img
                      src={img.dataUrl}
                      alt={img.filename}
                      className="h-16 w-16 rounded-md border border-border object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(img.id)}
                      className="absolute -right-1 -top-1 hidden rounded-full bg-destructive p-0.5 text-white group-hover/thumb:block"
                    >
                      <X className="size-2.5" />
                    </button>
                  </div>
                ))}
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
            <form onSubmit={handleSubmit} className="relative flex items-center gap-2 px-4 py-3">
              {showMentionPopover && session.status === 'running' && (
                <FileMentionPopover
                  sessionId={session.id}
                  initialQuery={mentionQuery}
                  onSelect={handleFileSelect}
                  onClose={() => setShowMentionPopover(false)}
                />
              )}
              <input
                ref={imageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                multiple
                className="hidden"
                onChange={handleImagePick}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground size-8 shrink-0"
                onClick={() => imageInputRef.current?.click()}
                disabled={session.status !== 'running'}
              >
                <ImagePlus className="size-4" />
              </Button>
              <Input
                ref={inputRef}
                data-testid="claude-input"
                value={input}
                onChange={handleInputChange}
                onPaste={handlePaste}
                placeholder="Send follow-up... (@ files, paste images)"
                disabled={session.status !== 'running'}
                className="text-sm"
              />
              <Button
                data-testid="claude-send"
                type="submit"
                disabled={session.status !== 'running' || (!input.trim() && attachedFiles.length === 0 && attachedImages.length === 0)}
                size="sm"
                variant={isBusy ? 'secondary' : 'default'}
              >
                <Send className="size-3" />
                {isBusy ? 'Queue' : 'Send'}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default ClaudeView;
