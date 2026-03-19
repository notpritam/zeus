import { useLayoutEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { zeusWs } from '@/lib/ws';
import type { WsEnvelope, TerminalOutputPayload, TerminalExitPayload } from '../../../shared/types';

/** Check if a terminal instance is alive and its renderer is ready */
function isTerminalReady(term: Terminal | null): term is Terminal {
  if (!term) return false;
  // After disposal, xterm sets element to undefined
  if (!term.element) return false;
  return true;
}

/** Safely fit the terminal and send resize if dimensions changed */
function safeFitAndResize(
  term: Terminal,
  fitAddon: FitAddon,
  container: HTMLElement,
  sessionId: string,
): void {
  // Skip hidden / zero-size containers — renderer has nothing to measure
  if (container.offsetWidth === 0 || container.offsetHeight === 0) return;
  if (!isTerminalReady(term)) return;
  try {
    fitAddon.fit();
  } catch {
    // FitAddon.fit() accesses _renderService.dimensions internally;
    // this throws when the renderer isn't initialised (hidden tab, mid-dispose, etc.)
    return;
  }
  // cols/rows read can also fail if terminal was disposed between fit() and here
  try {
    zeusWs.send({
      channel: 'terminal',
      sessionId,
      payload: { type: 'resize', cols: term.cols, rows: term.rows },
      auth: '',
    });
  } catch {
    // Terminal disposed mid-operation — ignore
  }
}

export function useTerminal(
  sessionId: string | null,
  containerRef: React.RefObject<HTMLDivElement | null>,
  onExit?: (code: number) => void,
) {
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const disposedRef = useRef(false);

  useLayoutEffect(() => {
    if (!sessionId || !containerRef.current) return;
    disposedRef.current = false;

    const container = containerRef.current;

    // Read theme colors from CSS custom properties
    const styles = getComputedStyle(document.documentElement);
    const bg = styles.getPropertyValue('--color-bg').trim() || '#0a0a0a';
    const fg = styles.getPropertyValue('--color-foreground').trim() || '#e0e0e0';
    const accent = styles.getPropertyValue('--color-accent').trim() || '#22c55e';

    const term = new Terminal({
      fontFamily: 'var(--font-mono), "JetBrains Mono", "SF Mono", "Fira Code", "Cascadia Code", monospace',
      fontSize: 12,
      lineHeight: 1.4,
      theme: {
        background: bg,
        foreground: fg,
        cursor: accent,
        selectionBackground: 'rgba(34, 197, 94, 0.25)',
        black: bg,
        brightBlack: '#555555',
        white: fg,
        brightWhite: '#ffffff',
        green: accent,
        brightGreen: '#4ade80',
        red: '#ef4444',
        brightRed: '#f87171',
        yellow: '#f59e0b',
        brightYellow: '#fbbf24',
        blue: '#3b82f6',
        brightBlue: '#60a5fa',
        cyan: '#06b6d4',
        brightCyan: '#22d3ee',
        magenta: '#a855f7',
        brightMagenta: '#c084fc',
      },
      cursorBlink: true,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(container);

    // Initial fit (guard against hidden containers)
    requestAnimationFrame(() => {
      if (disposedRef.current) return;
      safeFitAndResize(term, fitAddon, container, sessionId);
    });

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Terminal input → server
    const inputDisposable = term.onData((data) => {
      if (disposedRef.current) return;
      zeusWs.send({
        channel: 'terminal',
        sessionId,
        payload: { type: 'input', data },
        auth: '',
      });
    });

    // Server output → terminal
    const unsubscribe = zeusWs.on('terminal', (envelope: WsEnvelope) => {
      if (envelope.sessionId !== sessionId) return;
      if (disposedRef.current || !isTerminalReady(term)) return;
      const payload = envelope.payload as { type: string };

      try {
        if (payload.type === 'output') {
          const { data } = envelope.payload as TerminalOutputPayload;
          term.write(data);
        } else if (payload.type === 'exit') {
          const { code } = envelope.payload as TerminalExitPayload;
          term.write(`\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m\r\n`);
          onExit?.(code);
        }
      } catch {
        // Terminal disposed between check and write — ignore
      }
    });

    // Resize observer — skip when container is hidden (display:none → zero dimensions)
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (disposedRef.current) return;
        const t = termRef.current;
        const f = fitAddonRef.current;
        if (!t || !f) return;
        safeFitAndResize(t, f, container, sessionId);
      });
    });
    resizeObserver.observe(container);

    return () => {
      disposedRef.current = true;
      resizeObserver.disconnect();
      inputDisposable.dispose();
      unsubscribe();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId, containerRef]);

  return { terminal: termRef };
}
