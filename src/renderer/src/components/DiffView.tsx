import { useEffect, useRef, useState } from 'react';
import { monaco } from '@/lib/monaco-setup';
import { useZeusStore } from '@/stores/useZeusStore';
import { getFileIcon } from '@/lib/file-icons';
import type { GitFileStatus } from '../../../../shared/types';

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

// Register Zeus dark theme once
let themeRegistered = false;
function ensureTheme() {
  if (themeRegistered) return;
  monaco.editor.defineTheme('zeus-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#0a0a0a',
      'editor.foreground': '#e0e0e0',
      'editorLineNumber.foreground': '#333333',
      'editorLineNumber.activeForeground': '#888888',
      'diffEditor.insertedTextBackground': '#22c55e18',
      'diffEditor.removedTextBackground': '#ef444418',
      'diffEditor.insertedLineBackground': '#22c55e0d',
      'diffEditor.removedLineBackground': '#ef44440d',
      'editor.lineHighlightBackground': '#1a1a1a',
      'editorGutter.background': '#0a0a0a',
    },
  });
  themeRegistered = true;
}

export default function DiffView() {
  const openDiffTabs = useZeusStore((s) => s.openDiffTabs);
  const activeDiffTabId = useZeusStore((s) => s.activeDiffTabId);
  const gitStatus = useZeusStore((s) => s.gitStatus);
  const updateDiffContent = useZeusStore((s) => s.updateDiffContent);
  const saveDiffFile = useZeusStore((s) => s.saveDiffFile);
  const [renderSideBySide, setRenderSideBySide] = useState(true);

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

    // Dispose previous editor + models
    changeListenerRef.current?.dispose();
    editorRef.current?.dispose();
    originalModelRef.current?.dispose();
    modifiedModelRef.current?.dispose();

    if (activeTab.mode === 'edit') {
      // Standalone editor for file viewing/editing
      const model = monaco.editor.createModel(
        activeTab.modified,
        activeTab.language,
      );
      modifiedModelRef.current = model;
      originalModelRef.current = null;

      const editor = monaco.editor.create(containerRef.current, {
        model,
        theme: 'zeus-dark',
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
        editor.dispose();
        model.dispose();
        editorRef.current = null;
        modifiedModelRef.current = null;
        changeListenerRef.current = null;
      };
    } else {
      // Diff editor for git diffs
      const originalModel = monaco.editor.createModel(
        activeTab.original,
        activeTab.language,
      );
      const modifiedModel = monaco.editor.createModel(
        activeTab.modified,
        activeTab.language,
      );

      originalModelRef.current = originalModel;
      modifiedModelRef.current = modifiedModel;

      const diffEditor = monaco.editor.createDiffEditor(containerRef.current, {
        theme: 'zeus-dark',
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
        diffEditor.dispose();
        originalModel.dispose();
        modifiedModel.dispose();
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
