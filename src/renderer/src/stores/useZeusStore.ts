import { create } from 'zustand';
import type { ZeusState } from './types';
import { createConnectionSlice } from './slices/connectionSlice';
import { createClaudeSlice } from './slices/claudeSlice';
import { createTerminalSlice } from './slices/terminalSlice';
import { createGitSlice } from './slices/gitSlice';
import { createFileSlice } from './slices/fileSlice';
import { createQaSlice } from './slices/qaSlice';
import { createAndroidSlice } from './slices/androidSlice';
import { createSubagentSlice } from './slices/subagentSlice';
import { createSettingsSlice } from './slices/settingsSlice';
import { createMcpSlice } from './slices/mcpSlice';
import { createTaskSlice } from './slices/taskSlice';
import { createPermissionSlice } from './slices/permissionSlice';
import { createPerfSlice } from './slices/perfSlice';
import { createDiffSlice } from './slices/diffSlice';
import { createViewSlice } from './slices/viewSlice';

export type { ZeusState } from './types';
export type { ViewMode, DiffTab, SubagentClient } from './types';

export const useZeusStore = create<ZeusState>()((...a) => ({
  ...createConnectionSlice(...a),
  ...createClaudeSlice(...a),
  ...createTerminalSlice(...a),
  ...createGitSlice(...a),
  ...createFileSlice(...a),
  ...createQaSlice(...a),
  ...createAndroidSlice(...a),
  ...createSubagentSlice(...a),
  ...createSettingsSlice(...a),
  ...createMcpSlice(...a),
  ...createTaskSlice(...a),
  ...createPermissionSlice(...a),
  ...createPerfSlice(...a),
  ...createDiffSlice(...a),
  ...createViewSlice(...a),
}));
