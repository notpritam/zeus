import { motion } from 'framer-motion';

interface ModeToggleProps {
  active: boolean;
  onToggle: () => void;
}

function ModeToggle({ active, onToggle }: ModeToggleProps) {
  return (
    <button
      className="inline-flex cursor-pointer items-center gap-3 border-none bg-transparent p-1 [-webkit-app-region:no-drag]"
      onClick={onToggle}
    >
      <div
        className={`flex h-[22px] w-10 items-center rounded-full border p-0.5 transition-colors duration-200 ${
          active
            ? 'border-zeus-green-border bg-zeus-green-bg justify-end'
            : 'border-zeus-ghost bg-zeus-surface justify-start'
        }`}
      >
        <motion.div
          className={`h-4 w-4 rounded-full transition-colors duration-200 ${
            active ? 'bg-zeus-green' : 'bg-zeus-faint'
          }`}
          layout
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        />
      </div>
      <motion.span
        className="text-zeus-dim font-mono text-[0.65rem] font-semibold tracking-[0.12em]"
        key={active ? 'running' : 'paused'}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        {active ? 'RUNNING' : 'PAUSED'}
      </motion.span>
    </button>
  );
}

export default ModeToggle;
