import { useEffect, useRef } from 'react';
import type { ClaudeSessionInfo, SessionActivity } from '../../../shared/types';

type AttentionReason = 'approval_needed' | 'task_done' | 'task_error';

/**
 * Plays notification sounds and shows system notifications when
 * Claude sessions need attention: tool approval, task done, or error.
 */
export function useNotificationSound(
  claudeSessions: ClaudeSessionInfo[],
  sessionActivity: Record<string, SessionActivity>,
) {
  const prevStatusRef = useRef<Record<string, string>>({});
  const prevActivityRef = useRef<Record<string, string>>({});

  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    const prevActivity = prevActivityRef.current;

    for (const session of claudeSessions) {
      const activity = sessionActivity[session.id] ?? { state: 'idle' };
      const prevState = prevActivity[session.id];
      const wasRunning = prevStatus[session.id] === 'running';

      // Session finished
      if (wasRunning && session.status === 'done' && session.notificationSound !== false) {
        notify('task_done', session.name || session.prompt);
      }

      // Session errored
      if (wasRunning && session.status === 'error' && session.notificationSound !== false) {
        notify('task_error', session.name || session.prompt);
      }

      // Needs approval (only fire once per transition)
      if (
        activity.state === 'waiting_approval' &&
        prevState !== 'waiting_approval' &&
        session.notificationSound !== false
      ) {
        notify('approval_needed', session.name || session.prompt);
      }

      prevStatus[session.id] = session.status;
      prevActivity[session.id] = activity.state;
    }
  }, [claudeSessions, sessionActivity]);
}

// ─── Sound ───

function playTone(reason: AttentionReason) {
  try {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.type = 'sine';

    if (reason === 'approval_needed') {
      // Two-tone alert: urgent feel
      oscillator.frequency.setValueAtTime(660, ctx.currentTime);
      oscillator.frequency.setValueAtTime(880, ctx.currentTime + 0.12);
      oscillator.frequency.setValueAtTime(660, ctx.currentTime + 0.24);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.4);
    } else if (reason === 'task_done') {
      // Rising chime: success
      oscillator.frequency.setValueAtTime(880, ctx.currentTime);
      oscillator.frequency.setValueAtTime(1047, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.3);
    } else {
      // Low tone: error
      oscillator.frequency.setValueAtTime(330, ctx.currentTime);
      oscillator.frequency.setValueAtTime(220, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.35);
    }

    oscillator.onended = () => ctx.close();
  } catch {
    // Audio not available
  }
}

// ─── System notification ───

function showSystemNotification(reason: AttentionReason, sessionName: string) {
  if (document.hasFocus()) return; // Only notify when window is not focused

  const titles: Record<AttentionReason, string> = {
    approval_needed: 'Approval Needed',
    task_done: 'Task Complete',
    task_error: 'Task Failed',
  };

  const bodies: Record<AttentionReason, string> = {
    approval_needed: `"${truncate(sessionName, 40)}" needs your approval to continue.`,
    task_done: `"${truncate(sessionName, 40)}" finished successfully.`,
    task_error: `"${truncate(sessionName, 40)}" encountered an error.`,
  };

  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(titles[reason], { body: bodies[reason], silent: true });
  } else if ('Notification' in window && Notification.permission !== 'denied') {
    Notification.requestPermission().then((perm) => {
      if (perm === 'granted') {
        new Notification(titles[reason], { body: bodies[reason], silent: true });
      }
    });
  }
}

function notify(reason: AttentionReason, sessionName: string) {
  playTone(reason);
  showSystemNotification(reason, sessionName);
}

function truncate(str: string, max: number) {
  return str.length > max ? str.slice(0, max - 1) + '\u2026' : str;
}
