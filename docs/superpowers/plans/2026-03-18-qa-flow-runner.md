# QA Flow Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a structured flow system to Zeus QA agents so that predefined test flows (with intents, selector hints, and deterministic assertions) can be selected from the UI or triggered by text, replacing the current free-form-only approach while keeping free-form as a fallback.

**Architecture:** A `FlowRunner` service on the backend loads YAML flow definitions from `qa-flows/`, resolves user tasks to flows via exact ID or fuzzy match, builds structured per-persona agent prompts, and spawns parallel Claude sessions. The frontend adds a flow picker to the existing new-agent form. The existing free-form path is untouched — FlowRunner only activates when a flow matches.

**Tech Stack:** TypeScript, YAML (`js-yaml`), existing ClaudeSession/websocket/store infrastructure.

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/shared/qa-flow-types.ts` | TypeScript types for flow definitions, personas, steps, assertions, and resolved flows |
| `src/main/services/flow-runner.ts` | FlowRunner class: load YAML flows, resolve tasks to flows, build per-persona agent prompts |
| `qa-flows/example-flow.yaml` | Sample flow definition demonstrating the schema |

### Modified Files

| File | What Changes |
|------|-------------|
| `src/shared/types.ts` | Add `flowId?` and `personas?` to `start_qa_agent` payload; add `list_qa_flows` / `qa_flows_list` payload types |
| `src/main/services/websocket.ts` | Import FlowRunner, add `list_qa_flows` handler, modify `start_qa_agent` to resolve flows and spawn per-persona agents |
| `src/renderer/src/stores/useZeusStore.ts` | Add `qaFlows` state, `fetchQaFlows` action, handle `qa_flows_list` message, update `startQAAgent` to accept `flowId`/`personas` |
| `src/renderer/src/components/QAPanel.tsx` | Add flow picker dropdown + persona checkboxes to the new-agent form |
| `package.json` | Add `js-yaml` dependency + `@types/js-yaml` dev dependency |

---

## Task 1: Install `js-yaml` Dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install js-yaml and its types**

```bash
cd /Users/notpritamm/Documents/Projects/zeus
npm install js-yaml
npm install -D @types/js-yaml
```

- [ ] **Step 2: Verify installation**

```bash
node -e "require('js-yaml')"
```

Expected: No error output.

---

## Task 2: Define Flow Types

**Files:**
- Create: `src/shared/qa-flow-types.ts`

- [ ] **Step 1: Create the type definitions file**

```typescript
// src/shared/qa-flow-types.ts
// Canonical types for QA flow definitions loaded from YAML files.

/** A single hint selector the agent should try first before falling back to DOM inspection. */
export interface FlowStepHints {
  selectors?: string[];
  loginUrl?: string;
  repoUrl?: string;
  [key: string]: unknown;
}

/** A high-level intent step — the WHAT, not the HOW. */
export interface FlowStep {
  intent: string;
  hints?: FlowStepHints;
}

/** A single assertion the agent must verify after executing steps. */
export interface FlowAssertion {
  description: string;
  check: 'element_visible' | 'element_not_visible' | 'text_present' | 'text_absent' | 'network_response' | 'url_matches' | 'console_no_errors';
  hints?: string[];
  textContains?: string;
  method?: string;
  urlPattern?: string;
  status?: number | number[];
  pattern?: string;
}

/** A persona variant — credentials ref + specific assertions. */
export interface FlowPersona {
  id: string;
  credentialRef: string;
  assertions: FlowAssertion[];
}

/** Full flow definition as parsed from YAML. */
export interface FlowDefinition {
  id: string;
  name: string;
  description: string;
  targetPath?: string;
  tags: string[];
  personas: FlowPersona[];
  steps: FlowStep[];
}

/** Lightweight metadata sent to the frontend for the flow picker (no full step/assertion details). */
export interface FlowSummary {
  id: string;
  name: string;
  description: string;
  tags: string[];
  personaIds: string[];
  stepCount: number;
}

/** Result of FlowRunner.resolve() — a flow with optionally filtered personas. */
export interface ResolvedFlow {
  flow: FlowDefinition;
  personas: FlowPersona[];
}
```

- [ ] **Step 2: Verify types compile**

```bash
cd /Users/notpritamm/Documents/Projects/zeus && npx tsc --noEmit src/shared/qa-flow-types.ts
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/shared/qa-flow-types.ts
git commit -m "feat(qa): add flow definition types for structured QA testing"
```

---

## Task 3: Create Sample Flow YAML

**Files:**
- Create: `qa-flows/example-flow.yaml`

- [ ] **Step 1: Create the qa-flows directory and sample flow**

```yaml
# qa-flows/example-flow.yaml
# Example flow definition — demonstrates the schema.
# Copy and modify this to create flows for your app.

