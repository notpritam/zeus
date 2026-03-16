#!/usr/bin/env node
/**
 * Generates notification .wav files for Zeus.
 * Run: node scripts/generate-sounds.mjs
 *
 * Creates 3 sounds:
 *   - approval.wav  — two-tone alert (attention needed)
 *   - success.wav   — rising chime (task done)
 *   - error.wav     — low descending tone (task failed)
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'src', 'renderer', 'src', 'assets', 'sounds');
mkdirSync(outDir, { recursive: true });

const SAMPLE_RATE = 44100;

function generateWav(samples) {
  const numSamples = samples.length;
  const byteRate = SAMPLE_RATE * 2; // 16-bit mono
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);       // chunk size
  buffer.writeUInt16LE(1, 20);        // PCM
  buffer.writeUInt16LE(1, 22);        // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(2, 32);        // block align
  buffer.writeUInt16LE(16, 34);       // bits per sample

  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const val = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(val * 32767), 44 + i * 2);
  }

  return buffer;
}

function sine(freq, t) {
  return Math.sin(2 * Math.PI * freq * t);
}

function envelope(t, attack, sustain, release, total) {
  if (t < attack) return t / attack;
  if (t < attack + sustain) return 1;
  if (t < total) return 1 - (t - attack - sustain) / release;
  return 0;
}

// ─── Approval: Two-note alert (C5, E5 repeated) ───
function generateApproval() {
  const duration = 0.5;
  const numSamples = Math.floor(SAMPLE_RATE * duration);
  const samples = new Float64Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;
    const noteLen = 0.12;
    const gap = 0.02;
    const cycle = noteLen + gap;

    const noteIndex = Math.floor(t / cycle);
    const noteT = t - noteIndex * cycle;

    if (noteT < noteLen) {
      const freq = noteIndex % 2 === 0 ? 784 : 988; // G5, B5
      const env = envelope(noteT, 0.01, 0.06, 0.05, noteLen);
      samples[i] = sine(freq, noteT) * env * 0.35;
    }
  }

  return samples;
}

// ─── Success: Rising arpeggio (C5, E5, G5) ───
function generateSuccess() {
  const duration = 0.45;
  const numSamples = Math.floor(SAMPLE_RATE * duration);
  const samples = new Float64Array(numSamples);
  const notes = [523, 659, 784]; // C5, E5, G5

  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;
    const noteLen = 0.14;

    for (let n = 0; n < notes.length; n++) {
      const start = n * 0.1;
      const noteT = t - start;
      if (noteT >= 0 && noteT < noteLen) {
        const env = envelope(noteT, 0.01, 0.06, 0.07, noteLen);
        samples[i] += sine(notes[n], noteT) * env * 0.3;
      }
    }
  }

  return samples;
}

// ─── Error: Descending two-note (E4, C4) ───
function generateError() {
  const duration = 0.45;
  const numSamples = Math.floor(SAMPLE_RATE * duration);
  const samples = new Float64Array(numSamples);
  const notes = [330, 262]; // E4, C4

  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;

    for (let n = 0; n < notes.length; n++) {
      const start = n * 0.18;
      const noteLen = 0.2;
      const noteT = t - start;
      if (noteT >= 0 && noteT < noteLen) {
        const env = envelope(noteT, 0.01, 0.1, 0.09, noteLen);
        samples[i] += sine(notes[n], noteT) * env * 0.3;
      }
    }
  }

  return samples;
}

// Generate and write
writeFileSync(join(outDir, 'approval.wav'), generateWav(generateApproval()));
writeFileSync(join(outDir, 'success.wav'), generateWav(generateSuccess()));
writeFileSync(join(outDir, 'error.wav'), generateWav(generateError()));

console.log('Generated sound files in', outDir);
