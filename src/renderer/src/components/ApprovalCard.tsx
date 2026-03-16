import { Button } from '@/components/ui/button';
import { Check, X, ShieldAlert, FileText, TerminalSquare, Search, Globe, HelpCircle, Eye } from 'lucide-react';
import { useZeusStore } from '@/stores/useZeusStore';
import type { ClaudeApprovalInfo } from '../../../shared/types';

// ─── Tool Detail Helpers ───

interface ToolDetail {
  icon: React.ElementType;
  label: string;
  filePath?: string;
  command?: string;
  question?: string;
  oldContent?: string;
  newContent?: string;
  rawInput?: string;
}

function parseToolInput(approval: ClaudeApprovalInfo): ToolDetail {
  const input = approval.toolInput as Record<string, unknown> | null;

  switch (approval.toolName) {
    case 'Edit': {
      return {
        icon: FileText,
        label: 'Edit File',
        filePath: String(input?.file_path ?? ''),
        oldContent: String(input?.old_string ?? ''),
        newContent: String(input?.new_string ?? ''),
      };
    }
    case 'Write': {
      return {
        icon: FileText,
        label: 'Create File',
        filePath: String(input?.file_path ?? ''),
        oldContent: '',
        newContent: String(input?.content ?? ''),
      };
    }
    case 'Bash':
      return {
        icon: TerminalSquare,
        label: 'Run Command',
        command: String(input?.command ?? ''),
      };
    case 'Read':
      return {
        icon: FileText,
        label: 'Read File',
        filePath: String(input?.file_path ?? ''),
      };
    case 'Glob':
    case 'Grep':
      return {
        icon: Search,
        label: approval.toolName === 'Glob' ? 'Find Files' : 'Search Code',
        rawInput: String(input?.pattern ?? input?.query ?? ''),
      };
    case 'WebFetch':
      return {
        icon: Globe,
        label: 'Fetch URL',
        rawInput: String(input?.url ?? ''),
      };
    case 'AskUserQuestion':
      return {
        icon: HelpCircle,
        label: 'Question',
        question: String(input?.question ?? ''),
      };
    default:
      return {
        icon: ShieldAlert,
        label: approval.toolName,
        rawInput: input ? JSON.stringify(input, null, 2) : '',
      };
  }
}

// ─── Approval Card ───

interface ApprovalCardProps {
  approval: ClaudeApprovalInfo;
  onApprove: () => void;
  onDeny: () => void;
}

export default function ApprovalCard({ approval, onApprove, onDeny }: ApprovalCardProps) {
  const detail = parseToolInput(approval);
  const Icon = detail.icon;
  const hasDiff = detail.oldContent != null && detail.newContent != null && detail.filePath;
  const openApprovalDiff = useZeusStore((s) => s.openApprovalDiff);

  const handleViewChanges = () => {
    if (hasDiff) {
      openApprovalDiff(approval.sessionId, detail.filePath!, detail.oldContent!, detail.newContent!);
    }
  };

  return (
    <div className="zeus-attention-approval overflow-hidden rounded-lg border border-orange-400/40">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 bg-orange-400/10 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <ShieldAlert className="size-4 shrink-0 animate-pulse text-orange-400" />
          <Icon className="size-3.5 shrink-0 text-orange-300" />
          <span className="text-xs font-semibold text-orange-300">{detail.label}</span>
        </div>
        <div className="flex shrink-0 gap-2">
          {hasDiff && (
            <Button
              size="xs"
              variant="outline"
              className="border-orange-400/30 text-orange-300 hover:bg-orange-400/10"
              onClick={handleViewChanges}
            >
              <Eye className="size-3" />
              View
            </Button>
          )}
          <Button
            size="xs"
            className="bg-green-600 text-white hover:bg-green-700"
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

      {/* File path */}
      {detail.filePath && (
        <div className="border-t border-orange-400/20 bg-orange-400/5 px-3 py-1.5">
          <p className="truncate font-mono text-xs text-foreground">
            {detail.filePath}
          </p>
        </div>
      )}

      {/* Command */}
      {detail.command && (
        <div className="border-t border-orange-400/20 bg-black/30 px-3 py-2">
          <pre className="whitespace-pre-wrap font-mono text-xs text-green-400">$ {detail.command}</pre>
        </div>
      )}

      {/* Question */}
      {detail.question && (
        <div className="border-t border-orange-400/20 bg-orange-400/5 px-3 py-2">
          <p className="text-sm text-foreground">{detail.question}</p>
        </div>
      )}

      {/* Raw input for other tools */}
      {detail.rawInput && !detail.command && !detail.question && (
        <div className="border-t border-orange-400/20 bg-orange-400/5 px-3 py-1.5">
          <p className="truncate font-mono text-xs text-muted-foreground">{detail.rawInput}</p>
        </div>
      )}
    </div>
  );
}
