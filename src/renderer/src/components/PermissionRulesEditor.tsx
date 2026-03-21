// src/renderer/src/components/PermissionRulesEditor.tsx
import { useState, useEffect, useMemo } from 'react';
import { useZeusStore } from '@/stores/useZeusStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Plus, Trash2, Shield, ShieldCheck, ShieldX, ShieldQuestion,
  Copy, Eye, Pencil, Terminal, GitBranch, Package, Trash, Globe,
  ChevronDown, ChevronRight, Lock,
} from 'lucide-react';
import type { PermissionRule, PermissionAction } from '../../../shared/permission-types';

// ─── Quick Presets ──────────────────────────────────────────────────────────

interface QuickPreset {
  id: string;
  label: string;
  icon: typeof Shield;
  description: string;
  rules: PermissionRule[];
}

const QUICK_PRESETS: QuickPreset[] = [
  {
    id: 'read',
    label: 'Read Files',
    icon: Eye,
    description: 'Allow reading, searching, and globbing files',
    rules: [
      { tool: 'Read', pattern: '*', action: 'allow' },
      { tool: 'Glob', pattern: '*', action: 'allow' },
      { tool: 'Grep', pattern: '*', action: 'allow' },
    ],
  },
  {
    id: 'edit',
    label: 'Edit Code',
    icon: Pencil,
    description: 'Allow editing and writing files in src/',
    rules: [
      { tool: 'Edit', pattern: 'src/**', action: 'allow' },
      { tool: 'Write', pattern: 'src/**', action: 'allow' },
      { tool: 'Edit', pattern: '**/*.ts', action: 'allow' },
      { tool: 'Edit', pattern: '**/*.tsx', action: 'allow' },
      { tool: 'Edit', pattern: '**/*.js', action: 'allow' },
      { tool: 'Edit', pattern: '**/*.jsx', action: 'allow' },
      { tool: 'Edit', pattern: '**/*.css', action: 'allow' },
      { tool: 'Edit', pattern: '**/*.json', action: 'allow' },
    ],
  },
  {
    id: 'edit-all',
    label: 'Edit All Files',
    icon: Pencil,
    description: 'Allow editing and writing any file',
    rules: [
      { tool: 'Edit', pattern: '*', action: 'allow' },
      { tool: 'Write', pattern: '*', action: 'allow' },
    ],
  },
  {
    id: 'git',
    label: 'Git Commands',
    icon: GitBranch,
    description: 'Allow git commands',
    rules: [
      { tool: 'Bash', pattern: 'git *', action: 'allow' },
    ],
  },
  {
    id: 'package',
    label: 'Package Manager',
    icon: Package,
    description: 'Allow npm, yarn, pnpm, bun commands',
    rules: [
      { tool: 'Bash', pattern: 'npm *', action: 'allow' },
      { tool: 'Bash', pattern: 'npx *', action: 'allow' },
      { tool: 'Bash', pattern: 'yarn *', action: 'allow' },
      { tool: 'Bash', pattern: 'pnpm *', action: 'allow' },
      { tool: 'Bash', pattern: 'bun *', action: 'allow' },
    ],
  },
  {
    id: 'bash',
    label: 'All Bash',
    icon: Terminal,
    description: 'Allow all bash commands (ask for rm)',
    rules: [
      { tool: 'Bash', pattern: '*', action: 'allow' },
      { tool: 'Bash', pattern: 'rm -rf *', action: 'ask' },
    ],
  },
  {
    id: 'deny-secrets',
    label: 'Deny Secrets',
    icon: Lock,
    description: 'Deny editing .env, secrets, and credentials',
    rules: [
      { tool: 'Edit', pattern: '*.env*', action: 'deny' },
      { tool: 'Write', pattern: '*.env*', action: 'deny' },
      { tool: 'Edit', pattern: '**/*.secret*', action: 'deny' },
      { tool: 'Write', pattern: '**/*.secret*', action: 'deny' },
      { tool: 'Edit', pattern: '**/credentials*', action: 'deny' },
      { tool: 'Write', pattern: '**/credentials*', action: 'deny' },
    ],
  },
  {
    id: 'deny-delete',
    label: 'Deny Delete',
    icon: Trash,
    description: 'Ask before rm commands, deny rm -rf /',
    rules: [
      { tool: 'Bash', pattern: 'rm *', action: 'ask' },
      { tool: 'Bash', pattern: 'rm -rf /*', action: 'deny' },
    ],
  },
  {
    id: 'web',
    label: 'Web Access',
    icon: Globe,
    description: 'Allow web fetching and searching',
    rules: [
      { tool: 'WebFetch', pattern: '*', action: 'allow' },
      { tool: 'WebSearch', pattern: '*', action: 'allow' },
    ],
  },
];

