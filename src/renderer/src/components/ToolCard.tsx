import { useState } from 'react';
import { Copy, ClipboardCheck, ChevronDown, Terminal, Glasses, Code2, Search, Globe, ListTree, FileCode2, Bot } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { ImageLightbox, useLightbox } from '@/components/ImageLightbox';
import type { NormalizedEntryType, ActionType } from '../../../shared/types';

// ─── Code theme (matches Markdown.tsx) ───

const codeTheme = {
  ...oneDark,
  '::selection': {},
  'pre[class*="language-"]': {
    ...oneDark['pre[class*="language-"]'],
    background: 'transparent',
    margin: 0,
    padding: '0.5rem 0.75rem',
    fontSize: '0.75rem',
  },
  'code[class*="language-"]': {
    ...oneDark['code[class*="language-"]'],
    background: 'transparent',
    fontSize: '0.75rem',
  },
};

// ─── Helpers ───

function langFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', rs: 'rust', go: 'go', rb: 'ruby',
    java: 'java', kt: 'kotlin', swift: 'swift',
    css: 'css', scss: 'scss', html: 'html', vue: 'vue', svelte: 'svelte',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    md: 'markdown', sh: 'bash', zsh: 'bash', bash: 'bash',
    sql: 'sql', graphql: 'graphql', dockerfile: 'docker',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
  };
  return map[ext] || 'text';
}

function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
}

function ToolOutputCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={(e) => { e.stopPropagation(); handleCopy(); }}
      className="text-muted-foreground hover:text-foreground shrink-0 rounded p-0.5 transition-colors"
      title={copied ? 'Copied' : 'Copy'}
    >
      {copied ? <ClipboardCheck className="size-3" /> : <Copy className="size-3" />}
    </button>
  );
}

// ─── Plain text block (no syntax highlighting) ───

function PlainText({ text, className }: { text: string; className?: string }) {
  return (
    <pre
      className={`whitespace-pre-wrap break-words font-mono text-xs leading-relaxed ${className ?? 'text-foreground'}`}
      style={{ padding: '0.5rem 0.75rem', margin: 0 }}
    >
      {text}
    </pre>
  );
}

// ─── Shared code output wrapper ───

function CodeOutput({ code, language, label, maxHeight = 'max-h-72' }: {
  code: string; language?: string; label?: string; maxHeight?: string;
}) {
  const isPlainText = !language || language === 'text';
  return (
    <div className={`bg-bg-surface border-border mt-2 overflow-hidden rounded-md border ${maxHeight}`}>
      {label && (
        <div className="border-border flex items-center justify-between border-b px-3 py-1">
          <span className="text-muted-foreground text-[10px] font-medium uppercase">{label}</span>
          <ToolOutputCopyButton text={code} />
        </div>
      )}
      <div className={`overflow-auto ${maxHeight} ${!label ? 'relative' : ''}`}>
        {!label && (
          <div className="absolute top-1 right-2 z-10">
            <ToolOutputCopyButton text={code} />
          </div>
        )}
        {isPlainText ? (
          <PlainText text={code} />
        ) : (
          <SyntaxHighlighter
            style={codeTheme}
            language={language}
            PreTag="div"
            customStyle={{
              background: 'transparent',
              margin: 0,
              padding: '0.5rem 0.75rem',
              fontSize: '0.75rem',
              fontFamily: 'var(--font-mono)',
              lineHeight: '1.5',
            }}
            wrapLongLines
          >
            {code}
          </SyntaxHighlighter>
        )}
      </div>
    </div>
  );
}

// ─── Per-tool body renderers ───

function BashToolBody({ command, output }: { command: string; output: string }) {
  const cleaned = stripAnsi(output);
  const fullText = `$ ${command}${cleaned ? '\n' + cleaned : ''}`;
  return <CodeOutput code={fullText} language="bash" label="Shell" />;
}

