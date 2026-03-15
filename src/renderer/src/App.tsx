import { useEffect } from 'react';
import { motion } from 'framer-motion';
import StatusRow from '@/components/StatusRow';
import ModeToggle from '@/components/ModeToggle';
import { useZeusStore } from '@/stores/useZeusStore';

function App() {
  const { powerBlock, loading, init, togglePower } = useZeusStore();

  useEffect(() => {
    init();
  }, [init]);

  if (loading) return null;

  return (
    <div className="bg-bg text-text-secondary flex h-screen flex-col overflow-hidden select-none">
      {/* Drag region — clears macOS traffic lights */}
      <div className="h-12 w-full shrink-0" />

      <motion.div
        className="mx-6 flex flex-1 flex-col pb-5"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
      >
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-text-primary text-lg font-bold tracking-tight">Zeus</h1>
          <p className="text-text-dim mt-1 text-[10px] tracking-widest uppercase">
            Remote Orchestration Server
          </p>
        </div>

        {/* Mode Toggle */}
        <ModeToggle active={powerBlock} onToggle={togglePower} />

        {/* Services */}
        <div className="mt-5">
          <p className="text-text-dim mb-2 text-[10px] font-medium tracking-widest uppercase">
            Services
          </p>
          <div className="border-border bg-bg-card rounded-lg border px-4 py-1">
            <StatusRow
              label="Power Lock"
              status={powerBlock ? 'ACTIVE' : 'OFF'}
              active={powerBlock}
            />
            <StatusRow label="WebSocket" status="OFFLINE" />
            <StatusRow label="Tunnel" status="OFFLINE" />
          </div>
        </div>

        {/* Footer */}
        <div className="mt-auto pt-4">
          <div className="border-border-dim flex items-center justify-between border-t pt-3">
            <span className="text-text-ghost text-[10px]">Zeus v1.0.0</span>
            <span className={`text-[10px] ${powerBlock ? 'text-accent' : 'text-text-faint'}`}>
              {powerBlock ? 'Awake' : 'Sleeping'}
            </span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default App;
