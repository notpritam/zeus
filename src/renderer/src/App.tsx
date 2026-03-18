import { useEffect, useState, useCallback, useMemo, Component, type ReactNode } from 'react';
import { X, AlertTriangle, RotateCcw } from 'lucide-react';
import Header from '@/components/Header';
import SessionSidebar from '@/components/SessionSidebar';
import TerminalView from '@/components/TerminalView';
import ClaudeView from '@/components/ClaudeView';
import RightPanel from '@/components/RightPanel';
import DiffTabBar from '@/components/DiffTabBar';
import DiffView from '@/components/DiffView';
import NewClaudeSessionModal from '@/components/NewClaudeSessionModal';
import CommandPalette, { buildCommands } from '@/components/CommandPalette';
import SettingsView from '@/components/SettingsView';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
  useDefaultLayout,
} from '@/components/ui/ResizablePanel';
import { useZeusStore } from '@/stores/useZeusStore';
import { useNotificationSound } from '@/hooks/useNotificationSound';
import { zeusWs } from '@/lib/ws';

// ─── Error Boundary for DiffView / any panel ───

class PanelErrorBoundary extends Component<
  { children: ReactNode; name: string; onReset?: () => void },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode; name: string; onReset?: () => void }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    // Silently swallow ResizeObserver errors — they're harmless
    if (error.message?.includes('ResizeObserver')) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
          <AlertTriangle className="text-warn size-6" />
          <p className="text-foreground text-sm font-medium">{this.props.name} Error</p>
          <p className="text-muted-foreground max-w-sm text-center text-xs">
            {this.state.error?.message || 'Something went wrong rendering this panel.'}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              this.props.onReset?.();
            }}
            className="border-border text-foreground hover:bg-secondary mt-1 flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors"
          >
            <RotateCcw className="size-3" />
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

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
    toggleTunnel,
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
    lastActivityAt,
    messageQueue,
    queueMessage,
    editQueuedMessage,
    removeQueuedMessage,
    selectClaudeSession,
    updateClaudeSession,
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
    setViewMode,
  } = useZeusStore();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [mobileRightPanelOpen, setMobileRightPanelOpen] = useState(false);

  const openSettings = useCallback(() => setViewMode('settings'), [setViewMode]);

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
        openSettings,
      }),
    [powerBlock, tunnel, togglePower, startSession, openNewClaudeModal, toggleRightPanel, openSettings],
  );

  // Global keyboard shortcuts (except ⌘K which is handled in CommandPalette)
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;

      if (e.key === ',') {
        e.preventDefault();
        // Toggle settings view — if already on settings, go back to terminal
        if (viewMode === 'settings') {
          setViewMode('terminal');
        } else {
          setViewMode('settings');
        }
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
    [startSession, openNewClaudeModal, toggleRightPanel, viewMode, setViewMode],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="bg-bg text-text-secondary flex h-screen flex-col overflow-hidden select-none" style={{ height: '100dvh' }}>
      {/* macOS traffic light clearance — only when main Header is visible on mobile */}
      <div className={`h-6 w-full shrink-0 md:hidden ${viewMode === 'claude' ? 'hidden' : ''}`} />

      {/* Main Header — hidden on mobile when Claude view is active (ClaudeView has its own header) */}
      <div className={`${viewMode === 'claude' ? 'hidden md:block' : ''}`}>
        <Header
          connected={connected}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          onToggleRightPanel={toggleRightPanel}
          rightPanelOpen={activeRightTab !== null}
          onOpenSettings={openSettings}
          onOpenCommandPalette={() => setShowCommandPalette(true)}
        />
      </div>

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
            lastActivityAt={lastActivityAt}
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
            onUpdateClaudeSession={updateClaudeSession}
            onDeleteClaudeSession={deleteClaudeSession}
            onArchiveClaudeSession={archiveClaudeSession}
            onDeleteTerminalSession={deleteTerminalSession}
            onArchiveTerminalSession={archiveTerminalSession}
            onOpenSettings={openSettings}
            onCloseSidebar={() => setSidebarOpen(false)}
          />
        </div>

        {/* Backdrop for mobile slide-over */}
        {sidebarOpen && (
          <div
            className="absolute inset-0 z-[5] bg-black/50"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Main Content — Terminal, Claude, or Settings */}
        <div data-testid="main-area" className="min-w-0 flex-1">
          {viewMode === 'settings' ? (
            <SettingsView
              powerBlock={powerBlock}
              websocket={websocket}
              tunnel={tunnel}
              onTogglePower={togglePower}
              onToggleTunnel={toggleTunnel}
            />
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
              onResume={(prompt) => activeClaudeId && resumeClaudeSession(activeClaudeId, prompt)}
              onQueueMessage={queueMessage}
              onEditQueued={editQueuedMessage}
              onRemoveQueued={removeQueuedMessage}
              onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
              onOpenSettings={openSettings}
              onOpenCommandPalette={() => setShowCommandPalette(true)}
              onToggleRightPanel={() => {
                if (!activeRightTab) {
                  useZeusStore.getState().setActiveRightTab('info');
                }
                setMobileRightPanelOpen(true);
              }}
              connected={connected}
            />
          ) : (
            <TerminalView sessionId={activeSessionId} />
          )}
        </div>

        {/* Mobile right panel — full-width overlay */}
        {mobileRightPanelOpen && (
          <>
            <div
              className="absolute inset-0 z-20 bg-black/50"
              onClick={() => setMobileRightPanelOpen(false)}
            />
            <div className="bg-background absolute inset-0 z-30 flex flex-col">
              <div className="border-border flex items-center justify-between border-b px-4 py-2.5 [-webkit-app-region:drag]">
                <span className="text-foreground text-sm font-semibold [-webkit-app-region:no-drag]">Panels</span>
                <button
                  onClick={() => setMobileRightPanelOpen(false)}
                  className="text-muted-foreground hover:text-foreground [-webkit-app-region:no-drag]"
                >
                  <X className="size-5" />
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <RightPanel />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Desktop 3-panel layout */}
      <div data-testid="app-shell-desktop" className="hidden min-h-0 flex-1 md:flex">
        <ResizablePanelGroup
          orientation="horizontal"
          defaultLayout={defaultLayout}
          onLayoutChanged={onLayoutChanged}
        >
          {sidebarCollapsed ? (
            <div className="shrink-0">
              <SessionSidebar
                collapsed
                sessions={sessions}
                activeSessionId={activeSessionId}
                claudeSessions={claudeSessions}
                activeClaudeId={activeClaudeId}
                viewMode={viewMode}
                sessionActivity={sessionActivity}
                lastActivityAt={lastActivityAt}
                onNewSession={() => startSession()}
                onNewClaudeSession={() => openNewClaudeModal()}
                onSelectSession={(id) => selectSession(id)}
                onStopSession={stopSession}
                onSelectClaudeSession={(id) => selectClaudeSession(id)}
                onUpdateClaudeSession={updateClaudeSession}
                onDeleteClaudeSession={deleteClaudeSession}
                onArchiveClaudeSession={archiveClaudeSession}
                onDeleteTerminalSession={deleteTerminalSession}
                onArchiveTerminalSession={archiveTerminalSession}
                onOpenSettings={openSettings}
                onCloseSidebar={() => setSidebarCollapsed(true)}
                onExpandSidebar={() => setSidebarCollapsed(false)}
              />
            </div>
          ) : (
            <>
              <ResizablePanel id="sidebar" defaultSize="15%" minSize="150px" maxSize="25%">
                <SessionSidebar
                  sessions={sessions}
                  activeSessionId={activeSessionId}
                  claudeSessions={claudeSessions}
                  activeClaudeId={activeClaudeId}
                  viewMode={viewMode}
                  sessionActivity={sessionActivity}
                  lastActivityAt={lastActivityAt}
                  onNewSession={() => startSession()}
                  onNewClaudeSession={() => openNewClaudeModal()}
                  onSelectSession={(id) => selectSession(id)}
                  onStopSession={stopSession}
                  onSelectClaudeSession={(id) => selectClaudeSession(id)}
                  onUpdateClaudeSession={updateClaudeSession}
                  onDeleteClaudeSession={deleteClaudeSession}
                  onArchiveClaudeSession={archiveClaudeSession}
                  onDeleteTerminalSession={deleteTerminalSession}
                  onArchiveTerminalSession={archiveTerminalSession}
                  onOpenSettings={openSettings}
                  onCloseSidebar={() => setSidebarCollapsed(true)}
                />
              </ResizablePanel>
              <ResizableHandle />
            </>
          )}

          <ResizablePanel
            id="content"
            defaultSize={activeRightTab ? '60%' : '75%'}
            minSize="30%"
          >
            <div data-testid="main-area-desktop" className="flex h-full flex-col">
              {sessionDiffTabs.length > 0 && <DiffTabBar />}

              <div className="min-h-0 flex-1">
                {viewMode === 'settings' ? (
                  <SettingsView
                    powerBlock={powerBlock}
                    websocket={websocket}
                    tunnel={tunnel}
                    onTogglePower={togglePower}
                    onToggleTunnel={toggleTunnel}
                  />
                ) : viewMode === 'diff' ? (
                  <PanelErrorBoundary name="Diff Viewer" onReset={() => useZeusStore.getState().returnToHome()}>
                    <DiffView />
                  </PanelErrorBoundary>
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
                    onResume={(prompt) => activeClaudeId && resumeClaudeSession(activeClaudeId, prompt)}
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
                <PanelErrorBoundary name="Right Panel">
                  <RightPanel />
                </PanelErrorBoundary>
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
