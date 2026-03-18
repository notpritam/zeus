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
