import { useEffect, useRef, useState } from 'react';
import { monaco } from '@/lib/monaco-setup';
import { useZeusStore } from '@/stores/useZeusStore';
import { getFileIcon } from '@/lib/file-icons';
import type { GitFileStatus } from '../../../shared/types';

const STATUS_STYLES: Record<string, { label: string; color: string }> = {
  M: { label: 'M', color: 'text-warn' },
  MM: { label: 'M', color: 'text-warn' },
  A: { label: 'A', color: 'text-accent' },
  AM: { label: 'A', color: 'text-accent' },
  D: { label: 'D', color: 'text-destructive' },
  '??': { label: 'U', color: 'text-text-muted' },
  R: { label: 'R', color: 'text-info' },
};

function getFileStatus(
  file: string,
  sessionId: string,
  gitStatus: Record<string, { staged: { file: string; status: GitFileStatus }[]; unstaged: { file: string; status: GitFileStatus }[] }>,
): { label: string; color: string } {
  const status = gitStatus[sessionId];
  if (!status) return STATUS_STYLES['M'];
  const match =
    status.staged.find((c) => c.file === file) ||
    status.unstaged.find((c) => c.file === file);
  if (!match) return STATUS_STYLES['M'];
  return STATUS_STYLES[match.status] || STATUS_STYLES['M'];
}

// Register Monaco theme from current Zeus theme colors
let lastThemeHash = '';
function ensureTheme() {
  const root = document.documentElement;
  const bg = root.style.getPropertyValue('--color-bg') || '#0a0a0a';
  const fg = root.style.getPropertyValue('--color-foreground') || '#e0e0e0';
  const ghost = root.style.getPropertyValue('--color-text-ghost') || '#333333';
  const muted = root.style.getPropertyValue('--color-text-muted') || '#888888';
  const surface = root.style.getPropertyValue('--color-bg-surface') || '#1a1a1a';
  const accent = root.style.getPropertyValue('--color-accent') || '#22c55e';
  const danger = root.style.getPropertyValue('--color-danger') || '#ef4444';

  const hash = `${bg}${fg}${ghost}${muted}${surface}${accent}${danger}`;
  if (hash === lastThemeHash) return;
  lastThemeHash = hash;

  const isDark = root.classList.contains('dark');
  monaco.editor.defineTheme('zeus-theme', {
    base: isDark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': bg,
      'editor.foreground': fg,
      'editorLineNumber.foreground': ghost,
      'editorLineNumber.activeForeground': muted,
      'diffEditor.insertedTextBackground': accent + '18',
      'diffEditor.removedTextBackground': danger + '18',
      'diffEditor.insertedLineBackground': accent + '0d',
      'diffEditor.removedLineBackground': danger + '0d',
      'editor.lineHighlightBackground': surface,
      'editorGutter.background': bg,
    },
  });
  monaco.editor.setTheme('zeus-theme');
}

