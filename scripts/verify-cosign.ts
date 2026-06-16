// scripts/verify-cosign.ts
// Headless verification of the Cosign Intervention Surface. Everything the demo claims,
// proven in one process with zero infra:
//
//   1. Cosign round-trip — the Cason↔Causey hold is rejected through the real decideCosign
//      Server Action; the agent proceeds without merge; the audit chain shows
//      COSIGN_DECISION then COSIGN_RESULT and verifies (and a tamper breaks it).
//   2. Fail-closed — an expired hold is swept to TIMEOUT (auto-reject), never released.
//   3. Drift → quarantine — the scripted drift fires on Scribe by weight-space I(θ); the
//      type system forbids asserting I(θ)/degrees on a canary-probe (API-backed) agent.
//   4. Zod at the boundary — malformed adapter/stream payloads are rejected, not trusted.
//   5. Honesty — the live adapter is inert until wired (no fabricated approval).
//
// Run: NODE_OPTIONS=--conditions=react-server tsx scripts/verify-cosign.ts
// (the condition lets the server-only guarded modules import under plain Node.)

import { SimulatorSource } from "../governance/sources/simulator";
import { CogniGateSource } from "../governance/sources/cognigate";
import {
  appendAudit,
  MemoryAuditStore,
  setAuditStore,
  getAuditStore,
  verifyChain,
} from "../governance/audit";
import { getSource, resetSource } from "../governance/registry";
import { decideCosign } from "../app/_actions/cosign";
import {
  CosignRequest,
  DriftEvent,
  GovernanceStreamEvent,
  RecordMergePayload,
  WeightSpaceDrift,
  CanaryProbeDrift,
} from "../governance/types";
import type { AuditEvent } from "../governance/types";

interface Result {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
}
const results: Result[] = [];
function check(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, detail });
}

const CASON_CAUSEY_HOLD_ID = "11111111-1111-4111-8111-111111111111";
const SECONDARY_HOLD_ID = "22222222-2222-4222-8222-222222222222";

