import { useEffect, useRef } from 'react';
import type { ClaudeSessionInfo } from '../../../shared/types';

/**
 * Plays a short notification tone when a Claude session transitions
 * from 'running' to 'done', if that session has notificationSound enabled.
 */
export function useNotificationSound(claudeSessions: ClaudeSessionInfo[]) {
  const prevStatusRef = useRef<Record<string, string>>({});

  useEffect(() => {
    const prev = prevStatusRef.current;

    for (const session of claudeSessions) {
      const wasRunning = prev[session.id] === 'running';
      const isDone = session.status === 'done';

      if (wasRunning && isDone && session.notificationSound !== false) {
        playTone();
      }

      prev[session.id] = session.status;
    }
  }, [claudeSessions]);
}

function playTone() {
  try {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.connect(gain);
    gain.connect(ctx.destination);

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, ctx.currentTime);
    oscillator.frequency.setValueAtTime(1047, ctx.currentTime + 0.1);

    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.3);

    oscillator.onended = () => ctx.close();
  } catch {
    // Audio not available — ignore
  }
}
