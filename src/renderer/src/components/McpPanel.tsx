import { useEffect } from 'react';
import { RefreshCw, Settings, Loader2, Plug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useZeusStore } from '@/stores/useZeusStore';

function McpPanel() {
  const activeClaudeId = useZeusStore((s) => s.activeClaudeId);
  const claudeSessions = useZeusStore((s) => s.claudeSessions);
  const sessionMcps = useZeusStore((s) => s.sessionMcps);
  const mcpHealthResults = useZeusStore((s) => s.mcpHealthResults);
  const fetchSessionMcps = useZeusStore((s) => s.fetchSessionMcps);
  const healthCheckMcp = useZeusStore((s) => s.healthCheckMcp);
  const setActiveRightTab = useZeusStore((s) => s.setActiveRightTab);

  const activeSession = claudeSessions.find((s) => s.id === activeClaudeId);
  const mcps = activeClaudeId ? (sessionMcps[activeClaudeId] ?? []) : [];

  // Fetch session MCPs when active session changes
  useEffect(() => {
    if (activeClaudeId) {
      fetchSessionMcps(activeClaudeId);
    }
  }, [activeClaudeId]);

  const handleRefresh = () => {
    // Health check all session MCPs
    for (const mcp of mcps) {
      healthCheckMcp(mcp.serverId);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="border-border bg-card sticky top-0 z-10 shrink-0 border-b">
        <div className="flex items-center gap-2 px-3 py-2">
          <Plug className="text-primary size-4" />
          <span className="text-primary text-sm font-bold">Session MCPs</span>
          <div className="flex-1" />
          {activeSession && mcps.length > 0 && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="size-5"
              onClick={handleRefresh}
              title="Refresh health"
            >
              <RefreshCw className="size-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {!activeSession ? (
          <div className="flex flex-col items-center justify-center gap-3 px-4 py-8 text-center">
            <Plug className="text-muted-foreground/30 size-8" />
            <div>
              <p className="text-muted-foreground text-xs">No active session.</p>
              <p className="text-muted-foreground/60 text-[10px] mt-1">
                Start a Claude session to see attached MCP servers.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 gap-1.5 text-xs"
              onClick={() => setActiveRightTab('settings')}
            >
              <Settings className="size-3" />
              Manage MCPs
            </Button>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {/* zeus-bridge — always present */}
            <div className="flex items-center gap-2.5 rounded-md px-2.5 py-2">
              <span className="size-2 shrink-0 rounded-full bg-green-500" />
              <span className="text-xs font-medium flex-1">zeus-bridge</span>
              <span className="text-[10px] text-muted-foreground">always on</span>
            </div>

            {/* Attached MCPs */}
            {mcps.map((mcp) => {
              const health = mcpHealthResults[mcp.serverId];
              const status = mcp.status;
              const isChecking = health === undefined && status === 'attached';

              return (
                <div
                  key={mcp.serverId}
                  className="flex items-center gap-2.5 rounded-md px-2.5 py-2 hover:bg-secondary/40 transition-colors"
                >
                  {/* Status dot */}
                  {status === 'active' ? (
                    <span className="size-2 shrink-0 rounded-full bg-green-500" />
                  ) : status === 'failed' ? (
                    <span className="size-2 shrink-0 rounded-full bg-red-500" />
                  ) : isChecking ? (
                    <Loader2 className="size-2 shrink-0 animate-spin text-muted-foreground" />
                  ) : (
                    <span className="size-2 shrink-0 rounded-full bg-muted-foreground/40" />
                  )}

                  <span className="text-xs font-medium flex-1 truncate">{mcp.serverName}</span>

                  <span className={`text-[10px] ${
                    status === 'active' ? 'text-green-400' :
                    status === 'failed' ? 'text-red-400' :
                    'text-muted-foreground'
                  }`}>
                    {status}
                  </span>

                  {health && (
                    <span className="text-[10px] text-muted-foreground/60">
                      {health.latencyMs}ms
                    </span>
                  )}
                </div>
              );
            })}

            {mcps.length === 0 && (
              <p className="text-muted-foreground/60 text-[10px] px-2.5 py-2">
                No external MCPs attached to this session.
              </p>
            )}

            {/* Footer info */}
            <div className="border-border mt-3 border-t pt-3 px-2.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">
                  Attached: {mcps.length} server{mcps.length !== 1 ? 's' : ''}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-1.5 text-xs"
                onClick={() => setActiveRightTab('settings')}
              >
                <Settings className="size-3" />
                Manage MCPs
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default McpPanel;
