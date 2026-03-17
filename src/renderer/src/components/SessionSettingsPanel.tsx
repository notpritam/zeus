import { useState, useRef, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Settings,
  Pencil,
  Check,
  X,
  Palette,
  Copy,
  Clock,
  FolderOpen,
  GitBranch,
  Shield,
  Cpu,
  Bell,
  BellOff,
  Eye,
  EyeOff,
  Zap,
  AlertTriangle,
  Square,
  Archive,
  Trash2,
  Bot,
} from 'lucide-react';
import { useZeusStore } from '@/stores/useZeusStore';

// ─── Constants ───

const SESSION_COLORS = [
  null,
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
];

// ─── Helpers ───

function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function formatTimeIST(ts: number): string {
  try {
    return new Date(ts).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return '—';
  }
}

// ─── Sub-components ───

function SectionHeader({ title, className }: { title: string; className?: string }) {
  return (
    <div className={`border-border border-b px-3 py-1.5 ${className ?? ''}`}>
      <span className="text-foreground text-[10px] font-semibold uppercase tracking-wider">{title}</span>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value, muted }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1.5">
      <div className="flex items-center gap-2">
        <Icon className="text-muted-foreground size-3 shrink-0" />
        <span className="text-muted-foreground text-[11px]">{label}</span>
      </div>
      <div className={`text-right text-[11px] font-medium ${muted ? 'text-muted-foreground' : 'text-foreground'}`}>{value}</div>
    </div>
  );
}

