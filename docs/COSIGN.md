# Cosign Intervention Surface

The runtime **human-in-the-loop control plane** for the genealogy fleet — the place an
operator sits, watches, and intervenes. The trace UI (`/`) shows automated control (the
gate, the Red Cell) deciding one run; this surface (`/console`) is the *intervention delta*:
where a held action waits for a human, and where a model swap is caught and quarantined.

Three surfaces, one page:

1. **Cosign queue** — the load-bearing write path. `REQUIRE_COSIGN`-held actions surface
   with full decision context; the operator approves or rejects; the decision routes back
   to the enforcement plane and lands in an append-only audit chain.
2. **Fleet view** — read-only: ten agents, CAR ID, BASIS tier, status, attestation method,
   last action.
3. **Drift → quarantine** — a model-swap detection firing, the agent auto-quarantined.

**Acceptance centerpiece:** the **Cason↔Causey merge refusal** as a live cosign moment — a
human visibly stopping a bad merge — plus a **model-swap caught on Scribe by I(θ)**.

## The crux: the cosign round-trip (the first write path)

The trace UI is read-only. This surface introduces the first *mutation* in the demo stack —
a human decision that releases or rejects a held action. The boundary is drawn tightly:

```
Agent → CogniGate (PEP) → REQUIRE_COSIGN → GovernanceSource.hold → store (PENDING, ttl)
                                                                  → Realtime → Cosign queue → Operator
Operator → decideCosign (Server Action) → audit(intent) → adapter.submitDecision → audit(outcome) → CogniGate → Agent
```

- The client calls the **`decideCosign` Server Action** and nothing else. It never touches
  the adapter, the service-role key, or CogniGate directly.
- The decision **writes to the audit chain and releases/rejects the held action via the
  adapter**. It does **not** mutate BASIS trust scores — any trust effect flows through
  CogniGate/BASIS normally. This preserves the read-only-to-trust-data guarantee.
- Order is deliberate: **audit the intent before acting**, submit, **audit the outcome**.

### Timeout posture: fail-closed, non-negotiable

On TTL expiry with no human decision, the action is **auto-rejected** (`TIMEOUT`) and
audited. For a governance system the only defensible default is deny-if-no-human-acks. Two
mechanisms enforce it:

- **Read-time:** a hold past its TTL reads as `TIMEOUT` immediately (no merge is ever
  released on a stale hold), independent of any cron.
- **Durable backstop:** the TTL sweeper (`/api/governance/sweep`, a Vercel Cron) flips
  expired `PENDING` → `TIMEOUT`, pushes the reject through the adapter, and audits it.

Default TTL is **15 minutes**; tighten per action type (the simulator's secondary hold uses
90s so the expiry is watchable).

## Simulator-first, adapter-swappable

Everything works today on the **simulator** (`GOVERNANCE_SOURCE=simulator`, the default):
zero infrastructure, synthetic and scripted, no bridge to a real agent — safe for public
exposure, and the kill switch. Flipping to live is one env var once two prerequisites land:

| Gate | What it needs | Until then |
|---|---|---|
| **G2** | CogniGate's `REQUIRE_COSIGN` path emits hold events and consumes decisions | `submitDecision` is inert: `{ ok: false, reason: "cognigate-not-wired" }` — never a fabricated approval |
| **G3** | The ASTS sink emits queryable fleet state + the I(θ) divergence signal | No live fleet/drift |

`governance/registry.ts` selects the implementation; `governance/sources/cognigate.ts` is
the live adapter (inert stub); `supabase/` holds the schema, RLS, and grants the live path
persists to.

## Drift detection is method-aware (and the claim has to be true)

Weight-space **I(θ) fingerprinting requires reading the weights**, so it applies **only to
Scribe** — the one self-hosted, open-weight agent. The other nine are API-backed: no weight
access, so they are attested by **canary-probe behavioral checks** (response-signature
divergence on a fixed probe battery), never by I(θ).

This is enforced in the type system, not just the copy: `DriftEvent` is a discriminated
union on `method`. A `WEIGHT_SPACE_ITHETA` event carries `divergenceDeg`; a `CANARY_PROBE`
event carries `behavioralDistance`/`probeCount`. **A canary event cannot assert degrees, and
a weight-space claim cannot attach to an API-backed agent.**

The simulator fires **both** so the distinction is concrete on screen: a weight-space I(θ)
drift on Scribe (the money-shot — "I(θ) caught a model swap" is literally true), then a
canary-probe drift on an API-backed agent (a provider-side swap caught behaviorally, since
there are no weights to read). Both auto-quarantine; each is tagged with the method that is
actually valid for that agent.

## Public-tier-clean

This repo and `axiom-orion` are public. Accordingly:

- **Zero I(θ) internals.** The adapter *consumes and renders* a divergence signal. The
  weight-space computation, aggregation method, and threshold calibration are **not in this
  repo** — they are private-plane. Simulator drift values are synthetic and labeled.
- Links point to public orgs only. No private-plane repo references.
- If the detection method's filing is referenced, it is exactly "provisional filed March
  2026" — no figures, no claim-scope.

## Data model & security (live path)

Four tables: `agents`, `cosign_requests`, `audit_events`, `drift_events`
(`supabase/migrations/0001_*.sql`).

- **`anon` (browser) gets SELECT only** — fleet, PENDING holds, drift. No client
  insert/update/delete anywhere.
- All writes go through Server Actions using the **service-role key, server-side only** —
  absent from the client bundle (enforced by `server-only` import guards).
- **`audit_events` is append-only**: UPDATE/DELETE revoked from every role; inserts
  server-only. The chain hash is `sha256(prev_hash || canonical({id, ts, agent_car_id,
  event_type, actor, payload}))`.
- Realtime is enabled on `cosign_requests`.

### Audit: tamper-evident, not tamper-proof

An in-place edit or deletion of a past row breaks the hash linkage, so tampering is
*detectable*. It is not *prevented* — a holder of write access (the service role) could
rewrite the whole chain. True WORM needs an external ledger. The limitation is named in the
console footer and here, not papered over.

## Verify it

```bash
npm run verify:cosign   # 42 checks, zero infra: round-trip · audit chain · tamper · fail-closed · drift · Zod · honesty
npm run build           # server/client boundaries; server-only keeps the decision path off the client
```

Files: `governance/{types,source,registry,audit}.ts`, `governance/sources/{simulator,cognigate}.ts`,
`app/_actions/cosign.ts`, `app/api/governance/{stream,sweep}/route.ts`, `app/console/page.tsx`,
`components/console/*`, `auth/operator.ts`, `lib/governance-stream.ts`, `scripts/verify-cosign.ts`.
