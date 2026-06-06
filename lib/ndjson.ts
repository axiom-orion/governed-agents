// lib/ndjson.ts
// Incremental NDJSON parser for the TraceEvent wire format, plus a runtime
// validator. The UI must render ONLY from well-formed TraceEvents, so every
// line is validated against the C2 schema before it is accepted. A line that
// is invalid JSON — or valid JSON that is not a TraceEvent — is reported as
// malformed and skipped; the parser keeps going.
//
// Pure and React-free so it can be unit-checked under Node (see
// scripts/check-model.ts).

import type { TraceEvent } from "./trace-events";
import type {
  AgentRole,
  Provenance,
  PolicyViolation,
  PolicyDecision,
  ProposedAction,
} from "./governance";

// --- primitive guards ------------------------------------------------------
function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
function isString(x: unknown): x is string {
  return typeof x === "string";
}
function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

// --- contract guards (C1 types referenced by C2 events) --------------------
const AGENT_ROLES: readonly AgentRole[] = ["researcher", "reasoner", "executor"];
function isAgentRole(x: unknown): x is AgentRole {
  return isString(x) && (AGENT_ROLES as readonly string[]).includes(x);
}

function isProvenance(x: unknown): x is Provenance {
  return (
    isRecord(x) &&
    isString(x.sourceId) &&
    isString(x.snippet) &&
    isFiniteNumber(x.score)
  );
}
function isProvenanceArray(x: unknown): x is Provenance[] {
  return Array.isArray(x) && x.every(isProvenance);
}

function isPolicyViolation(x: unknown): x is PolicyViolation {
  return isRecord(x) && isString(x.rule) && isString(x.detail);
}

function isPolicyDecision(x: unknown): x is PolicyDecision {
  return (
    isRecord(x) &&
    (x.decision === "allow" || x.decision === "block" || x.decision === "needs_approval") &&
    Array.isArray(x.violations) &&
    x.violations.every(isPolicyViolation) &&
    isString(x.evaluatedAt)
  );
}

function isProposedAction(x: unknown): x is ProposedAction {
  return (
    isRecord(x) &&
    isString(x.kind) &&
    isRecord(x.payload) &&
    isString(x.justification) &&
    isProvenanceArray(x.provenance)
  );
}

// --- the TraceEvent guard (exhaustive over the C2 discriminated union) -----
export function isTraceEvent(x: unknown): x is TraceEvent {
  if (!isRecord(x) || !isString(x.type)) return false;
  switch (x.type) {
    case "run_started":
      return isString(x.runId) && isString(x.task) && isString(x.at);
    case "step_started":
      return isString(x.stepId) && isAgentRole(x.role) && isString(x.at);
    case "step_completed":
      return (
        isString(x.stepId) &&
        isAgentRole(x.role) &&
        isString(x.summary) &&
        isProvenanceArray(x.provenance) &&
        isString(x.at)
      );
    case "action_proposed":
      return isString(x.stepId) && isProposedAction(x.action) && isString(x.at);
    case "gate_decision":
      return isString(x.stepId) && isPolicyDecision(x.decision) && isString(x.at);
    case "executed":
      return isString(x.stepId) && isString(x.result) && isString(x.at);
    case "halted":
      return isString(x.stepId) && isString(x.reason) && isString(x.at);
    case "awaiting_approval":
      return isString(x.stepId) && isString(x.reason) && isString(x.at);
    case "run_completed":
      return isString(x.runId) && isString(x.at);
    case "error":
      return isString(x.message) && isString(x.at);
    default:
      return false;
  }
}

// --- incremental parser ----------------------------------------------------
export interface NdjsonChunkResult {
  /** Valid TraceEvents decoded from the complete lines in this push. */
  readonly events: TraceEvent[];
  /** Raw lines that were skipped because they were not valid TraceEvents. */
  readonly malformed: string[];
}

/**
 * Stateful, incremental NDJSON reader. Feed it arbitrary chunks (which may
 * split mid-line); it buffers the partial tail and only emits events for
 * complete, newline-terminated lines. Call `flush()` once the stream ends to
 * process any unterminated final line.
 */
export class NdjsonTraceParser {
  #buffer = "";

  push(chunk: string): NdjsonChunkResult {
    this.#buffer += chunk;
    const out: NdjsonChunkResult = { events: [], malformed: [] };
    let newlineIndex = this.#buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.#buffer.slice(0, newlineIndex);
      this.#buffer = this.#buffer.slice(newlineIndex + 1);
      this.#consume(line, out);
      newlineIndex = this.#buffer.indexOf("\n");
    }
    return out;
  }

  flush(): NdjsonChunkResult {
    const out: NdjsonChunkResult = { events: [], malformed: [] };
    const rest = this.#buffer;
    this.#buffer = "";
    this.#consume(rest, out);
    return out;
  }

  #consume(rawLine: string, out: NdjsonChunkResult): void {
    const line = rawLine.trim(); // tolerate CRLF and incidental whitespace
    if (line.length === 0) return; // blank lines are not errors
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      out.malformed.push(rawLine);
      return;
    }
    if (isTraceEvent(parsed)) {
      out.events.push(parsed);
    } else {
      out.malformed.push(rawLine);
    }
  }
}