id: example_login_flow
name: Login Flow
description: Verify login behavior across user types
targetPath: /login
tags:
  - auth
  - core

personas:
  - id: valid_user
    credentialRef: QA_VALID_USER
    assertions:
      - description: Should redirect to dashboard after login
        check: url_matches
        pattern: "/dashboard"
      - description: No JS errors during login
        check: console_no_errors

  - id: invalid_user
    credentialRef: QA_INVALID_USER
    assertions:
      - description: Error message should appear
        check: text_present
        textContains: "Invalid credentials"
      - description: Should stay on login page
        check: url_matches
        pattern: "/login"

steps:
  - intent: Navigate to the login page
    hints:
      loginUrl: /login

  - intent: Fill in the credentials for this persona
    hints:
      selectors:
        - "[data-testid='email-input']"
        - "input[type='email']"

  - intent: Submit the login form
    hints:
      selectors:
        - "[data-testid='login-btn']"
        - "button[type='submit']"

  - intent: Wait for navigation and verify the outcome
```

- [ ] **Step 2: Validate YAML is parseable**

```bash
node -e "const yaml = require('js-yaml'); const fs = require('fs'); console.log(JSON.stringify(yaml.load(fs.readFileSync('qa-flows/example-flow.yaml', 'utf8')), null, 2))"
```

Expected: Valid JSON printed to stdout with all fields present.

- [ ] **Step 3: Commit**

```bash
git add qa-flows/example-flow.yaml
git commit -m "feat(qa): add example flow YAML definition"
```

---

## Task 4: Build FlowRunner Service

**Files:**
- Create: `src/main/services/flow-runner.ts`

- [ ] **Step 1: Create FlowRunner with YAML loading and resolve logic**

```typescript
// src/main/services/flow-runner.ts
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { FlowDefinition, FlowSummary, FlowPersona, ResolvedFlow } from '../../shared/qa-flow-types';

export class FlowRunner {
  private flows: Map<string, FlowDefinition> = new Map();
  private flowsDir: string;

  constructor(flowsDir: string) {
    this.flowsDir = flowsDir;
    this.loadFlows();
  }

