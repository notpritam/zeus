import type { ConnectionSlice } from './slices/connectionSlice';
import type { ClaudeSlice } from './slices/claudeSlice';
import type { TerminalSlice } from './slices/terminalSlice';
import type { GitSlice } from './slices/gitSlice';
import type { FileSlice } from './slices/fileSlice';
import type { QaSlice } from './slices/qaSlice';
import type { AndroidSlice } from './slices/androidSlice';
import type { SubagentSlice } from './slices/subagentSlice';
import type { SettingsSlice } from './slices/settingsSlice';
import type { McpSlice } from './slices/mcpSlice';
import type { TaskSlice } from './slices/taskSlice';
import type { PermissionSlice } from './slices/permissionSlice';
import type { PerfSlice } from './slices/perfSlice';
import type { DiffSlice } from './slices/diffSlice';
import type { ViewSlice } from './slices/viewSlice';

export type ViewMode = 'terminal' | 'claude' | 'diff' | 'settings' | 'new-session';

export interface DiffTab {
  id: string;
  sessionId: string;
  file: string;
  staged: boolean;
  original: string;
  modified: string;
  language: string;
  isDirty: boolean;
  mode: 'diff' | 'edit';
}

export interface SubagentClient {
  info: import('../../../shared/types').SubagentSessionInfo;
  entries: import('../../../shared/types').NormalizedEntry[];
}

export type ZeusState =
  ConnectionSlice &
  ClaudeSlice &
  TerminalSlice &
  GitSlice &
  FileSlice &
  QaSlice &
  AndroidSlice &
  SubagentSlice &
  SettingsSlice &
  McpSlice &
  TaskSlice &
  PermissionSlice &
  PerfSlice &
  DiffSlice &
  ViewSlice;
