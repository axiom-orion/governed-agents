// governance/sources/simulator.ts
// The zero-infra GovernanceSource. It scripts the two money-shots — the Cason↔Causey
// merge refusal as a live cosign moment, and a model-swap caught on Scribe by I(θ) —
// and accepts decisions, with no Supabase, no CogniGate, no keys. Flipping to live is
// one env var once those land (see registry.ts + sources/cognigate.ts).
//
// Honest by construction: the simulator has no bridge to a real agent, so it is safe for
// public exposure. Every value below is synthetic. In particular the I(θ) signatures and
// divergence are illustrative strings/numbers — the actual weight-space computation,
// aggregation, and threshold calibration live in the private plane and are not in this
// repo. The drift money-shot fires on Scribe (the one self-hosted open-weight agent), so
// "I(θ) caught a model swap" is a true claim; the nine API-backed agents are attested by
// canary-probe behavioral checks, never by weight-space I(θ).

import { randomUUID } from "node:crypto";
import type {
  AgentState,
  CosignDecision,
  CosignRequest,
  DriftEvent,
  RecordMergePayload,
  SubmitResult,
} from "../types";
import type { GovernanceSource, SweepResult, Unsubscribe } from "../source";

const PRIMARY_TTL_MS = 15 * 60_000; // 15m — the high-stakes default
const SECONDARY_TTL_MS = 90_000; // 90s — tightened for a watchable fail-closed expiry
const HOLD_PRIMARY_DELAY_MS = 1_800;
const HOLD_SECONDARY_DELAY_MS = 3_600;
const DRIFT_DELAY_MS = 7_000;

// Stable ids so the decision path resolves the same hold across stateless invocations.
const CASON_CAUSEY_HOLD_ID = "11111111-1111-4111-8111-111111111111";
const SECONDARY_HOLD_ID = "22222222-2222-4222-8222-222222222222";
const SCRIBE_CAR_ID = "CAR-7F3A-SCRIBE";

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

// --- the fleet: 1 self-hosted open-weight (Scribe) + 9 API-backed -----------
function buildFleet(): AgentState[] {
  const base: ReadonlyArray<Omit<AgentState, "lastSeen">> = [
    {
      carId: SCRIBE_CAR_ID,
      name: "Scribe",
      role: "Record transcription & OCR normalization",
      modelBacking: "llama-3.1-70b · self-hosted",
      hosting: "SELF_HOSTED_OPEN_WEIGHT",
      attestation: "WEIGHT_SPACE_ITHETA",
      tier: "T2",
      status: "ACTIVE",
      lastAction: "Normalized 41 parish-register scans (St. Paul's, Edgefield)",
    },
    {
      carId: "CAR-2B11-MATCHER",
      name: "Matcher",
      role: "Candidate record matching",
      modelBacking: "claude-sonnet-4-6 · API",
      hosting: "API_BACKED",
      attestation: "CANARY_PROBE",
      tier: "T3",
      status: "ACTIVE",
      lastAction: "Proposed RECORD_MERGE(Cason, Causey) — held for cosign",
    },
    {
      carId: "CAR-9C04-KEEPER",
      name: "Keeper",
      role: "Record-write gate",
      modelBacking: "claude-sonnet-4-6 · API",
      hosting: "API_BACKED",
      attestation: "CANARY_PROBE",
      tier: "T5",
      status: "ACTIVE",
      lastAction: "Wrote 1880 census citation to Pike Co. household #112",
    },
    {
      carId: "CAR-4D77-LINEAGE",
      name: "Lineage",
      role: "Lineage inference",
      modelBacking: "claude-opus-4-8 · API",
      hosting: "API_BACKED",
      attestation: "CANARY_PROBE",
      tier: "T4",
      status: "ACTIVE",
      lastAction: "Resolved a 3-generation gap on the Tisdale branch",
    },
    {
      carId: "CAR-1A29-SOURCER",
      name: "Sourcer",
      role: "Source retrieval & citation",
      modelBacking: "claude-haiku-4-5 · API",
      hosting: "API_BACKED",
      attestation: "CANARY_PROBE",
      tier: "T3",
      status: "ACTIVE",
      lastAction: "Attached 6 FamilySearch citations to the Cawson cluster",
    },
    {
      carId: "CAR-6E52-INDEXER",
      name: "Indexer",
      role: "Census & parish indexing",
      modelBacking: "claude-haiku-4-5 · API",
      hosting: "API_BACKED",
      attestation: "CANARY_PROBE",
      tier: "T2",
      status: "ACTIVE",
      lastAction: "Indexed 1850 slave schedule, Upson Co., GA",
    },
    {
      carId: "CAR-3F8B-GEOCODER",
      name: "Geocoder",
      role: "Place & jurisdiction resolution",
      modelBacking: "claude-haiku-4-5 · API",
      hosting: "API_BACKED",
      attestation: "CANARY_PROBE",
      tier: "T2",
      status: "PAUSED",
      lastAction: "Paused — geocoding provider rate-limit backoff",
    },
    {
      carId: "CAR-8B40-DEDUP",
      name: "Dedup",
      role: "Duplicate detection",
      modelBacking: "claude-sonnet-4-6 · API",
      hosting: "API_BACKED",
      attestation: "CANARY_PROBE",
      tier: "T3",
      status: "ACTIVE",
      lastAction: "Flagged 2 ambiguous Margaret records for cosign",
    },
    {
      carId: "CAR-5C63-ARCHIVIST",
      name: "Archivist",
      role: "Document archival & provenance",
      modelBacking: "claude-sonnet-4-6 · API",
      hosting: "API_BACKED",
      attestation: "CANARY_PROBE",
      tier: "T3",
      status: "ACTIVE",
      lastAction: "Sealed provenance chain for 14 deed images",
    },
    {
      carId: "CAR-0A17-HERALD",
      name: "Herald",
      role: "Family-facing summaries",
      modelBacking: "claude-haiku-4-5 · API",
      hosting: "API_BACKED",
      attestation: "CANARY_PROBE",
      tier: "T1",
      status: "ACTIVE",
      lastAction: "Drafted the Cason descendant summary (held pending merge)",
    },
  ];
  // Stagger lastSeen so the fleet reads as live, not frozen.
  return base.map((a, i) => ({ ...a, lastSeen: iso(-1_000 * (3 + i * 7)) }));
}

