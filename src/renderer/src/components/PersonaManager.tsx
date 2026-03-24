import { useState, useCallback } from 'react';
import { ArrowLeft, Plus, Pencil, Trash2, ChevronDown, Save, X } from 'lucide-react';
import { useZeusStore } from '@/stores/useZeusStore';
import type { AgentPersona } from '../../../shared/room-types';

const MODEL_OPTIONS = [
  { label: 'Default', value: '' },
  { label: 'Sonnet 4.6', value: 'sonnet' },
  { label: 'Opus 4.6', value: 'opus' },
  { label: 'Haiku 4.5', value: 'haiku' },
];

interface PersonaManagerProps {
  onClose: () => void;
}

export function PersonaManager({ onClose }: PersonaManagerProps) {
  const personas = useZeusStore((s) => s.agentPersonas);
  const createPersona = useZeusStore((s) => s.createPersona);
  const updatePersona = useZeusStore((s) => s.updatePersona);
  const deletePersona = useZeusStore((s) => s.deletePersona);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formRole, setFormRole] = useState('');
  const [formIcon, setFormIcon] = useState('');
  const [formModel, setFormModel] = useState('');
  const [formPrompt, setFormPrompt] = useState('');

  const resetForm = useCallback(() => {
    setFormName('');
    setFormRole('');
    setFormIcon('');
    setFormModel('');
    setFormPrompt('');
    setEditingId(null);
    setIsCreating(false);
  }, []);

  const startEdit = useCallback((persona: AgentPersona) => {
    setEditingId(persona.id);
    setIsCreating(false);
    setFormName(persona.name);
    setFormRole(persona.role);
    setFormIcon(persona.icon ?? '');
    setFormModel(persona.model ?? '');
    setFormPrompt(persona.systemPrompt);
  }, []);

  const startCreate = useCallback(() => {
    setIsCreating(true);
    setEditingId(null);
    setFormName('');
    setFormRole('');
    setFormIcon('\uD83E\uDD16');
    setFormModel('');
    setFormPrompt('');
  }, []);

  const handleSave = useCallback(() => {
    if (!formName.trim() || !formRole.trim() || !formPrompt.trim()) return;

    if (isCreating) {
      const id = `persona-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      createPersona({
        id,
        name: formName.trim(),
        role: formRole.trim(),
        systemPrompt: formPrompt.trim(),
        model: formModel || undefined,
        icon: formIcon || undefined,
      });
    } else if (editingId) {
      updatePersona(editingId, {
        name: formName.trim(),
        role: formRole.trim(),
        systemPrompt: formPrompt.trim(),
        model: formModel || null,
        icon: formIcon || null,
      });
    }
    resetForm();
  }, [isCreating, editingId, formName, formRole, formPrompt, formModel, formIcon, createPersona, updatePersona, resetForm]);

  const handleDelete = useCallback((id: string) => {
    deletePersona(id);
    if (editingId === id) resetForm();
  }, [deletePersona, editingId, resetForm]);

  const isEditing = isCreating || editingId !== null;

  // Edit/Create form
  if (isEditing) {
    return (
      <div className="flex h-full flex-col bg-zinc-900/30">
        <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
          <button
            onClick={resetForm}
            className="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            <ArrowLeft className="size-3.5" />
          </button>
          <span className="text-xs font-semibold text-zinc-200">
            {isCreating ? 'New Persona' : 'Edit Persona'}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Icon"
              value={formIcon}
              onChange={(e) => setFormIcon(e.target.value)}
              className="w-10 rounded bg-zinc-800 px-1.5 py-1 text-center text-sm outline-none ring-1 ring-zinc-700 focus:ring-zinc-500"
            />
            <input
              type="text"
              placeholder="Name"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none ring-1 ring-zinc-700 focus:ring-zinc-500"
            />
          </div>
          <input
            type="text"
            placeholder="Role (e.g. frontend, backend)"
            value={formRole}
            onChange={(e) => setFormRole(e.target.value)}
            className="w-full rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none ring-1 ring-zinc-700 focus:ring-zinc-500"
          />
          <div className="relative">
            <select
              value={formModel}
              onChange={(e) => setFormModel(e.target.value)}
              className="w-full appearance-none rounded bg-zinc-800 px-2 py-1 pr-6 text-xs text-zinc-200 outline-none ring-1 ring-zinc-700 focus:ring-zinc-500"
            >
              {MODEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 size-3 -translate-y-1/2 text-zinc-500" />
          </div>
          <textarea
            placeholder="System prompt for this agent persona..."
            rows={8}
            value={formPrompt}
            onChange={(e) => setFormPrompt(e.target.value)}
            className="w-full resize-none rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none ring-1 ring-zinc-700 focus:ring-zinc-500"
          />
        </div>
        <div className="flex items-center gap-2 border-t border-zinc-800 px-3 py-2">
          <button
            disabled={!formName.trim() || !formRole.trim() || !formPrompt.trim()}
            onClick={handleSave}
            className="flex flex-1 items-center justify-center gap-1 rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Save className="size-3" />
            Save
          </button>
          <button
            onClick={resetForm}
            className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // List view
  return (
    <div className="flex h-full flex-col bg-zinc-900/30">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            <ArrowLeft className="size-3.5" />
          </button>
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Personas</span>
        </div>
        <button
          onClick={startCreate}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          title="New persona"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {personas.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-zinc-600">
            No personas yet. Click + to create one.
          </div>
        )}
        {personas.map((persona) => (
          <div
            key={persona.id}
            className="group flex items-center gap-2 border-b border-zinc-800/50 px-3 py-2 hover:bg-zinc-800/40"
          >
            <span className="text-sm leading-none shrink-0">{persona.icon ?? '\uD83E\uDD16'}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-zinc-200">{persona.name}</div>
              <div className="truncate text-[10px] text-zinc-500">{persona.role}{persona.model ? ` \u00B7 ${persona.model}` : ''}</div>
            </div>
            <button
              onClick={() => startEdit(persona)}
              className="hidden shrink-0 rounded p-1 text-zinc-600 hover:bg-zinc-700 hover:text-zinc-300 group-hover:block"
              title="Edit"
            >
              <Pencil className="size-3" />
            </button>
            <button
              onClick={() => handleDelete(persona.id)}
              className="hidden shrink-0 rounded p-1 text-zinc-600 hover:bg-zinc-700 hover:text-red-400 group-hover:block"
              title="Delete"
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