  /** Load all .yaml/.yml files from the flows directory. */
  loadFlows(): void {
    this.flows.clear();
    if (!fs.existsSync(this.flowsDir)) return;

    const files = fs.readdirSync(this.flowsDir).filter(
      (f) => f.endsWith('.yaml') || f.endsWith('.yml'),
    );

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(this.flowsDir, file), 'utf8');
        const parsed = yaml.load(content) as FlowDefinition;
        if (parsed?.id) {
          this.flows.set(parsed.id, parsed);
        }
      } catch (err) {
        console.warn(`[FlowRunner] Failed to load ${file}:`, (err as Error).message);
      }
    }
    console.log(`[FlowRunner] Loaded ${this.flows.size} flow(s) from ${this.flowsDir}`);
  }

  /** Return lightweight summaries for the frontend flow picker. */
  listFlows(): FlowSummary[] {
    return Array.from(this.flows.values()).map((f) => ({
      id: f.id,
      name: f.name,
      description: f.description,
      tags: f.tags ?? [],
      personaIds: f.personas.map((p) => p.id),
      stepCount: f.steps.length,
    }));
  }

  /** Resolve a user task to a flow definition + filtered personas. */
  resolve(
    task: string,
    options?: { flowId?: string; personas?: string[] },
  ): ResolvedFlow | null {
    let flow: FlowDefinition | undefined;

    // Priority 1: Explicit flowId from UI picker
    if (options?.flowId) {
      flow = this.flows.get(options.flowId);
      if (!flow) return null;
      return this.applyPersonaFilter(flow, options.personas);
    }

    // Priority 2: "flow:<id>" prefix in task text
    const prefixMatch = task.match(/^flow:(\S+)/);
    if (prefixMatch) {
      flow = this.flows.get(prefixMatch[1]);
      if (!flow) return null;
      return this.applyPersonaFilter(flow, options?.personas);
    }

    // Priority 3: Fuzzy match against flow names, IDs, and tags
    const match = this.fuzzyMatch(task);
    if (match) {
      return this.applyPersonaFilter(match, options?.personas);
    }

    return null;
  }

  /** Build a structured prompt for a specific persona execution. */
  buildAgentPrompt(
    flow: FlowDefinition,
    persona: FlowPersona,
    targetUrl: string,
  ): string {
    const stepsText = flow.steps
      .map((s, i) => {
        let line = `${i + 1}. ${s.intent}`;
        if (s.hints?.selectors) {
          line += `\n   Try these selectors first: ${s.hints.selectors.join(', ')}`;
        }
        if (s.hints?.loginUrl) {
          line += `\n   Login page: ${targetUrl}${s.hints.loginUrl}`;
        }
        return line;
      })
      .join('\n');

    const assertionsText = persona.assertions
      .map((a) => {
        let line = `- ${a.description}`;
        line += `\n  Check: ${a.check}`;
        if (a.hints?.length) line += `\n  Hint selectors: ${a.hints.join(', ')}`;
        if (a.textContains) line += `\n  Text contains: "${a.textContains}"`;
        if (a.method) line += `\n  HTTP method: ${a.method}`;
        if (a.urlPattern) line += `\n  URL pattern: ${a.urlPattern}`;
        if (a.status) line += `\n  Expected status: ${Array.isArray(a.status) ? a.status.join(' or ') : a.status}`;
        if (a.pattern) line += `\n  URL pattern: ${a.pattern}`;
        return line;
      })
      .join('\n');

    return `## QA Test: ${flow.name}
**Persona:** ${persona.id}
**Credential:** ${persona.credentialRef}
**Target:** ${targetUrl}${flow.targetPath ?? ''}

### Steps (execute in order):
${stepsText}

### Assertions — ALL must pass:
${assertionsText}

### Rules:
- Use hint selectors first. If not found, use qa_snapshot to inspect the DOM and adapt.
- Report any selector drift as a warning (old selector → new selector you found).
- For each assertion, report PASS or FAIL with evidence (screenshot or value found).
- Take a screenshot before and after the main action.
- Do NOT invent additional tests beyond what is listed above.
- If a step fails and cannot be recovered, report FAIL and stop.`;
  }

  // ── Private ──

  private applyPersonaFilter(
    flow: FlowDefinition,
    personaIds?: string[],
  ): ResolvedFlow {
    const personas =
      personaIds && personaIds.length > 0
        ? flow.personas.filter((p) => personaIds.includes(p.id))
        : flow.personas;
    return { flow, personas };
  }

  private fuzzyMatch(task: string): FlowDefinition | null {
    const lower = task.toLowerCase();
    let bestMatch: FlowDefinition | null = null;
    let bestScore = 0;

    for (const flow of this.flows.values()) {
      let score = 0;

      // Check flow name words
      const nameWords = flow.name.toLowerCase().split(/\s+/);
      for (const word of nameWords) {
        if (lower.includes(word) && word.length > 2) score += 3;
      }

      // Check flow ID (underscore-separated)
      const idWords = flow.id.toLowerCase().split('_');
      for (const word of idWords) {
        if (lower.includes(word) && word.length > 2) score += 2;
      }

      // Check tags
      for (const tag of flow.tags ?? []) {
        if (lower.includes(tag.toLowerCase())) score += 1;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = flow;
      }
    }

    // Require a minimum score to avoid false matches
    return bestScore >= 4 ? bestMatch : null;
  }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /Users/notpritamm/Documents/Projects/zeus && npx tsc --noEmit src/main/services/flow-runner.ts
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/services/flow-runner.ts
git commit -m "feat(qa): add FlowRunner service — loads YAML flows, resolves tasks, builds agent prompts"
```

---

## Task 5: Update Shared Types for Flow Payloads

**Files:**
- Modify: `src/shared/types.ts:572-587` (QaPayload union)

- [ ] **Step 1: Add `flowId` and `personas` to `start_qa_agent` payload**

In `src/shared/types.ts`, find the existing `start_qa_agent` payload type (line 573):

```typescript
// BEFORE
| { type: 'start_qa_agent'; task: string; name?: string; workingDir: string; targetUrl?: string; parentSessionId: string; parentSessionType: 'terminal' | 'claude' }
```

Replace with:

```typescript
// AFTER
| { type: 'start_qa_agent'; task: string; name?: string; workingDir: string; targetUrl?: string; parentSessionId: string; parentSessionType: 'terminal' | 'claude'; flowId?: string; personas?: string[] }
```

- [ ] **Step 2: Add `list_qa_flows` and `qa_flows_list` payloads**

In `src/shared/types.ts`, add these two lines within the `QaPayload` union. Add the client→server one after line 579 (`clear_qa_agent_entries`), and the server→client one after line 586 (`qa_agent_entries`):

```typescript
// Client → Server (add after clear_qa_agent_entries)
| { type: 'list_qa_flows' }

