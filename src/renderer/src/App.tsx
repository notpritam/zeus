import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import StatusRow from '@/components/StatusRow';
import ModeToggle from '@/components/ModeToggle';

function App() {
  const [active, setActive] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.zeus.getStatus().then((status) => {
      setActive(status.powerBlock);
      setLoading(false);
    });
  }, []);

  const handleToggle = async () => {
    const newState = await window.zeus.togglePower();
    setActive(newState);
  };

  if (loading) return null;

  return (
    <div className="bg-zeus-bg flex h-screen items-center justify-center text-gray-200 select-none">
      <motion.div
        className="w-full px-8 pt-10 pb-8 text-center"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <h1 className="mb-1 text-3xl font-bold text-white">Zeus</h1>
        <p className="text-zeus-dim mb-6 text-xs tracking-[0.15em] uppercase">
          Remote Orchestration Server
        </p>

        <div className="mb-6">
          <ModeToggle active={active} onToggle={handleToggle} />
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            className="border-zeus-border bg-zeus-card mx-auto max-w-70 rounded-lg border p-4"
            key={active ? 'active' : 'paused'}
            initial={{ opacity: 0.8 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            <StatusRow label="Power Lock" status={active ? 'ACTIVE' : 'OFF'} active={active} />
            <StatusRow label="WebSocket" status="OFFLINE" />
            <StatusRow label="Tunnel" status="OFFLINE" />
          </motion.div>
        </AnimatePresence>

        <p className="text-zeus-ghost mt-6 text-[0.65rem]">v1.0.0</p>
      </motion.div>
    </div>
  );
}

export default App;
