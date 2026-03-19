import type { PermissionMode, SubagentType, SubagentCli } from '../../shared/types';
import { app } from 'electron';
import path from 'node:path';

// ─── Registry Types ───

export interface SubagentInputField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'file';
  required: boolean;
  placeholder?: string;
  defaultValue?: string | (() => string);
}

export interface SubagentMcpConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface SubagentContext {
  workingDir: string;
  parentSessionId: string;
  parentSessionType: 'terminal' | 'claude';
  targetUrl?: string;
  fileContent?: string;
  resolvedFlow?: unknown; // ResolvedFlow from flow-runner (QA-specific)
}

export interface SubagentTypeDefinition {
  type: SubagentType;
  name: string;
  icon: string;
  description: string;
  inputFields: SubagentInputField[];
  buildPrompt: (inputs: Record<string, string>, context: SubagentContext) => string;
  permissionMode: PermissionMode;
  mcpServers: SubagentMcpConfig[];
  cli: SubagentCli;
}

// ─── Registry API ───

const registry = new Map<SubagentType, SubagentTypeDefinition>();

export function registerSubagentType(def: SubagentTypeDefinition): void {
  registry.set(def.type, def);
}

export function getSubagentType(type: SubagentType): SubagentTypeDefinition | undefined {
  return registry.get(type);
}

export function listSubagentTypes(): SubagentTypeDefinition[] {
  return Array.from(registry.values());
}

// ─── QA Agent System Prompt (moved from websocket.ts) ───

function buildQAAgentSystemPrompt(targetUrl: string | undefined): string {
  const urlLine = targetUrl
    ? `You are a QA agent for a web application running at ${targetUrl}.`
    : `You are a QA agent. No target URL was auto-detected — use qa_navigate to the correct URL once you determine it from the project config or ask the task description.`;
  return `${urlLine}

You have full access to:
- Navigation & page info: qa_navigate, qa_text, qa_pdf, qa_health
- Element interaction: qa_click, qa_click_selector, qa_hover, qa_focus, qa_select_text, qa_type, qa_fill, qa_press, qa_scroll
- DOM inspection: qa_snapshot (supports CSS selector scoping and compact format), qa_screenshot (supports full_page)
- JavaScript execution: qa_evaluate (run JS in page context — read app state, dispatch events, assert DOM)
- Tab management: qa_list_tabs, qa_lock_tab, qa_unlock_tab
- Browser state: qa_cookies (get/set), qa_storage (localStorage/sessionStorage)
- Observability: qa_console_logs (filter by level), qa_network_requests (filter by URL pattern, failed_only), qa_js_errors
- Smart waiting: qa_wait_for_element (poll until selector matches), qa_wait_for_network_idle
- Assertions: qa_assert_element (assert exists/not-exists with optional text match)
- Batch: qa_batch_actions (run multiple actions in one call — much faster)
- Compound: qa_run_test_flow (navigate + wait + snapshot + screenshot + errors in one call)
- Instance info: qa_list_instances, qa_list_profiles
- Completion: qa_finish (REQUIRED — call when done to send results to parent agent)
- File editing: Read, Edit, Write tools
- Shell commands: Bash tool

Tips for speed:
- Use qa_batch_actions to chain clicks/types/presses instead of calling each tool individually.
- Use qa_snapshot with a CSS selector param to scope to a section — avoids huge accessibility trees.
- Use qa_click_selector for table rows, cards, and other non-focusable clickable elements.
- Use qa_wait_for_element instead of fixed delays — it polls and returns as soon as the element appears.
- Use qa_assert_element for pass/fail checks — it auto-retries with timeout.
- For React controlled inputs, use qa_click on the field then qa_type (not qa_fill which may miss onChange).
- Use qa_evaluate to read Redux/Zustand store state or dispatch synthetic events.

Your workflow:
1. Navigate to the target URL
2. Test the requested functionality using the fastest tools available
3. Use qa_assert_element and qa_wait_for_element to verify state changes
4. Check qa_console_logs, qa_network_requests, and qa_js_errors
5. If you find bugs: fix the code, then re-test to confirm the fix
6. Call qa_finish with your complete findings — this is MANDATORY

CRITICAL: You MUST call qa_finish when you are done. This sends your results back to the parent agent.
Without it, the parent agent will timeout waiting for your response. Always call qa_finish as your LAST action.

Always use qa_run_test_flow after making code changes to verify the fix.
Be concise — the user sees a compact action log, not a full chat.
Never use AskUserQuestion — make your best judgment and proceed.`;
}

// ─── Type Registrations ───

registerSubagentType({
  type: 'qa',
  name: 'QA Tester',
  icon: 'Eye',
  description: 'Browser-based QA testing with PinchTab automation',
  inputFields: [
    { key: 'task', label: 'Task', type: 'textarea', required: true, placeholder: 'What to test...' },
    { key: 'targetUrl', label: 'Target URL', type: 'text', required: false, placeholder: 'Auto-detected from dev server' },
  ],
  buildPrompt: (inputs, context) => {
    const targetUrl = inputs.targetUrl || context.targetUrl || 'http://localhost:5173';
    return `${buildQAAgentSystemPrompt(targetUrl)}\n\n---\n\nTask: ${inputs.task}`;
  },
  permissionMode: 'bypassPermissions',
  mcpServers: [{
    name: 'zeus-qa',
    command: 'node',
    args: [path.resolve(app.getAppPath(), 'out/main/mcp-qa-server.mjs')],
  }],
  cli: 'claude',
});

registerSubagentType({
  type: 'plan_reviewer',
  name: 'Plan Reviewer',
  icon: 'FileSearch',
  description: 'Review implementation plans for completeness and feasibility',
  inputFields: [
    { key: 'task', label: 'Review Instructions', type: 'textarea', required: true, placeholder: 'Review this plan for...' },
    { key: 'filePath', label: 'Plan File', type: 'file', required: true, placeholder: 'docs/superpowers/plans/...' },
  ],
  buildPrompt: (inputs, context) => {
    const fileContent = context.fileContent ?? '';
    return [
      'You are a Plan Reviewer agent. Your job is to review implementation plans for completeness, feasibility, and correctness.',
      '',
      'Review the following implementation plan and provide:',
      '1. **Completeness** — Are all necessary steps included? Any gaps?',
      '2. **Ordering** — Are steps in the right order? Are dependencies respected?',
      '3. **Feasibility** — Are any steps technically infeasible or overly complex?',
      '4. **Risks** — What could go wrong? Missing error handling? Edge cases?',
      '5. **Improvements** — Concrete suggestions to strengthen the plan.',
      '',
      '---',
      '',
      `Plan file: ${inputs.filePath}`,
      '',
      fileContent,
      '',
      '---',
      '',
      `Additional instructions: ${inputs.task}`,
    ].join('\n');
  },
  permissionMode: 'plan',
  mcpServers: [],
  cli: 'claude',
});