// Server → Client (add after qa_agent_entries)
| { type: 'qa_flows_list'; flows: import('./qa-flow-types').FlowSummary[] }
```

- [ ] **Step 3: Verify types compile**

```bash
cd /Users/notpritamm/Documents/Projects/zeus && npm run typecheck
```

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(qa): add flow-related payload types to QaPayload"
```

---

## Task 6: Integrate FlowRunner into WebSocket Handler

**Files:**
- Modify: `src/main/services/websocket.ts`

This is the core integration. Three changes:
1. Import and instantiate FlowRunner at module level
2. Add `list_qa_flows` handler
3. Modify `start_qa_agent` to resolve flows and spawn per-persona agents

- [ ] **Step 1: Add FlowRunner import and instantiation**

Near the top of `websocket.ts` (after other service imports), add:

```typescript
import { FlowRunner } from './flow-runner';
```

> **Note:** `path` is already imported at line 4 (`import path from 'path'`). Do NOT add a second `path` import.

Near the module-level variables (around line 115, near `let qaService`), add:

```typescript
// QA flow runner — loads structured flow definitions from qa-flows/
const flowRunner = new FlowRunner(path.join(app.getAppPath(), 'qa-flows'));
```

> **Note:** Use `app.getAppPath()` (from Electron, already imported at line 8) instead of `process.cwd()` — in packaged Electron apps, `process.cwd()` is not the project root.

- [ ] **Step 2: Add `list_qa_flows` handler**

In the `handleQA` function, add a new `else if` branch before the `start_qa_agent` handler (before line 2212):

```typescript
} else if (payload.type === 'list_qa_flows') {
  // Reload flows from disk in case they changed, then send summaries
  flowRunner.loadFlows();
  sendEnvelope(ws, {
    channel: 'qa', sessionId: '', auth: '',
    payload: { type: 'qa_flows_list', flows: flowRunner.listFlows() },
  });
```

- [ ] **Step 3: Modify `start_qa_agent` to support flow resolution**

In the `start_qa_agent` handler (around line 2212+), after the PinchTab setup (after the instance launch + CDP wiring block), and before the single-session spawn, add the flow resolution logic.

The change is: **after** the existing targetUrl resolution block (lines 2247-2267, which handles parent session lookup → env var → live detection), and **before** the existing `const qaAgentId = ...` (line 2268), insert the flow resolution. Do NOT replace the targetUrl resolution — it stays exactly as-is.

> **IMPORTANT:** Keep lines 2247-2267 (the targetUrl resolution block with `detectDevServerUrlDetailed`) completely intact. The flow resolution is inserted AFTER it.

Insert this block between line 2267 and line 2268 (between the targetUrl resolution and `const qaAgentId`):

