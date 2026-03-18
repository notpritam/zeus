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
