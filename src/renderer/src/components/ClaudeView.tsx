import { useState, useRef, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Send, Loader2, Check, X, StopCircle, File, Folder, ImagePlus, Pencil, Trash2, Sparkles, Minimize2, Maximize2, Menu, Settings, PanelRight, ArrowDown, RotateCcw } from 'lucide-react';
import { Kbd } from '@/components/ui/kbd';
import FileMentionPopover from '@/components/FileMentionPopover';
import SlashCommandPopover from '@/components/SlashCommandPopover';
import { SLASH_COMMANDS, getFilteredCommands } from '../../../shared/slash-commands';
import type { SlashCommand } from '../../../shared/slash-commands';
import ApprovalCard from '@/components/ApprovalCard';
import SessionTerminalPanel from '@/components/SessionTerminalPanel';
import { useZeusStore } from '@/stores/useZeusStore';
import VirtualizedEntryList from '@/components/VirtualizedEntryList';
import type {
  NormalizedEntry,
  ClaudeApprovalInfo,
  ClaudeSessionInfo,
  SessionActivity,
} from '../../../shared/types';

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
  onInjectMessage: (content: string, files?: string[], images?: Array<{ filename: string; mediaType: string; dataUrl: string }>) => void;
  onApprove: (approvalId: string, updatedInput?: Record<string, unknown>) => void;
  onDeny: (approvalId: string, reason?: string) => void;
  onInterrupt: () => void;
  onResume: (prompt?: string) => void;
  onQueueMessage: (content: string) => void;
  onEditQueued: (id: string, content: string) => void;
  onRemoveQueued: (id: string) => void;
  onClearHistory?: () => void;
  // Mobile header controls (passed only from mobile layout)
  onToggleSidebar?: () => void;
  onOpenSettings?: () => void;
  onOpenCommandPalette?: () => void;
  onToggleRightPanel?: () => void;
  connected?: boolean;
}