```typescript
      // ── Flow Resolution ──
      const resolved = flowRunner.resolve(payload.task, {
        flowId: payload.flowId,
        personas: payload.personas,
      });

      if (resolved) {
        // ── Structured flow: spawn one agent per persona ──
        const personaPromises = resolved.personas.map(async (persona) => {
          const qaAgentId = `qa-agent-${++qaAgentIdCounter}-${Date.now()}-${persona.id}`;
          const parentSessionId = payload.parentSessionId;
          const parentSessionType = payload.parentSessionType;
          const agentName = payload.name
            ? `${payload.name} (${persona.id})`
            : `${resolved.flow.name} — ${persona.id}`;

          const session = new ClaudeSession({
            workingDir: payload.workingDir,
            permissionMode: 'bypassPermissions',
            enableQA: true,
            qaTargetUrl: targetUrl,
            zeusSessionId: payload.parentSessionId,
            qaAgentId,
          });

          const record: QaAgentRecord = {
            qaAgentId,
            parentSessionId,
            parentSessionType,
            name: agentName,
            task: `[Flow: ${resolved.flow.id}] ${persona.id}`,
            targetUrl,
            workingDir: payload.workingDir,
            session,
            startedAt: Date.now(),
            pendingResponseId: payload.responseId,
            pendingResponseWs: ws,
            collectedTextEntries: [],
          };

          qaAgentSessions.set(qaAgentId, record);
          console.log(`[QA Agent] Created flow record: qaAgentId=${qaAgentId}, flow=${resolved.flow.id}, persona=${persona.id}`);
          wireQAAgent(record);

          insertQaAgentSession({
            id: qaAgentId,
            parentSessionId,
            parentSessionType,
            name: agentName,
            task: record.task,
            targetUrl,
            status: 'running',
            startedAt: record.startedAt,
            endedAt: null,
            workingDir: payload.workingDir,
          });

          console.log('[QA Agent] Flow agent started successfully:', qaAgentId);
          broadcastEnvelope({
            channel: 'qa', sessionId: '', auth: '',
            payload: {
              type: 'qa_agent_started',
              qaAgentId,
              parentSessionId,
              parentSessionType,
              name: agentName,
              task: record.task,
              targetUrl,
            },
          });

          const initialMsgEntry: NormalizedEntry = {
            id: `qa-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            timestamp: new Date().toISOString(),
            entryType: { type: 'user_message' },
            content: record.task,
          };
          broadcastEnvelope({
            channel: 'qa', sessionId: '', auth: '',
            payload: { type: 'qa_agent_entry', qaAgentId, parentSessionId, entry: initialMsgEntry },
          });
          insertQaAgentEntry(qaAgentId, 'user_message', JSON.stringify(initialMsgEntry), Date.now());

          const flowPrompt = `${buildQAAgentSystemPrompt(targetUrl)}\n\n---\n\n${flowRunner.buildAgentPrompt(resolved.flow, persona, targetUrl)}`;
          await session.start(flowPrompt);
        });

        // Spawn all persona agents in parallel
        await Promise.all(personaPromises);
        return; // Skip the free-form path below
      }

      // ── Free-form fallback: no flow matched — existing code below runs unchanged ──
```

Then **leave the existing code from line 2268 onward completely untouched** (the `const qaAgentId = ...` through `await session.start(prompt)` block). The `return` in the flow branch prevents falling through to it. This means zero changes to the free-form path.

- [ ] **Step 4: Verify it compiles**

```bash
cd /Users/notpritamm/Documents/Projects/zeus && npm run typecheck
```

Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/websocket.ts
git commit -m "feat(qa): integrate FlowRunner into start_qa_agent — per-persona agent spawning"
```

---

## Task 7: Add Store Support for Flows

**Files:**
- Modify: `src/renderer/src/stores/useZeusStore.ts`

- [ ] **Step 1: Add `qaFlows` state**

In the store state interface / initial state area, add:

```typescript
qaFlows: FlowSummary[];
```

Initialize with `qaFlows: []`.

Import at top of file:

```typescript
import type { FlowSummary } from '../../../shared/qa-flow-types';
```

- [ ] **Step 2: Add `fetchQaFlows` action**

In the QA Agent actions section (around line 2417), add:

```typescript
fetchQaFlows: () => {
  zeusWs.send({
    channel: 'qa', sessionId: '', auth: '',
    payload: { type: 'list_qa_flows' },
  });
},
```

- [ ] **Step 3: Add `qa_flows_list` WebSocket handler**

In the QA channel handler (around line 1338, after the `qa_agent_entries` handler), add:

```typescript
if (payload.type === 'qa_flows_list') {
  set({ qaFlows: payload.flows });
}
```

- [ ] **Step 4: Update `startQAAgent` to accept `flowId` and `personas`**

Modify the existing `startQAAgent` action (line ~2354):

```typescript
// BEFORE
startQAAgent: (task: string, workingDir: string, parentSessionId: string, parentSessionType: 'terminal' | 'claude', targetUrl?: string, name?: string) => {

// AFTER
startQAAgent: (task: string, workingDir: string, parentSessionId: string, parentSessionType: 'terminal' | 'claude', targetUrl?: string, name?: string, flowId?: string, personas?: string[]) => {
```

And update the payload to include the new fields:

```typescript
payload: { type: 'start_qa_agent', task, name, workingDir, targetUrl, parentSessionId, parentSessionType, flowId, personas },
```

