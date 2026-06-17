// governance/supabase.ts
// Server-only Supabase access for the live path (GOVERNANCE_SOURCE=cognigate). Supabase is
// the seam: the public console reads/writes these tables; the private CogniGate/ASTS side
// reads/writes the same tables. So this file never references a CogniGate endpoint or any
// I(θ) internals — it only moves rows that match the public contract in governance/types.ts.
//
// server-only: the service-role client and key never reach the browser. The client talks to
// the console exclusively through the decideCosign Server Action and the read-only stream.
//
// Every row that crosses this boundary is Zod-validated against the contract, so a malformed
// or unexpected row is rejected rather than rendered — the same discipline as the simulator.

import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AgentState,
  CosignRequest,
  DriftEvent,
  AuditEvent as AuditEventSchema,
} from "./types";
import type { AgentState as Agent, CosignRequest as Hold, DriftEvent as Drift, AuditEvent } from "./types";
import type { AuditStore } from "./audit";

let cached: SupabaseClient | null | undefined;

/** The service-role client, or null when the live path is not configured (degrade honestly). */
export function getSupabaseAdmin(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  cached = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return cached;
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseAdmin() !== null;
}

// --- normalization: PostgREST returns timestamptz with an offset and numeric as strings ---
function ts(value: unknown): string {
  return new Date(String(value)).toISOString(); // → "…Z", which z.iso.datetime() accepts
}
function num(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

// --- row → contract mappers (snake_case DB → camelCase type, then Zod-validated) ---
export function rowToAgent(row: Record<string, unknown>): Agent {
  return AgentState.parse({
    carId: row.car_id,
    name: row.name,
    role: row.role,
    modelBacking: row.model_backing,
    hosting: row.hosting,
    attestation: row.attestation,
    tier: row.tier,
    status: row.status,
    lastSeen: ts(row.last_seen),
    lastAction: row.last_action ?? null,
  });
}

export function rowToHold(row: Record<string, unknown>): Hold {
  return CosignRequest.parse({
    id: row.id,
    agentCarId: row.agent_car_id,
    actionType: row.action_type,
    actionPayload: row.action_payload,
    trigger: row.trigger,
    context: row.context,
    status: row.status,
    createdAt: ts(row.created_at),
    ttlExpiresAt: ts(row.ttl_expires_at),
    decidedAt: row.decided_at != null ? ts(row.decided_at) : null,
    decidedBy: row.decided_by ?? null,
  });
}

export function rowToDrift(row: Record<string, unknown>): Drift {
  const base = {
    id: row.id,
    agentCarId: row.agent_car_id,
    ts: ts(row.ts),
    expectedSignature: row.expected_signature,
    observedSignature: row.observed_signature,
    actionTaken: row.action_taken,
    correlationId: row.correlation_id,
  };
  const shaped =
    row.method === "WEIGHT_SPACE_ITHETA"
      ? { ...base, method: "WEIGHT_SPACE_ITHETA", divergenceDeg: num(row.divergence_deg) }
      : { ...base, method: "CANARY_PROBE", behavioralDistance: num(row.behavioral_distance), probeCount: num(row.probe_count) };
  return DriftEvent.parse(shaped);
}

function rowToAudit(row: Record<string, unknown>): AuditEvent {
  return AuditEventSchema.parse({
    id: row.id,
    ts: ts(row.ts),
    agentCarId: row.agent_car_id ?? null,
    eventType: row.event_type,
    actor: row.actor,
    payload: row.payload,
    prevHash: row.prev_hash ?? null,
    hash: row.hash,
  });
}

// --- Supabase-backed audit store (append-only, hash-linked in Postgres) ---
export class SupabaseAuditStore implements AuditStore {
  readonly #db: SupabaseClient;
  constructor(db: SupabaseClient) {
    this.#db = db;
  }
  async head(): Promise<string | null> {
    // seq is a monotonic identity column, so the tail of the chain is the max seq.
    const { data, error } = await this.#db
      .from("audit_events")
      .select("hash")
      .order("seq", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`audit head: ${error.message}`);
    return (data?.hash as string | undefined) ?? null;
  }
  async append(event: AuditEvent): Promise<void> {
    const { error } = await this.#db.from("audit_events").insert({
      id: event.id,
      ts: event.ts,
      agent_car_id: event.agentCarId,
      event_type: event.eventType,
      actor: event.actor,
      payload: event.payload,
      prev_hash: event.prevHash,
      hash: event.hash,
    });
    if (error) throw new Error(`audit append: ${error.message}`);
  }
  async all(): Promise<AuditEvent[]> {
    const { data, error } = await this.#db
      .from("audit_events")
      .select("*")
      .order("seq", { ascending: true });
    if (error) throw new Error(`audit all: ${error.message}`);
    return (data ?? []).map((r) => rowToAudit(r as Record<string, unknown>));
  }
}
