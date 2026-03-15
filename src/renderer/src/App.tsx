import StatusRow from '@/components/StatusRow';

function App() {
  return (
    <div className="container">
      <h1>⚡ Zeus</h1>
      <p className="subtitle">Remote Orchestration Server</p>
      <div className="status-card">
        <StatusRow label="Power Lock" status="ACTIVE" active />
        <StatusRow label="WebSocket" status="OFFLINE" />
        <StatusRow label="Tunnel" status="OFFLINE" />
      </div>
      <p className="version">v1.0.0</p>
    </div>
  );
}

export default App;