- [ ] **Step 5: Verify it compiles**

```bash
cd /Users/notpritamm/Documents/Projects/zeus && npm run typecheck
```

Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/stores/useZeusStore.ts
git commit -m "feat(qa): add qaFlows state, fetchQaFlows action, flow-aware startQAAgent"
```

---

## Task 8: Add Flow Picker UI to QAPanel

**Files:**
- Modify: `src/renderer/src/components/QAPanel.tsx:83-231` (state + handler area) and `src/renderer/src/components/QAPanel.tsx:912-960` (new agent form)

- [ ] **Step 1: Add flow-related state and imports**

At the top of `QAPanel.tsx`, add to imports:

```typescript
import type { FlowSummary } from '../../../shared/qa-flow-types';
```

Inside the `QAPanel` function, add store selectors (around line 107, near existing QA agent store selectors):

```typescript
const qaFlows = useZeusStore((s) => s.qaFlows);
const fetchQaFlows = useZeusStore((s) => s.fetchQaFlows);
```

Add local state (around line 135, near existing agent form state):

```typescript
const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
const [selectedPersonas, setSelectedPersonas] = useState<string[]>([]);
```

- [ ] **Step 2: Add useEffect to fetch flows when form opens**

After the existing useEffects (around line 219), add:

```typescript
// Fetch available flows when showing the new agent form
useEffect(() => {
  if (showNewAgentForm || !hasAnyAgent) {
    fetchQaFlows();
  }
}, [showNewAgentForm, hasAnyAgent]);
```

Also add a derived value for the selected flow:

```typescript
const selectedFlow = qaFlows.find((f) => f.id === selectedFlowId) ?? null;
```

- [ ] **Step 3: Add flow selection handler**

Add a handler for flow selection (near `handleStartAgent`, around line 221):

```typescript
const handleFlowSelect = (flowId: string | null) => {
  setSelectedFlowId(flowId);
  if (flowId) {
    const flow = qaFlows.find((f) => f.id === flowId);
    if (flow) {
      setSelectedPersonas([...flow.personaIds]);
      if (!agentTask.trim()) {
        setAgentTask(flow.name);
      }
    }
  } else {
    setSelectedPersonas([]);
  }
};

