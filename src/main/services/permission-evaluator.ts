// src/main/services/permission-evaluator.ts
// Permission evaluator — glob matching, rule evaluation, and built-in templates

import picomatch from 'picomatch';
import path from 'path';
import type {
  PermissionRule,
  PermissionAction,
  PermissionTemplate,
} from '../../shared/permission-types';

// ─── Glob Matching ───────────────────────────────────────────────────────────

/**
 * Match a string against a glob pattern.
 * Fast-paths for '*' (match everything) and exact string match.
 * Falls back to picomatch for real glob evaluation.
 */
export function matchGlob(str: string, pattern: string): boolean {
  // Fast-path: wildcard matches everything
  if (pattern === '*') return true;

  // Fast-path: exact match
  if (str === pattern) return true;

  // Picomatch glob evaluation
  const isMatch = picomatch(pattern, { dot: true, bash: true });
  return isMatch(str);
}

// ─── Path Helpers ────────────────────────────────────────────────────────────

/**
 * Make an absolute path relative to the project directory.
 * If the path is already relative or not inside the project, return as-is.
 */
export function relativize(filePath: string, projectDir: string): string {
  if (!path.isAbsolute(filePath)) return filePath;

  const normalizedFile = path.normalize(filePath);
  const normalizedDir = path.normalize(projectDir).replace(/\/$/, '');

  if (normalizedFile.startsWith(normalizedDir + path.sep)) {
    return path.relative(normalizedDir, normalizedFile);
  }

  // Path is outside project — return as-is
  return filePath;
}

// ─── Pattern Extraction ──────────────────────────────────────────────────────

/**
 * Extract the relevant file path or command from a tool's input,
 * based on the tool name. This is the string that gets matched
 * against permission rule patterns.
 */
export function extractPattern(
  toolName: string,
  toolInput: Record<string, unknown>,
): string {
  switch (toolName) {
    // File-based tools
    case 'Read':
    case 'Edit':
    case 'Write':
      return (toolInput.file_path as string) ?? '*';

    // Search tools
    case 'Glob':
      return (toolInput.pattern as string) ?? '*';

    case 'Grep':
      return (toolInput.path as string) ?? '*';

    // Command execution
    case 'Bash':
      return (toolInput.command as string) ?? '*';

    // Web tools
    case 'WebFetch':
    case 'WebSearch':
      return (toolInput.url as string) ?? (toolInput.query as string) ?? '*';

    // Notebook
    case 'NotebookEdit':
      return (toolInput.file_path as string) ?? '*';

    default:
      // MCP tools — try common field names
      if (toolInput.file_path) return toolInput.file_path as string;
      if (toolInput.path) return toolInput.path as string;
      if (toolInput.command) return toolInput.command as string;
      return '*';
  }
}

// ─── Rule Evaluation ─────────────────────────────────────────────────────────

/**
 * Evaluate a permission action for a given tool + pattern against a list of rules.
 *
 * Uses last-wins semantics: iterate all rules in order, and the last matching
 * rule determines the action. If no rules match, defaults to 'ask'.
 */
export function evaluate(
  toolName: string,
  pattern: string,
  rules: PermissionRule[],
): PermissionAction {
  let result: PermissionAction = 'ask';

  for (const rule of rules) {
    const toolMatches = matchGlob(toolName, rule.tool);
    const patternMatches = matchGlob(pattern, rule.pattern);

    if (toolMatches && patternMatches) {
      result = rule.action;
    }
  }

  return result;
}

// ─── Built-in Templates ─────────────────────────────────────────────────────

