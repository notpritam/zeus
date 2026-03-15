import { powerSaveBlocker } from 'electron';

let blockerId: number | null = null;

export function startPowerBlock(): void {
  blockerId = powerSaveBlocker.start('prevent-display-sleep');
  console.log(`[Zeus] Power blocker started (id: ${blockerId})`);
}

export function stopPowerBlock(): void {
  if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) {
    powerSaveBlocker.stop(blockerId);
    console.log('[Zeus] Power blocker stopped');
    blockerId = null;
  }
}

export function isPowerBlocked(): boolean {
  return blockerId !== null && powerSaveBlocker.isStarted(blockerId);
}
