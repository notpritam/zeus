import { useEffect, useState, useCallback, useMemo } from 'react';
import Header from '@/components/Header';
import SessionSidebar from '@/components/SessionSidebar';
import TerminalView from '@/components/TerminalView';
import ClaudeView from '@/components/ClaudeView';
import RightPanel from '@/components/RightPanel';
import DiffTabBar from '@/components/DiffTabBar';
import DiffView from '@/components/DiffView';
import NewClaudeSessionModal from '@/components/NewClaudeSessionModal';
import CommandPalette, { buildCommands } from '@/components/CommandPalette';
import SettingsModal from '@/components/SettingsModal';
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
    activeRightTab,
    openDiffTabs,
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
    resumeClaudeSession,
    sessionActivity,
    messageQueue,
    queueMessage,
    editQueuedMessage,
    removeQueuedMessage,
    selectClaudeSession,
    deleteClaudeSession,
    archiveClaudeSession,
    deleteTerminalSession,
    archiveTerminalSession,
    openNewClaudeModal,
    closeNewClaudeModal,
    toggleRightPanel,
    addProject,
    removeProject,
    settingsError,
  } = useZeusStore();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);

  useEffect(() => {
    const cleanup = connect();
    return cleanup;
  }, [connect]);

  useNotificationSound(claudeSessions, sessionActivity);

  const activeClaudeSession = claudeSessions.find((s) => s.id === activeClaudeId) ?? null;
  const activeEntries = activeClaudeId ? (claudeEntries[activeClaudeId] ?? []) : [];
  const activeActivity = activeClaudeId ? (sessionActivity[activeClaudeId] ?? { state: 'idle' as const }) : { state: 'idle' as const };
  const activeQueue = activeClaudeId ? (messageQueue[activeClaudeId] ?? []) : [];

  // Filter diff tabs to current session for tab bar visibility
  const currentSessionId = activeClaudeId ?? activeSessionId;
  const sessionDiffTabs = openDiffTabs.filter((t) => t.sessionId === currentSessionId);

  // Persist layout between page reloads
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'zeus-layout' });

  // Command palette commands
  const commands = useMemo(
    () =>
      buildCommands({
        powerBlock,
        tunnel,
        togglePower,
        startSession,
        openNewClaudeModal,
        toggleRightPanel,
        openSettings: () => setShowSettings(true),
      }),
    [powerBlock, tunnel, togglePower, startSession, openNewClaudeModal, toggleRightPanel],
  );

  // Global keyboard shortcuts (except ⌘K which is handled in CommandPalette)
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;

      if (e.key === ',') {
        e.preventDefault();
        setShowSettings((v) => !v);
      } else if (e.key === 't') {
        e.preventDefault();
        startSession();
      } else if (e.key === 'n') {
        e.preventDefault();
        openNewClaudeModal();
      } else if (e.key === 'b') {
        e.preventDefault();
        toggleRightPanel();
      }
    },
    [startSession, openNewClaudeModal, toggleRightPanel],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="bg-bg text-text-secondary flex h-screen flex-col overflow-hidden select-none">
      {/* macOS traffic light clearance */}
      <div className="h-6 w-full shrink-0 md:hidden" />

      <Header
        connected={connected}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        onToggleRightPanel={toggleRightPanel}
        rightPanelOpen={activeRightTab !== null}
        onOpenSettings={() => setShowSettings(true)}
        onOpenCommandPalette={() => setShowCommandPalette(true)}
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
            viewMode={viewMode}
            sessionActivity={sessionActivity}
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
            onDeleteClaudeSession={deleteClaudeSession}
            onArchiveClaudeSession={archiveClaudeSession}
            onDeleteTerminalSession={deleteTerminalSession}
            onArchiveTerminalSession={archiveTerminalSession}
            onOpenSettings={() => setShowSettings(true)}
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
              activity={activeActivity}
              queue={activeQueue}
              onSendMessage={sendClaudeMessage}
              onApprove={approveClaudeTool}
              onDeny={denyClaudeTool}
              onInterrupt={interruptClaude}
              onResume={() => activeClaudeId && resumeClaudeSession(activeClaudeId)}
              onQueueMessage={queueMessage}
              onEditQueued={editQueuedMessage}
              onRemoveQueued={removeQueuedMessage}
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
              viewMode={viewMode}
              sessionActivity={sessionActivity}
              onNewSession={() => startSession()}
              onNewClaudeSession={() => openNewClaudeModal()}
              onSelectSession={(id) => selectSession(id)}
              onStopSession={stopSession}
              onSelectClaudeSession={(id) => selectClaudeSession(id)}
              onDeleteClaudeSession={deleteClaudeSession}
              onArchiveClaudeSession={archiveClaudeSession}
              onDeleteTerminalSession={deleteTerminalSession}
              onArchiveTerminalSession={archiveTerminalSession}
              onOpenSettings={() => setShowSettings(true)}
            />
          </ResizablePanel>

          <ResizableHandle />

          <ResizablePanel
            id="content"
            defaultSize={activeRightTab ? '60%' : '75%'}
            minSize="30%"
          >
            <div data-testid="main-area-desktop" className="flex h-full flex-col">
              {sessionDiffTabs.length > 0 && <DiffTabBar />}

              <div className="min-h-0 flex-1">
                {viewMode === 'diff' ? (
                  <DiffView />
                ) : viewMode === 'claude' ? (
                  <ClaudeView
                    session={activeClaudeSession}
                    entries={activeEntries}
                    approvals={pendingApprovals}
                    activity={activeActivity}
                    queue={activeQueue}
                    onSendMessage={sendClaudeMessage}
                    onApprove={approveClaudeTool}
                    onDeny={denyClaudeTool}
                    onInterrupt={interruptClaude}
                    onResume={() => activeClaudeId && resumeClaudeSession(activeClaudeId)}
                    onQueueMessage={queueMessage}
                    onEditQueued={editQueuedMessage}
                    onRemoveQueued={removeQueuedMessage}
                  />
                ) : (
                  <TerminalView sessionId={activeSessionId} />
                )}
              </div>
            </div>
          </ResizablePanel>

          {activeRightTab ? (
            <>
              <ResizableHandle />
              <ResizablePanel id="right-panel" defaultSize="25%" minSize="200px" maxSize="40%">
                <RightPanel />
              </ResizablePanel>
            </>
          ) : (
            <div className="shrink-0">
              <RightPanel />
            </div>
          )}
        </ResizablePanelGroup>
      </div>

      {/* Command Palette (shadcn/cmdk) */}
      <CommandPalette
        open={showCommandPalette}
        onOpenChange={setShowCommandPalette}
        commands={commands}
      />

      {/* Settings Modal (shadcn Dialog) */}
      <SettingsModal
        open={showSettings}
        onOpenChange={setShowSettings}
        powerBlock={powerBlock}
        websocket={websocket}
        tunnel={tunnel}
        onTogglePower={togglePower}
      />

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
