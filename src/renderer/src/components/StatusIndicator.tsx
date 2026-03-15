import { motion } from 'framer-motion';

interface StatusIndicatorProps {
  active: boolean;
}

function StatusIndicator({ active }: StatusIndicatorProps) {
  return (
    <span className="relative flex h-2 w-2">
      {active && (
        <motion.span
          className="bg-accent absolute inline-flex h-full w-full rounded-full opacity-75"
          animate={{ scale: [1, 1.8, 1], opacity: [0.75, 0, 0.75] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
      <span
        className={`relative inline-flex h-2 w-2 rounded-full ${active ? 'bg-accent' : 'bg-text-ghost'}`}
      />
    </span>
  );
}

export default StatusIndicator;