// --- the Cason↔Causey hold: a wrong merge with distinguishing evidence ------
const CASON_CAUSEY_PAYLOAD: RecordMergePayload = {
  left: {
    recordId: "rec:cason-elias-1816",
    name: "Elias Cason",
    born: "abt 1816 · Edgefield District, South Carolina",
    died: "1879 · Pike County, Georgia",
    timeline: [
      { year: "1816", place: "Edgefield District, SC", event: "Born; family in St. Paul's Parish" },
      { year: "1838–1849", place: "Edgefield District, SC", event: "Appears on SC state tax rolls every year (continuous)" },
      { year: "1841", place: "Edgefield District, SC", event: "Marries Sarah Holloway" },
      { year: "1852", place: "Pike County, GA", event: "Migrates SC → GA; buys 80 acres on Flint River" },
      { year: "1879", place: "Pike County, GA", event: "Dies; buried at Concord Primitive Baptist" },
    ],
  },
  right: {
    recordId: "rec:causey-elias-1818",
    name: "Elias Causey",
    born: "abt 1818 · Anne Arundel County, Maryland",
    died: "1884 · Upson County, Georgia",
    timeline: [
      { year: "1818", place: "Anne Arundel County, MD", event: "Born; Causey family of West River" },
      { year: "1834", place: "Anne Arundel County, MD", event: "Named in a Maryland chancery record (father's estate)" },
      { year: "1837", place: "Wake County, NC", event: "Maryland detour: sells inherited MD land, settles in NC" },
      { year: "1843", place: "Wake County, NC", event: "Marries Eliza Pratt" },
      { year: "1856", place: "Upson County, GA", event: "Migrates NC → GA; adjacent county to Pike" },
      { year: "1884", place: "Upson County, GA", event: "Dies; buried at Thomaston" },
    ],
  },
  distinguishingEvidence: {
    headline: "Maryland-detour fingerprint — the two lines are in different states at the same time",
    detail:
      "The merge rests on a shared given name (Elias), birth years two apart, and co-location in adjacent Georgia counties by the mid-1850s. But the Causey line carries a Maryland origin and a documented 1834 Anne Arundel chancery record plus an 1837 Wake County, NC deed, while the Cason line sits on continuous Edgefield, SC tax rolls 1838–1849. Two men cannot be in Maryland/North Carolina and South Carolina simultaneously: these are distinct lineages whose paths only converge, coincidentally, in Georgia.",
    divergencePoints: [
      "Birthplace: Edgefield District, SC (Cason) vs Anne Arundel County, MD (Causey)",
      "1834–1837: Causey documented in MD then NC; Cason on continuous SC tax rolls — same years, different states",
      "Spouses differ: Sarah Holloway (Cason) vs Eliza Pratt (Causey)",
      "Surnames are phonetic neighbors, not the same family — no shared record links them before Georgia",
    ],
  },
  proposedConfidence: 0.71,
};

