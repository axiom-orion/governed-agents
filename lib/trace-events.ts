// lib/trace-events.ts
// C2 · Trace-event schema — the wire format between the agent loop (emitter)
// and the trace UI (consumer). Frozen in P0; do not redefine downstream.
// Transport: newline-delimited JSON over a streaming Route Handler — one
// TraceEvent per line; the UI parses incrementally.

import type { Provenance, ProposedAction, PolicyDecision, AgentRole } from "./governance";

export type TraceEvent =
  | { type: "run_started"; runId: string; task: string; at: string }
  | { type: "step_started"; stepId: string; role: AgentRole; at: string }
  | { type: "step_completed"; stepId: string; role: AgentRole; summary: string; provenance: Provenance[]; at: string }
  | { type: "action_proposed"; stepId: string; action: ProposedAction; at: string }
  | { type: "gate_decision"; stepId: string; decision: PolicyDecision; at: string }
  | { type: "executed"; stepId: string; result: string; at: string }
  | { type: "halted"; stepId: string; reason: string; at: string }
  | { type: "run_completed"; runId: string; at: string }
  | { type: "error"; message: string; at: string };
