import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

// ─── AskUserQuestion Types ───

interface AskOption {
  label: string;
  description: string;
}

interface AskQuestion {
  question: string;
  header: string;
  options: AskOption[];
  multiSelect: boolean;
}

// ─── AskUserQuestion Card ───

function AskUserQuestionCard({
  approval,
  onDeny,
}: {
  approval: ClaudeApprovalInfo;
  onApprove: (updatedInput?: Record<string, unknown>) => void;
  onDeny: (reason?: string) => void;
}) {
  const input = approval.toolInput as Record<string, unknown> | null;
  const questions = (input?.questions as AskQuestion[]) ?? [];

  const [selections, setSelections] = useState<Record<string, string>>({});
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});
  const [showCustom, setShowCustom] = useState<Record<string, boolean>>({});

  const toggleOption = (questionText: string, optionLabel: string, multiSelect: boolean) => {
    setSelections((prev) => {
      if (multiSelect) {
        const current = prev[questionText] ?? '';
        const selected = current ? current.split('|||') : [];
        const idx = selected.indexOf(optionLabel);
        if (idx >= 0) {
          selected.splice(idx, 1);
        } else {
          selected.push(optionLabel);
        }
        return { ...prev, [questionText]: selected.join('|||') };
      }
      if (prev[questionText] === optionLabel) {
        return { ...prev, [questionText]: '' };
      }
      setShowCustom((s) => ({ ...s, [questionText]: false }));
      return { ...prev, [questionText]: optionLabel };
    });
  };

  const isSelected = (questionText: string, optionLabel: string, multiSelect: boolean) => {
    const val = selections[questionText] ?? '';
    if (multiSelect) {
      return val.split('|||').includes(optionLabel);
    }
    return val === optionLabel;
  };

  const handleCustomToggle = (questionText: string) => {
    setShowCustom((prev) => {
      const next = !prev[questionText];
      if (next) {
        setSelections((s) => ({ ...s, [questionText]: '' }));
      }
      return { ...prev, [questionText]: next };
    });
  };

  const handleSubmit = () => {
    const answers: Record<string, string> = {};
    for (const q of questions) {
      if (showCustom[q.question] && customInputs[q.question]) {
        answers[q.question] = customInputs[q.question];
      } else if (selections[q.question]) {
        answers[q.question] = selections[q.question];
      }
    }

    // Format answers as readable text for the denial message
    const answerLines = Object.entries(answers)
      .map(([q, a]) => `${q} → ${a}`)
      .join('\n');
    const reason = `User answered:\n${answerLines}`;

    // Use deny with the answer text — Claude reads the denial message
    onDeny(reason);
  };

  const hasAnswer = questions.every((q) =>
    (showCustom[q.question] && customInputs[q.question]?.trim()) || selections[q.question]
  );

  return (
    <div className="zeus-attention-approval overflow-hidden rounded-lg border border-blue-400/40">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 bg-blue-400/10 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <HelpCircle className="size-4 shrink-0 text-blue-400" />
          <span className="text-xs font-semibold text-blue-300">Question from Claude</span>
        </div>
        <Button size="xs" variant="destructive" onClick={() => onDeny()}>
          <X className="size-3" />
          Dismiss
        </Button>
      </div>

      {/* Questions */}
      <div className="space-y-3 px-3 py-3">
        {questions.map((q) => (
          <div key={q.question}>
            <div className="mb-2 flex items-start gap-2">
              {q.header && (
                <span className="mt-0.5 shrink-0 rounded bg-blue-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-blue-300">
                  {q.header}
                </span>
              )}
              <p className="text-sm text-foreground">{q.question}</p>
            </div>

            <div className="space-y-1.5 pl-1">
              {q.options.map((opt) => {
                const selected = isSelected(q.question, opt.label, q.multiSelect);
                return (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => toggleOption(q.question, opt.label, q.multiSelect)}
                    className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                      selected
                        ? 'border-blue-400/50 bg-blue-400/10 text-foreground'
                        : 'border-border bg-secondary/50 text-muted-foreground hover:border-blue-400/30 hover:bg-secondary'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${
                        selected ? 'border-blue-400 bg-blue-400' : 'border-muted-foreground/40'
                      }`}>
                        {selected && <Check className="size-2.5 text-white" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium">{opt.label}</p>
                        {opt.description && (
                          <p className="mt-0.5 text-[11px] text-muted-foreground">{opt.description}</p>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}

              {/* Other / custom option */}
              <button
                type="button"
                onClick={() => handleCustomToggle(q.question)}
                className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                  showCustom[q.question]
                    ? 'border-blue-400/50 bg-blue-400/10 text-foreground'
                    : 'border-border bg-secondary/50 text-muted-foreground hover:border-blue-400/30 hover:bg-secondary'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${
                    showCustom[q.question] ? 'border-blue-400 bg-blue-400' : 'border-muted-foreground/40'
                  }`}>
                    {showCustom[q.question] && <Check className="size-2.5 text-white" />}
                  </div>
                  <p className="text-xs font-medium">Other</p>
                </div>
              </button>

              {showCustom[q.question] && (
                <Input
                  autoFocus
                  placeholder="Type your answer..."
                  value={customInputs[q.question] ?? ''}
                  onChange={(e) => setCustomInputs((prev) => ({ ...prev, [q.question]: e.target.value }))}
                  className="mt-1 text-xs"
                />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Submit */}
      <div className="flex justify-end border-t border-blue-400/20 bg-blue-400/5 px-3 py-2">
        <Button
          size="sm"
          className="bg-blue-500 text-white hover:bg-blue-600"
          disabled={!hasAnswer}
          onClick={handleSubmit}
        >
          <Check className="size-3" />
          Submit Answer
        </Button>
      </div>
    </div>
  );
}

// ─── Approval Card ───

interface ApprovalCardProps {
  approval: ClaudeApprovalInfo;
  onApprove: (updatedInput?: Record<string, unknown>) => void;
  onDeny: (reason?: string) => void;
}

export default function ApprovalCard({ approval, onApprove, onDeny }: ApprovalCardProps) {
  if (approval.toolName === 'AskUserQuestion') {
    return <AskUserQuestionCard approval={approval} onApprove={onApprove} onDeny={onDeny} />;
  }

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
            onClick={() => onApprove()}
          >
            <Check className="size-3" />
            Allow
          </Button>
          <Button size="xs" variant="destructive" onClick={() => onDeny()}>
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
