// governance/sources/cognigate.ts
// The live GovernanceSource for GOVERNANCE_SOURCE=cognigate. Supabase is the seam: this
// adapter reads/writes the four governance tables; the private CogniGate REQUIRE_COSIGN
// consumer and the ASTS sink read/write the SAME tables on their side. That keeps every
// CogniGate endpoint and all I(θ) internals OUT of this public repo — the adapter only ever
// moves rows that match the public contract, and only ever consumes the divergence signal.
//
// Honesty is preserved two ways:
//   * If Supabase is not configured, the adapter is inert — reads return empty and
//     submitDecision returns { ok:false, reason:"cognigate-not-configured" }. It never
//     fabricates an approval against a store that isn't there.
//   * submitDecision reports what actually happened: the decision is recorded to the
//     governance store and the hold is resolved there. Whether a real agent then acts is the
//     enforcement plane's job (it consumes the same row); the effect text says exactly that.

import type { AgentState, CosignDecision, CosignRequest, DriftEvent, SubmitResult } from "../types";
import type { GovernanceSource, SweepResult, Unsubscribe } from "../source";
import { getSupabaseAdmin, rowToAgent, rowToHold, rowToDrift } from "../supabase";

export class CogniGateSource implements GovernanceSource {
  async getFleet(): Promise<AgentState[]> {
    const db = getSupabaseAdmin();
    if (!db) return [];
    const { data, error } = await db.from("agents").select("*").order("car_id");
    if (error) throw new Error(`getFleet: ${error.message}`);
    return (data ?? []).map((r) => rowToAgent(r as Record<string, unknown>));
  }

  async listPendingHolds(): Promise<CosignRequest[]> {
    const db = getSupabaseAdmin();
    if (!db) return [];
    const { data, error } = await db
      .from("cosign_requests")
      .select("*")
      .eq("status", "PENDING")
      .order("created_at", { ascending: true });
    if (error) throw new Error(`listPendingHolds: ${error.message}`);
    return (data ?? []).map((r) => rowToHold(r as Record<string, unknown>));
  }

  async getHold(id: string): Promise<CosignRequest | null> {
    const db = getSupabaseAdmin();
    if (!db) return null;
    const { data, error } = await db.from("cosign_requests").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`getHold: ${error.message}`);
    return data ? rowToHold(data as Record<string, unknown>) : null;
  }

  // Realtime: new PENDING holds CogniGate parks into the table surface here without polling.
  watchHolds(onHold: (r: CosignRequest) => void): Unsubscribe {
    const db = getSupabaseAdmin();
    if (!db) return () => {};
    try {
      const channel = db
        .channel("cosign-holds")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "cosign_requests" },
          (payload) => {
            try {
              const hold = rowToHold(payload.new as Record<string, unknown>);
              if (hold.status === "PENDING") onHold(hold);
            } catch {
              // a row that doesn't match the contract is skipped, not rendered
            }
          },
        )
        .subscribe();
      return () => {
        void db.removeChannel(channel);
      };
    } catch {
      return () => {};
    }
  }

  async listRecentDrift(limit = 10): Promise<DriftEvent[]> {
    const db = getSupabaseAdmin();
    if (!db) return [];
    const { data, error } = await db
      .from("drift_events")
      .select("*")
      .order("ts", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`listRecentDrift: ${error.message}`);
    return (data ?? []).map((r) => rowToDrift(r as Record<string, unknown>)).reverse();
  }

  // Realtime: drift signals the ASTS sink writes surface here (read-only — consumed, not computed).
  watchDrift(onDrift: (e: DriftEvent) => void): Unsubscribe {
    const db = getSupabaseAdmin();
    if (!db) return () => {};
    try {
      const channel = db
        .channel("drift-events")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "drift_events" },
          (payload) => {
            try {
              onDrift(rowToDrift(payload.new as Record<string, unknown>));
            } catch {
              // skip a malformed signal rather than render it
            }
          },
        )
        .subscribe();
      return () => {
        void db.removeChannel(channel);
      };
    } catch {
      return () => {};
    }
  }

  async submitDecision(requestId: string, decision: CosignDecision, actor: string): Promise<SubmitResult> {
    const db = getSupabaseAdmin();
    if (!db) return { ok: false, reason: "cognigate-not-configured" };

    const status = decision === "APPROVE" ? "APPROVED" : "REJECTED";
    // Conditional update: only resolve a hold that is still PENDING. Returns the rows it
    // changed, so a no-op (already decided / expired) is detectable and honestly reported.
    const { data, error } = await db
      .from("cosign_requests")
      .update({ status, decided_at: new Date().toISOString(), decided_by: actor })
      .eq("id", requestId)
      .eq("status", "PENDING")
      .select("id, action_type");
    if (error) return { ok: false, reason: `store-error: ${error.message}` };
    if (!data || data.length === 0) return { ok: false, reason: "hold-not-pending-or-unknown" };

    const effect =
      decision === "APPROVE"
        ? "RECORD_MERGE released — recorded to the governance store; the enforcement plane applies the merge."
        : "RECORD_MERGE denied — recorded to the governance store; the agent proceeds without merging.";
    return { ok: true, effect };
  }

  async sweepExpired(now: Date = new Date()): Promise<SweepResult> {
    const db = getSupabaseAdmin();
    if (!db) return { timedOut: [] };
    const { data, error } = await db
      .from("cosign_requests")
      .update({ status: "TIMEOUT", decided_at: now.toISOString(), decided_by: "system:ttl-sweeper" })
      .eq("status", "PENDING")
      .lt("ttl_expires_at", now.toISOString())
      .select("*");
    if (error) throw new Error(`sweepExpired: ${error.message}`);
    return { timedOut: (data ?? []).map((r) => rowToHold(r as Record<string, unknown>)) };
  }
}