function ReadToolBody({ output, path }: { output: string; path: string }) {
  if (!output) return null;
  const lang = langFromPath(path);
  const fileName = path.split('/').pop() || path;
  return <CodeOutput code={output} language={lang} label={fileName} />;
}

function SearchToolBody({ output }: { output: string }) {
  if (!output) return null;
  return <CodeOutput code={output} language="text" label="Results" />;
}

function EditToolBody({ output, actionType }: { output: string; actionType: ActionType }) {
  if (!output) return null;
  const filePath = actionType.action === 'file_edit' ? actionType.path : '';
  const lang = filePath ? langFromPath(filePath) : 'text';

  if (output.startsWith('--- old\n')) {
    const parts = output.split('\n+++ new\n');
    const oldStr = parts[0]?.replace('--- old\n', '') || '';
    const newStr = parts[1] || '';
    return (
      <div className="mt-2 space-y-1">
        {oldStr && (
          <div className="border-border overflow-hidden rounded-md border border-red-500/20">
            <div className="border-border flex items-center border-b bg-red-500/5 px-3 py-1">
              <span className="text-[10px] font-medium text-red-400/70">Removed</span>
            </div>
            <div className="max-h-40 overflow-auto">
              <SyntaxHighlighter
                style={codeTheme}
                language={lang}
                PreTag="div"
                customStyle={{
                  background: 'rgba(239, 68, 68, 0.03)',
                  margin: 0,
                  padding: '0.5rem 0.75rem',
                  fontSize: '0.75rem',
                  fontFamily: 'var(--font-mono)',
                  lineHeight: '1.5',
                }}
                wrapLongLines
              >
                {oldStr}
              </SyntaxHighlighter>
            </div>
          </div>
        )}
        {newStr && (
          <div className="border-border overflow-hidden rounded-md border border-green-500/20">
            <div className="border-border flex items-center border-b bg-green-500/5 px-3 py-1">
              <span className="text-[10px] font-medium text-green-400/70">Added</span>
            </div>
            <div className="max-h-40 overflow-auto">
              <SyntaxHighlighter
                style={codeTheme}
                language={lang}
                PreTag="div"
                customStyle={{
                  background: 'rgba(34, 197, 94, 0.03)',
                  margin: 0,
                  padding: '0.5rem 0.75rem',
                  fontSize: '0.75rem',
                  fontFamily: 'var(--font-mono)',
                  lineHeight: '1.5',
                }}
                wrapLongLines
              >
                {newStr}
              </SyntaxHighlighter>
            </div>
          </div>
        )}
      </div>
    );
  }

  const fileName = filePath.split('/').pop() || 'diff';
  return <CodeOutput code={output} language={lang} label={fileName} />;
}

function GenericToolBody({ output }: { output: string }) {
  if (!output) return null;
  const trimmed = output.trimStart();
  const lang = trimmed.startsWith('{') || trimmed.startsWith('[') ? 'json' : 'text';
  return <CodeOutput code={output} language={lang} />;
}

function ToolImages({ images, inline }: { images: string[]; inline?: boolean }) {
  const { lightbox, openLightbox, closeLightbox } = useLightbox();
  if (!images.length) return null;
  return (
    <>
      <div className={inline ? 'space-y-1' : 'mt-1 space-y-1'}>
        {images.map((src, i) => (
          <div
            key={i}
            className="cursor-pointer overflow-hidden rounded-lg bg-secondary/60 p-1.5 transition-opacity hover:opacity-80"
            onClick={() => openLightbox(images, i)}
          >
            <img
              src={src}
              alt={`Screenshot ${i + 1}`}
              className="max-h-[180px] w-full rounded object-contain"
            />
          </div>
        ))}
      </div>
      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          initialIndex={lightbox.index}
          onClose={closeLightbox}
        />
      )}
    </>
  );
}

