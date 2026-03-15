import { useRef } from 'react';
import { useTerminal } from '@/hooks/useTerminal';

interface TerminalViewProps {
  sessionId: string | null;
}

function TerminalView({ sessionId }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  useTerminal(sessionId, containerRef);

  if (!sessionId) {
    return (
      <div
        data-testid="terminal-empty"
        className="bg-bg text-text-dim flex h-full items-center justify-center"
      >
        <p className="text-sm">No session selected &mdash; click New Session</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="terminal-container"
      className="bg-bg h-full w-full overflow-hidden p-1"
    />
  );
}

export default TerminalView;
