// governance/registry.ts
// Selects the GovernanceSource implementation from the GOVERNANCE_SOURCE env var.
// Default is the simulator: zero-infra, safe for public exposure, and the kill switch —
// GOVERNANCE_SOURCE=simulator reverts to fully synthetic with no live effects. Set it to
// `cognigate` to point at the real REQUIRE_COSIGN path + ASTS sink (inert until G2/G3).
//
// One source per process (memoized) so the in-memory simulator state — opened holds, the
// decision overlay, the quarantine flag — is shared by the reads, the stream route, and
// the Server Action within a warm server instance.

import type { GovernanceSource } from "./source";
import { SimulatorSource } from "./sources/simulator";
import { CogniGateSource } from "./sources/cognigate";
import { setAuditStore } from "./audit";
import { getSupabaseAdmin, SupabaseAuditStore } from "./supabase";

export type GovernanceSourceKind = "simulator" | "cognigate";

export function governanceSourceKind(): GovernanceSourceKind {
  return process.env.GOVERNANCE_SOURCE === "cognigate" ? "cognigate" : "simulator";
}

let cached: GovernanceSource | undefined;

export function getSource(): GovernanceSource {
  if (cached) return cached;
  if (governanceSourceKind() === "cognigate") {
    cached = new CogniGateSource();
    // On the live path the Truth Chain persists to Postgres. Wired synchronously so the
    // Server Action's appendAudit hits Supabase, not the in-memory store. Falls back to the
    // in-memory store if Supabase isn't configured (the source is inert in that case anyway).
    const db = getSupabaseAdmin();
    if (db) setAuditStore(new SupabaseAuditStore(db));
  } else {
    cached = new SimulatorSource();
  }
  return cached;
}

/** Test seam: drop the memoized source (used by the headless verifier between scenarios). */
export function resetSource(): void {
  cached = undefined;
}