async function main(): Promise<void> {
  // ============ 1) the cosign round-trip through the real Server Action ===========
  setAuditStore(new MemoryAuditStore());
  resetSource(); // force a fresh simulator that the Server Action will share

  const holdBefore = await getSource().getHold(CASON_CAUSEY_HOLD_ID);
  check("hold: the Cason↔Causey RECORD_MERGE resolves by id", holdBefore?.actionType === "RECORD_MERGE");
  check("hold: starts PENDING", holdBefore?.status === "PENDING");

  // The distinguishing evidence is the Maryland-detour fingerprint, and it is legible.
  const payload = RecordMergePayload.safeParse(holdBefore?.actionPayload);
  check("payload: validates as RECORD_MERGE", payload.success);
  check(
    "payload: distinguishing evidence is the Maryland-detour fingerprint",
    payload.success && /maryland/i.test(payload.data.distinguishingEvidence.headline),
    payload.success ? payload.data.distinguishingEvidence.headline : undefined,
  );
  check(
    "payload: the two lines are documented in different states at the same time",
    payload.success && payload.data.distinguishingEvidence.divergencePoints.length >= 3,
  );

  const decision = await decideCosign({ requestId: CASON_CAUSEY_HOLD_ID, decision: "REJECT" });
  check("decision: REJECT is accepted (ok)", decision.result.ok);
  check(
    "decision: the agent proceeds WITHOUT merging",
    decision.result.ok && /without merg/i.test(decision.result.effect),
    decision.result.ok ? decision.result.effect : (decision.result as { reason: string }).reason,
  );
  check("decision: two audit rows were written", decision.audit.length === 2);
  check(
    "decision: rows are COSIGN_DECISION then COSIGN_RESULT",
    decision.audit[0]?.eventType === "COSIGN_DECISION" && decision.audit[1]?.eventType === "COSIGN_RESULT",
  );

  const holdAfter = await getSource().getHold(CASON_CAUSEY_HOLD_ID);
  check("decision: the hold is now REJECTED", holdAfter?.status === "REJECTED");
  check("decision: attributed to the operator", holdAfter?.decidedBy === "operator");

  // a second decision on the same hold is refused — no double-spend of a held action
  const again = await decideCosign({ requestId: CASON_CAUSEY_HOLD_ID, decision: "APPROVE" });
  check("decision: a settled hold cannot be decided again", !again.result.ok);

  // ============ 2) the audit chain verifies, and a tamper breaks it ===============
  const chain = await getAuditStore().all();
  check("audit: the chain has the two decision rows", chain.length >= 2);
  check("audit: COSIGN_DECISION links from genesis (prevHash null)", chain[0]?.prevHash === null);
  check("audit: COSIGN_RESULT links to COSIGN_DECISION", chain[1]?.prevHash === chain[0]?.hash);
  const verified = verifyChain(chain);
  check("audit: verifyChain confirms the intact chain", verified.ok, JSON.stringify(verified));

  const tampered: AuditEvent[] = chain.slice();
  const first = tampered[0]!;
  tampered[0] = { ...first, payload: { ...(first.payload as object), tampered: true } };
  const brokenAt = verifyChain(tampered).brokenAt;
  check("audit: a single edited payload breaks the chain (tamper-evident)", brokenAt === 0, `brokenAt=${brokenAt}`);

  // ============ 3) fail-closed: an expired hold is auto-rejected ==================
  resetSource();
  const sim = new SimulatorSource();
  // Before expiry the secondary hold is decidable (still pending).
  const sweepEarly = await sim.sweepExpired(new Date());
  check("fail-closed: nothing swept before any TTL elapses", sweepEarly.timedOut.length === 0);

  // The secondary hold has a 90s TTL; jump past it. The 15m primary is still alive.
  const afterSecondary = await sim.sweepExpired(new Date(Date.now() + 100_000));
  check(
    "fail-closed: the 90s hold is swept to TIMEOUT (auto-reject), not released",
    afterSecondary.timedOut.length === 1 &&
      afterSecondary.timedOut[0]?.id === SECONDARY_HOLD_ID &&
      afterSecondary.timedOut[0]?.status === "TIMEOUT",
  );
  const secondaryNow = await sim.getHold(SECONDARY_HOLD_ID);
  check("fail-closed: the swept hold reads TIMEOUT, decided by the sweeper", secondaryNow?.status === "TIMEOUT" && secondaryNow?.decidedBy === "system:ttl-sweeper");
  const primaryStill = await sim.getHold(CASON_CAUSEY_HOLD_ID);
  check("fail-closed: the 15m hold is untouched (not yet expired)", primaryStill?.status === "PENDING");

  // a TIMEOUT is auditable on the same chain shape as a human decision
  setAuditStore(new MemoryAuditStore());
  await appendAudit({
    eventType: "COSIGN_TIMEOUT",
    actor: "system:ttl-sweeper",
    payload: { requestId: SECONDARY_HOLD_ID, autoDecision: "REJECT", posture: "fail-closed" },
  });
  const timeoutChain = await getAuditStore().all();
  check("fail-closed: the auto-reject is recorded in the Truth Chain", timeoutChain[0]?.eventType === "COSIGN_TIMEOUT" && verifyChain(timeoutChain).ok);

  // ============ 4) drift → quarantine, with honest method discrimination ==========
  resetSource();
  const driftSim = new SimulatorSource();
  let captured: DriftEvent | undefined;
  const unsub = driftSim.watchDrift((e) => {
    captured = e;
  });
  // wait out the scripted drift delay
  await new Promise((r) => setTimeout(r, 7_500));
  unsub();
  check("drift: the scripted event fired", captured !== undefined);
  check("drift: it fired on Scribe", captured?.agentCarId === "CAR-7F3A-SCRIBE");
  check(
    "drift: Scribe is attested by weight-space I(θ) (valid — self-hosted open weights)",
    captured?.method === "WEIGHT_SPACE_ITHETA",
  );
  check(
    "drift: the event carries a subspace-rotation divergence in degrees",
    captured?.method === "WEIGHT_SPACE_ITHETA" && captured.divergenceDeg > 0,
  );
  check("drift: the action taken is QUARANTINE", captured?.actionTaken === "QUARANTINE");
  const fleetAfter = await driftSim.getFleet();
  const scribe = fleetAfter.find((a) => a.carId === "CAR-7F3A-SCRIBE");
  check("drift: the fleet view flips Scribe to QUARANTINED", scribe?.status === "QUARANTINED");

  // the honesty fix, enforced by the type system: an API-backed agent can only be a
  // canary-probe drift, which carries a behavioral distance — never I(θ) degrees.
  const fleet = await driftSim.getFleet();
  const apiAgents = fleet.filter((a) => a.attestation === "CANARY_PROBE");
  check("fleet: nine API-backed agents are attested by canary-probe, not I(θ)", apiAgents.length === 9);
  check(
    "fleet: exactly one self-hosted open-weight agent is fingerprintable in weight space",
    fleet.filter((a) => a.attestation === "WEIGHT_SPACE_ITHETA").length === 1,
  );
  // a canary-probe drift parses against its variant and has NO degrees field
  const canary = CanaryProbeDrift.safeParse({
    id: "33333333-3333-4333-8333-333333333333",
    agentCarId: "CAR-2B11-MATCHER",
    ts: new Date().toISOString(),
    method: "CANARY_PROBE",
    expectedSignature: "probe-baseline ⟨h0⟩",
    observedSignature: "⟨h1⟩",
    behavioralDistance: 0.42,
    probeCount: 64,
    actionTaken: "QUARANTINE",
    correlationId: "swap-canary",
  });
  check("drift: a canary-probe event validates and carries a behavioral distance, not degrees", canary.success && !("divergenceDeg" in canary.data));
  const weight = WeightSpaceDrift.safeParse({ ...((captured ?? {}) as object) });
  check("drift: the weight-space event validates against its variant", weight.success);

  // ============ 5) Zod rejects malformed boundary payloads ========================
  check("zod: a CosignRequest missing required fields is rejected", !CosignRequest.safeParse({ id: "not-a-uuid" }).success);
  check("zod: a drift event with no method is rejected", !DriftEvent.safeParse({ id: "x", agentCarId: "y", ts: "z" }).success);
  check(
    "zod: a malformed stream line is rejected at the boundary",
    !GovernanceStreamEvent.safeParse({ type: "drift", at: new Date().toISOString(), event: { method: "WEIGHT_SPACE_ITHETA" } }).success,
  );
  check(
    "zod: a well-formed stream line validates",
    GovernanceStreamEvent.safeParse({ type: "heartbeat", at: new Date().toISOString() }).success,
  );

  // ============ 6) the live adapter is inert until wired (no fabrication) =========
  const live = new CogniGateSource();
  const liveDecision = await live.submitDecision(CASON_CAUSEY_HOLD_ID, "REJECT", "operator");
  check(
    "honesty: the inert live adapter returns ok:false / cognigate-not-wired (never a fake approval)",
    !liveDecision.ok && liveDecision.reason === "cognigate-not-wired",
  );
  check("honesty: the inert live adapter exposes no fleet/holds", (await live.getFleet()).length === 0 && (await live.listPendingHolds()).length === 0);

  // ============ report ===========================================================
  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    // eslint-disable-next-line no-console
    console.log(`${r.ok ? "ok " : "FAIL"} ${r.name}${!r.ok && r.detail !== undefined ? ` — ${r.detail}` : ""}`);
  }
  // eslint-disable-next-line no-console
  console.log(`\n${results.length - failed.length}/${results.length} cosign checks passed`);
  if (failed.length > 0) process.exit(1);
}

void main();