// A genuinely ambiguous near-duplicate — thin evidence both ways. The correct fail-closed
// default when no human acks within the (tightened) TTL is REJECT: don't merge on silence.
const SECONDARY_PAYLOAD: RecordMergePayload = {
  left: {
    recordId: "rec:margaret-cason-1849",
    name: "Margaret Cason",
    born: "abt 1849 · Pike County, Georgia",
    died: null,
    timeline: [
      { year: "1849", place: "Pike County, GA", event: "Born (1850 census, household #112, age 1)" },
      { year: "1870", place: "Pike County, GA", event: "Listed as 'Margaret Cason', age 21, keeping house" },
    ],
  },
  right: {
    recordId: "rec:margaret-cawson-1850",
    name: "Margaret Cawson",
    born: "abt 1850 · Upson County, Georgia",
    died: null,
    timeline: [
      { year: "1850", place: "Upson County, GA", event: "Born (parish baptism, spelled 'Cawson')" },
      { year: "1871", place: "Upson County, GA", event: "Marries; surname recorded 'Cawson'" },
    ],
  },
  distinguishingEvidence: {
    headline: "Ambiguous — evidence is thin both ways; fail closed (don't merge) on no human ack",
    detail:
      "Same era, adjacent counties, a one-letter spelling difference, and no record that links or separates them. There is not enough to merge and not enough to rule it out. With no operator decision inside the window, the safe default is to NOT merge — fail closed.",
    divergencePoints: [
      "Birth county differs by one (Pike vs Upson) — within normal record drift",
      "Spelling Cason vs Cawson — could be the same clerk's variance or two families",
      "No linking record, no separating record — genuinely undecidable from what's attached",
    ],
  },
  proposedConfidence: 0.58,
};

function buildHold(
  id: string,
  agentCarId: string,
  ttlMs: number,
  trigger: string,
  context: string,
  payload: RecordMergePayload,
): CosignRequest {
  const createdAt = new Date();
  return {
    id,
    agentCarId,
    actionType: "RECORD_MERGE",
    actionPayload: payload,
    trigger,
    context,
    status: "PENDING",
    createdAt: createdAt.toISOString(),
    ttlExpiresAt: new Date(createdAt.getTime() + ttlMs).toISOString(),
    decidedAt: null,
    decidedBy: null,
  };
}

// --- the drift money-shot: a model swap on Scribe, caught in weight space ----
function buildScribeDrift(): DriftEvent {
  return {
    id: randomUUID(),
    agentCarId: SCRIBE_CAR_ID,
    ts: new Date().toISOString(),
    method: "WEIGHT_SPACE_ITHETA",
    // Synthetic, illustrative signatures. NOT a real I(θ) — the computation is private-plane.
    expectedSignature: "θ̄-band ⟨0x7f3a…c1⟩ ±2.1°",
    observedSignature: "⟨0x91b8…4e⟩ — outside band",
    divergenceDeg: 14.7,
    actionTaken: "QUARANTINE",
    correlationId: `swap-${randomUUID().slice(0, 8)}`,
  };
}

export class SimulatorSource implements GovernanceSource {
  // Seed holds resolvable by id across invocations; an overlay records decisions made
  // in *this* warm instance so reads reflect them.
  readonly #seeds: ReadonlyMap<string, CosignRequest>;
  readonly #decided = new Map<string, { status: CosignRequest["status"]; by: string | null; at: string }>();
  readonly #fleet: AgentState[];
  #scribeQuarantined = false;

