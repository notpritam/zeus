import { useState, useEffect } from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Kbd } from '@/components/ui/kbd';
import { Button } from '@/components/ui/button';
import {
  Wifi,
  WifiOff,
  Link,
  Zap,
  Activity,
  Keyboard,
  Settings,
  Palette,
  RefreshCw,
  Info,
  Plug,
  Plus,
  Trash2,
  Pencil,
  Heart,
  Download,
  Star,
  Check,
  X,
  Loader2,
} from 'lucide-react';
import PerformanceTab from './PerformanceTab';
import ThemePicker from './ThemePicker';
import { useZeusStore } from '@/stores/useZeusStore';
import type { McpServerRecord, McpProfileRecord } from '../../../shared/types';

interface SettingsViewProps {
  powerBlock: boolean;
  websocket: boolean;
  tunnel: string | null;
  autoTunnel: boolean;
  onTogglePower: () => void;
  onToggleTunnel: () => void;
  onSetAutoTunnel: (enabled: boolean) => void;
}

const shortcuts = [
  ['⌘K', 'Command Palette'],
  ['⌘,', 'Settings'],
  ['⌘T', 'New Terminal'],
  ['⌘N', 'New Claude Session'],
  ['⌘B', 'Toggle Side Panel'],
] as const;

type SettingsTab = 'general' | 'appearance' | 'performance' | 'shortcuts' | 'about' | 'mcp';

const tabs: { id: SettingsTab; label: string; icon: typeof Settings }[] = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'mcp', label: 'MCP Servers', icon: Plug },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'performance', label: 'Performance', icon: Activity },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'about', label: 'About', icon: Info },
];

const APP_VERSION = __APP_VERSION__;

// ─── MCP Settings Tab ───

