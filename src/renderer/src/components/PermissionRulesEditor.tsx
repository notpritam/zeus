// src/renderer/src/components/PermissionRulesEditor.tsx
import { useState, useEffect } from 'react';
import { useZeusStore } from '@/stores/useZeusStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Shield, ShieldCheck, ShieldX, ShieldQuestion, Copy } from 'lucide-react';
import type { PermissionRule, PermissionAction } from '../../../shared/permission-types';

const ACTION_STYLES: Record<PermissionAction, { bg: string; icon: typeof Shield }> = {
  allow: { bg: 'bg-green-500/20 text-green-400', icon: ShieldCheck },
  deny: { bg: 'bg-red-500/20 text-red-400', icon: ShieldX },
  ask: { bg: 'bg-yellow-500/20 text-yellow-400', icon: ShieldQuestion },
};

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
  const Icon = style.icon;

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

export function PermissionRulesEditor({ projectId }: { projectId: string }) {
  const {
    permissionRules, permissionTemplates,
    fetchPermissionRules, setPermissionRules, applyPermissionTemplate,
    fetchPermissionTemplates, clearPermissionRules,
  } = useZeusStore();

  const [localRules, setLocalRules] = useState<PermissionRule[]>([]);
  const [dirty, setDirty] = useState(false);

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
      {/* Templates */}
      <div>
        <label className="text-muted-foreground mb-1.5 block text-[10px] font-medium uppercase">Templates</label>
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

      {/* Rules list */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-muted-foreground text-[10px] font-medium uppercase">
            Rules ({localRules.length})
          </label>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[9px]" onClick={handleAdd}>
              <Plus className="mr-0.5 size-2.5" /> Add
            </Button>
            {localRules.length > 0 && (
              <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[9px] text-red-400" onClick={handleClear}>
                Clear
              </Button>
            )}
          </div>
        </div>
        <div className="space-y-1">
          {localRules.map((rule, i) => (
            <RuleRow key={i} rule={rule} index={i} onUpdate={handleUpdate} onRemove={handleRemove} />
          ))}
          {localRules.length === 0 && (
            <div className="text-muted-foreground py-3 text-center text-[10px]">
              No rules. Using default permission mode. Apply a template or add custom rules.
            </div>
          )}
        </div>
      </div>

      {/* Save */}
      {dirty && (
        <div className="flex gap-2">
          <Button size="sm" className="h-7 flex-1 text-xs" onClick={handleSave}>
            Save Rules
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setLocalRules(rules); setDirty(false); }}>
            Discard
          </Button>
        </div>
      )}

      {/* Info */}
      <div className="text-muted-foreground space-y-1 text-[9px]">
        <p><strong>Last rule wins.</strong> Rules are evaluated top-to-bottom; the last matching rule decides.</p>
        <p><strong>Tool:</strong> Read, Edit, Write, Bash, Glob, Grep, * (any)</p>
        <p><strong>Pattern:</strong> src/**, *.env, npm *, rm -rf * (globs supported)</p>
      </div>
    </div>
  );
}