/** Check if a preset's rules are all present in the current rule list */
function isPresetActive(preset: QuickPreset, currentRules: PermissionRule[]): boolean {
  return preset.rules.every((presetRule) =>
    currentRules.some(
      (r) => r.tool === presetRule.tool && r.pattern === presetRule.pattern && r.action === presetRule.action,
    ),
  );
}

/** Add a preset's rules (skip duplicates) */
function addPresetRules(currentRules: PermissionRule[], preset: QuickPreset): PermissionRule[] {
  const newRules = [...currentRules];
  for (const presetRule of preset.rules) {
    const exists = newRules.some(
      (r) => r.tool === presetRule.tool && r.pattern === presetRule.pattern && r.action === presetRule.action,
    );
    if (!exists) newRules.push(presetRule);
  }
  return newRules;
}

/** Remove a preset's rules */
function removePresetRules(currentRules: PermissionRule[], preset: QuickPreset): PermissionRule[] {
  return currentRules.filter(
    (r) => !preset.rules.some(
      (pr) => pr.tool === r.tool && pr.pattern === r.pattern && pr.action === r.action,
    ),
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const ACTION_STYLES: Record<PermissionAction, { bg: string; icon: typeof Shield }> = {
  allow: { bg: 'bg-green-500/20 text-green-400', icon: ShieldCheck },
  deny: { bg: 'bg-red-500/20 text-red-400', icon: ShieldX },
  ask: { bg: 'bg-yellow-500/20 text-yellow-400', icon: ShieldQuestion },
};

// ─── Components ─────────────────────────────────────────────────────────────

function RuleRow({
  rule,
  index,
  onUpdate,
  onRemove,
}: {
  rule: PermissionRule;
  index: number;
  onUpdate: (index: number, rule: PermissionRule) => void;
  onRemove: (index: number) => void;
}) {
  const style = ACTION_STYLES[rule.action];

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted-foreground w-5 text-right text-[9px]">{index + 1}</span>
      <Input
        value={rule.tool}
        onChange={(e) => onUpdate(index, { ...rule, tool: e.target.value })}
        placeholder="Tool (e.g. Edit, Bash, *)"
        className="h-7 flex-1 font-mono text-[11px]"
      />
      <span className="text-muted-foreground text-[10px]">:</span>
      <Input
        value={rule.pattern}
        onChange={(e) => onUpdate(index, { ...rule, pattern: e.target.value })}
        placeholder="Pattern (e.g. src/**, *.env)"
        className="h-7 flex-[2] font-mono text-[11px]"
      />
      <select
        value={rule.action}
        onChange={(e) => onUpdate(index, { ...rule, action: e.target.value as PermissionAction })}
        className={`h-7 rounded-md border px-1.5 text-[10px] font-medium ${style.bg}`}
      >
        <option value="allow">Allow</option>
        <option value="deny">Deny</option>
        <option value="ask">Ask</option>
      </select>
      <Button size="sm" variant="ghost" className="size-7 p-0 text-red-400 hover:text-red-300" onClick={() => onRemove(index)}>
        <Trash2 className="size-3" />
      </Button>
    </div>
  );
}

// ─── Main Editor ────────────────────────────────────────────────────────────

export function PermissionRulesEditor({ projectId }: { projectId: string }) {
  const {
    permissionRules, permissionTemplates,
    fetchPermissionRules, setPermissionRules, applyPermissionTemplate,
    fetchPermissionTemplates, clearPermissionRules,
  } = useZeusStore();

  const [localRules, setLocalRules] = useState<PermissionRule[]>([]);
  const [dirty, setDirty] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const rules = permissionRules[projectId] ?? [];

  // Fetch on mount
  useEffect(() => {
    fetchPermissionRules(projectId);
    fetchPermissionTemplates();
  }, [projectId, fetchPermissionRules, fetchPermissionTemplates]);

  // Sync from store to local
  useEffect(() => {
    if (!dirty) {
      setLocalRules(rules);
    }
  }, [rules, dirty]);

  // Compute which presets are active
  const activePresets = useMemo(
    () => new Set(QUICK_PRESETS.filter((p) => isPresetActive(p, localRules)).map((p) => p.id)),
    [localRules],
  );

  const handleTogglePreset = (preset: QuickPreset) => {
    if (activePresets.has(preset.id)) {
      setLocalRules(removePresetRules(localRules, preset));
    } else {
      setLocalRules(addPresetRules(localRules, preset));
    }
    setDirty(true);
  };

  const handleUpdate = (index: number, rule: PermissionRule) => {
    const next = [...localRules];
    next[index] = rule;
    setLocalRules(next);
    setDirty(true);
  };

  const handleRemove = (index: number) => {
    setLocalRules(localRules.filter((_, i) => i !== index));
    setDirty(true);
  };

  const handleAdd = () => {
    setLocalRules([...localRules, { tool: '*', pattern: '*', action: 'ask' }]);
    setDirty(true);
  };

  const handleSave = () => {
    setPermissionRules(projectId, localRules);
    setDirty(false);
  };

  const handleApplyTemplate = (templateId: string) => {
    applyPermissionTemplate(projectId, templateId);
    setDirty(false);
  };

  const handleClear = () => {
    clearPermissionRules(projectId);
    setLocalRules([]);
    setDirty(false);
  };

  return (
    <div className="space-y-3">
      {/* Quick Presets — toggleable chips */}
      <div>
        <label className="text-muted-foreground mb-1.5 block text-[10px] font-medium uppercase">
          Quick Permissions
        </label>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_PRESETS.map((preset) => {
            const active = activePresets.has(preset.id);
            const Icon = preset.icon;
            return (
              <button
                key={preset.id}
                title={preset.description}
                onClick={() => handleTogglePreset(preset)}
                className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors ${
                  active
                    ? 'border-primary/50 bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground'
                }`}
              >
                <Icon className="size-3" />
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Full Templates */}
      <div>
        <label className="text-muted-foreground mb-1.5 block text-[10px] font-medium uppercase">
          Templates
        </label>
        <div className="flex flex-wrap gap-1.5">
          {permissionTemplates.map((t) => (
            <Button
              key={t.id}
              size="sm"
              variant="outline"
              className="h-6 text-[10px]"
              onClick={() => handleApplyTemplate(t.id)}
              title={t.description}
            >
              <Copy className="mr-1 size-3" />
              {t.name}
            </Button>
          ))}
        </div>
      </div>

      {/* Save bar — shown when dirty */}
      {dirty && (
        <div className="flex gap-2">
          <Button size="sm" className="h-7 flex-1 text-xs" onClick={handleSave}>
            Save Rules ({localRules.length})
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setLocalRules(rules); setDirty(false); }}>
            Discard
          </Button>
        </div>
      )}

      {/* Advanced: Collapsible rule list */}
      <div>
        <button
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[10px]"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          {showAdvanced ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          Advanced — {localRules.length} rules
          {localRules.length > 0 && !showAdvanced && (
            <span className="text-muted-foreground ml-1">
              ({activePresets.size} presets active)
            </span>
          )}
        </button>

        {showAdvanced && (
          <div className="mt-2 space-y-2">
            <div className="mb-1.5 flex items-center justify-end gap-1">
              <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[9px]" onClick={handleAdd}>
                <Plus className="mr-0.5 size-2.5" /> Add Rule
              </Button>
              {localRules.length > 0 && (
                <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[9px] text-red-400" onClick={handleClear}>
                  Clear All
                </Button>
              )}
            </div>
            <div className="space-y-1">
              {localRules.map((rule, i) => (
                <RuleRow key={i} rule={rule} index={i} onUpdate={handleUpdate} onRemove={handleRemove} />
              ))}
              {localRules.length === 0 && (
                <div className="text-muted-foreground py-3 text-center text-[10px]">
                  No rules. Toggle presets above or add custom rules.
                </div>
              )}
            </div>

            {/* Info */}
            <div className="text-muted-foreground space-y-1 text-[9px]">
              <p><strong>Last rule wins.</strong> Rules are evaluated top-to-bottom; the last matching rule decides.</p>
              <p><strong>Tool:</strong> Read, Edit, Write, Bash, Glob, Grep, * (any)</p>
              <p><strong>Pattern:</strong> src/**, *.env, npm *, rm -rf * (globs supported)</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