export const PERMISSION_TEMPLATES: PermissionTemplate[] = [
  // ── Frontend Dev ──────────────────────────────────────────────────────
  {
    id: 'frontend-dev',
    name: 'Frontend Dev',
    description:
      'Read anywhere, write in src/ and public/, deny secrets, ask for config changes.',
    rules: [
      // Allow read/search everywhere
      { tool: 'Read', pattern: '*', action: 'allow' },
      { tool: 'Glob', pattern: '*', action: 'allow' },
      { tool: 'Grep', pattern: '*', action: 'allow' },

      // Allow edits in src/** and public/**
      { tool: 'Edit', pattern: 'src/**', action: 'allow' },
      { tool: 'Write', pattern: 'src/**', action: 'allow' },
      { tool: 'Edit', pattern: 'public/**', action: 'allow' },
      { tool: 'Write', pattern: 'public/**', action: 'allow' },

      // Deny secrets
      { tool: 'Edit', pattern: '*.env*', action: 'deny' },
      { tool: 'Write', pattern: '*.env*', action: 'deny' },
      { tool: 'Edit', pattern: '*.secret*', action: 'deny' },
      { tool: 'Write', pattern: '*.secret*', action: 'deny' },

      // Ask for config
      { tool: 'Edit', pattern: 'config/**', action: 'ask' },
      { tool: 'Write', pattern: 'config/**', action: 'ask' },

      // Allow common frontend bash commands
      { tool: 'Bash', pattern: 'npm *', action: 'allow' },
      { tool: 'Bash', pattern: 'npx *', action: 'allow' },
      { tool: 'Bash', pattern: 'yarn *', action: 'allow' },
      { tool: 'Bash', pattern: 'pnpm *', action: 'allow' },
      { tool: 'Bash', pattern: 'bun *', action: 'allow' },
      { tool: 'Bash', pattern: 'git *', action: 'allow' },

      // Ask for rm and other bash
      { tool: 'Bash', pattern: 'rm *', action: 'ask' },
      { tool: 'Bash', pattern: '*', action: 'ask' },
    ],
  },

  // ── Full Stack ────────────────────────────────────────────────────────
  {
    id: 'full-stack',
    name: 'Full Stack',
    description:
      'Read and write everywhere, deny secrets and credentials, allow common dev tools.',
    rules: [
      // Allow read/search everywhere
      { tool: 'Read', pattern: '*', action: 'allow' },
      { tool: 'Glob', pattern: '*', action: 'allow' },
      { tool: 'Grep', pattern: '*', action: 'allow' },

      // Allow edits everywhere
      { tool: 'Edit', pattern: '*', action: 'allow' },
      { tool: 'Write', pattern: '*', action: 'allow' },

      // Deny secrets (last-wins, so these override the above)
      { tool: 'Edit', pattern: '*.env*', action: 'deny' },
      { tool: 'Write', pattern: '*.env*', action: 'deny' },
      { tool: 'Edit', pattern: '**/*.secret*', action: 'deny' },
      { tool: 'Write', pattern: '**/*.secret*', action: 'deny' },
      { tool: 'Edit', pattern: '**/credentials*', action: 'deny' },
      { tool: 'Write', pattern: '**/credentials*', action: 'deny' },

      // Allow common dev bash commands
      { tool: 'Bash', pattern: 'npm *', action: 'allow' },
      { tool: 'Bash', pattern: 'npx *', action: 'allow' },
      { tool: 'Bash', pattern: 'git *', action: 'allow' },
      { tool: 'Bash', pattern: 'docker *', action: 'allow' },
      { tool: 'Bash', pattern: 'make *', action: 'allow' },
      { tool: 'Bash', pattern: 'cargo *', action: 'allow' },
      { tool: 'Bash', pattern: 'go *', action: 'allow' },
      { tool: 'Bash', pattern: 'python *', action: 'allow' },

      // Ask for rm -rf and other bash
      { tool: 'Bash', pattern: 'rm -rf *', action: 'ask' },
      { tool: 'Bash', pattern: '*', action: 'ask' },
    ],
  },

  // ── DevOps ────────────────────────────────────────────────────────────
  {
    id: 'devops',
    name: 'DevOps',
    description:
      'Read everywhere, edit infra/CI files only, allow all bash except dangerous rm.',
    rules: [
      // Allow read/search everywhere
      { tool: 'Read', pattern: '*', action: 'allow' },
      { tool: 'Glob', pattern: '*', action: 'allow' },
      { tool: 'Grep', pattern: '*', action: 'allow' },

      // Deny editing source code
      { tool: 'Edit', pattern: 'src/**', action: 'deny' },
      { tool: 'Write', pattern: 'src/**', action: 'deny' },

      // Allow editing infra/CI files
      { tool: 'Edit', pattern: 'Dockerfile*', action: 'allow' },
      { tool: 'Write', pattern: 'Dockerfile*', action: 'allow' },
      { tool: 'Edit', pattern: 'docker-compose*', action: 'allow' },
      { tool: 'Write', pattern: 'docker-compose*', action: 'allow' },
      { tool: 'Edit', pattern: '.github/**', action: 'allow' },
      { tool: 'Write', pattern: '.github/**', action: 'allow' },
      { tool: 'Edit', pattern: '**/infra/**', action: 'allow' },
      { tool: 'Write', pattern: '**/infra/**', action: 'allow' },
      { tool: 'Edit', pattern: '*.yml', action: 'allow' },
      { tool: 'Write', pattern: '*.yml', action: 'allow' },
      { tool: 'Edit', pattern: '*.yaml', action: 'allow' },
      { tool: 'Write', pattern: '*.yaml', action: 'allow' },
      { tool: 'Edit', pattern: '*.toml', action: 'allow' },
      { tool: 'Write', pattern: '*.toml', action: 'allow' },

      // Allow all bash
      { tool: 'Bash', pattern: '*', action: 'allow' },

      // Deny dangerous rm (last-wins overrides above)
      { tool: 'Bash', pattern: 'rm -rf /*', action: 'deny' },
    ],
  },

  // ── Read Only ─────────────────────────────────────────────────────────
  {
    id: 'read-only',
    name: 'Read Only',
    description:
      'Allow reading and searching only. Deny all edits and commands. Ask for web.',
    rules: [
      // Allow read/search
      { tool: 'Read', pattern: '*', action: 'allow' },
      { tool: 'Glob', pattern: '*', action: 'allow' },
      { tool: 'Grep', pattern: '*', action: 'allow' },

      // Deny all writes and commands
      { tool: 'Edit', pattern: '*', action: 'deny' },
      { tool: 'Write', pattern: '*', action: 'deny' },
      { tool: 'Bash', pattern: '*', action: 'deny' },

      // Ask for web
      { tool: 'WebFetch', pattern: '*', action: 'ask' },
      { tool: 'WebSearch', pattern: '*', action: 'ask' },
    ],
  },

  // ── YOLO ──────────────────────────────────────────────────────────────
  {
    id: 'yolo',
    name: 'YOLO',
    description: 'Allow everything. No restrictions at all.',
    rules: [{ tool: '*', pattern: '*', action: 'allow' }],
  },
];
