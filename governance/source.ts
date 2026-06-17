// governance/source.ts
// The adapter boundary that makes sim/live swappable. Everything the console needs
// from the enforcement plane goes through this interface: fleet state, the stream of
// held actions and drift signals, and the single write — pushing a human decision back.
//
// The contract is deliberately small. Reads (getFleet/listPendingHolds/getHold) feed the
// RSC first paint; watch* feeds the realtime stream route; submitDecision is the only
// mutation, and it is server-only (the client reaches it through a Server Action, never
// directly). sweepExpired backs the fail-closed TTL cron.

import type { AgentState, CosignDecision, CosignRequest, DriftEvent, SubmitResult } from "./types";

export type Unsubscribe = () => void;

export interface SweepResult {
  /** Requests that were past TTL and have just been auto-rejected (fail-closed). */
  readonly timedOut: readonly CosignRequest[];
}

export interface GovernanceSource {
  /** Current fleet snapshot for the read-only fleet view. */
  getFleet(): Promise<AgentState[]>;

  /** Pending holds for the cosign queue's first paint (RSC). */
  listPendingHolds(): Promise<CosignRequest[]>;

  /** A single hold by id — used by the Server Action to render context and validate the target. */
  getHold(id: string): Promise<CosignRequest | null>;

  /** Subscribe to newly-held actions. Returns an unsubscribe. Server-side (stream route). */
  watchHolds(onHold: (r: CosignRequest) => void): Unsubscribe;

  /** Recent drift signals for the stream's first paint (so already-quarantined agents show
   *  their drift detail, not just a red chip). The simulator fires drift live and returns []. */
  listRecentDrift(limit?: number): Promise<DriftEvent[]>;

  /** Subscribe to drift/quarantine signals. Returns an unsubscribe. Server-side (stream route). */
  watchDrift(onDrift: (e: DriftEvent) => void): Unsubscribe;

  /**
   * Push a human decision back to the enforcement plane. Server-only.
   * Returns { ok:true, effect } on a real release/reject, or { ok:false, reason } when the
   * target is missing/unwired — never a fabricated success against a target that isn't there.
   */
  submitDecision(requestId: string, decision: CosignDecision, actor: string): Promise<SubmitResult>;

  /**
   * Fail-closed sweep: any PENDING hold past its TTL is auto-rejected (TIMEOUT) and the
   * reject is pushed through submitDecision. Returns what was swept so the caller can audit it.
   */
  sweepExpired(now?: Date): Promise<SweepResult>;
}
