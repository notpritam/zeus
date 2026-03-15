import { motion } from 'framer-motion';
import StatusIndicator from '@/components/StatusIndicator';

interface StatusRowProps {
  label: string;
  status: string;
  active?: boolean;
}

function StatusRow({ label, status, active = false }: StatusRowProps) {
  return (
    <div className="[&+&]:border-border-dim flex items-center justify-between py-2.5 [&+&]:border-t">
      <div className="flex items-center gap-2">
        <StatusIndicator active={active} />
        <span className="text-text-muted text-[12px]">{label}</span>
      </div>
      <motion.span
        className={`rounded-sm px-2 py-0.5 text-[10px] font-semibold tracking-wider ${
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
