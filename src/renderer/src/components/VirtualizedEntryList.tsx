import { useRef, useEffect, useCallback, useMemo, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Loader2 } from 'lucide-react';
import { EntryItem, CompressedGroup, groupEntriesByUser } from '@/components/EntryRenderers';
import type { EntryGroup } from '@/components/EntryRenderers';
import type { NormalizedEntry } from '../../../shared/types';

// ─── Types ───

interface VirtualizedEntryListProps {
  entries: NormalizedEntry[];
  compressed: boolean;
  sessionDone: boolean;
  sessionRunning: boolean;
  queue: Array<{ id: string; content: string }>;
  /** Called when scroll nears the top to load older entries */
  onLoadMore: () => void;
  /** Whether older entries are currently loading */
  loadingOlder: boolean;
  /** Render queued message items */
  renderQueueItem: (msg: { id: string; content: string }) => React.ReactNode;
  /** Expose scroll state so parent can show/hide scroll-to-bottom button */
  onScrollStateChange: (atBottom: boolean) => void;
  /** Imperative handle for parent to scroll to bottom */
  scrollToBottomRef: React.MutableRefObject<(() => void) | null>;
}

// ─── Virtual row wrapper (for measureElement) ───

interface VirtualRowProps {
  index: number;
  measureRef: (el: HTMLDivElement | null) => void;
  children: React.ReactNode;
}

const VirtualRow = memo(function VirtualRow({ measureRef, children }: VirtualRowProps) {
  return (
    <div ref={measureRef} className="pb-3">
      {children}
    </div>
  );
});
VirtualRow.displayName = 'VirtualRow';

// ─── Item types for the unified virtual list ───

type VirtualItem =
  | { type: 'entry'; entry: NormalizedEntry; isLast: boolean }
  | { type: 'group'; group: EntryGroup; isLast: boolean }
  | { type: 'queue'; messages: Array<{ id: string; content: string }> }
  | { type: 'empty' };

// ─── Main Component ───

function VirtualizedEntryList({
  entries,
  compressed,
  sessionDone,
  sessionRunning,
  queue,
  onLoadMore,
  loadingOlder,
  renderQueueItem,
  onScrollStateChange,
  scrollToBottomRef,
}: VirtualizedEntryListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);
  const prevItemCount = useRef(0);

  // Build the unified item list for the virtualizer
  const items: VirtualItem[] = useMemo(() => {
    const result: VirtualItem[] = [];

    if (compressed) {
      const groups = groupEntriesByUser(entries);
      groups.forEach((group, i) => {
        result.push({
          type: 'group',
          group,
          isLast: i === groups.length - 1,
        });
      });
    } else {
      entries.forEach((entry, i) => {
        result.push({
          type: 'entry',
          entry,
          isLast: i === entries.length - 1,
        });
      });
    }

    // Append queued messages as a single virtual row
    if (queue.length > 0) {
      result.push({ type: 'queue', messages: queue });
    }

    // Empty state
    if (entries.length === 0 && sessionRunning) {
      result.push({ type: 'empty' });
    }

    return result;
  }, [entries, compressed, queue, sessionRunning]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 80, // reasonable default; measureElement refines it
    overscan: 10,
    measureElement: (el) => {
      // Use getBoundingClientRect for accurate measurement including margins
      if (!el) return 0;
      return el.getBoundingClientRect().height;
    },
  });

  // Scroll to bottom when new items arrive (unless user scrolled up)
  useEffect(() => {
    const count = items.length;
    if (count > prevItemCount.current && !userScrolledUp.current && count > 0) {
      // Use requestAnimationFrame to ensure measurements are settled
      requestAnimationFrame(() => {
        virtualizer.scrollToIndex(count - 1, { align: 'end', behavior: 'auto' });
      });
    }
    prevItemCount.current = count;
  }, [items.length, virtualizer]);

  // Also auto-scroll when the last entry content changes (streaming updates)
  const lastEntryId = entries[entries.length - 1]?.id;
  const lastEntryContent = entries[entries.length - 1]?.content;
  useEffect(() => {
    if (!userScrolledUp.current && items.length > 0) {
      requestAnimationFrame(() => {
        virtualizer.scrollToIndex(items.length - 1, { align: 'end', behavior: 'auto' });
      });
    }
  }, [lastEntryId, lastEntryContent, items.length, virtualizer]);

  // Track scroll position for "user scrolled up" detection + load more
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      userScrolledUp.current = !atBottom;
      onScrollStateChange(atBottom);

      // Load more when near top
      if (el.scrollTop < 200) {
        onLoadMore();
      }
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [onLoadMore, onScrollStateChange]);

  // Expose scroll-to-bottom to parent
  const scrollToBottom = useCallback(() => {
    if (items.length > 0) {
      virtualizer.scrollToIndex(items.length - 1, { align: 'end', behavior: 'smooth' });
      userScrolledUp.current = false;
      onScrollStateChange(true);
    }
  }, [items.length, virtualizer, onScrollStateChange]);

  useEffect(() => {
    scrollToBottomRef.current = scrollToBottom;
  }, [scrollToBottom, scrollToBottomRef]);

  // Render a single virtual item
  const renderItem = useCallback(
    (item: VirtualItem) => {
      switch (item.type) {
        case 'entry':
          return (
            <EntryItem
              entry={item.entry}
              sessionDone={sessionDone}
              isLastEntry={item.isLast}
            />
          );
        case 'group':
          return (
            <CompressedGroup
              group={item.group}
              isLast={item.isLast}
              sessionDone={sessionDone}
            />
          );
        case 'queue':
          return (
            <div className="space-y-2">
              {item.messages.map((msg) => renderQueueItem(msg))}
            </div>
          );
        case 'empty':
          return (
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-3 animate-spin" />
              Starting Claude session...
            </div>
          );
      }
    },
    [sessionDone, renderQueueItem],
  );

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto"
      style={{ contain: 'strict' }}
    >
      {/* Loading older badge */}
      {loadingOlder && (
        <div className="flex justify-center py-2">
          <div className="bg-card border-border text-muted-foreground flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs shadow-md">
            <Loader2 className="size-3 animate-spin" />
            Loading...
          </div>
        </div>
      )}

      {/* Virtual container */}
      <div
        className="relative w-full px-4"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualItems.map((virtualRow) => {
          const item = items[virtualRow.index];
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full px-4"
              style={{
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div className="pb-3">
                {renderItem(item)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default memo(VirtualizedEntryList);
