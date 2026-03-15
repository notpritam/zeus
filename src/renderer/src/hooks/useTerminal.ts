import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { zeusWs } from '@/lib/ws';
import type { WsEnvelope, TerminalOutputPayload, TerminalExitPayload } from '../../../shared/types';

export function useTerminal(
  sessionId: string | null,
  containerRef: React.RefObject<HTMLDivElement | null>,
) {
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!sessionId || !containerRef.current) return;

    const container = containerRef.current;

    const term = new Terminal({
      fontFamily: 'var(--font-mono), "SF Mono", "Fira Code", "Cascadia Code", monospace',
      fontSize: 13,
      lineHeight: 1.3,
      theme: {
        background: '#0a0a0a',
        foreground: '#e0e0e0',
        cursor: '#22c55e',
        selectionBackground: 'rgba(34, 197, 94, 0.25)',
        black: '#0a0a0a',
        brightBlack: '#555555',
        white: '#e0e0e0',
        brightWhite: '#ffffff',
        green: '#22c55e',
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

    // Initial fit
    requestAnimationFrame(() => {
      fitAddon.fit();
      // Send initial resize to server
      zeusWs.send({
        channel: 'terminal',
        sessionId,
        payload: { type: 'resize', cols: term.cols, rows: term.rows },
        auth: '',
      });
    });

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Terminal input → server
    const inputDisposable = term.onData((data) => {
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
      const payload = envelope.payload as { type: string };

      if (payload.type === 'output') {
        const { data } = envelope.payload as TerminalOutputPayload;
        term.write(data);
      } else if (payload.type === 'exit') {
        const { code } = envelope.payload as TerminalExitPayload;
        term.write(`\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m\r\n`);
      }
    });

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (fitAddonRef.current) {
          fitAddonRef.current.fit();
          if (termRef.current) {
            zeusWs.send({
              channel: 'terminal',
              sessionId,
              payload: { type: 'resize', cols: termRef.current.cols, rows: termRef.current.rows },
              auth: '',
            });
          }
        }
      });
    });
    resizeObserver.observe(container);

    return () => {
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