function ClaudeView({
  session,
  entries,
  approvals,
  activity,
  queue,
  onSendMessage,
  onInjectMessage,
  onApprove,
  onDeny,
  onInterrupt,
  onResume,
  onQueueMessage,
  onEditQueued,
  onRemoveQueued,
  onClearHistory,
  onToggleSidebar,
  onOpenSettings,
  onOpenCommandPalette,
  onToggleRightPanel,
  connected,
}: ClaudeViewProps) {
  const [input, setInput] = useState('');
  const [resumeInput, setResumeInput] = useState('');
  const [compressed, setCompressed] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<Array<{ path: string; type: 'file' | 'directory' }>>([]);
  const [attachedImages, setAttachedImages] = useState<ImageAttachmentLocal[]>([]);
  const [showMentionPopover, setShowMentionPopover] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [showSlashPopover, setShowSlashPopover] = useState(false);
  const [slashSelectedIdx, setSlashSelectedIdx] = useState(0);
  const [slashQuery, setSlashQuery] = useState('/');
  const inputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const scrollToBottomRef = useRef<(() => void) | null>(null);
  // Pagination — read from store
  const meta = useZeusStore((s) => session ? s.claudeEntriesMeta[session.id] : null);
  const loadMoreEntries = useZeusStore((s) => s.loadMoreEntries);

  // Session terminal panel
  const sessionTerminalState = useZeusStore((s) =>
    session ? s.sessionTerminals[session.id] : undefined
  );
  const terminalPanelHeight = useZeusStore((s) => s.terminalPanelHeight);
  const setTerminalPanelHeight = useZeusStore((s) => s.setTerminalPanelHeight);
  const panelVisible = sessionTerminalState?.panelVisible ?? false;

  // Drag resize state
  const [isDragging, setIsDragging] = useState(false);
  const claudeViewRef = useRef<HTMLDivElement>(null);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!claudeViewRef.current) return;
      const rect = claudeViewRef.current.getBoundingClientRect();
      const mouseY = e.clientY - rect.top;
      const pct = ((rect.height - mouseY) / rect.height) * 100;
      setTerminalPanelHeight(pct);
    };

    const handleMouseUp = () => setIsDragging(false);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, setTerminalPanelHeight]);

  // Focus management: terminal panel ↔ claude input
  useEffect(() => {
    if (panelVisible) {
      inputRef.current?.blur();
    } else {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [panelVisible]);

  // Scroll callbacks for virtualized list
  const handleScrollStateChange = useCallback((atBottom: boolean) => {
    setShowScrollToBottom(!atBottom);
  }, []);

  const handleLoadMore = useCallback(() => {
    if (session) loadMoreEntries(session.id);
  }, [session, loadMoreEntries]);

  const scrollToBottom = useCallback(() => {
    scrollToBottomRef.current?.();
  }, []);

  const renderQueueItem = useCallback(
    (msg: { id: string; content: string }) => (
      <QueuedMessageItem key={msg.id} msg={msg} onEdit={onEditQueued} onRemove={onRemoveQueued} />
    ),
    [onEditQueued, onRemoveQueued],
  );

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInput(value);

    // Slash command detection: show popover when input starts with / and has no space yet
    const slashMatch = value.match(/^(\/\S*)$/);
    if (slashMatch) {
      const q = slashMatch[1];
      setSlashQuery(q);
      setShowSlashPopover(true);
      setSlashSelectedIdx(0);
    } else {
      setShowSlashPopover(false);
    }

    // File @ mention detection
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

  const filteredSlashCommands = showSlashPopover ? getFilteredCommands(slashQuery) : ([] as SlashCommand[]);

  const handleSlashSelect = useCallback((cmd: SlashCommand) => {
    // Fill in the command name; add a trailing space if it takes args
    setInput(cmd.command + (cmd.args ? ' ' : ''));
    setShowSlashPopover(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSlashPopover || filteredSlashCommands.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSlashSelectedIdx((i) => Math.min(i + 1, filteredSlashCommands.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSlashSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const selected = filteredSlashCommands[slashSelectedIdx];
      if (selected) handleSlashSelect(selected);
    } else if (e.key === 'Escape') {
      setShowSlashPopover(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSlashPopover, filteredSlashCommands, slashSelectedIdx, handleSlashSelect]);

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

    setShowSlashPopover(false);

    // Intercept locally-handled slash commands
    if (trimmed.startsWith('/')) {
      const cmdName = trimmed.split(' ')[0].toLowerCase();
      const cmd = SLASH_COMMANDS.find((c) => c.command === cmdName);
      if (cmd?.localHandler === 'clear') {
        onClearHistory?.();
        setInput('');
        return;
      }
    }

    if (isBusy) {
      // Inject message mid-turn — interrupts Claude and sends immediately
      onInjectMessage(
        trimmed,
        attachedFiles.length > 0 ? attachedFiles.map((f) => f.path) : undefined,
        attachedImages.length > 0 ? attachedImages.map((img) => ({ filename: img.filename, mediaType: img.mediaType, dataUrl: img.dataUrl })) : undefined,
      );
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
    <div ref={claudeViewRef} data-testid="claude-view" className="bg-background flex h-full flex-col">
      {/* Header bar */}
      <div className="border-border bg-card flex items-center justify-between border-b px-4 py-2.5 [-webkit-app-region:drag]">
        <div className="flex items-center gap-2 [-webkit-app-region:no-drag]">
          {/* Sidebar toggle — mobile only */}
          {onToggleSidebar && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="md:hidden"
              onClick={onToggleSidebar}
            >
              <Menu className="size-4" />
            </Button>
          )}
          <span className="text-primary text-sm font-bold truncate max-w-[200px]">{session.name || 'Claude'}</span>
        </div>
        <div className="flex items-center gap-2 [-webkit-app-region:no-drag]">
          <Button
            variant="ghost"
            size="icon-xs"
            className={`size-7 ${compressed ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setCompressed(!compressed)}
            title={compressed ? 'Expand all' : 'Compress view'}
          >
            {compressed ? <Maximize2 className="size-4" /> : <Minimize2 className="size-4" />}
          </Button>
          {/* Right panel toggle — mobile only */}
          {onToggleRightPanel && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="md:hidden"
              onClick={onToggleRightPanel}
              title="Panels"
            >
              <PanelRight className="size-4" />
            </Button>
          )}
          {/* Command palette — mobile only */}
          {onOpenCommandPalette && (
            <Button
              variant="ghost"
              size="xs"
              className="md:hidden"
              onClick={onOpenCommandPalette}
              title="Command Palette (⌘K)"
            >
              <Kbd>⌘K</Kbd>
            </Button>
          )}
          {/* Settings — mobile only */}
          {onOpenSettings && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="md:hidden"
              onClick={onOpenSettings}
              title="Settings"
            >
              <Settings className="size-4" />
            </Button>
          )}
          {/* Connection indicator — mobile only */}
          {connected !== undefined && (
            <span className="relative flex h-2 w-2 md:hidden">
              {connected && (
                <span className="bg-accent absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" />
              )}
              <span
                className={`relative inline-flex h-2 w-2 rounded-full ${connected ? 'bg-accent' : 'bg-muted-foreground/30'}`}
              />
            </span>
          )}
        </div>
      </div>

      {/* Chat + Terminal split */}
      <div className="relative min-h-0 flex-1 flex flex-col">
        {/* Chat area */}
        <div className="min-h-0 flex-1 flex flex-col overflow-hidden">

          {/* Virtualized entry list */}
          <div className="relative min-h-0 flex-1">
            <VirtualizedEntryList
              entries={entries}
              compressed={compressed}
              sessionDone={session.status !== 'running'}
              sessionRunning={session.status === 'running'}
              queue={queue}
              onLoadMore={handleLoadMore}
              loadingOlder={meta?.loading ?? false}
              renderQueueItem={renderQueueItem}
              onScrollStateChange={handleScrollStateChange}
              scrollToBottomRef={scrollToBottomRef}
            />

            {/* Floating scroll-to-bottom button */}
            <AnimatePresence>
              {showScrollToBottom && (
                <motion.button
                  key="scroll-to-bottom"
                  initial={{ opacity: 0, scale: 0.8, x: '-50%' }}
                  animate={{ opacity: 1, scale: 1, x: '-50%' }}
                  exit={{ opacity: 0, scale: 0.8, x: '-50%' }}
                  transition={{ duration: 0.15 }}
                  onClick={scrollToBottom}
                  className="bg-primary text-primary-foreground absolute bottom-3 left-1/2 z-10 flex size-8 items-center justify-center rounded-full shadow-lg hover:opacity-90"
                >
                  <ArrowDown className="size-4" />
                </motion.button>
              )}
            </AnimatePresence>
          </div>

          {/* Approval cards */}
          <AnimatePresence>
            {sessionApprovals.length > 0 && (
              <motion.div
                key="approvals"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                className="overflow-hidden"
              >
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
              </motion.div>
            )}
          </AnimatePresence>

          {/* Activity bar — always visible at bottom when busy */}
          <AnimatePresence>
            {isBusy && (
              <motion.div
                key="activity-bar"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                className="overflow-hidden"
              >
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
              </motion.div>
            )}
          </AnimatePresence>

          {/* Input area */}
          <div className="border-border bg-card shrink-0 border-t">
            {(session.status === 'error' || session.status === 'done') ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  onResume(resumeInput.trim() || undefined);
                  setResumeInput('');
                }}
                className="flex items-center gap-2 px-4 py-3"
              >
                <input
                  type="text"
                  value={resumeInput}
                  onChange={(e) => setResumeInput(e.target.value)}
                  placeholder={session.status === 'error' ? 'Resume with message...' : 'Continue with message...'}
                  className="bg-muted text-foreground placeholder:text-muted-foreground flex-1 rounded-md border-none px-3 py-1.5 text-sm outline-none"
                />
                <Button size="sm" variant="outline" type="submit">
                  <RotateCcw className="size-3" />
                  {resumeInput.trim() ? 'Send' : 'Resume'}
                </Button>
              </form>
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
                  {showSlashPopover && filteredSlashCommands.length > 0 && (
                    <SlashCommandPopover
                      commands={filteredSlashCommands}
                      selectedIdx={slashSelectedIdx}
                      onSelect={handleSlashSelect}
                      onClose={() => setShowSlashPopover(false)}
                    />
                  )}
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
                    id="claude-input"
                    data-testid="claude-input"
                    value={input}
                    onChange={handleInputChange}
                    onKeyDown={handleInputKeyDown}
                    onPaste={handlePaste}
                    placeholder="Send follow-up... (@ files, / commands)"
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
                    variant="default"
                  >
                    <Send className="size-3" />
                    Send
                  </Button>
                </form>
              </>
            )}
          </div>
        </div>

        {/* Drag handle + Terminal panel — always mounted, animated height to preserve xterm state */}
        {session && (
          <motion.div
            initial={false}
            animate={{
              height: panelVisible ? `${terminalPanelHeight}%` : 0,
            }}
            transition={isDragging ? { duration: 0 } : { duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            className="shrink-0 overflow-hidden flex flex-col"
          >
            <div
              onMouseDown={handleDragStart}
              className="border-border hover:bg-primary/20 h-1 shrink-0 cursor-row-resize border-y transition-colors"
              style={isDragging ? { backgroundColor: 'var(--primary)' } : undefined}
            />
            <div className="min-h-0 flex-1">
              <SessionTerminalPanel
                claudeSessionId={session.id}
                cwd={session.workingDir || '/'}
              />
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

export default ClaudeView;