function McpToolBody({ input, output, images = [] }: { input: string; output: string; images?: string[] }) {
  return (
    <div className="mt-2 space-y-1.5">
      {input && (
        <div className="border-border overflow-hidden rounded-md border border-blue-500/20">
          <div className="border-border flex items-center border-b bg-blue-500/5 px-3 py-1">
            <span className="text-[10px] font-medium text-blue-400/70">Input</span>
          </div>
          <div className="max-h-40 overflow-auto">
            <SyntaxHighlighter
              style={codeTheme}
              language="json"
              PreTag="div"
              customStyle={{
                background: 'rgba(59, 130, 246, 0.03)',
                margin: 0,
                padding: '0.5rem 0.75rem',
                fontSize: '0.75rem',
                fontFamily: 'var(--font-mono)',
                lineHeight: '1.5',
              }}
              wrapLongLines
            >
              {input}
            </SyntaxHighlighter>
          </div>
        </div>
      )}
      {output && (() => {
        const trimmed = output.trimStart();
        const isJson = trimmed.startsWith('{') || trimmed.startsWith('[');
        return (
          <div className="border-border overflow-hidden rounded-md border border-green-500/20">
            <div className="border-border flex items-center border-b bg-green-500/5 px-3 py-1">
              <span className="text-[10px] font-medium text-green-400/70">Result</span>
            </div>
            <div className="max-h-60 overflow-auto" style={{ background: 'rgba(34, 197, 94, 0.03)' }}>
              {isJson ? (
                <SyntaxHighlighter
                  style={codeTheme}
                  language="json"
                  PreTag="div"
                  customStyle={{
                    background: 'transparent',
                    margin: 0,
                    padding: '0.5rem 0.75rem',
                    fontSize: '0.75rem',
                    fontFamily: 'var(--font-mono)',
                    lineHeight: '1.5',
                  }}
                  wrapLongLines
                >
                  {output}
                </SyntaxHighlighter>
              ) : (
                <PlainText text={output} className="text-foreground/90" />
              )}
            </div>
          </div>
        );
      })()}
      {images.length > 0 && <ToolImages images={images} />}
    </div>
  );
}

// ─── Tool Helpers ───

function getToolIcon(actionType: ActionType): React.ReactNode {
  switch (actionType.action) {
    case 'file_read':
      return <Glasses className="size-3.5" />;
    case 'file_edit':
      return <FileCode2 className="size-3.5" />;
    case 'command_run':
      return <Terminal className="size-3.5" />;
    case 'search':
      return <Search className="size-3.5" />;
    case 'web_fetch':
      return <Globe className="size-3.5" />;
    case 'task_create':
      return <Bot className="size-3.5" />;
    case 'mcp_tool':
      return <Globe className="size-3.5" />;
    default:
      return <Code2 className="size-3.5" />;
  }
}

function getToolTitle(actionType: ActionType): string {
  switch (actionType.action) {
    case 'file_read': return 'Read';
    case 'file_edit': return 'Edit';
    case 'command_run': return 'Shell';
    case 'search': return 'Search';
    case 'web_fetch': return 'Fetch';
    case 'task_create': return actionType.agentName || actionType.agentType || 'Agent';
    case 'plan_presentation': return 'Plan';
    case 'mcp_tool': return actionType.server;
    case 'other': return actionType.description;
  }
}

function getToolSubtitle(actionType: ActionType): string {
  switch (actionType.action) {
    case 'file_read': return actionType.path?.split('/').pop() || actionType.path || '';
    case 'file_edit': return actionType.path?.split('/').pop() || actionType.path || '';
    case 'command_run': return actionType.command || '';
    case 'search': return actionType.query || '';
    case 'web_fetch': return actionType.url || '';
    case 'task_create': return actionType.description || '';
    case 'plan_presentation': return '';
    case 'mcp_tool': return actionType.method || '';
    case 'other': return actionType.description || '';
  }
}

function getToolDirectory(actionType: ActionType): string | null {
  if (actionType.action === 'file_read' || actionType.action === 'file_edit') {
    const p = actionType.path || '';
    const idx = p.lastIndexOf('/');
    return idx > 0 ? p.slice(0, idx) : null;
  }
  return null;
}

