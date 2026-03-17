import * as React from 'react';
import { cn } from '@/lib/utils';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}

function BottomSheet({ open, onClose, children, className }: BottomSheetProps) {
  // Close on Escape
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 animate-in fade-in-0 duration-200"
        onClick={onClose}
      />
      {/* Sheet */}
      <div
        className={cn(
          'relative w-full max-w-sm rounded-t-2xl border border-b-0 bg-background px-2 pb-6 pt-3 shadow-xl',
          'animate-in slide-in-from-bottom duration-200',
          className,
        )}
      >
        {/* Drag handle */}
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30" />
        {children}
      </div>
    </div>
  );
}

interface BottomSheetItemProps {
  icon?: React.ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}

function BottomSheetItem({ icon, label, onClick, destructive }: BottomSheetItemProps) {
  return (
    <button
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm font-medium transition-colors',
        destructive
          ? 'text-destructive hover:bg-destructive/10'
          : 'text-foreground hover:bg-secondary',
      )}
      onClick={onClick}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {label}
    </button>
  );
}

export { BottomSheet, BottomSheetItem };
