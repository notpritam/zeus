import { useEffect, useState, useMemo } from 'react';
import { useZeusStore } from '@/stores/useZeusStore';
import type { McpServerRecord, McpToolEntry, McpServerMetadata } from '../../../shared/types';
import { RefreshCw, ChevronDown, ChevronRight, Puzzle, Server, Loader2, Search } from 'lucide-react';

// ─── McpToolSchemaView ───

function McpToolSchemaView({ schema }: { schema: Record<string, unknown> }) {
  const properties = (schema.properties ?? {}) as Record<string, { type?: string; description?: string; default?: unknown }>;
  const required = (schema.required ?? []) as string[];
  const entries = Object.entries(properties);

  if (entries.length === 0) {
    return <span className="text-muted-foreground text-xs italic">No parameters</span>;
  }

  return (
    <table className="mt-2 w-full text-xs">
      <thead>
        <tr className="text-muted-foreground border-border border-b">
          <th className="py-1 pr-3 text-left font-medium">Name</th>
          <th className="py-1 pr-3 text-left font-medium">Type</th>
          <th className="py-1 pr-3 text-left font-medium">Required</th>
          <th className="py-1 text-left font-medium">Description</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([name, prop]) => (
          <tr key={name} className="border-border/50 border-b last:border-0">
            <td className="text-foreground py-1.5 pr-3 font-mono">{name}</td>
            <td className="text-muted-foreground py-1.5 pr-3">{String(prop.type ?? 'any')}</td>
            <td className="py-1.5 pr-3">
              {required.includes(name) ? (
                <span className="text-amber-400 text-[10px] font-semibold">YES</span>
              ) : (
                <span className="text-muted-foreground/50 text-[10px]">no</span>
              )}
            </td>
            <td className="text-muted-foreground py-1.5">
              {prop.description ?? ''}
              {prop.default !== undefined && (
                <span className="text-muted-foreground/60 ml-2">(default: {JSON.stringify(prop.default)})</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── McpToolAccordion ───

function McpToolAccordion({ tools }: { tools: McpToolEntry[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (toolName: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(toolName)) next.delete(toolName);
      else next.add(toolName);
      return next;
    });
  };

  if (tools.length === 0) {
    return <p className="text-muted-foreground py-4 text-center text-sm italic">No tools discovered</p>;
  }

  return (
    <div className="space-y-1">
      {tools.map((tool) => {
        const isOpen = expanded.has(tool.toolName);
        return (
          <div key={tool.toolName} className="border-border/50 rounded border">
            <button
              onClick={() => toggle(tool.toolName)}
              className="hover:bg-muted/50 flex w-full items-center gap-2 px-3 py-2 text-left transition-colors"
            >
              {isOpen ? <ChevronDown className="text-muted-foreground size-3.5 shrink-0" /> : <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />}
              <span className="text-foreground text-sm font-medium font-mono">{tool.toolName}</span>
              <span className="text-muted-foreground truncate text-xs">{tool.description.split('\n')[0]}</span>
            </button>
            {isOpen && (
              <div className="border-border/50 border-t px-3 py-2">
                <p className="text-muted-foreground mb-2 text-xs whitespace-pre-wrap">{tool.description}</p>
                <McpToolSchemaView schema={tool.inputSchema} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── McpMetadataCard ───

function McpMetadataCard({ metadata }: { metadata: McpServerMetadata }) {
  const capabilities = Object.keys(metadata.capabilities);
  const discoveredDate = new Date(metadata.discoveredAt);
  const relativeTime = getRelativeTime(discoveredDate);

  return (
    <div className="bg-muted/30 border-border mb-4 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-foreground text-base font-semibold">{metadata.serverName || 'Unknown Server'}</h3>
          {metadata.serverVersion && (
            <span className="text-muted-foreground text-xs">v{metadata.serverVersion}</span>
          )}
        </div>
        <span className="text-muted-foreground text-xs">Protocol {metadata.protocolVersion || '\u2014'}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {capabilities.length > 0 ? (
          capabilities.map((cap) => (
            <span key={cap} className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-[10px] font-medium">
              {cap}
            </span>
          ))
        ) : (
          <span className="text-muted-foreground text-xs italic">No capabilities reported</span>
        )}
      </div>
      <p className="text-muted-foreground/60 mt-2 text-[10px]">Discovered {relativeTime}</p>
    </div>
  );
}

function getRelativeTime(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

// ─── McpServerList ───

function McpServerList({
  servers,
  selectedId,
  onSelect,
  toolCounts,
  metadata,
  discovering,
  onDiscover,
  onDiscoverAll,
}: {
  servers: McpServerRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  toolCounts: Record<string, number>;
  metadata: Record<string, McpServerMetadata>;
  discovering: Record<string, boolean>;
  onDiscover: (id: string) => void;
  onDiscoverAll: () => void;
}) {
  const anyDiscovering = Object.values(discovering).some(Boolean);

  return (
    <div className="border-border flex h-full flex-col border-r">
      {/* Header */}
      <div className="border-border flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-foreground text-sm font-semibold">MCP Servers</h2>
        <button
          onClick={onDiscoverAll}
          disabled={anyDiscovering}
          className="text-muted-foreground hover:text-foreground hover:bg-muted flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors disabled:opacity-50"
          title="Discover all enabled servers"
        >
          {anyDiscovering ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
          Discover All
        </button>
      </div>

      {/* Server list */}
      <div className="flex-1 overflow-y-auto">
        {servers.length === 0 ? (
          <p className="text-muted-foreground p-4 text-center text-sm">No MCP servers registered</p>
        ) : (
          servers.map((server) => {
            const isSelected = server.id === selectedId;
            const isDiscovering = discovering[server.id];
            const count = toolCounts[server.id] ?? 0;
            const meta = metadata[server.id];

            return (
              <div
                key={server.id}
                onClick={() => onSelect(server.id)}
                className={`border-border/30 flex cursor-pointer items-center gap-3 border-b px-4 py-3 transition-colors ${
                  isSelected ? 'bg-muted' : 'hover:bg-muted/50'
                } ${!server.enabled ? 'opacity-50' : ''}`}
              >
                <Server className="text-muted-foreground size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground truncate text-sm font-medium">{server.name}</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                      server.source === 'zeus' ? 'bg-blue-500/10 text-blue-400' : 'bg-purple-500/10 text-purple-400'
                    }`}>
                      {server.source}
                    </span>
                  </div>
                  <div className="text-muted-foreground mt-0.5 flex items-center gap-2 text-[10px]">
                    {count > 0 && <span>{count} tool{count !== 1 ? 's' : ''}</span>}
                    {meta && <span>· {getRelativeTime(new Date(meta.discoveredAt))}</span>}
                    {!server.enabled && <span className="text-amber-400">disabled</span>}
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onDiscover(server.id); }}
                  disabled={isDiscovering}
                  className="text-muted-foreground hover:text-foreground shrink-0 rounded p-1 transition-colors"
                  title="Refresh"
                >
                  {isDiscovering ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── McpServerDetail ───

function McpServerDetail({
  server,
  metadata,
  tools,
  searchQuery,
  onSearchChange,
}: {
  server: McpServerRecord | null;
  metadata?: McpServerMetadata;
  tools: McpToolEntry[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
}) {
  const filteredTools = useMemo(() => {
    if (!searchQuery) return tools;
    const q = searchQuery.toLowerCase();
    return tools.filter(
      (t) => t.toolName.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
    );
  }, [tools, searchQuery]);

  if (!server) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Puzzle className="text-muted-foreground/30 mx-auto mb-3 size-12" />
          <p className="text-muted-foreground text-sm">Select a server to view its tools</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-border flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-foreground text-sm font-semibold">{server.name}</h2>
        <span className="text-muted-foreground text-xs">{tools.length} tool{tools.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {metadata && <McpMetadataCard metadata={metadata} />}

        {tools.length === 0 ? (
          <div className="text-center py-8">
            <RefreshCw className="text-muted-foreground/30 mx-auto mb-3 size-8" />
            <p className="text-muted-foreground text-sm">Click Refresh to discover this server's tools</p>
          </div>
        ) : (
          <>
            {tools.length > 5 && (
              <div className="mb-3 flex items-center gap-2">
                <Search className="text-muted-foreground size-3.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder="Filter tools..."
                  className="bg-transparent text-foreground placeholder:text-muted-foreground/50 flex-1 border-none text-sm outline-none"
                />
              </div>
            )}
            <McpToolAccordion tools={filteredTools} />
          </>
        )}
      </div>
    </div>
  );
}

// ─── McpPlaygroundView (main) ───

export default function McpPlaygroundView() {
  const mcpServers = useZeusStore((s) => s.mcpServers);
  const mcpToolCache = useZeusStore((s) => s.mcpToolCache);
  const mcpServerMetadata = useZeusStore((s) => s.mcpServerMetadata);
  const mcpDiscovering = useZeusStore((s) => s.mcpDiscovering);
  const fetchMcpServers = useZeusStore((s) => s.fetchMcpServers);
  const fetchCachedTools = useZeusStore((s) => s.fetchCachedTools);
  const discoverServer = useZeusStore((s) => s.discoverServer);
  const discoverAllServers = useZeusStore((s) => s.discoverAllServers);

  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchMcpServers();
    fetchCachedTools();
  }, [fetchMcpServers, fetchCachedTools]);

  useEffect(() => {
    setSearchQuery('');
  }, [selectedServerId]);

  const selectedServer = mcpServers.find((s) => s.id === selectedServerId) ?? null;
  const selectedTools = selectedServerId ? mcpToolCache[selectedServerId] ?? [] : [];
  const selectedMeta = selectedServerId ? mcpServerMetadata[selectedServerId] : undefined;

  const toolCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [serverId, tools] of Object.entries(mcpToolCache)) {
      counts[serverId] = tools.length;
    }
    return counts;
  }, [mcpToolCache]);

  return (
    <div className="flex h-full">
      <div className="w-72 shrink-0">
        <McpServerList
          servers={mcpServers}
          selectedId={selectedServerId}
          onSelect={setSelectedServerId}
          toolCounts={toolCounts}
          metadata={mcpServerMetadata}
          discovering={mcpDiscovering}
          onDiscover={discoverServer}
          onDiscoverAll={discoverAllServers}
        />
      </div>
      <div className="min-w-0 flex-1">
        <McpServerDetail
          server={selectedServer}
          metadata={selectedMeta}
          tools={selectedTools}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />
      </div>
    </div>
  );
}
