import { useState, useRef, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Brain, Loader2, Copy, ClipboardCheck, ChevronDown, ChevronUp, File, Minimize2, Maximize2 } from 'lucide-react';
import Markdown from '@/components/Markdown';
import { ToolCard } from '@/components/ToolCard';
import { ImageLightbox, useLightbox } from '@/components/ImageLightbox';
import type { NormalizedEntry, NormalizedEntryType } from '../../../shared/types';

// ─── Helpers ───

export function formatTimestampIST(timestamp?: string): string | null {
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

// ─── Atomic Renderers ───

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

const USER_BUBBLE_MAX_H = 150;

export function UserBubble({ content, metadata, timestamp }: { content: string; metadata?: unknown; timestamp?: string }) {
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

export function AssistantBubble({ content, timestamp }: { content: string; timestamp?: string }) {
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

export function ThinkingBlock({ content }: { content: string }) {
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

export function TokenUsageBar({ entryType }: { entryType: NormalizedEntryType }) {
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

// ─── EntryItem — single-dispatch renderer for any NormalizedEntry ───

export function EntryItem({ entry, sessionDone, isLastEntry }: { entry: NormalizedEntry; sessionDone?: boolean; isLastEntry?: boolean }) {
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

// ─── Compressed View ───

export interface EntryGroup {
  userEntry: NormalizedEntry | null;
  responses: NormalizedEntry[];
}

export function groupEntriesByUser(entries: NormalizedEntry[]): EntryGroup[] {
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

export function CompressedGroup({ group, isLast, sessionDone }: { group: EntryGroup; isLast: boolean; sessionDone: boolean }) {
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
