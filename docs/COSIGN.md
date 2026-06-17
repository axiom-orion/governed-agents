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

## Simulator-first, adapter-swappable — and the live path is wired

The default is the **simulator** (`GOVERNANCE_SOURCE=simulator`): zero infrastructure,
synthetic and scripted, no bridge to a real agent — safe for public exposure, and the kill
switch. Set `GOVERNANCE_SOURCE=cognigate` (+ the Supabase env vars) and the console runs
against Postgres instead.

**Supabase is the seam.** The public console only ever talks to Supabase; the private
CogniGate/ASTS side reads and writes the *same* tables. So no CogniGate endpoint and no I(θ)
internals live in this repo — the adapter only moves rows that match the public contract.

```
              ┌─────────── public repo (this) ───────────┐   ┌──── private plane ────┐
  Operator ── │ console → decideCosign → Supabase tables  │ ⇄ │ CogniGate consumes the │
              │ console ← stream/RSC  ← Supabase tables    │   │ decision row; ASTS     │
              └───────────────────────────────────────────┘   │ writes fleet + drift   │
                                                               └────────────────────────┘
```

`governance/sources/cognigate.ts` is the live adapter: reads (`getFleet`,
`listPendingHolds`, `getHold`, `listRecentDrift`) and Realtime subscriptions come from
Supabase; `submitDecision` and `sweepExpired` write to it; the Truth Chain persists to
`audit_events`. If the Supabase env isn't set it stays **inert** —
`{ ok: false, reason: "cognigate-not-configured" }`, never a fabricated approval.

What still belongs to the private plane (not this repo):

| Gate | The private-plane half | Effect if absent |
|---|---|---|
| **G2** | CogniGate's `REQUIRE_COSIGN` path *parks holds into* and *consumes decisions from* the shared tables | Decisions persist + audit, but no real agent acts on the release/reject |
| **G3** | The ASTS sink *writes* fleet state + the I(θ) divergence signal into the shared tables | Fleet/drift only reflect what's been seeded, not live agents |

Both halves meet at the four Supabase tables — neither side imports the other's code.

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
- **`audit_events` is append-only**: UPDATE/DELETE revoked from *every* role including
  `service_role` (verified on the live project — the app role can `INSERT`/`SELECT` only);
  the chain hash is `sha256(prev_hash || canonical({id, ts, agent_car_id, event_type, actor,
  payload}))`.
- Realtime is enabled on `cosign_requests` and `drift_events`.

### Audit: tamper-evident, not tamper-proof

An in-place edit or deletion of a past row breaks the hash linkage, so tampering is
*detectable*. It is not *prevented* — a holder of write access (the service role) could
rewrite the whole chain. True WORM needs an external ledger. The limitation is named in the
console footer and here, not papered over.

## Run the live path

```bash
# server-side only (set in Vercel → Environment Variables, or .env.local for local runs)
GOVERNANCE_SOURCE=cognigate
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role key, from the Supabase dashboard>
OPERATOR_ID=<your operator id>          # live mode refuses decisions without one
CRON_SECRET=<random>                    # the TTL sweeper requires it in live mode
```

Apply `supabase/migrations/0001_*.sql` then `supabase/seed.sql` to a project (a dedicated
one — don't mix the tables into an existing app's `public` schema). The default deployment
stays on the simulator (free, public-safe); cognigate mode is opt-in per environment.

## Verify it

```bash
npm run verify:cosign   # 42 checks, zero infra: round-trip · audit chain · tamper · fail-closed · drift · Zod · honesty
npm run build           # server/client boundaries; server-only keeps the decision path off the client
```

The live read path + RLS were verified against a real project: reads map and Zod-validate
(10 agents, both holds, both drift methods), and `anon` is denied UPDATE/INSERT and is blind
to `audit_events` (Postgres `42501`).

Files: `governance/{types,source,registry,audit}.ts`, `governance/sources/{simulator,cognigate}.ts`,
`app/_actions/cosign.ts`, `app/api/governance/{stream,sweep}/route.ts`, `app/console/page.tsx`,
`components/console/*`, `auth/operator.ts`, `lib/governance-stream.ts`, `scripts/verify-cosign.ts`.
