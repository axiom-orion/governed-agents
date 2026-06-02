// lib/loop.ts
// The runnable core: Researcher -> Reasoner -> governance gate -> execute-or-halt.
// Yields one TraceEvent per step. The executor runs ONLY when evaluatePolicy()
// returns "allow". Any failure (model timeout, refusal, malformed output) is emitted
// as an `error` event — the loop never hangs, and always ends with `run_completed`.

import { randomUUID } from "node:crypto";
import { defaultPolicy, evaluatePolicy, type ProposedAction } from "./governance";
import type { TraceEvent } from "./trace-events";
import { runExecutor, runReasoner, runResearcher } from "./agents";
import { createModelClient, type ModelClient } from "./model-client";

const now = (): string => new Date().toISOString();

export async function* runLoop(
  task: string,
  client: ModelClient = createModelClient(),
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

    // 2) Reasoner — propose exactly one action (provenance carried from retrieval).
    const reasonerStep = `${runId}:reasoner`;
    yield { type: "step_started", stepId: reasonerStep, role: "reasoner", at: now() };
    const action: ProposedAction = await runReasoner(task, finding, client);
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
    const decision = evaluatePolicy(action, defaultPolicy);
    yield { type: "gate_decision", stepId: reasonerStep, decision, at: now() };

    // 4) Execute only on allow; otherwise halt with the policy rationale.
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
