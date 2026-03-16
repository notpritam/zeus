import { useEffect, useRef, useState, useCallback } from 'react';
import { DiffEditor, loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { useZeusStore } from '@/stores/useZeusStore';
import type { GitFileStatus } from '../../../../shared/types';

// Use local Monaco bundling (Electron — no CDN)
loader.config({ monaco });

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

// Register Zeus dark theme
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
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);

  const activeTab = openDiffTabs.find((t) => t.id === activeDiffTabId);

  // Register theme on mount
  useEffect(() => {
    ensureTheme();
  }, []);

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

  const handleEditorDidMount = useCallback(
    (editor: monaco.editor.IStandaloneDiffEditor) => {
      editorRef.current = editor;

      // Listen for changes on the modified (right) editor
      const modifiedEditor = editor.getModifiedEditor();
      modifiedEditor.onDidChangeModelContent(() => {
        const content = modifiedEditor.getValue();
        if (activeDiffTabId) {
          updateDiffContent(activeDiffTabId, content);
        }
      });
    },
    [activeDiffTabId, updateDiffContent],
  );

  if (!activeTab) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-text-muted text-sm">No diff tab selected</p>
      </div>
    );
  }

  const fileName = activeTab.file;
  const dirName = fileName.includes('/')
    ? fileName.substring(0, fileName.lastIndexOf('/'))
    : '';
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
        <span className="text-text-ghost text-[10px]">·</span>
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

      {/* Monaco DiffEditor */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <DiffEditor
          key={activeTab.id}
          height="100%"
          original={activeTab.original}
          modified={activeTab.modified}
          language={activeTab.language}
          theme="zeus-dark"
          onMount={handleEditorDidMount}
          options={{
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
          }}
        />
      </div>
    </div>
  );
}
