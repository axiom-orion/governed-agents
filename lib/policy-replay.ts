// lib/policy-replay.ts
// Makes the recorded Sample runs honest about policy. A fixture bakes in its own
// gate_decision/halted/executed events; if we replayed those verbatim, editing a
// policy threshold would change nothing. Instead we keep every event up to the
// proposed action, then RE-RUN the real gate (evaluatePolicy) over that action with
// the edited config and regenerate the tail (gate → execute | halt → completed).
// The result is still a plain TraceEvent[] — the UI can't tell it from the wire,
// and lowering the threshold below a source's score flips BLOCK → ALLOW for real.

import { buildPolicy, evaluatePolicy, type PolicyConfig, type ProposedAction } from "./governance";
import type { TraceEvent } from "./trace-events";

function plusMs(iso: string, ms: number): string {
  const base = Date.parse(iso);
  if (Number.isNaN(base)) return iso;
  return new Date(base + ms).toISOString();
}

function synthesizeExecuted(action: ProposedAction): string {
  if (action.kind === "send_email") {
    const to = typeof action.payload.to === "string" ? action.payload.to : "the recipient";
    const subject = typeof action.payload.subject === "string" ? action.payload.subject : undefined;
    return subject ? `Sent email to ${to} — “${subject}”.` : `Sent email to ${to}.`;
  }
  return "Action executed.";
}

/**
 * Recompute a recorded run's gate decision under `config` and regenerate the tail.
 * If the run has no proposed action (nothing to gate), it is returned unchanged.
 */
export function replayWithPolicy(
  run: readonly TraceEvent[],
  config: PolicyConfig,
): TraceEvent[] {
  let runId: string | undefined;
  let action: ProposedAction | undefined;
  let actionStepId: string | undefined;
  let originalExecuted: string | undefined;
  let originalExecutorSummary: string | undefined;

  for (const event of run) {
    if (event.type === "run_started") runId = event.runId;
    else if (event.type === "action_proposed") {
      action = event.action;
      actionStepId = event.stepId;
    } else if (event.type === "executed") originalExecuted = event.result;
    else if (event.type === "step_completed" && event.role === "executor") {
      originalExecutorSummary = event.summary;
    }
  }

  if (action === undefined || actionStepId === undefined) return [...run];

  // Keep the head: everything up to and including the proposed action.
  const head: TraceEvent[] = [];
  for (const event of run) {
    head.push(event);
    if (event.type === "action_proposed" && event.stepId === actionStepId) break;
  }

  const baseAt = head[head.length - 1]?.at ?? new Date().toISOString();
  const decision = {
    ...evaluatePolicy(action, buildPolicy(config)),
    evaluatedAt: plusMs(baseAt, 60),
  };

  const tail: TraceEvent[] = [
    { type: "gate_decision", stepId: actionStepId, decision, at: plusMs(baseAt, 60) },
  ];

  if (decision.decision === "allow") {
    const execStep = `${actionStepId}:exec`;
    const result = originalExecuted ?? synthesizeExecuted(action);
    tail.push(
      { type: "step_started", stepId: execStep, role: "executor", at: plusMs(baseAt, 120) },
      { type: "executed", stepId: execStep, result, at: plusMs(baseAt, 320) },
      {
        type: "step_completed",
        stepId: execStep,
        role: "executor",
        summary: originalExecutorSummary ?? result,
        provenance: [...action.provenance],
        at: plusMs(baseAt, 380),
      },
    );
  } else {
    const reason =
      decision.violations.map((v) => `${v.rule}: ${v.detail}`).join("; ") || "blocked by policy";
    tail.push({ type: "halted", stepId: actionStepId, reason, at: plusMs(baseAt, 120) });
  }

  tail.push({ type: "run_completed", runId: runId ?? "replay", at: plusMs(baseAt, 440) });
  return [...head, ...tail];
}
