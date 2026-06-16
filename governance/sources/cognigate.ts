// governance/sources/cognigate.ts
// The live adapter to the real enforcement plane: CogniGate's REQUIRE_COSIGN path (the
// PEP that holds actions and consumes decisions) and the ASTS v1.0 sink (queryable fleet
// state + the I(θ) divergence signal). It persists holds/decisions/audit to Supabase and
// subscribes to Supabase Realtime for live arrival.
//
// G2/G3 are prerequisites this task does not own:
//   G2 — CogniGate must emit hold events and consume decisions (submitDecision needs a
//        real target). Until then this adapter is INERT.
//   G3 — the ASTS sink must emit queryable fleet state + I(θ) drift. Until then there is
//        no live fleet/drift.
//
// Honesty rule (load-bearing): while inert, submitDecision returns
// { ok: false, reason: "cognigate-not-wired" } — it NEVER fabricates an { ok: true }
// against a target that isn't there, and reads return empty rather than invented state.
// Flipping this on is wiring, not new design: implement the marked sections against the
// Supabase client + the CogniGate/ASTS endpoints, set GOVERNANCE_SOURCE=cognigate.
//
// Public-tier note: this adapter only ever CONSUMES the I(θ) divergence signal that ASTS
// emits. The weight-space computation, aggregation, and threshold calibration are not here
// and must not be added here — they belong to the private plane.

import type { AgentState, CosignDecision, CosignRequest, DriftEvent, SubmitResult } from "../types";
import type { GovernanceSource, SweepResult, Unsubscribe } from "../source";

export class CogniGateSource implements GovernanceSource {
  // G3: read fleet state from the ASTS sink (Supabase `agents`, or the sink API).
  async getFleet(): Promise<AgentState[]> {
    return [];
  }

  // G2: read PENDING holds CogniGate has parked (Supabase `cosign_requests`).
  async listPendingHolds(): Promise<CosignRequest[]> {
    return [];
  }

  async getHold(_id: string): Promise<CosignRequest | null> {
    return null;
  }

  // G2: subscribe to Supabase Realtime on `cosign_requests` for new PENDING holds.
  watchHolds(_onHold: (r: CosignRequest) => void): Unsubscribe {
    return () => {};
  }

  // G3: subscribe to the ASTS drift channel (Supabase `drift_events`).
  watchDrift(_onDrift: (e: DriftEvent) => void): Unsubscribe {
    return () => {};
  }

  // G2: push the decision to CogniGate's REQUIRE_COSIGN consumer. Inert until wired —
  // never fabricate success against a missing target.
  async submitDecision(_requestId: string, _decision: CosignDecision, _actor: string): Promise<SubmitResult> {
    return { ok: false, reason: "cognigate-not-wired" };
  }

  // G2: a real sweep flips expired PENDING → TIMEOUT in Supabase and pushes REJECT to
  // CogniGate. Inert until wired: nothing to sweep.
  async sweepExpired(_now?: Date): Promise<SweepResult> {
    return { timedOut: [] };
  }
}