export default function DiffView() {
  const openDiffTabs = useZeusStore((s) => s.openDiffTabs);
  const activeDiffTabId = useZeusStore((s) => s.activeDiffTabId);
  const gitStatus = useZeusStore((s) => s.gitStatus);
  const updateDiffContent = useZeusStore((s) => s.updateDiffContent);
  const saveDiffFile = useZeusStore((s) => s.saveDiffFile);
  const activeThemeColors = useZeusStore((s) => s.activeThemeColors);
  const [renderSideBySide, setRenderSideBySide] = useState(true);

  // Re-register Monaco theme when Zeus theme changes
  useEffect(() => {
    ensureTheme();
  }, [activeThemeColors]);

  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | monaco.editor.IStandaloneCodeEditor | null>(null);
  const originalModelRef = useRef<monaco.editor.ITextModel | null>(null);
  const modifiedModelRef = useRef<monaco.editor.ITextModel | null>(null);
  const changeListenerRef = useRef<monaco.IDisposable | null>(null);

  const activeTab = openDiffTabs.find((t) => t.id === activeDiffTabId);
  const isEditMode = activeTab?.mode === 'edit';

  // Create / destroy the editor when the active tab changes
  useEffect(() => {
    ensureTheme();

    if (!containerRef.current || !activeTab) return;

    // Dispose previous editor + models safely
    try { changeListenerRef.current?.dispose(); } catch { /* already disposed */ }
    try { editorRef.current?.dispose(); } catch { /* already disposed */ }
    try { originalModelRef.current?.dispose(); } catch { /* already disposed */ }
    try { modifiedModelRef.current?.dispose(); } catch { /* already disposed */ }

    // Guard: container must have non-zero dimensions for Monaco
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      // Retry on next frame when layout settles
      const raf = requestAnimationFrame(() => {
        // Force re-run by toggling a no-op state (the effect depends on activeTab.id)
      });
      return () => cancelAnimationFrame(raf);
    }

    if (activeTab.mode === 'edit') {
      // Standalone editor for file viewing/editing
      const model = monaco.editor.createModel(
        activeTab.modified ?? '',
        activeTab.language,
      );
      modifiedModelRef.current = model;
      originalModelRef.current = null;

      const editor = monaco.editor.create(containerRef.current, {
        model,
        theme: 'zeus-theme',
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 13,
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        wordWrap: 'off',
      });

      editorRef.current = editor;

      const listener = model.onDidChangeContent(() => {
        if (activeDiffTabId) {
          updateDiffContent(activeDiffTabId, model.getValue());
        }
      });
      changeListenerRef.current = listener;

      return () => {
        listener.dispose();
        try { editor.dispose(); } catch { /* ok */ }
        try { model.dispose(); } catch { /* ok */ }
        editorRef.current = null;
        modifiedModelRef.current = null;
        changeListenerRef.current = null;
      };
    } else {
      // Diff editor for git diffs
      const originalModel = monaco.editor.createModel(
        activeTab.original ?? '',
        activeTab.language,
      );
      const modifiedModel = monaco.editor.createModel(
        activeTab.modified ?? '',
        activeTab.language,
      );

      originalModelRef.current = originalModel;
      modifiedModelRef.current = modifiedModel;

      const diffEditor = monaco.editor.createDiffEditor(containerRef.current, {
        theme: 'zeus-theme',
        renderSideBySide,
        originalEditable: false,
        readOnly: false,
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 13,
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        wordWrap: 'off',
        diffWordWrap: 'off',
      });

      diffEditor.setModel({ original: originalModel, modified: modifiedModel });
      editorRef.current = diffEditor;

      const listener = modifiedModel.onDidChangeContent(() => {
        if (activeDiffTabId) {
          updateDiffContent(activeDiffTabId, modifiedModel.getValue());
        }
      });
      changeListenerRef.current = listener;

      return () => {
        listener.dispose();
        try { diffEditor.dispose(); } catch { /* ok */ }
        try { originalModel.dispose(); } catch { /* ok */ }
        try { modifiedModel.dispose(); } catch { /* ok */ }
        editorRef.current = null;
        originalModelRef.current = null;
        modifiedModelRef.current = null;
        changeListenerRef.current = null;
      };
    }
    // Re-create when the active tab switches
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab?.id]);

  // Update side-by-side option without recreating the editor (diff mode only)
  useEffect(() => {
    if (editorRef.current && 'updateOptions' in editorRef.current && !isEditMode) {
      (editorRef.current as monaco.editor.IStandaloneDiffEditor).updateOptions({ renderSideBySide });
    }
  }, [renderSideBySide, isEditMode]);

  // Cmd+S / Ctrl+S handler
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (activeDiffTabId) {
          saveDiffFile(activeDiffTabId);
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeDiffTabId, saveDiffFile]);

  if (!activeTab) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-text-muted text-sm">No diff tab selected</p>
      </div>
    );
  }

  const fileName = activeTab.file;
  const shortName = fileName.split('/').pop() || fileName;
  const dirName = fileName.includes('/')
    ? fileName.substring(0, fileName.lastIndexOf('/'))
    : '';

  if (isEditMode) {
    const iconInfo = getFileIcon(shortName);
    const IconComponent = iconInfo.icon;

    return (
      <div className="flex h-full flex-col">
        {/* Edit mode toolbar */}
        <div className="bg-bg-card border-border flex shrink-0 items-center gap-2 border-b px-3 py-1">
          <IconComponent className={`size-3.5 ${iconInfo.color}`} />
          <span className="text-foreground text-xs">{fileName}</span>
          {dirName && (
            <span className="text-text-ghost text-[10px]">{dirName}</span>
          )}
          {activeTab.isDirty && (
            <span className="bg-primary ml-1 inline-block size-1.5 rounded-full" />
          )}
        </div>
        <div ref={containerRef} className="min-h-0 flex-1" />
      </div>
    );
  }

  // Diff mode
  const statusStyle = getFileStatus(activeTab.file, activeTab.sessionId, gitStatus);

  return (
    <div className="flex h-full flex-col">
      {/* Diff toolbar */}
      <div className="bg-bg-card border-border flex shrink-0 items-center gap-2 border-b px-3 py-1">
        <span className={`${statusStyle.color} text-[10px] font-bold`}>{statusStyle.label}</span>
        <span className="text-foreground text-xs">{fileName}</span>
        {dirName && (
          <span className="text-text-ghost text-[10px]">{dirName}</span>
        )}
        <span className="text-text-ghost text-[10px]">&middot;</span>
        <span className="text-text-muted text-[10px]">
          {activeTab.staged ? 'Staged' : 'Unstaged'}
        </span>

        {/* Inline / Side-by-Side toggle */}
        <div className="ml-auto flex gap-1">
          <button
            className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
              !renderSideBySide
                ? 'bg-primary/10 border-primary text-foreground border'
                : 'border-border text-text-muted border hover:text-text-secondary'
            }`}
            onClick={() => setRenderSideBySide(false)}
          >
            Inline
          </button>
          <button
            className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
              renderSideBySide
                ? 'bg-primary/10 border-primary text-foreground border'
                : 'border-border text-text-muted border hover:text-text-secondary'
            }`}
            onClick={() => setRenderSideBySide(true)}
          >
            Side-by-Side
          </button>
        </div>
      </div>

      {/* Monaco DiffEditor — direct API, no wrapper */}
      <div ref={containerRef} className="min-h-0 flex-1" />
    </div>
  );
}
