import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Send, Loader2, Brain, Check, X, StopCircle, File, Folder, Copy, ClipboardCheck, RotateCcw, ChevronDown, ChevronUp, ImagePlus, Pencil, Trash2, Sparkles, Minimize2, Maximize2 } from 'lucide-react';
import Markdown from '@/components/Markdown';
import FileMentionPopover from '@/components/FileMentionPopover';
import ApprovalCard from '@/components/ApprovalCard';
import { ToolCard } from '@/components/ToolCard';
import { ImageLightbox, useLightbox } from '@/components/ImageLightbox';
import { useZeusStore } from '@/stores/useZeusStore';
import type {
  NormalizedEntry,
  NormalizedEntryType,
  ClaudeApprovalInfo,
  ClaudeSessionInfo,
  SessionActivity,
} from '../../../shared/types';

// ─── Helpers ───

function formatTimestampIST(timestamp?: string): string | null {
  if (!timestamp) return null;
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return null;
    return date.toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return null;
  }
}

// ─── Entry Renderers ───

function CopyAction({ text, align = 'left' }: { text: string; align?: 'left' | 'right' }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      onClick={handleCopy}
      className="text-muted-foreground hover:text-foreground mt-1 flex items-center gap-1 px-1 text-[10px] transition-colors"
    >
      {copied ? <ClipboardCheck className="size-3" /> : <Copy className="size-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

const USER_BUBBLE_MAX_H = 150; // px – collapsed height limit

function UserBubble({ content, metadata, timestamp }: { content: string; metadata?: unknown; timestamp?: string }) {
  const meta = metadata as { files?: string[]; images?: Array<{ filename: string; dataUrl: string }> } | undefined;
  const files = meta?.files;
  const images = meta?.images;
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const contentRef = useRef<HTMLParagraphElement>(null);
  const { lightbox, openLightbox, closeLightbox } = useLightbox();

  useEffect(() => {
    if (contentRef.current) {
      setOverflows(contentRef.current.scrollHeight > USER_BUBBLE_MAX_H);
    }
  }, [content]);

  const imageUrls = images?.map((img) => img.dataUrl) ?? [];

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
                className="max-h-40 cursor-pointer rounded-md border border-primary/20 object-cover transition-opacity hover:opacity-80"
                onClick={() => openLightbox(imageUrls, i)}
              />
            ))}
          </div>
        )}
        {lightbox && (
          <ImageLightbox
            images={lightbox.images}
            initialIndex={lightbox.index}
            onClose={closeLightbox}
          />
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
      <div className={`flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover/msg:opacity-100`}>
        {formatTimestampIST(timestamp) && (
          <span className="text-muted-foreground mt-1 flex items-center px-1 text-[10px]">{formatTimestampIST(timestamp)}</span>
        )}
        <CopyAction text={content} align="right" />
      </div>
    </div>
  );
}

