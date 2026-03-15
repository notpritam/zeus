import { motion } from 'framer-motion';

interface StatusRowProps {
  label: string;
  status: string;
  active?: boolean;
}

function StatusRow({ label, status, active = false }: StatusRowProps) {
  return (
    <div className="[&+&]:border-zeus-border-dim flex items-center justify-between py-2 [&+&]:border-t">
      <span className="text-zeus-muted text-sm">{label}</span>
      <motion.span
        className={`rounded px-2.5 py-0.5 text-[0.65rem] font-semibold tracking-wider ${
          active ? 'bg-zeus-green-bg text-zeus-green' : 'bg-zeus-surface text-zeus-faint'
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