function McpSettingsTab() {
  const mcpServers = useZeusStore((s) => s.mcpServers);
  const mcpProfiles = useZeusStore((s) => s.mcpProfiles);
  const mcpHealthResults = useZeusStore((s) => s.mcpHealthResults);
  const mcpImportResult = useZeusStore((s) => s.mcpImportResult);
  const fetchMcpServers = useZeusStore((s) => s.fetchMcpServers);
  const addMcpServer = useZeusStore((s) => s.addMcpServer);
  const updateMcpServer = useZeusStore((s) => s.updateMcpServer);
  const removeMcpServer = useZeusStore((s) => s.removeMcpServer);
  const toggleMcpServer = useZeusStore((s) => s.toggleMcpServer);
  const healthCheckMcp = useZeusStore((s) => s.healthCheckMcp);
  const importMcpFromClaude = useZeusStore((s) => s.importMcpFromClaude);
  const fetchMcpProfiles = useZeusStore((s) => s.fetchMcpProfiles);
  const createMcpProfile = useZeusStore((s) => s.createMcpProfile);
  const updateMcpProfile = useZeusStore((s) => s.updateMcpProfile);
  const deleteMcpProfile = useZeusStore((s) => s.deleteMcpProfile);
  const setDefaultMcpProfile = useZeusStore((s) => s.setDefaultMcpProfile);
  const clearMcpImportResult = useZeusStore((s) => s.clearMcpImportResult);

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingServer, setEditingServer] = useState<string | null>(null);
  const [serverForm, setServerForm] = useState({ name: '', command: '', args: '', env: '' });
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [editingProfile, setEditingProfile] = useState<string | null>(null);
  const [profileForm, setProfileForm] = useState({ name: '', description: '', serverIds: [] as string[] });
  const [healthChecking, setHealthChecking] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    fetchMcpServers();
    fetchMcpProfiles();
  }, []);

  const handleAddServer = () => {
    if (!serverForm.name.trim() || !serverForm.command.trim()) return;
    const args = serverForm.args.trim() ? serverForm.args.split(/\s+/) : [];
    let env: Record<string, string> = {};
    if (serverForm.env.trim()) {
      try { env = JSON.parse(serverForm.env); } catch { /* ignore */ }
    }
    addMcpServer(serverForm.name.trim(), serverForm.command.trim(), args, env);
    setServerForm({ name: '', command: '', args: '', env: '' });
    setShowAddForm(false);
  };

  const handleEditServer = (server: McpServerRecord) => {
    setEditingServer(server.id);
    setServerForm({
      name: server.name,
      command: server.command,
      args: server.args.join(' '),
      env: Object.keys(server.env).length > 0 ? JSON.stringify(server.env, null, 2) : '',
    });
  };

  const handleSaveEdit = () => {
    if (!editingServer || !serverForm.name.trim() || !serverForm.command.trim()) return;
    const args = serverForm.args.trim() ? serverForm.args.split(/\s+/) : [];
    let env: Record<string, string> = {};
    if (serverForm.env.trim()) {
      try { env = JSON.parse(serverForm.env); } catch { /* ignore */ }
    }
    updateMcpServer(editingServer, {
      name: serverForm.name.trim(),
      command: serverForm.command.trim(),
      args,
      env,
    });
    setEditingServer(null);
    setServerForm({ name: '', command: '', args: '', env: '' });
  };

  const handleCheckAll = async () => {
    setHealthChecking(true);
    healthCheckMcp(); // check all
    setTimeout(() => setHealthChecking(false), 3000);
  };

  const handleAddProfile = () => {
    if (!profileForm.name.trim()) return;
    createMcpProfile(profileForm.name.trim(), profileForm.description.trim(), profileForm.serverIds);
    setProfileForm({ name: '', description: '', serverIds: [] });
    setShowProfileForm(false);
  };

  const handleEditProfile = (profile: McpProfileRecord) => {
    setEditingProfile(profile.id);
    setProfileForm({
      name: profile.name,
      description: profile.description,
      serverIds: profile.servers.map((s) => s.id),
    });
  };

  const handleSaveProfile = () => {
    if (!editingProfile || !profileForm.name.trim()) return;
    updateMcpProfile(editingProfile, {
      name: profileForm.name.trim(),
      description: profileForm.description.trim(),
      serverIds: profileForm.serverIds,
    });
    setEditingProfile(null);
    setProfileForm({ name: '', description: '', serverIds: [] });
  };

  const toggleProfileServer = (serverId: string) => {
    setProfileForm((f) => ({
      ...f,
      serverIds: f.serverIds.includes(serverId)
        ? f.serverIds.filter((id) => id !== serverId)
        : [...f.serverIds, serverId],
    }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-foreground mb-1">MCP Servers</h3>
        <p className="text-muted-foreground text-xs mb-4">
          Manage MCP server registry and profiles for Claude sessions
        </p>
      </div>

      {/* Import result banner */}
      {mcpImportResult && (
        <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
          <Download className="size-4 text-primary shrink-0 mt-0.5" />
          <div className="flex-1 text-xs">
            <p className="font-medium">Import complete</p>
            {mcpImportResult.imported.length > 0 && (
              <p className="text-muted-foreground mt-0.5">
                Imported: {mcpImportResult.imported.join(', ')}
              </p>
            )}
            {mcpImportResult.skipped.length > 0 && (
              <p className="text-muted-foreground mt-0.5">
                Skipped: {mcpImportResult.skipped.join(', ')}
              </p>
            )}
          </div>
          <button onClick={clearMcpImportResult} className="text-muted-foreground hover:text-foreground">
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Servers section */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider">
            Servers ({mcpServers.length})
          </h4>
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-[10px]"
              onClick={importMcpFromClaude}
            >
              <Download className="size-3" />
              Import from Claude
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-[10px]"
              onClick={handleCheckAll}
              disabled={healthChecking}
            >
              {healthChecking ? <Loader2 className="size-3 animate-spin" /> : <Heart className="size-3" />}
              Health Check All
            </Button>
            <Button
              variant="default"
              size="sm"
              className="h-6 gap-1 px-2 text-[10px]"
              onClick={() => { setShowAddForm(true); setServerForm({ name: '', command: '', args: '', env: '' }); }}
            >
              <Plus className="size-3" />
              Add Server
            </Button>
          </div>
        </div>

        {/* Add / Edit server form */}
        {(showAddForm || editingServer) && (
          <div className="rounded-lg border p-3 mb-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground block mb-0.5">Name *</label>
                <input
                  type="text"
                  className="w-full bg-secondary border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="my-mcp-server"
                  value={serverForm.name}
                  onChange={(e) => setServerForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground block mb-0.5">Command *</label>
                <input
                  type="text"
                  className="w-full bg-secondary border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="npx"
                  value={serverForm.command}
                  onChange={(e) => setServerForm((f) => ({ ...f, command: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">Args (space-separated)</label>
              <input
                type="text"
                className="w-full bg-secondary border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="-y @modelcontextprotocol/server-github"
                value={serverForm.args}
                onChange={(e) => setServerForm((f) => ({ ...f, args: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">Env (JSON, optional)</label>
              <input
                type="text"
                className="w-full bg-secondary border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                placeholder='{"GITHUB_TOKEN": "..."}'
                value={serverForm.env}
                onChange={(e) => setServerForm((f) => ({ ...f, env: e.target.value }))}
              />
            </div>
            <div className="flex justify-end gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px]"
                onClick={() => { setShowAddForm(false); setEditingServer(null); setServerForm({ name: '', command: '', args: '', env: '' }); }}
              >
                Cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                className="h-6 text-[10px]"
                onClick={editingServer ? handleSaveEdit : handleAddServer}
                disabled={!serverForm.name.trim() || !serverForm.command.trim()}
              >
                {editingServer ? 'Save Changes' : 'Add Server'}
              </Button>
            </div>
          </div>
        )}

        {/* Server list */}
        <div className="space-y-1">
          {mcpServers.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center">
              <Plug className="size-6 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">No MCP servers registered</p>
              <p className="text-[10px] text-muted-foreground/60 mt-1">
                Add servers manually or import from your Claude config
              </p>
            </div>
          ) : (
            mcpServers.map((server) => {
              const health = mcpHealthResults[server.id];
              return (
                <div
                  key={server.id}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                    !server.enabled ? 'opacity-50' : ''
                  }`}
                >
                  {/* Health indicator */}
                  <div className="shrink-0">
                    {health ? (
                      health.healthy ? (
                        <span className="flex size-2 rounded-full bg-green-500" />
                      ) : (
                        <span className="flex size-2 rounded-full bg-red-500" title={health.error} />
                      )
                    ) : (
                      <span className="flex size-2 rounded-full bg-muted-foreground/30" />
                    )}
                  </div>

                  {/* Server info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium truncate">{server.name}</span>
                      <Badge variant="secondary" className="text-[9px] px-1 py-0">
                        {server.source}
                      </Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate font-mono">
                      {server.command} {server.args.join(' ')}
                    </p>
                  </div>

                  {/* Health latency */}
                  {health && (
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {health.latencyMs}ms
                    </span>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <Switch
                      checked={server.enabled}
                      onCheckedChange={(checked) => toggleMcpServer(server.id, checked)}
                      className="scale-75"
                    />
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="size-5"
                      onClick={() => healthCheckMcp(server.id)}
                      title="Health check"
                    >
                      <Heart className="size-2.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="size-5"
                      onClick={() => handleEditServer(server)}
                      title="Edit"
                    >
                      <Pencil className="size-2.5" />
                    </Button>
                    {deleteConfirm === server.id ? (
                      <div className="flex items-center gap-0.5">
                        <Button
                          variant="destructive"
                          size="icon-xs"
                          className="size-5"
                          onClick={() => { removeMcpServer(server.id); setDeleteConfirm(null); }}
                          title="Confirm delete"
                        >
                          <Check className="size-2.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="size-5"
                          onClick={() => setDeleteConfirm(null)}
                          title="Cancel"
                        >
                          <X className="size-2.5" />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="size-5 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteConfirm(server.id)}
                        title="Delete"
                      >
                        <Trash2 className="size-2.5" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Profiles section */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider">
            Profiles ({mcpProfiles.length})
          </h4>
          <Button
            variant="default"
            size="sm"
            className="h-6 gap-1 px-2 text-[10px]"
            onClick={() => { setShowProfileForm(true); setProfileForm({ name: '', description: '', serverIds: [] }); }}
          >
            <Plus className="size-3" />
            New Profile
          </Button>
        </div>

        {/* Add / Edit profile form */}
        {(showProfileForm || editingProfile) && (
          <div className="rounded-lg border p-3 mb-3 space-y-2">
            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">Profile Name *</label>
              <input
                type="text"
                className="w-full bg-secondary border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="e.g. Coding, Research"
                value={profileForm.name}
                onChange={(e) => setProfileForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">Description</label>
              <input
                type="text"
                className="w-full bg-secondary border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="Optional description..."
                value={profileForm.description}
                onChange={(e) => setProfileForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground block mb-1">Servers</label>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {mcpServers.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => toggleProfileServer(s.id)}
                    className={`w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${
                      profileForm.serverIds.includes(s.id)
                        ? 'bg-primary/10 text-foreground'
                        : 'hover:bg-secondary/60 text-muted-foreground'
                    }`}
                  >
                    <span className={`flex size-3.5 items-center justify-center rounded border ${
                      profileForm.serverIds.includes(s.id)
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border'
                    }`}>
                      {profileForm.serverIds.includes(s.id) && <Check className="size-2" />}
                    </span>
                    {s.name}
                  </button>
                ))}
                {mcpServers.length === 0 && (
                  <p className="text-[10px] text-muted-foreground px-2">No servers to select. Add servers first.</p>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px]"
                onClick={() => { setShowProfileForm(false); setEditingProfile(null); }}
              >
                Cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                className="h-6 text-[10px]"
                onClick={editingProfile ? handleSaveProfile : handleAddProfile}
                disabled={!profileForm.name.trim()}
              >
                {editingProfile ? 'Save Changes' : 'Create Profile'}
              </Button>
            </div>
          </div>
        )}

        {/* Profile list */}
        <div className="space-y-1">
          {mcpProfiles.length === 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-center">
              <p className="text-xs text-muted-foreground">No profiles yet</p>
              <p className="text-[10px] text-muted-foreground/60 mt-1">
                Create profiles to quickly select MCP server groups
              </p>
            </div>
          ) : (
            mcpProfiles.map((profile) => (
              <div key={profile.id} className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium">{profile.name}</span>
                    {profile.isDefault && (
                      <Badge variant="default" className="text-[9px] px-1 py-0 gap-0.5">
                        <Star className="size-2" />
                        Default
                      </Badge>
                    )}
                    <Badge variant="secondary" className="text-[9px] px-1 py-0">
                      {profile.servers.length} server{profile.servers.length !== 1 ? 's' : ''}
                    </Badge>
                  </div>
                  {profile.description && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">{profile.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!profile.isDefault && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="size-5"
                      onClick={() => setDefaultMcpProfile(profile.id)}
                      title="Set as default"
                    >
                      <Star className="size-2.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="size-5"
                    onClick={() => handleEditProfile(profile)}
                    title="Edit"
                  >
                    <Pencil className="size-2.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="size-5 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteMcpProfile(profile.id)}
                    title="Delete"
                  >
                    <Trash2 className="size-2.5" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsView({
  powerBlock,
  websocket,
  tunnel,
  autoTunnel,
  onTogglePower,
  onToggleTunnel,
  onSetAutoTunnel,
}: SettingsViewProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Mobile tab bar — horizontal */}
      <div className="md:hidden shrink-0 border-b bg-background">
        <nav className="flex gap-1 px-4 py-2 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                  activeTab === tab.id
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                }`}
              >
                <Icon className="size-3.5" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Body: sidebar + content */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Tab nav — vertical on desktop */}
        <nav className="hidden md:flex md:w-48 md:shrink-0 md:flex-col md:border-r md:bg-secondary/20 md:py-3 md:px-2.5 md:space-y-0.5 md:overflow-y-auto">
          <div className="px-2.5 pb-3">
            <h2 className="text-sm font-semibold text-foreground">Settings</h2>
            <p className="text-muted-foreground text-[11px] mt-0.5">Configure Zeus</p>
          </div>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-xs transition-colors ${
                  activeTab === tab.id
                    ? 'bg-background text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
                }`}
              >
                <Icon className="size-3.5" />
                {tab.label}
              </button>
            );
          })}

          {/* Version at bottom of sidebar */}
          <div className="mt-auto pt-4 px-2.5">
            <p className="text-muted-foreground/60 text-[10px]">Zeus v{APP_VERSION}</p>
          </div>
        </nav>

        {/* Scrollable content area */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl p-6">
            {/* General tab */}
            {activeTab === 'general' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-medium text-foreground mb-1">General</h3>
                  <p className="text-muted-foreground text-xs mb-4">System status and core settings</p>
                </div>

                <div>
                  <h4 className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider mb-3">
                    System Status
                  </h4>
                  <div className="space-y-3">
                    {/* Power Lock */}
                    <div className="flex items-center justify-between rounded-lg border p-3">
                      <div className="flex items-center gap-3">
                        <div className="flex size-8 items-center justify-center rounded-md bg-secondary">
                          <Zap className="size-4 text-muted-foreground" />
                        </div>
                        <div>
                          <Label htmlFor="power-lock" className="text-sm font-medium">
                            Power Lock
                          </Label>
                          <p className="text-muted-foreground text-[11px]">Prevent system sleep</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant={powerBlock ? 'default' : 'secondary'}>
                          {powerBlock ? 'Active' : 'Off'}
                        </Badge>
                        <Switch id="power-lock" checked={powerBlock} onCheckedChange={onTogglePower} />
                      </div>
                    </div>

                    {/* WebSocket */}
                    <div className="flex items-center justify-between rounded-lg border p-3">
                      <div className="flex items-center gap-3">
                        <div className="flex size-8 items-center justify-center rounded-md bg-secondary">
                          {websocket ? (
                            <Wifi className="size-4 text-muted-foreground" />
                          ) : (
                            <WifiOff className="size-4 text-muted-foreground" />
                          )}
                        </div>
                        <div>
                          <span className="text-sm font-medium">WebSocket</span>
                          <p className="text-muted-foreground text-[11px]">Real-time connection</p>
                        </div>
                      </div>
                      <Badge variant={websocket ? 'default' : 'destructive'}>
                        {websocket ? 'Connected' : 'Offline'}
                      </Badge>
                    </div>

                    {/* Tunnel */}
                    <div className="flex items-center justify-between rounded-lg border p-3">
                      <div className="flex items-center gap-3">
                        <div className="flex size-8 items-center justify-center rounded-md bg-secondary">
                          <Link className="size-4 text-muted-foreground" />
                        </div>
                        <div>
                          <span className="text-sm font-medium">Tunnel</span>
                          <p className="text-muted-foreground text-[11px]">Remote access via ngrok</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={tunnel ? 'default' : 'secondary'}>
                          {tunnel ? 'Active' : 'Off'}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="size-6"
                          onClick={onToggleTunnel}
                          title={tunnel ? 'Restart tunnel' : 'Start tunnel'}
                        >
                          <RefreshCw className="size-3" />
                        </Button>
                      </div>
                    </div>

                    {/* Auto Tunnel */}
                    <div className="flex items-center justify-between rounded-lg border p-3">
                      <div className="flex items-center gap-3">
                        <div className="flex size-8 items-center justify-center rounded-md bg-secondary">
                          <Link className="size-4 text-muted-foreground" />
                        </div>
                        <div>
                          <Label htmlFor="auto-tunnel" className="text-sm font-medium">
                            Auto Tunnel
                          </Label>
                          <p className="text-muted-foreground text-[11px]">Start tunnel automatically on launch</p>
                        </div>
                      </div>
                      <Switch id="auto-tunnel" checked={autoTunnel} onCheckedChange={onSetAutoTunnel} />
                    </div>
                  </div>
                </div>

                {tunnel && (
                  <div>
                    <h4 className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider mb-2">
                      Tunnel URL
                    </h4>
                    <button
                      className="text-primary hover:text-primary/80 w-full truncate rounded-md border px-3 py-2 text-left text-xs transition-colors"
                      title={tunnel}
                      onClick={() => navigator.clipboard.writeText(tunnel)}
                    >
                      {tunnel.replace(/^https?:\/\//, '')} — click to copy
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* MCP Servers tab */}
            {activeTab === 'mcp' && <McpSettingsTab />}

            {/* Appearance tab */}
            {activeTab === 'appearance' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-medium text-foreground mb-1">Appearance</h3>
                  <p className="text-muted-foreground text-xs mb-4">Customize the look and feel</p>
                </div>
                <ThemePicker />
              </div>
            )}

            {/* Performance tab */}
            {activeTab === 'performance' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-medium text-foreground mb-1">Performance</h3>
                  <p className="text-muted-foreground text-xs mb-4">System resource monitoring</p>
                </div>
                <PerformanceTab />
              </div>
            )}

            {/* Shortcuts tab */}
            {activeTab === 'shortcuts' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-medium text-foreground mb-1">Keyboard Shortcuts</h3>
                  <p className="text-muted-foreground text-xs mb-4">Quick actions and navigation</p>
                </div>
                <div className="space-y-1">
                  {shortcuts.map(([key, label]) => (
                    <div key={key} className="flex items-center justify-between rounded-lg border px-3 py-2.5">
                      <span className="text-muted-foreground text-xs">{label}</span>
                      <Kbd>{key}</Kbd>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* About tab */}
            {activeTab === 'about' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-medium text-foreground mb-1">About Zeus</h3>
                  <p className="text-muted-foreground text-xs mb-4">
                    Remote orchestration tool for AI-powered development
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
                    <span className="text-muted-foreground text-xs">Version</span>
                    <span className="text-foreground text-xs font-mono">{APP_VERSION}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
                    <span className="text-muted-foreground text-xs">Platform</span>
                    <span className="text-foreground text-xs font-mono">{navigator.platform}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
                    <span className="text-muted-foreground text-xs">User Agent</span>
                    <span className="text-foreground text-xs font-mono truncate max-w-xs" title={navigator.userAgent}>
                      {navigator.userAgent.split(' ').slice(-3).join(' ')}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsView;