function AssistantBubble({ content, timestamp }: { content: string; timestamp?: string }) {
  return (
    <div className="group/msg flex flex-col items-start">
      <div className="bg-card border-border max-w-[85%] rounded-xl rounded-bl-sm border px-3 py-2">
        <div className="select-text">
          <Markdown content={content} />
        </div>
      </div>
      <div className={`flex items-center gap-1 opacity-0 transition-opacity group-hover/msg:opacity-100`}>
        {formatTimestampIST(timestamp) && (
          <span className="text-muted-foreground mt-1 flex items-center px-1 text-[10px]">{formatTimestampIST(timestamp)}</span>
        )}
        <CopyAction text={content} align="left" />
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

// ─── Compressed View ───

interface EntryGroup {
  userEntry: NormalizedEntry | null;
  responses: NormalizedEntry[];
}

function groupEntriesByUser(entries: NormalizedEntry[]): EntryGroup[] {
  const groups: EntryGroup[] = [];
  let current: EntryGroup = { userEntry: null, responses: [] };

  for (const entry of entries) {
    if (entry.entryType.type === 'user_message') {
      if (current.userEntry || current.responses.length > 0) {
        groups.push(current);
      }
      current = { userEntry: entry, responses: [] };
    } else {
      current.responses.push(entry);
    }
  }
  if (current.userEntry || current.responses.length > 0) {
    groups.push(current);
  }
  return groups;
}

function summarizeGroup(responses: NormalizedEntry[]): { tools: number; edits: number; reads: number; commands: number; text: string } {
  let tools = 0, edits = 0, reads = 0, commands = 0;
  let text = '';

  for (const r of responses) {
    if (r.entryType.type === 'tool_use') {
      tools++;
      const action = r.entryType.actionType.action;
      if (action === 'file_edit') edits++;
      else if (action === 'file_read') reads++;
      else if (action === 'command_run') commands++;
    } else if (r.entryType.type === 'assistant_message' && !text) {
      text = r.content.slice(0, 150);
    }
  }
  return { tools, edits, reads, commands, text };
}

function CompressedGroup({ group, isLast, sessionDone }: { group: EntryGroup; isLast: boolean; sessionDone: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const summary = summarizeGroup(group.responses);
  const hasResponses = group.responses.length > 0;

  const chips: string[] = [];
  if (summary.edits > 0) chips.push(`${summary.edits} edit${summary.edits > 1 ? 's' : ''}`);
  if (summary.reads > 0) chips.push(`${summary.reads} read${summary.reads > 1 ? 's' : ''}`);
  if (summary.commands > 0) chips.push(`${summary.commands} cmd${summary.commands > 1 ? 's' : ''}`);
  const otherTools = summary.tools - summary.edits - summary.reads - summary.commands;
  if (otherTools > 0) chips.push(`${otherTools} other`);

  return (
    <div className="space-y-3">
      {group.userEntry && (
        <UserBubble content={group.userEntry.content} metadata={group.userEntry.metadata} timestamp={group.userEntry.timestamp} />
      )}

      {hasResponses && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="bg-secondary/50 border-border hover:bg-secondary group/cg flex w-full items-center gap-2 rounded-lg border px-3 py-1.5 text-left transition-colors"
        >
          <Maximize2 className="text-muted-foreground size-3 shrink-0" />
          {summary.text ? (
            <span className="text-foreground min-w-0 flex-1 truncate text-xs">{summary.text}</span>
          ) : (
            <span className="text-muted-foreground min-w-0 flex-1 text-xs italic">No text response</span>
          )}
          {chips.length > 0 && (
            <div className="flex shrink-0 items-center gap-1">
              {chips.map((c) => (
                <Badge key={c} variant="secondary" className="text-[9px] font-normal">{c}</Badge>
              ))}
            </div>
          )}
        </button>
      )}

      {hasResponses && expanded && (
        <div className="border-border/50 space-y-3 border-l-2 pl-3">
          <button
            onClick={() => setExpanded(false)}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[10px] transition-colors"
          >
            <Minimize2 className="size-3" />
            Collapse
          </button>
          {group.responses.map((entry, i) => (
            <EntryItem
              key={entry.id}
              entry={entry}
              sessionDone={sessionDone}
              isLastEntry={isLast && i === group.responses.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EntryItem({ entry, sessionDone, isLastEntry }: { entry: NormalizedEntry; sessionDone?: boolean; isLastEntry?: boolean }) {
  switch (entry.entryType.type) {
    case 'user_message':
      return <UserBubble content={entry.content} metadata={entry.metadata} timestamp={entry.timestamp} />;
    case 'assistant_message':
      return <AssistantBubble content={entry.content} timestamp={entry.timestamp} />;
    case 'thinking':
      return <ThinkingBlock content={entry.content} />;
    case 'tool_use':
      return <ToolCard entryType={entry.entryType} content={entry.content} metadata={entry.metadata} sessionDone={sessionDone} isLastEntry={isLastEntry} />;
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

// ─── Main ClaudeView ───

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
  onApprove: (approvalId: string, updatedInput?: Record<string, unknown>) => void;
  onDeny: (approvalId: string, reason?: string) => void;
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
  const [compressed, setCompressed] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<Array<{ path: string; type: 'file' | 'directory' }>>([]);
  const [attachedImages, setAttachedImages] = useState<ImageAttachmentLocal[]>([]);
  const [showMentionPopover, setShowMentionPopover] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollAnchorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const userScrolledUp = useRef(false);

  // Track if user has scrolled away from bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      userScrolledUp.current = !atBottom;
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  // Auto-scroll to bottom on new entries (unless user scrolled up)
  useEffect(() => {
    if (!userScrolledUp.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length, entries[entries.length - 1]?.id]);

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

  const sessionApprovals = approvals.filter((a) => a.sessionId === session.id);

  const isBusy = session?.status === 'running' && activity.state !== 'idle';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed && attachedFiles.length === 0 && attachedImages.length === 0) return;

    if (isBusy) {
      // Queue all messages when busy — they'll be sent when session becomes idle
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
      <div className="border-border bg-card flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-primary text-sm font-bold truncate max-w-[200px]">{session.name || 'Claude'}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-xs"
            className={`size-7 ${compressed ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setCompressed(!compressed)}
            title={compressed ? 'Expand all' : 'Compress view'}
          >
            {compressed ? <Maximize2 className="size-4" /> : <Minimize2 className="size-4" />}
          </Button>
          {(session.status === 'error' || session.status === 'done') && (
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground hover:text-primary"
              onClick={onResume}
            >
              <RotateCcw className="size-3.5" />
              Resume
            </Button>
          )}
        </div>
      </div>

      {/* Entry list */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4" style={{ overflowAnchor: 'none' }}>
        {compressed ? (
          groupEntriesByUser(entries).map((group, i, arr) => (
            <CompressedGroup
              key={group.userEntry?.id ?? `group-${i}`}
              group={group}
              isLast={i === arr.length - 1}
              sessionDone={session.status !== 'running'}
            />
          ))
        ) : (
          entries.map((entry, i) => (
            <EntryItem key={entry.id} entry={entry} sessionDone={session.status !== 'running'} isLastEntry={i === entries.length - 1} />
          ))
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

        {/* Scroll anchor — keeps content pinned to bottom */}
        <div ref={scrollAnchorRef} style={{ overflowAnchor: 'auto', height: 0 }} />
      </div>

      {/* Approval cards */}
      {sessionApprovals.length > 0 && (
        <div className="border-border space-y-2 border-t px-4 py-2">
          {sessionApprovals.map((a) => (
            <ApprovalCard
              key={a.approvalId}
              approval={a}
              onApprove={(updatedInput) => onApprove(a.approvalId, updatedInput)}
              onDeny={(reason) => onDeny(a.approvalId, reason)}
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
              {isBusy && (
                <Button
                  type="button"
                  size="icon"
                  variant="destructive"
                  onClick={onInterrupt}
                  className="size-8 shrink-0"
                >
                  <StopCircle className="size-4" />
                </Button>
              )}
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
