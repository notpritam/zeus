import { useEffect, useRef } from 'react';
import type { ClaudeSessionInfo, SessionActivity } from '../../../shared/types';

// Vite resolves these to hashed asset URLs
import approvalSoundUrl from '@/assets/sounds/approval.wav';
import successSoundUrl from '@/assets/sounds/success.wav';
import errorSoundUrl from '@/assets/sounds/error.wav';

type AttentionReason = 'approval_needed' | 'task_done' | 'task_error';

const SOUND_URLS: Record<AttentionReason, string> = {
  approval_needed: approvalSoundUrl,
  task_done: successSoundUrl,
  task_error: errorSoundUrl,
};

/**
 * Plays notification sounds and shows system notifications when
 * Claude sessions need attention: tool approval, task done, or error.
 *
 * Uses real .wav files via AudioContext (like vibe-kanban) to avoid
 * macOS NowPlaying/MediaRemote TCC prompts that `new Audio()` triggers.
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

// ─── Sound (AudioContext + decodeAudioData, same approach as vibe-kanban) ───

async function playSound(reason: AttentionReason): Promise<void> {
  try {
    const url = SOUND_URLS[reason];
    const ctx = new AudioContext();
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    const audioData = await ctx.decodeAudioData(buf);
    const source = ctx.createBufferSource();
    source.buffer = audioData;
    source.connect(ctx.destination);
    source.start();
    source.onended = () => ctx.close();
  } catch {
    // Audio not available — fall back to oscillator
    playToneFallback(reason);
  }
}

/** Fallback oscillator tone if .wav fetch fails */
function playToneFallback(reason: AttentionReason) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';

    if (reason === 'approval_needed') {
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12);
    } else if (reason === 'task_done') {
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1047, ctx.currentTime + 0.1);
    } else {
      osc.frequency.setValueAtTime(330, ctx.currentTime);
      osc.frequency.setValueAtTime(220, ctx.currentTime + 0.15);
    }

    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.35);
    osc.onended = () => ctx.close();
  } catch {
    // Truly no audio available
  }
}

// ─── System notification ───

function showSystemNotification(reason: AttentionReason, sessionName: string) {
  if (document.hasFocus()) return;

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
  playSound(reason);
  showSystemNotification(reason, sessionName);
}

function truncate(str: string, max: number) {
  return str.length > max ? str.slice(0, max - 1) + '\u2026' : str;
}
