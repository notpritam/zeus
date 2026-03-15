import { motion } from 'framer-motion';

interface ModeToggleProps {
  active: boolean;
  onToggle: () => void;
}

function ModeToggle({ active, onToggle }: ModeToggleProps) {
  return (
    <button
      className="group border-border bg-bg-card hover:border-border-dim flex w-full cursor-pointer items-center justify-between rounded-xl border px-4 py-3 transition-colors [-webkit-app-region:no-drag]"
      onClick={onToggle}
    >
      <div className="flex items-center gap-3.5">
        <div
          className={`flex h-5 w-9 items-center rounded-full border p-0.5 transition-colors duration-200 ${
            active
              ? 'border-accent-border bg-accent-bg justify-end'
              : 'border-text-ghost bg-bg-surface justify-start'
          }`}
        >
          <motion.div
            className={`h-3.5 w-3.5 rounded-full transition-colors duration-200 ${
              active ? 'bg-accent' : 'bg-text-faint'
            }`}
            layout
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          />
        </div>
        <span className="text-text-secondary text-[13px]">Server Mode</span>
      </div>
      <motion.span
        className={`shrink-0 text-[10px] font-semibold tracking-[0.2em] ${active ? 'text-accent' : 'text-text-faint'}`}
        key={active ? 'running' : 'paused'}
        initial={{ opacity: 0, y: 3 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15 }}
      >
        {active ? 'RUNNING' : 'PAUSED'}
      </motion.span>
    </button>
  );
}

export default ModeToggle;
