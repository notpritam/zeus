import { motion } from 'framer-motion';
import StatusIndicator from '@/components/StatusIndicator';

interface StatusRowProps {
  label: string;
  status: string;
  active?: boolean;
}

function StatusRow({ label, status, active = false }: StatusRowProps) {
  return (
    <div className="[&+&]:border-border-dim flex items-center justify-between gap-4 py-3 [&+&]:border-t">
      <div className="flex min-w-0 items-center gap-2.5">
        <StatusIndicator active={active} />
        <span className="text-text-muted text-[13px]">{label}</span>
      </div>
      <motion.span
        className={`shrink-0 rounded-sm px-2 py-0.5 text-[10px] font-semibold tracking-[0.2em] ${
          active ? 'bg-accent-bg text-accent' : 'bg-bg-surface text-text-faint'
        }`}
        key={`${label}-${active}`}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
      >
        {status}
      </motion.span>
    </div>
  );
}

export default StatusRow;
