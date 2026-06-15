// lib/loop.ts
// The runnable core: Researcher -> Reasoner -> governance gate -> execute-or-halt.
// Yields one TraceEvent per step. The executor runs ONLY when evaluatePolicy()
// returns "allow". Any failure (model timeout, refusal, malformed output) is emitted
// as an `error` event — the loop never hangs, and always ends with `run_completed`.

import { randomUUID } from "node:crypto";
import {
  defaultPolicy,
  evaluatePolicy,
  isConsequentialKind,
  type PolicyRule,
  type ProposedAction,
} from "./governance";
import type { TraceEvent } from "./trace-events";
import { runExecutor, runResearcher } from "./agents";
import { runConsensusReasoner } from "./consensus";
import { runRedCell, withRedCell } from "./redcell";
import { createReasonerVoters, type Voter } from "./providers";
import { createModelClient, type ModelClient } from "./model-client";

const now = (): string => new Date().toISOString();

export async function* runLoop(
  task: string,
  client: ModelClient = createModelClient(),
  policy: readonly PolicyRule[] = defaultPolicy,
  voters: readonly Voter[] = createReasonerVoters(client),
): AsyncGenerator<TraceEvent> {
  const runId = randomUUID();
  yield { type: "run_started", runId, task, at: now() };

  try {
    // 1) Researcher — retrieve sources + summarize.
    const researcherStep = `${runId}:researcher`;
    yield { type: "step_started", stepId: researcherStep, role: "researcher", at: now() };
    const finding = await runResearcher(task, client);
    yield {
      type: "step_completed",
      stepId: researcherStep,
      role: "researcher",
      summary: finding.summary,
      provenance: [...finding.provenance],
      at: now(),
    };

    // 2) Reasoner — propose exactly one action via the model triad (provenance
    // carried from retrieval). With one voter this is the single-model path; with
    // Gemini/Grok keys present it votes and attaches the consensus for the gate.
    const reasonerStep = `${runId}:reasoner`;
    yield { type: "step_started", stepId: reasonerStep, role: "reasoner", at: now() };
    const proposed: ProposedAction = await runConsensusReasoner(task, finding, voters);
    // Red Cell (adversarial mode): reserved for consequential actions — outbound sends
    // and destructive/irreversible kinds — where an independent "make the case against
    // it" review earns its cost. Internal records are still gated by the hard rules but
    // skip the generative red team. Needs ≥2 voters so a distinct reviewer can exist;
    // single-voter (offline/CI) runs are unchanged.
    const action: ProposedAction =
      voters.length >= 2 && isConsequentialKind(proposed.kind)
        ? withRedCell(proposed, await runRedCell(task, proposed, voters))
        : proposed;
    yield {
      type: "step_completed",
      stepId: reasonerStep,
      role: "reasoner",
      summary: action.justification,
      provenance: [...action.provenance],
      at: now(),
    };
    yield { type: "action_proposed", stepId: reasonerStep, action, at: now() };

    // 3) Governance gate — allow or block.
    const decision = evaluatePolicy(action, policy);
    yield { type: "gate_decision", stepId: reasonerStep, decision, at: now() };

    // 4) Execute only on allow; block halts the run; needs_approval parks it for a human.
    if (decision.decision === "allow") {
      const executorStep = `${runId}:executor`;
      yield { type: "step_started", stepId: executorStep, role: "executor", at: now() };
      const result = await runExecutor(action, client);
      yield { type: "executed", stepId: executorStep, result, at: now() };
      yield {
        type: "step_completed",
        stepId: executorStep,
        role: "executor",
        summary: result,
        provenance: [...action.provenance],
        at: now(),
      };
    } else if (decision.decision === "needs_approval") {
      const reason = decision.violations
        .filter((v) => (v.severity ?? "block") === "review")
        .map((v) => `${v.rule}: ${v.detail}`)
        .join("; ");
      yield {
        type: "awaiting_approval",
        stepId: reasonerStep,
        reason: reason.length > 0 ? reason : "awaiting human approval",
        at: now(),
      };
    } else {
      const reason = decision.violations.map((v) => `${v.rule}: ${v.detail}`).join("; ");
      yield {
        type: "halted",
        stepId: reasonerStep,
        reason: reason.length > 0 ? reason : "blocked by policy",
        at: now(),
      };
    }
  } catch (err) {
    yield { type: "error", message: err instanceof Error ? err.message : String(err), at: now() };
  }

  yield { type: "run_completed", runId, at: now() };
}