const handlePersonaToggle = (personaId: string) => {
  setSelectedPersonas((prev) =>
    prev.includes(personaId)
      ? prev.filter((p) => p !== personaId)
      : [...prev, personaId],
  );
};
```

- [ ] **Step 4: Update handleStartAgent guard and call**

First, update the early return guard (line 223) to allow flow-only mode:

```typescript
// BEFORE
if (!agentTask.trim() || !parentSessionId) {

// AFTER
if ((!agentTask.trim() && !selectedFlowId) || !parentSessionId) {
```

Then update the `startQAAgent` call (line ~227):

```typescript
// BEFORE
startQAAgent(agentTask.trim(), sessionCtx?.workingDir || '/', parentSessionId, parentSessionType, agentTargetUrl, agentName.trim() || undefined);

// AFTER
startQAAgent(
  agentTask.trim(),
  sessionCtx?.workingDir || '/',
  parentSessionId,
  parentSessionType,
  agentTargetUrl,
  agentName.trim() || undefined,
  selectedFlowId ?? undefined,
  selectedPersonas.length > 0 ? selectedPersonas : undefined,
);
```

Also reset flow state after starting:

```typescript
setAgentTask('');
setAgentName('');
setSelectedFlowId(null);
setSelectedPersonas([]);
setShowNewAgentForm(false);
```

- [ ] **Step 5: Add flow picker UI to the form**

In the new agent form section (around line 938, between the Target URL input and the task textarea), add the flow picker:

```tsx
{/* Flow picker */}
{qaFlows.length > 0 && (
  <div className="w-full space-y-1.5">
    <label className="text-muted-foreground text-[9px] uppercase tracking-wider">
      Test Flow (optional)
    </label>
    <select
      value={selectedFlowId ?? ''}
      onChange={(e) => handleFlowSelect(e.target.value || null)}
      className="bg-secondary text-foreground w-full rounded px-2 py-1 text-[10px] outline-none"
    >
      <option value="">None — free-form task</option>
      {qaFlows.map((flow) => (
        <option key={flow.id} value={flow.id}>
          {flow.name} [{flow.tags.join(', ')}] · {flow.stepCount} steps · {flow.personaIds.length} persona{flow.personaIds.length !== 1 ? 's' : ''}
        </option>
      ))}
    </select>

    {/* Persona checkboxes — shown when a flow is selected */}
    {selectedFlow && selectedFlow.personaIds.length > 1 && (
      <div className="space-y-1 pt-1">
        <label className="text-muted-foreground text-[9px] uppercase tracking-wider">
          Personas
        </label>
        {selectedFlow.personaIds.map((pid) => (
          <label key={pid} className="text-foreground flex items-center gap-1.5 text-[10px]">
            <input
              type="checkbox"
              checked={selectedPersonas.includes(pid)}
              onChange={() => handlePersonaToggle(pid)}
              className="accent-primary size-3"
            />
            {pid}
          </label>
        ))}
      </div>
    )}
  </div>
)}
```

This goes right after the `agentTargetUrl` input and before the `agentTask` textarea.

- [ ] **Step 6: Update the task textarea placeholder**

```tsx
// BEFORE
placeholder="e.g. Test the login flow with valid and invalid credentials..."

// AFTER
placeholder={selectedFlowId ? "Additional instructions (optional)..." : "e.g. Test the login flow with valid and invalid credentials..."}
```

- [ ] **Step 7: Update the textarea onKeyDown handler**

The Enter-to-submit should also work when a flow is selected with no task text:

```tsx
// BEFORE
if (e.key === 'Enter' && !e.shiftKey && agentTask.trim()) {

// AFTER
if (e.key === 'Enter' && !e.shiftKey && (agentTask.trim() || selectedFlowId)) {
```

- [ ] **Step 8: Update the start button disabled state**

The button should be clickable if a flow is selected even without task text:

```tsx
// BEFORE
disabled={!agentTask.trim()}

// AFTER
disabled={!agentTask.trim() && !selectedFlowId}
```

- [ ] **Step 9: Verify it compiles**

```bash
cd /Users/notpritamm/Documents/Projects/zeus && npm run typecheck
```

Expected: No type errors.

- [ ] **Step 10: Build and verify the app loads**

```bash
cd /Users/notpritamm/Documents/Projects/zeus && npm run build
```

Expected: Build succeeds.

- [ ] **Step 11: Commit**

```bash
git add src/renderer/src/components/QAPanel.tsx
git commit -m "feat(qa): add flow picker UI with persona checkboxes to QA agent form"
```

---

## Task 9: Manual Verification

- [ ] **Step 1: Start the dev server and verify the form**

```bash
cd /Users/notpritamm/Documents/Projects/zeus && npm run dev
```

Open the app → QA tab → Agent mode → click + (new agent). Verify:
- Flow picker dropdown appears below Target URL
- `example_login_flow` shows in the dropdown
- Selecting it shows persona checkboxes (valid_user, invalid_user)
- Deselecting shows "None — free-form task"
- Task textarea placeholder changes when flow is selected

- [ ] **Step 2: Test free-form fallback**

With "None" selected in the flow picker, type a free-form task and start agent. Verify it works exactly as before (no regression).

- [ ] **Step 3: Test flow-based agent**

Select the example flow, check one persona, click Start Agent. Verify:
- Agent spawns with name like "Login Flow — valid_user"
- Agent receives the structured prompt (visible in the log)
- Agent attempts to follow the steps and assertions

- [ ] **Step 4: Commit all remaining changes**

```bash
git add -A
git commit -m "feat(qa): complete QA flow runner system — structured flows with UI picker"
```

---

## Summary of Changes

```
New files:
  src/shared/qa-flow-types.ts        ← Type definitions for flows
  src/main/services/flow-runner.ts   ← FlowRunner service (load, resolve, build prompts)
  qa-flows/example-flow.yaml         ← Sample flow definition

Modified files:
  package.json                       ← js-yaml dependency
  src/shared/types.ts                ← flowId/personas on start_qa_agent, list_qa_flows payloads
  src/main/services/websocket.ts     ← FlowRunner integration, per-persona spawning
  src/renderer/src/stores/useZeusStore.ts  ← qaFlows state + actions
  src/renderer/src/components/QAPanel.tsx  ← Flow picker UI + persona checkboxes

Data flow:
  UI form → flowId + personas[] → WebSocket → FlowRunner.resolve() →
    match? → spawn N agents (one per persona) with structured prompts
    no match? → spawn 1 agent with free-form prompt (current behavior)
```