function ColorPicker({
  value,
  onChange,
  onClose,
}: {
  value: string | undefined;
  onChange: (color: string | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="bg-popover border-border absolute top-full left-0 z-50 mt-1 flex gap-1 rounded-lg border p-1.5 shadow-lg"
      onClick={(e) => e.stopPropagation()}
    >
      {SESSION_COLORS.map((c) => (
        <button
          key={c ?? 'none'}
          className={`size-5 rounded-full border-2 transition-transform hover:scale-110 ${
            (c ?? undefined) === value ? 'border-foreground scale-110' : 'border-transparent'
          }`}
          style={{ backgroundColor: c ?? 'transparent' }}
          onClick={() => { onChange(c); onClose(); }}
          title={c ? c : 'Default'}
        >
          {!c && <X className="text-muted-foreground size-full p-0.5" />}
        </button>
      ))}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      onClick={handleCopy}
      className="text-muted-foreground hover:text-foreground ml-1 inline-flex shrink-0 transition-colors"
      title="Copy"
    >
      {copied ? <Check className="size-3 text-green-400" /> : <Copy className="size-3" />}
    </button>
  );
}

// ─── Main Panel ───

function SessionSettingsPanel() {
  const activeClaudeId = useZeusStore((s) => s.activeClaudeId);
  const session = useZeusStore((s) => s.claudeSessions.find((cs) => cs.id === s.activeClaudeId));
  const gitStatus = useZeusStore((s) => activeClaudeId ? s.gitStatus[activeClaudeId] : undefined);
  const gitConnected = useZeusStore((s) => activeClaudeId ? s.gitWatcherConnected[activeClaudeId] === true : false);
  const fileTreeConnected = useZeusStore((s) => activeClaudeId ? s.fileTreeConnected[activeClaudeId] === true : false);
  const updateClaudeSession = useZeusStore((s) => s.updateClaudeSession);
  const deleteClaudeSession = useZeusStore((s) => s.deleteClaudeSession);
  const archiveClaudeSession = useZeusStore((s) => s.archiveClaudeSession);
  const stopClaude = useZeusStore((s) => s.stopClaude);

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // ─── Empty state ───
  if (!activeClaudeId || !session) {
    return (
      <div className="flex flex-col">
        <div className="border-border flex shrink-0 items-center gap-2 border-b px-3 py-2">
          <Settings className="text-muted-foreground size-3.5" />
          <span className="text-foreground text-xs font-semibold">Session Settings</span>
        </div>
        <div className="flex flex-col items-center justify-center gap-2 p-4">
          <Settings className="text-muted-foreground size-6" />
          <p className="text-muted-foreground text-xs">No active session</p>
        </div>
      </div>
    );
  }

  const elapsed = Date.now() - session.startedAt;
  const statusColor =
    session.status === 'running' ? 'text-green-400' :
    session.status === 'done' ? 'text-muted-foreground' :
    session.status === 'error' ? 'text-red-400' :
    'text-muted-foreground';

  const startEditing = () => {
    setEditValue(session.name || '');
    setEditing(true);
  };

  const saveEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed !== (session.name || '')) {
      updateClaudeSession(session.id, { name: trimmed || undefined });
    }
    setEditing(false);
  };

  const cancelEdit = () => setEditing(false);

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="border-border flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <Settings className="text-muted-foreground size-3.5" />
        <span className="text-foreground text-xs font-semibold">Session Settings</span>
      </div>

      <div>
        {/* ─── Identity ─── */}
        <SectionHeader title="Identity" />

        {/* Name */}
        <div className="flex items-center justify-between gap-2 px-3 py-1.5">
          <div className="flex items-center gap-2">
            <Zap className="text-muted-foreground size-3 shrink-0" />
            <span className="text-muted-foreground text-[11px]">Name</span>
          </div>
          {editing ? (
            <div className="flex items-center gap-1">
              <input
                autoFocus
                className="bg-muted text-foreground h-5 w-[120px] rounded px-1.5 text-[11px] font-medium outline-none ring-1 ring-primary"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                onBlur={saveEdit}
              />
              <button onClick={saveEdit} className="text-green-400 hover:text-green-300"><Check className="size-3" /></button>
              <button onClick={cancelEdit} className="text-muted-foreground hover:text-foreground"><X className="size-3" /></button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <span className={`text-[11px] font-medium ${session.name ? 'text-foreground' : 'text-muted-foreground'}`}>
                {session.name || '—'}
              </span>
              <button onClick={startEditing} className="text-muted-foreground hover:text-foreground">
                <Pencil className="size-3" />
              </button>
            </div>
          )}
        </div>

        {/* Color */}
        <div className="flex items-center justify-between gap-2 px-3 py-1.5">
          <div className="flex items-center gap-2">
            <Palette className="text-muted-foreground size-3 shrink-0" />
            <span className="text-muted-foreground text-[11px]">Color</span>
          </div>
          <div className="relative flex items-center gap-1.5">
            <span
              className="size-4 rounded-full border border-border"
              style={{ backgroundColor: session.color || 'transparent' }}
            />
            <button
              onClick={() => setShowColorPicker(!showColorPicker)}
              className="text-muted-foreground hover:text-foreground"
            >
              <Palette className="size-3" />
            </button>
            {showColorPicker && (
              <ColorPicker
                value={session.color || undefined}
                onChange={(c) => updateClaudeSession(session.id, { color: c })}
                onClose={() => setShowColorPicker(false)}
              />
            )}
          </div>
        </div>

        {/* Status */}
        <InfoRow icon={Zap} label="Status" value={
          <Badge variant={session.status === 'running' ? 'default' : 'secondary'} className={`text-[9px] ${statusColor}`}>
            {session.status}
          </Badge>
        } />

        {/* Session ID */}
        <div className="flex items-center justify-between gap-2 px-3 py-1.5">
          <div className="flex items-center gap-2">
            <Bot className="text-muted-foreground size-3 shrink-0" />
            <span className="text-muted-foreground text-[11px]">Session ID</span>
          </div>
          <div className="flex items-center">
            <span className="text-foreground max-w-[100px] truncate font-mono text-[10px]" title={session.id}>
              {session.id.slice(0, 12)}...
            </span>
            <CopyButton text={session.id} />
          </div>
        </div>

        {/* Claude Session ID */}
        {session.claudeSessionId && (
          <div className="flex items-center justify-between gap-2 px-3 py-1.5">
            <div className="flex items-center gap-2">
              <Bot className="text-muted-foreground size-3 shrink-0" />
              <span className="text-muted-foreground text-[11px]">Claude ID</span>
            </div>
            <div className="flex items-center">
              <span className="text-foreground max-w-[100px] truncate font-mono text-[10px]" title={session.claudeSessionId}>
                {session.claudeSessionId.slice(0, 12)}...
              </span>
              <CopyButton text={session.claudeSessionId} />
            </div>
          </div>
        )}

        {/* ─── Configuration ─── */}
        <SectionHeader title="Configuration" />
        <InfoRow icon={Shield} label="Permission" value={
          <Badge variant="outline" className="text-[9px]">{session.permissionMode || 'default'}</Badge>
        } />
        <InfoRow icon={Cpu} label="Model" value={session.model || 'default'} muted={!session.model} />
        <InfoRow icon={session.notificationSound ? Bell : BellOff} label="Sound" value={session.notificationSound !== false ? 'On' : 'Off'} />
        <InfoRow icon={GitBranch} label="Git Watcher" value={session.enableGitWatcher !== false ? 'Enabled' : 'Disabled'} />
        <InfoRow icon={session.enableQA ? Eye : EyeOff} label="QA" value={session.enableQA ? 'Enabled' : 'Disabled'} />

        {/* ─── Git Overview ─── */}
        <SectionHeader title="Git Overview" />
        <InfoRow icon={GitBranch} label="Watcher" value={
          <span className="flex items-center gap-1">
            <span className={`size-1.5 rounded-full ${gitConnected ? 'bg-green-400' : 'bg-muted-foreground/30'}`} />
            {gitConnected ? 'Connected' : 'Disconnected'}
          </span>
        } />
        {gitStatus && (
          <>
            <InfoRow icon={GitBranch} label="Branch" value={gitStatus.branch || '—'} muted={!gitStatus.branch} />
            {(gitStatus.ahead ?? 0) > 0 && <InfoRow icon={Zap} label="Ahead" value={gitStatus.ahead!} />}
            {(gitStatus.behind ?? 0) > 0 && <InfoRow icon={Zap} label="Behind" value={gitStatus.behind!} />}
            {gitStatus.staged.length > 0 && <InfoRow icon={Zap} label="Staged" value={
              <Badge variant="secondary" className="text-[10px] font-mono text-accent">{gitStatus.staged.length}</Badge>
            } />}
            {gitStatus.unstaged.length > 0 && <InfoRow icon={Zap} label="Unstaged" value={
              <Badge variant="secondary" className="text-[10px] font-mono text-warn">{gitStatus.unstaged.length}</Badge>
            } />}
          </>
        )}

        {/* ─── Working Directory ─── */}
        <SectionHeader title="Working Directory" />
        <InfoRow icon={FolderOpen} label="Path" value={
          <span className="max-w-[140px] truncate block text-[10px] font-mono" title={session.workingDir}>
            {session.workingDir || '—'}
          </span>
        } muted={!session.workingDir} />
        <InfoRow icon={FolderOpen} label="File Watcher" value={
          <span className="flex items-center gap-1">
            <span className={`size-1.5 rounded-full ${fileTreeConnected ? 'bg-green-400' : 'bg-muted-foreground/30'}`} />
            {fileTreeConnected ? 'Connected' : 'Disconnected'}
          </span>
        } />

        {/* ─── Timing ─── */}
        <SectionHeader title="Timing" />
        <InfoRow icon={Clock} label="Started" value={formatTimeIST(session.startedAt)} />
        <InfoRow icon={Clock} label="Duration" value={formatDuration(elapsed)} />
        {session.prompt && (
          <>
            <div className="px-3 pt-1.5 pb-0">
              <span className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">Initial Prompt</span>
            </div>
            <div className="px-3 py-1.5">
              <p className="text-muted-foreground text-[11px] leading-relaxed whitespace-pre-wrap line-clamp-3">{session.prompt}</p>
            </div>
          </>
        )}

        {/* ─── Danger Zone ─── */}
        <div className="border-border mt-2 border-t px-3 py-1.5 bg-red-500/5">
          <span className="text-red-400 text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1">
            <AlertTriangle className="size-3" /> Danger Zone
          </span>
        </div>
        <div className="flex flex-col gap-2 px-3 py-2 bg-red-500/5">
          {session.status === 'running' && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-full justify-start gap-2 text-[11px] border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
              onClick={stopClaude}
            >
              <Square className="size-3" /> Stop Session
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-full justify-start gap-2 text-[11px]"
            onClick={() => archiveClaudeSession(session.id)}
          >
            <Archive className="size-3" /> Archive Session
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-full justify-start gap-2 text-[11px] border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash2 className="size-3" /> Delete Session
          </Button>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Delete Session</DialogTitle>
            <DialogDescription className="text-xs">
              Are you sure you want to delete &quot;{session.name || session.id.slice(0, 12)}&quot;? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                deleteClaudeSession(session.id);
                setShowDeleteConfirm(false);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default SessionSettingsPanel;
