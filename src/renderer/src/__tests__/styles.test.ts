import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

describe('styles.css', () => {
  it('keeps the global reset inside Tailwind base layer so spacing utilities can override it', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles.css'), 'utf8');

    expect(styles).toMatch(
      /@layer base\s*\{[\s\S]*\*\s*\{[\s\S]*margin:\s*0;[\s\S]*padding:\s*0;[\s\S]*box-sizing:\s*border-box;/,
    );
  });
});
