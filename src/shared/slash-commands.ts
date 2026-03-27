// Slash command registry for Claude Code CLI commands.
// Commands with `localHandler` are intercepted by Zeus and not forwarded to Claude.
// All other commands are sent as-is to the Claude CLI process.

export type LocalHandler = 'clear';

export interface SlashCommand {
  command: string;
  description: string;
  args?: string;
  localHandler?: LocalHandler;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    command: '/clear',
    description: 'Clear conversation history',
    localHandler: 'clear',
  },
  {
    command: '/compact',
    description: 'Compact conversation to reduce context',
    args: '[instructions]',
  },
  {
    command: '/config',
    description: 'View or modify configuration',
  },
  {
    command: '/cost',
    description: 'Show token usage and cost for this session',
  },
  {
    command: '/doctor',
    description: 'Check Claude Code installation health',
  },
  {
    command: '/help',
    description: 'Show usage help and available commands',
  },
  {
    command: '/init',
    description: 'Initialize project with a CLAUDE.md guide',
  },
  {
    command: '/login',
    description: 'Switch Anthropic accounts',
  },
  {
    command: '/logout',
    description: 'Sign out from Anthropic account',
  },
  {
    command: '/memory',
    description: 'Edit memory files (CLAUDE.md)',
  },
  {
    command: '/model',
    description: 'Set or show the current AI model',
    args: '[model-name]',
  },
  {
    command: '/permissions',
    description: 'Manage tool permissions',
  },
  {
    command: '/pr_comments',
    description: 'Get comments from current pull request',
  },
  {
    command: '/review',
    description: 'Request a code review',
  },
  {
    command: '/status',
    description: 'View account and system status',
  },
  {
    command: '/terminal-setup',
    description: 'Install terminal integration',
  },
  {
    command: '/vim',
    description: 'Toggle Vim mode',
  },
];

/** Filter commands by the typed prefix (case-insensitive). */
export function getFilteredCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase();
  return SLASH_COMMANDS.filter((cmd) => cmd.command.startsWith(q));
}