// ─── ToolCard ───

function AgentCard({ actionType, status, content, output, sessionDone, isLastEntry }: {
  actionType: ActionType & { action: 'task_create' };
  status: string;
  content: string;
  output: string;
  sessionDone?: boolean;
  isLastEntry?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = status === 'created' && !sessionDone && isLastEntry === true;
  const isSuccess = status === 'success' || (status === 'created' && sessionDone);
  const isFailed = status === 'failed';

  const agentLabel = actionType.agentName || actionType.agentType || 'Agent';
  const typeBadge = actionType.agentType && actionType.agentType !== agentLabel ? actionType.agentType : null;

  const borderColor = isRunning ? 'border-primary/30 bg-primary/[0.03]' : isFailed ? 'border-red-400/30' : '';
  const hasOutput = output.length > 0;

  return (
    <div className={`bg-secondary border-border rounded-lg border ${borderColor} transition-colors`}>
      <button
        onClick={() => !isRunning && hasOutput && setExpanded(!expanded)}
        className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left ${!isRunning && hasOutput ? 'cursor-pointer' : 'cursor-default'}`}
      >
        {/* Agent icon */}
        <span className={`shrink-0 ${isRunning ? 'text-primary animate-pulse' : isSuccess ? 'text-green-400' : isFailed ? 'text-red-400' : 'text-muted-foreground'}`}>
          <Bot className="size-4" />
        </span>

        {/* Agent info */}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold ${isRunning ? 'zeus-shimmer-accent' : 'text-foreground/90'}`}>
              {agentLabel}
            </span>
            {typeBadge && (
              <span className="bg-primary/10 text-primary rounded px-1.5 py-0.5 text-[9px] font-medium">
                {typeBadge}
              </span>
            )}
            {isRunning && (
              <span className="zeus-shimmer text-[10px]">working...</span>
            )}
          </div>
          <span className="text-muted-foreground truncate text-[11px] leading-tight">
            {actionType.description || content}
          </span>
        </div>

        {/* Status + chevron */}
        <div className="flex shrink-0 items-center gap-1.5">
          <span className={`inline-block size-1.5 rounded-full ${isRunning ? 'bg-primary animate-pulse' : isSuccess ? 'bg-green-400' : isFailed ? 'bg-red-400' : 'bg-muted-foreground'}`} />
          {!isRunning && hasOutput && (
            <ChevronDown className={`text-muted-foreground size-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          )}
        </div>
      </button>

      {expanded && !isRunning && hasOutput && (
        <div className="border-border border-t px-3 pb-2">
          <GenericToolBody output={output} />
        </div>
      )}
    </div>
  );
}

export function ToolCard({ entryType, content, metadata, sessionDone, isLastEntry }: { entryType: NormalizedEntryType; content: string; metadata?: unknown; sessionDone?: boolean; isLastEntry?: boolean }) {
  if (entryType.type !== 'tool_use') return null;
  const { toolName, actionType, status } = entryType;
  const [expanded, setExpanded] = useState(false);

  const statusLabel = typeof status === 'string' ? status : status.status;
  const isRunning = statusLabel === 'created' && !sessionDone && isLastEntry === true;
  const isPending = statusLabel === 'pending_approval';
  const isDenied = statusLabel === 'denied';
  const isFailed = statusLabel === 'failed';
  const isSuccess = statusLabel === 'success' || (statusLabel === 'created' && sessionDone);

  const meta = metadata as { output?: string; images?: string[] } | undefined;
  const output = meta?.output || '';
  const images = meta?.images || [];

  // Agent/task_create gets its own dedicated card
  if (actionType.action === 'task_create') {
    return (
      <AgentCard
        actionType={actionType}
        status={statusLabel}
        content={content}
        output={output}
        sessionDone={sessionDone}
        isLastEntry={isLastEntry}
      />
    );
  }

  const borderColor =
    isPending ? 'border-orange-400/40 bg-orange-400/5' :
    isDenied ? 'border-red-400/40 bg-red-400/5' :
    isFailed ? 'border-red-400/30' :
    isRunning ? 'border-primary/30' :
    '';

  const statusDotColor =
    isRunning ? 'bg-primary' :
    isPending ? 'bg-orange-400' :
    isSuccess ? 'bg-green-400' :
    (isDenied || isFailed) ? 'bg-red-400' :
    'bg-muted-foreground';

  const title = getToolTitle(actionType);
  const subtitle = getToolSubtitle(actionType);
  const directory = getToolDirectory(actionType);
  const icon = getToolIcon(actionType);

  const isBash = actionType.action === 'command_run';
  const isEdit = actionType.action === 'file_edit';
  const isRead = actionType.action === 'file_read';
  const isSearch = actionType.action === 'search';
  const isMcp = actionType.action === 'mcp_tool';
  const mcpInput = isMcp ? actionType.input : '';
  const hasImages = images.length > 0;
  const hasExpandable = isBash ? true : isMcp ? (mcpInput.length > 0 || output.length > 0 || hasImages) : (output.length > 0 || hasImages || (isEdit && !!(actionType as unknown as { changes?: unknown[] }).changes));

  const handleToggle = () => {
    if (!hasExpandable || isRunning) return;
    setExpanded(!expanded);
  };

  return (
    <div className="space-y-1">
      <div className={`bg-secondary border-border rounded-lg border ${borderColor} transition-colors`}>
        {/* Trigger row */}
        <button
          onClick={handleToggle}
          className={`flex w-full items-center gap-2.5 px-3 py-2 text-left ${hasExpandable && !isRunning ? 'cursor-pointer' : 'cursor-default'}`}
        >
          {/* Icon */}
          <span className={`shrink-0 ${isRunning ? 'text-primary animate-pulse' : isSuccess ? 'text-green-400' : isFailed || isDenied ? 'text-red-400' : isPending ? 'text-orange-400' : 'text-muted-foreground'}`}>
            {icon}
          </span>

          {/* Title + subtitle */}
          <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
            <span className={`shrink-0 text-xs font-semibold ${isRunning ? 'zeus-shimmer-accent' : 'text-foreground/90'}`}>
              {title}
            </span>
            {!isRunning && subtitle && (
              <span className="text-muted-foreground min-w-0 truncate text-xs">
                {subtitle}
              </span>
            )}
            {isRunning && (
              <span className="zeus-shimmer text-xs">working...</span>
            )}
          </div>

          {/* Directory path (for file tools) */}
          {!isRunning && directory && (
            <span className="text-muted-foreground/50 hidden shrink-0 text-[10px] sm:block">
              {directory}
            </span>
          )}

          {/* Status dot + chevron */}
          <div className="flex shrink-0 items-center gap-1.5">
            <span className={`inline-block size-1.5 rounded-full ${statusDotColor} ${(isRunning || isPending) ? 'animate-pulse' : ''}`} />
            {hasExpandable && !isRunning && (
              <ChevronDown className={`text-muted-foreground size-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            )}
          </div>
        </button>

        {/* Expanded body — per-tool rendering */}
        {expanded && !isRunning && (
          <div className="border-border border-t px-3 pb-2">
            {isBash && <BashToolBody command={actionType.action === 'command_run' ? actionType.command : ''} output={output} />}
            {isEdit && <EditToolBody output={output} actionType={actionType} />}
            {isSearch && <SearchToolBody output={output} />}
            {isRead && output && <ReadToolBody output={output} path={actionType.action === 'file_read' ? actionType.path : ''} />}
            {isMcp && <McpToolBody input={mcpInput} output={output} images={images} />}
            {!isBash && !isEdit && !isSearch && !isRead && !isMcp && output && <GenericToolBody output={output} />}
            {!isMcp && hasImages && <ToolImages images={images} />}
          </div>
        )}
      </div>

      {hasImages && !isRunning && <ToolImages images={images} inline />}
    </div>
  );
}