  constructor() {
    const primary = buildHold(
      CASON_CAUSEY_HOLD_ID,
      "CAR-2B11-MATCHER",
      PRIMARY_TTL_MS,
      "BASIS T3 · distinct-lineage evidence above the merge-confidence band → REQUIRE_COSIGN",
      "Matcher proposes merging two “Elias” records co-located in adjacent Georgia counties by the 1850s. Distinct-lineage evidence (the Maryland-origin fingerprint) contradicts identity: the lines are documented in different states in the same years. A merge is hard to reverse.",
      CASON_CAUSEY_PAYLOAD,
    );
    const secondary = buildHold(
      SECONDARY_HOLD_ID,
      "CAR-8B40-DEDUP",
      SECONDARY_TTL_MS,
      "BASIS T3 · ambiguous near-duplicate, evidence below resolution band → REQUIRE_COSIGN (90s window)",
      "Dedup flags two “Margaret” records that may or may not be the same person. The evidence is thin both ways; this hold demonstrates the fail-closed posture — no decision inside the window auto-rejects (does not merge).",
      SECONDARY_PAYLOAD,
    );
    this.#seeds = new Map([
      [primary.id, primary],
      [secondary.id, secondary],
    ]);
    this.#fleet = buildFleet();
  }

  /** Resolve a hold's effective state from the seed + this instance's decisions + TTL. */
  #effective(seed: CosignRequest, now: Date): CosignRequest {
    const decision = this.#decided.get(seed.id);
    if (decision) {
      return { ...seed, status: decision.status, decidedBy: decision.by, decidedAt: decision.at };
    }
    if (now.getTime() > new Date(seed.ttlExpiresAt).getTime()) {
      // Past TTL with no decision — fail-closed: it is effectively a TIMEOUT reject.
      return { ...seed, status: "TIMEOUT" };
    }
    return seed;
  }

  async getFleet(): Promise<AgentState[]> {
    return this.#fleet.map((a) =>
      a.carId === SCRIBE_CAR_ID && this.#scribeQuarantined
        ? { ...a, status: "QUARANTINED", lastAction: "Quarantined — I(θ) divergence 14.7° (model-swap signature)" }
        : a,
    );
  }

  async listPendingHolds(): Promise<CosignRequest[]> {
    // The scripted holds arrive over the realtime stream (watchHolds), so at first paint
    // nothing is open yet — an honest "watching for holds" state. getHold/submitDecision
    // still resolve them by id, so the decision path works across stateless invocations
    // even though no hold is persistently "pending" here. Live mode returns real rows.
    return [];
  }

  async getHold(id: string): Promise<CosignRequest | null> {
    const seed = this.#seeds.get(id);
    return seed ? this.#effective(seed, new Date()) : null;
  }

  watchHolds(onHold: (r: CosignRequest) => void): Unsubscribe {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const open = (id: string, delay: number): void => {
      timers.push(
        setTimeout(() => {
          const seed = this.#seeds.get(id);
          if (seed && !this.#decided.has(id)) onHold({ ...seed });
        }, delay),
      );
    };
    open(CASON_CAUSEY_HOLD_ID, HOLD_PRIMARY_DELAY_MS);
    open(SECONDARY_HOLD_ID, HOLD_SECONDARY_DELAY_MS);
    return () => timers.forEach(clearTimeout);
  }

  watchDrift(onDrift: (e: DriftEvent) => void): Unsubscribe {
    const timer = setTimeout(() => {
      this.#scribeQuarantined = true;
      onDrift(buildScribeDrift());
    }, DRIFT_DELAY_MS);
    return () => clearTimeout(timer);
  }

  async submitDecision(requestId: string, decision: CosignDecision, actor: string): Promise<SubmitResult> {
    const seed = this.#seeds.get(requestId);
    if (!seed) return { ok: false, reason: "unknown-request" };
    const current = this.#effective(seed, new Date());
    if (current.status !== "PENDING") {
      return { ok: false, reason: `hold-not-pending (${current.status.toLowerCase()})` };
    }
    const status = decision === "APPROVE" ? "APPROVED" : "REJECTED";
    this.#decided.set(requestId, { status, by: actor, at: new Date().toISOString() });
    const effect =
      decision === "APPROVE"
        ? "RECORD_MERGE released — the two records are merged into one."
        : "RECORD_MERGE denied — the agent proceeds without merging; the two lineages stay distinct.";
    return { ok: true, effect };
  }

  async sweepExpired(now: Date = new Date()): Promise<SweepResult> {
    const timedOut: CosignRequest[] = [];
    for (const seed of this.#seeds.values()) {
      if (this.#decided.has(seed.id)) continue;
      if (now.getTime() > new Date(seed.ttlExpiresAt).getTime()) {
        const at = now.toISOString();
        this.#decided.set(seed.id, { status: "TIMEOUT", by: "system:ttl-sweeper", at });
        timedOut.push({ ...seed, status: "TIMEOUT", decidedBy: "system:ttl-sweeper", decidedAt: at });
      }
    }
    return { timedOut };
  }
}
