"use server";

// app/_actions/cosign.ts
// The decision write path — the first and only mutation in the demo stack, and the
// security-sensitive boundary the rest of the design protects. The client calls this
// Server Action; it never touches the adapter, the service-role key, or CogniGate directly.
//
// Order is deliberate and matches the crux sequence:
//   1. authenticate the operator (fail-closed if absent),
//   2. audit the INTENT before acting (hash-chained append),
//   3. push the decision to the enforcement plane via the adapter (sim or live),
//   4. audit the OUTCOME.
// The human decision writes to the audit chain and releases/rejects the held action via
// the adapter. It does NOT mutate BASIS trust scores — any trust effect flows through
// CogniGate/BASIS normally, preserving the read-only-to-trust-data guarantee.

import { z } from "zod";
import { CosignDecision } from "@/governance/types";
import { getSource } from "@/governance/registry";
import { appendAudit } from "@/governance/audit";
import { getOperator } from "@/auth/operator";
import type { SubmitResult } from "@/governance/types";

const Input = z.object({
  requestId: z.uuid(),
  decision: CosignDecision,
});

export interface DecideCosignResult {
  readonly result: SubmitResult;
  /** The two audit rows written for this decision, for the client to surface inline. */
  readonly audit: ReadonlyArray<{ readonly eventType: string; readonly hash: string; readonly ts: string }>;
}

export async function decideCosign(raw: unknown): Promise<DecideCosignResult> {
  const { requestId, decision } = Input.parse(raw);

  const operator = await getOperator();
  if (!operator) {
    return { result: { ok: false, reason: "unauthenticated" }, audit: [] };
  }

  // Confirm the target exists and is still actionable before we record an intent against it.
  const hold = await getSource().getHold(requestId);
  if (!hold) {
    return { result: { ok: false, reason: "unknown-request" }, audit: [] };
  }

  // 1. audit the intent BEFORE acting (hash-chained append).
  const intent = await appendAudit({
    eventType: "COSIGN_DECISION",
    actor: `human:${operator.id}`,
    agentCarId: hold.agentCarId,
    payload: { requestId, decision, actionType: hold.actionType },
  });

  // 2. push to the enforcement plane via the adapter (sim or live).
  const result = await getSource().submitDecision(requestId, decision, operator.id);

  // 3. audit the outcome.
  const outcome = await appendAudit({
    eventType: "COSIGN_RESULT",
    actor: "system",
    agentCarId: hold.agentCarId,
    payload: { requestId, decision, result },
  });

  return {
    result,
    audit: [
      { eventType: intent.eventType, hash: intent.hash, ts: intent.ts },
      { eventType: outcome.eventType, hash: outcome.hash, ts: outcome.ts },
    ],
  };
}
