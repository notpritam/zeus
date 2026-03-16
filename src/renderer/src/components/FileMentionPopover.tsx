import { useEffect, useRef } from 'react';
import { File, Folder } from 'lucide-react';
import {
  Command,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
  CommandEmpty,
} from '@/components/ui/command';
import { useFileSearch } from '@/hooks/useFileSearch';

interface FileMentionPopoverProps {
  sessionId: string;
  initialQuery: string;
  onSelect: (path: string, type: 'file' | 'directory') => void;
  onClose: () => void;
}

export default function FileMentionPopover({
  sessionId,
  initialQuery,
  onSelect,
  onClose,
}: FileMentionPopoverProps) {
  const { query, search, results, loading } = useFileSearch(sessionId);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    search(initialQuery);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape, true);
    };
  }, [onClose]);

  const folders = results.filter((r) => r.type === 'directory');
  const files = results.filter((r) => r.type === 'file');

  return (
    <div
      ref={containerRef}
      className="border-border bg-popover text-popover-foreground absolute bottom-full left-0 right-0 z-10 mb-1 overflow-hidden rounded-lg border shadow-lg"
    >
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="Search files..."
          value={query}
          onValueChange={(v) => search(v)}
          autoFocus
        />
        <CommandList className="max-h-[250px]">
          <CommandEmpty>
            {loading ? 'Searching...' : 'No files found'}
          </CommandEmpty>
          {folders.length > 0 && (
            <CommandGroup heading="Folders">
              {folders.map((r) => (
                <CommandItem
                  key={r.path}
                  value={r.path}
                  onSelect={() => onSelect(r.path, 'directory')}
                >
                  <Folder className="text-muted-foreground size-4" />
                  <span className="truncate font-mono text-xs">{r.path}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {files.length > 0 && (
            <CommandGroup heading="Files">
              {files.map((r) => (
                <CommandItem
                  key={r.path}
                  value={r.path}
                  onSelect={() => onSelect(r.path, 'file')}
                >
                  <File className="text-muted-foreground size-4" />
                  <span className="truncate font-mono text-xs">{r.path}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </div>
  );
}
