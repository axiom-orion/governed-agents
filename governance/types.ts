// governance/types.ts
// The boundary contract for the Cosign Intervention Surface — the runtime
// human-in-the-loop control plane for the genealogy fleet (flcason.com reference
// console). Zod schemas at every boundary; the TypeScript is inferred from them, so
// a malformed adapter payload (live or simulator) is rejected before it reaches the
// UI or the write path, never silently trusted.
//
// Public-tier note: these types describe the *interface* a governance source exposes —
// fleet state, held actions, a divergence signal. They deliberately contain no I(θ)
// computation, aggregation method, or threshold calibration. The adapter CONSUMES a
// drift signal and RENDERS it; the math lives in the private plane and is out of this
// repo. Simulator values are synthetic.

import { z } from "zod";

// --- BASIS tier (T1–T6) ----------------------------------------------------
export const BasisTier = z.enum(["T1", "T2", "T3", "T4", "T5", "T6"]);
export type BasisTier = z.infer<typeof BasisTier>;

export const AgentStatus = z.enum(["ACTIVE", "PAUSED", "QUARANTINED"]);
export type AgentStatus = z.infer<typeof AgentStatus>;

// Where an agent runs — load-bearing for which attestation is even possible.
//   SELF_HOSTED_OPEN_WEIGHT — we hold the weights; weight-space I(θ) fingerprinting applies.
//   API_BACKED — no weight access; only behavioral attestation is possible.
export const Hosting = z.enum(["SELF_HOSTED_OPEN_WEIGHT", "API_BACKED"]);
export type Hosting = z.infer<typeof Hosting>;

// How an agent's model identity/integrity is attested. Constrained by hosting:
//   WEIGHT_SPACE_ITHETA — subspace rotation of the weight-space identity signature I(θ);
//     valid ONLY for self-hosted open-weight agents (we can read the weights).
//   CANARY_PROBE — a fixed probe battery whose response signature is compared to a
//     baseline; the only method available for API-backed agents (no weight access).
export const AttestationMethod = z.enum(["WEIGHT_SPACE_ITHETA", "CANARY_PROBE"]);
export type AttestationMethod = z.infer<typeof AttestationMethod>;

// CAR ID handle format — a stable agent handle, e.g. "CAR-7F3A-SCRIBE".
export const AgentState = z.object({
  carId: z.string(),
  name: z.string(),
  role: z.string(),
  modelBacking: z.string(),
  hosting: Hosting,
  attestation: AttestationMethod,
  tier: BasisTier,
  status: AgentStatus,
  lastSeen: z.iso.datetime(),
  lastAction: z.string().nullable(),
});
export type AgentState = z.infer<typeof AgentState>;

// --- cosign (the write path) -----------------------------------------------
export const CosignDecision = z.enum(["APPROVE", "REJECT"]);
export type CosignDecision = z.infer<typeof CosignDecision>;

export const CosignStatus = z.enum(["PENDING", "APPROVED", "REJECTED", "TIMEOUT"]);
export type CosignStatus = z.infer<typeof CosignStatus>;

export const CosignRequest = z.object({
  id: z.uuid(),
  agentCarId: z.string(),
  actionType: z.string(), // e.g. "RECORD_MERGE"
  actionPayload: z.unknown(), // narrowed per actionType in the UI (see RecordMergePayload)
  trigger: z.string(), // policy/tier/band that forced the hold
  context: z.string(), // human-readable decision context
  status: CosignStatus,
  createdAt: z.iso.datetime(),
  ttlExpiresAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
  decidedBy: z.string().nullable(),
});
export type CosignRequest = z.infer<typeof CosignRequest>;

// A genealogy record — one side of a proposed merge. Authored content in the
// simulator; in live mode this is whatever the genealogy agent attaches to the hold.
export const TimelineEntry = z.object({
  year: z.string(),
  place: z.string(),
  event: z.string(),
});
export type TimelineEntry = z.infer<typeof TimelineEntry>;

export const GenealogyRecord = z.object({
  recordId: z.string(),
  name: z.string(),
  born: z.string(),
  died: z.string().nullable(),
  timeline: z.array(TimelineEntry),
});
export type GenealogyRecord = z.infer<typeof GenealogyRecord>;

