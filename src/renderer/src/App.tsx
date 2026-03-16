import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import SessionSidebar from '@/components/SessionSidebar';
import TerminalView from '@/components/TerminalView';
import ClaudeView from '@/components/ClaudeView';
import NewClaudeSessionModal from '@/components/NewClaudeSessionModal';
import { useZeusStore } from '@/stores/useZeusStore';
import { useNotificationSound } from '@/hooks/useNotificationSound';
import { zeusWs } from '@/lib/ws';

function App() {
  const {
    connected,
    powerBlock,
    websocket,
    tunnel,
    sessions,
    activeSessionId,
    claudeSessions,
    activeClaudeId,
    claudeEntries,
    pendingApprovals,
    viewMode,
    savedProjects,
    claudeDefaults,
    lastUsedProjectId,
    showNewClaudeModal,
    connect,
    togglePower,
    startSession,
    stopSession,
    selectSession,
    startClaudeSession,
    sendClaudeMessage,
    approveClaudeTool,
    denyClaudeTool,
    interruptClaude,
    selectClaudeSession,
    openNewClaudeModal,
    closeNewClaudeModal,
    addProject,
    removeProject,
    settingsError,
  } = useZeusStore();

  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const cleanup = connect();
    return cleanup;
  }, [connect]);

  useNotificationSound(claudeSessions);

  const activeClaudeSession = claudeSessions.find((s) => s.id === activeClaudeId) ?? null;
  const activeEntries = activeClaudeId ? (claudeEntries[activeClaudeId] ?? []) : [];

  return (
    <div className="bg-bg text-text-secondary flex h-screen flex-col overflow-hidden select-none">
      {/* macOS traffic light clearance */}
      <div className="h-6 w-full shrink-0 md:hidden" />

      <Header
        connected={connected}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
      />

      <div data-testid="app-shell" className="relative flex min-h-0 flex-1">
        {/* Sidebar — always visible on desktop, slide-over on mobile */}
        <div
          data-testid="sidebar-panel"
          className={`absolute inset-y-0 left-0 z-10 w-[280px] transition-transform md:relative md:translate-x-0 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <SessionSidebar
            sessions={sessions}
            activeSessionId={activeSessionId}
            claudeSessions={claudeSessions}
            activeClaudeId={activeClaudeId}
            powerBlock={powerBlock}
            websocket={websocket}
            tunnel={tunnel}
            viewMode={viewMode}
            onNewSession={() => {
              startSession();
              setSidebarOpen(false);
            }}
            onNewClaudeSession={() => {
              openNewClaudeModal();
              setSidebarOpen(false);
            }}
            onSelectSession={(id) => {
              selectSession(id);
              setSidebarOpen(false);
            }}
            onStopSession={stopSession}
            onSelectClaudeSession={(id) => {
              selectClaudeSession(id);
              setSidebarOpen(false);
            }}
            onTogglePower={togglePower}
          />
        </div>

        {/* Backdrop for mobile slide-over */}
        {sidebarOpen && (
          <div
            className="absolute inset-0 z-[5] bg-black/50 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Main Content — Terminal or Claude */}
        <div data-testid="main-area" className="min-w-0 flex-1">
          {viewMode === 'claude' ? (
            <ClaudeView
              session={activeClaudeSession}
              entries={activeEntries}
              approvals={pendingApprovals}
              onSendMessage={sendClaudeMessage}
              onApprove={approveClaudeTool}
              onDeny={denyClaudeTool}
              onInterrupt={interruptClaude}
            />
          ) : (
            <TerminalView sessionId={activeSessionId} />
          )}
        </div>
      </div>

      {/* New Claude Session Modal */}
      <NewClaudeSessionModal
        open={showNewClaudeModal}
        onClose={closeNewClaudeModal}
        savedProjects={savedProjects}
        claudeDefaults={claudeDefaults}
        lastUsedProjectId={lastUsedProjectId}
        onStart={(config) => {
          startClaudeSession(config);
          // Persist last used project
          const project = savedProjects.find((p) => p.path === config.workingDir);
          if (project) {
            zeusWs.send({
              channel: 'settings',
              sessionId: '',
              payload: { type: 'set_last_used_project', id: project.id },
              auth: '',
            });
          }
        }}
        onAddProject={addProject}
        onRemoveProject={removeProject}
        settingsError={settingsError}
      />
    </div>
  );
}

export default App;
