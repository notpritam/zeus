import { describe, it, expect } from 'vitest';
import { createMainWindowOptions } from '../window';

describe('createMainWindowOptions', () => {
  it('creates a resizable main window', () => {
    const options = createMainWindowOptions();

    expect(options.resizable).toBe(true);
  });
});