// The narrowed payload for a RECORD_MERGE hold: both candidate records plus the
// distinguishing evidence the agent surfaced — the thing that makes the merge wrong.
export const RecordMergePayload = z.object({
  left: GenealogyRecord,
  right: GenealogyRecord,
  distinguishingEvidence: z.object({
    headline: z.string(),
    detail: z.string(),
    divergencePoints: z.array(z.string()),
  }),
  proposedConfidence: z.number(), // the merge agent's own confidence, [0,1]
});
export type RecordMergePayload = z.infer<typeof RecordMergePayload>;

// --- drift (the read-only divergence signal) -------------------------------
// Method-discriminated so the type system makes a false claim impossible: a
// canary-probe event can never carry weight-space degrees, and a weight-space
// claim can never attach to an API-backed agent.
export const DriftMethod = z.enum(["WEIGHT_SPACE_ITHETA", "CANARY_PROBE"]);
export type DriftMethod = z.infer<typeof DriftMethod>;

const driftBase = {
  id: z.uuid(),
  agentCarId: z.string(),
  ts: z.iso.datetime(),
  expectedSignature: z.string(), // reference band (synthetic in the simulator)
  observedSignature: z.string(),
  actionTaken: z.literal("QUARANTINE"),
  correlationId: z.string(),
};

export const WeightSpaceDrift = z.object({
  ...driftBase,
  method: z.literal("WEIGHT_SPACE_ITHETA"),
  // subspace rotation between expected and observed I(θ), in degrees. The value is a
  // RENDERED signal; the rotation is computed in the private plane, never here.
  divergenceDeg: z.number(),
});
export type WeightSpaceDrift = z.infer<typeof WeightSpaceDrift>;

export const CanaryProbeDrift = z.object({
  ...driftBase,
  method: z.literal("CANARY_PROBE"),
  // probe-response divergence from the canary baseline, [0,1] (no weight access).
  behavioralDistance: z.number(),
  probeCount: z.number().int().nonnegative(),
});
export type CanaryProbeDrift = z.infer<typeof CanaryProbeDrift>;

export const DriftEvent = z.discriminatedUnion("method", [WeightSpaceDrift, CanaryProbeDrift]);
export type DriftEvent = z.infer<typeof DriftEvent>;

// --- audit (the Truth Chain) -----------------------------------------------
export const AuditEventType = z.enum([
  "COSIGN_HOLD_OPENED",
  "COSIGN_DECISION",
  "COSIGN_RESULT",
  "COSIGN_TIMEOUT",
  "DRIFT_QUARANTINE",
]);
export type AuditEventType = z.infer<typeof AuditEventType>;

// What a caller hands to appendAudit — the hash linkage is the store's job, not the
// caller's, so prevHash/hash/id/ts are NOT part of the input.
export const AuditInput = z.object({
  eventType: AuditEventType,
  actor: z.string(),
  payload: z.unknown(),
  agentCarId: z.string().nullable().optional(),
});
export type AuditInput = z.infer<typeof AuditInput>;

// A persisted, hash-linked audit row.
export const AuditEvent = z.object({
  id: z.uuid(),
  ts: z.iso.datetime(),
  agentCarId: z.string().nullable(),
  eventType: AuditEventType,
  actor: z.string(),
  payload: z.unknown(),
  prevHash: z.string().nullable(),
  hash: z.string(),
});
export type AuditEvent = z.infer<typeof AuditEvent>;

// --- the realtime channel (NDJSON, mirrors the trace stream) ---------------
// What the governance stream route emits, and what the client validates with Zod
// before trusting it. Keeps the "render only from validated events" discipline the
// trace UI already follows.
export const GovernanceStreamEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fleet"), at: z.iso.datetime(), agents: z.array(AgentState) }),
  z.object({ type: z.literal("holds"), at: z.iso.datetime(), holds: z.array(CosignRequest) }),
  z.object({ type: z.literal("hold_opened"), at: z.iso.datetime(), hold: CosignRequest }),
  z.object({
    type: z.literal("hold_resolved"),
    at: z.iso.datetime(),
    id: z.uuid(),
    status: CosignStatus,
    decidedBy: z.string().nullable(),
  }),
  z.object({ type: z.literal("drift"), at: z.iso.datetime(), event: DriftEvent }),
  z.object({ type: z.literal("agent_update"), at: z.iso.datetime(), agent: AgentState }),
  z.object({ type: z.literal("heartbeat"), at: z.iso.datetime() }),
]);
export type GovernanceStreamEvent = z.infer<typeof GovernanceStreamEvent>;

// Result of a decision submitted to the enforcement plane through the adapter.
export type SubmitResult =
  | { readonly ok: true; readonly effect: string }
  | { readonly ok: false; readonly reason: string };
