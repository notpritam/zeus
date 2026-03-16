import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import { cn } from '@/lib/utils';

export { useDefaultLayout };

export function ResizablePanelGroup({
  className,
  ...props
}: React.ComponentProps<typeof Group>) {
  return <Group className={cn('flex h-full w-full', className)} {...props} />;
}

export function ResizablePanel({ className, ...props }: React.ComponentProps<typeof Panel>) {
  return <Panel className={cn(className)} {...props} />;
}

export function ResizableHandle({
  className,
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      className={cn(
        'bg-border hover:bg-info active:bg-info w-px shrink-0 transition-colors duration-150',
        className,
      )}
      {...props}
    />
  );
}
