import { useEffect, useRef } from 'react';
import type { SlashCommand } from '../../../shared/slash-commands';

interface SlashCommandPopoverProps {
  commands: SlashCommand[];
  selectedIdx: number;
  onSelect: (command: SlashCommand) => void;
  onClose: () => void;
}

export default function SlashCommandPopover({
  commands,
  selectedIdx,
  onSelect,
  onClose,
}: SlashCommandPopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Scroll selected item into view when index changes
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  if (commands.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="border-border bg-popover text-popover-foreground absolute bottom-full left-0 right-0 z-10 mb-1 overflow-hidden rounded-lg border shadow-lg"
    >
      <div className="text-muted-foreground border-border border-b px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide">
        Slash Commands
      </div>
      <ul className="max-h-[220px] overflow-y-auto py-1">
        {commands.map((cmd, i) => (
          <li key={cmd.command}>
            <button
              ref={i === selectedIdx ? selectedRef : undefined}
              type="button"
              className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                i === selectedIdx
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent/50'
              }`}
              onMouseDown={(e) => {
                // Use mousedown so blur on input doesn't fire first
                e.preventDefault();
                onSelect(cmd);
              }}
            >
              <span className="text-primary shrink-0 font-mono font-semibold">
                {cmd.command}
              </span>
              {cmd.args && (
                <span className="text-muted-foreground shrink-0 font-mono text-xs">
                  {cmd.args}
                </span>
              )}
              <span className="text-muted-foreground min-w-0 truncate text-xs">
                {cmd.description}
              </span>
              {cmd.localHandler && (
                <span className="text-muted-foreground ml-auto shrink-0 text-[10px]">local</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
