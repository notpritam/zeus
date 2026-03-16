import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Component, useState, memo, type ComponentPropsWithoutRef, type ReactNode } from 'react';

// Override oneDark background to match Zeus theme
const codeTheme = {
  ...oneDark,
  '::selection': {},
  'pre[class*="language-"]': {
    ...oneDark['pre[class*="language-"]'],
    background: '#1a1a1a',
    margin: 0,
    padding: '0.75rem',
    fontSize: '0.8rem',
  },
  'code[class*="language-"]': {
    ...oneDark['code[class*="language-"]'],
    background: '#1a1a1a',
    fontSize: '0.8rem',
  },
};

// ─── Streaming-safe markdown sanitizer ───
// Closes any unclosed code fences so react-markdown doesn't crash on partial content.

function sanitizeStreamingMarkdown(content: string): string {
  // Count triple backtick fences (``` with optional language)
  const fenceRegex = /^(`{3,})/gm;
  let fenceCount = 0;
  let match;
  while ((match = fenceRegex.exec(content)) !== null) {
    // Only count opening/closing fences, not inline code
    fenceCount++;
    // Skip to avoid matching same position
    fenceRegex.lastIndex = match.index + match[0].length;
  }

  // If odd number of fences, there's an unclosed one — close it
  if (fenceCount % 2 !== 0) {
    return content + '\n```';
  }

  return content;
}

// ─── Error Boundary (last-resort fallback) ───

interface ErrorBoundaryProps {
  children: ReactNode;
  content: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  lastContent: string;
}

class MarkdownErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, lastContent: props.content };
  }

  static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return { hasError: true };
  }

  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): Partial<ErrorBoundaryState> | null {
    // Only reset error when content length changes significantly (not every delta)
    if (state.hasError && Math.abs(props.content.length - state.lastContent.length) > 50) {
      return { hasError: false, lastContent: props.content };
    }
    if (!state.hasError) {
      return { lastContent: props.content };
    }
    return null;
  }

  render() {
    if (this.state.hasError) {
      return (
        <p className="text-text-secondary text-sm whitespace-pre-wrap">
          {this.props.content}
        </p>
      );
    }
    return this.props.children;
  }
}

// ─── Components ───

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      className="text-text-ghost hover:text-text-muted text-[10px] transition-colors"
      onClick={handleCopy}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function CodeBlock({
  className,
  children,
  node: _node,
  ...props
}: ComponentPropsWithoutRef<'code'> & { inline?: boolean; node?: unknown }) {
  const match = /language-(\w+)/.exec(className || '');
  const code = String(children).replace(/\n$/, '');
  const isInline = !match && !code.includes('\n');

  if (isInline) {
    return (
      <code
        className="bg-bg-surface text-info rounded px-1.5 py-0.5 font-mono text-[0.85em]"
        {...props}
      >
        {children}
      </code>
    );
  }

  const language = match?.[1] || 'text';

  return (
    <div className="bg-bg-surface border-border group relative my-2 overflow-hidden rounded-lg border">
      <div className="border-border flex items-center justify-between border-b px-3 py-1.5">
        <span className="text-text-ghost text-[10px] font-medium uppercase">{language}</span>
        <CopyButton text={code} />
      </div>
      <SyntaxHighlighter
        style={codeTheme}
        language={language}
        PreTag="div"
        customStyle={{ background: 'transparent', margin: 0 }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

const Markdown = memo(function Markdown({ content }: { content: string }) {
  if (!content) return null;

  const safeContent = sanitizeStreamingMarkdown(content);

  return (
    <MarkdownErrorBoundary content={content}>
      <div className="zeus-markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            // Strip default <pre> wrapper — CodeBlock handles its own container
            pre: ({ children }) => <>{children}</>,
            code: CodeBlock,
            a: ({ children, ...props }) => (
              <a
                className="text-info hover:text-info/80 underline underline-offset-2"
                target="_blank"
                rel="noopener noreferrer"
                {...props}
              >
                {children}
              </a>
            ),
            table: ({ children }) => (
              <div className="my-2 overflow-x-auto">
                <table className="border-border w-full border-collapse text-sm">{children}</table>
              </div>
            ),
            th: ({ children }) => (
              <th className="bg-bg-surface border-border border px-3 py-1.5 text-left text-xs font-semibold">
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td className="border-border border px-3 py-1.5 text-xs">{children}</td>
            ),
          }}
        >
          {safeContent}
        </ReactMarkdown>
      </div>
    </MarkdownErrorBoundary>
  );
});

export default Markdown;
