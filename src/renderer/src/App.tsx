import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import SessionSidebar from '@/components/SessionSidebar';
import TerminalView from '@/components/TerminalView';
import ClaudeView from '@/components/ClaudeView';
import RightPanel from '@/components/RightPanel';
import NewClaudeSessionModal from '@/components/NewClaudeSessionModal';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
  useDefaultLayout,
} from '@/components/ui/ResizablePanel';
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
    rightPanelOpen,
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
    toggleRightPanel,
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

  // Persist layout between page reloads
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'zeus-layout' });

  return (
    <div className="bg-bg text-text-secondary flex h-screen flex-col overflow-hidden select-none">
      {/* macOS traffic light clearance */}
      <div className="h-6 w-full shrink-0 md:hidden" />

      <Header
        connected={connected}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        onToggleRightPanel={toggleRightPanel}
        rightPanelOpen={rightPanelOpen}
      />

      {/* Mobile layout */}
      <div data-testid="app-shell" className="relative flex min-h-0 flex-1 md:hidden">
        {/* Sidebar slide-over on mobile */}
        <div
          data-testid="sidebar-panel"
          className={`absolute inset-y-0 left-0 z-10 w-[280px] transition-transform ${
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
            className="absolute inset-0 z-[5] bg-black/50"
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

      {/* Desktop 3-panel layout */}
      <div data-testid="app-shell-desktop" className="hidden min-h-0 flex-1 md:flex">
        <ResizablePanelGroup
          orientation="horizontal"
          defaultLayout={defaultLayout}
          onLayoutChanged={onLayoutChanged}
        >
          <ResizablePanel id="sidebar" defaultSize="15%" minSize="200px" maxSize="25%">
            <SessionSidebar
              sessions={sessions}
              activeSessionId={activeSessionId}
              claudeSessions={claudeSessions}
              activeClaudeId={activeClaudeId}
              powerBlock={powerBlock}
              websocket={websocket}
              tunnel={tunnel}
              viewMode={viewMode}
              onNewSession={() => startSession()}
              onNewClaudeSession={() => openNewClaudeModal()}
              onSelectSession={(id) => selectSession(id)}
              onStopSession={stopSession}
              onSelectClaudeSession={(id) => selectClaudeSession(id)}
              onTogglePower={togglePower}
            />
          </ResizablePanel>

          <ResizableHandle />

          <ResizablePanel
            id="content"
            defaultSize={rightPanelOpen ? '60%' : '85%'}
            minSize="30%"
          >
            <div data-testid="main-area-desktop" className="h-full">
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
          </ResizablePanel>

          {rightPanelOpen && (
            <>
              <ResizableHandle />
              <ResizablePanel id="right-panel" defaultSize="25%" minSize="200px" maxSize="40%">
                <RightPanel />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
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
