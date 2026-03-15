import { useEffect } from 'react';
import { motion } from 'framer-motion';
import StatusRow from '@/components/StatusRow';
import ModeToggle from '@/components/ModeToggle';
import { useZeusStore } from '@/stores/useZeusStore';

function App() {
  const { powerBlock, websocket, loading, init, togglePower } = useZeusStore();

  useEffect(() => {
    init();
  }, [init]);

  if (loading) return null;

  return (
    <div className="bg-bg text-text-secondary flex h-screen flex-col overflow-hidden select-none">
      {/* Drag region — clears macOS traffic lights */}
      <div className="h-12 w-full shrink-0" />

      <div
        data-testid="app-shell"
        className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto px-6 pb-6"
      >
        <motion.div
          data-testid="app-panel"
          className="bg-bg flex w-full max-w-[560px] flex-col gap-8 rounded-[28px] px-7 py-7"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
        >
          {/* Header */}
          <div className="flex flex-col items-center justify-center space-y-1.5">
            <h1 className="text-text-primary text-[1.75rem] font-bold tracking-[-0.04em]">Zeus</h1>
            <p className="text-text-dim text-[10px] tracking-[0.28em] uppercase">
              Remote Orchestration Server
            </p>
          </div>

          {/* Mode Toggle */}
          <ModeToggle active={powerBlock} onToggle={togglePower} />

          {/* Services */}
          <div className="flex flex-col gap-2 p-4">
            <p className="text-text-dim text-[10px] font-medium tracking-[0.28em] uppercase">
              Services
            </p>
            <div className="border-border bg-bg-card rounded-xl border px-4 py-2">
              <StatusRow
                label="Power Lock"
                status={powerBlock ? 'ACTIVE' : 'OFF'}
                active={powerBlock}
              />
              <StatusRow
                label="WebSocket"
                status={websocket ? 'ACTIVE' : 'OFFLINE'}
                active={websocket}
              />
              <StatusRow label="Tunnel" status="OFFLINE" />
            </div>
          </div>

          {/* Footer */}
          <div className="mt-auto pt-1">
            <div className="flex items-center justify-between">
              <span className="text-text-ghost text-[10px]">Zeus v1.0.0</span>
              <span className={`text-[10px] ${powerBlock ? 'text-accent' : 'text-text-faint'}`}>
                {powerBlock ? 'Awake' : 'Sleeping'}
              </span>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

export default App;
