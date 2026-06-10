# Architecture & event schema

> How a governed run actually works end to end, and the exact wire format the UI
> renders from. If a value isn't in the stream, the UI doesn't show it.

## One run, end to end

```
                          POST /api/run  { taskId | task }
                                   │
        ┌──────────────────────────┴───────────────────────────┐
        │                  server-side agent loop               │
        │                                                       │
        │   Researcher ──▶ Reasoner ──▶  Governance gate  ──▶   │
        │   (retrieve +    (propose ONE   evaluatePolicy()      │
        │    summarize)     action)    allow/block/needs-approval│
        │       │             │               │                 │
        │   provenance     ProposedAction      ▼                │
        │   (scored 0–1)   (+ provenance)  allow → Executor runs │
        │                                  block → Halt          │
        │                                  needs-approval → Hold │
        └───────────────────────────────┬───────────────────────┘
                                         │  one TraceEvent per line (NDJSON)
                                         ▼
                       browser: incremental parse + validate
                       → project to nodes/edges → React Flow + panels
```

The **governance gate** is the thesis: every action an agent proposes is checked
against explicit policy **before** the Executor can run. The gate is a pure,
synchronous function (`lib/governance.ts`), so its decisions are deterministic and
auditable.

## Transport

- **`POST /api/run`** streams **newline-delimited JSON (NDJSON)** — `content-type:
  application/x-ndjson`. One `TraceEvent` per line, flushed **as each step
  completes** (not buffered). Not SSE; there is no `data:` framing.
- Request body: `{ "taskId": "<seed id>" }` or `{ "task": "<free text>" }`. An
  optional `{ "policy": { "externalSendThreshold": number } }` overrides the gate's
  confidence threshold for that run (see [The gate](#the-gate)).
- `GET /api/run` returns a small self-describing JSON (endpoint + seed tasks) and
  doubles as a cheap keep-warm ping for the serverless function.
- The browser parses incrementally (`lib/ndjson.ts`) and **validates every line**
  against the schema below; anything that isn't a well-formed `TraceEvent` is
  skipped and counted, never thrown.

## `TraceEvent` schema (the wire format)

`lib/trace-events.ts` — a discriminated union on `type`. Every event carries an
ISO-8601 `at`.

| `type` | Fields | Emitted |
|---|---|---|
| `run_started` | `runId`, `task` | once, first |
| `step_started` | `stepId`, `role` | per agent step |
| `step_completed` | `stepId`, `role`, `summary`, `provenance[]` | per agent step |
| `action_proposed` | `stepId`, `action` | after the Reasoner |
| `gate_decision` | `stepId`, `decision` | after the gate |
| `executed` | `stepId`, `result` | allow path only |
| `halted` | `stepId`, `reason` | block path only |
| `awaiting_approval` | `stepId`, `reason` | needs-approval path only |
| `run_completed` | `runId` | once, last |
| `error` | `message` | on any thrown failure |

`role` ∈ `researcher | reasoner | executor`.

### Referenced shapes (`lib/governance.ts`)

```ts
Provenance      = { sourceId: string; snippet: string; score: number /* [0,1] */ }
ProposedAction  = { kind: string; payload: Record<string, unknown>;
                    justification: string; provenance: Provenance[] }
PolicyViolation = { rule: string; detail: string; severity?: "block" | "review" }
Decision        = "allow" | "block" | "needs_approval"
PolicyDecision  = { decision: Decision; violations: PolicyViolation[]; evaluatedAt: string }
```

### Event order

- **allow** — `run_started → step_started(researcher) → step_completed(researcher)
  → step_started(reasoner) → step_completed(reasoner) → action_proposed →
  gate_decision(allow) → step_started(executor) → executed →
  step_completed(executor) → run_completed`
- **block** — `… → action_proposed → gate_decision(block) → halted →
  run_completed` (the Executor never starts)
- **needs-approval** — `… → action_proposed → gate_decision(needs_approval) →
  awaiting_approval → run_completed` (parked for a human; the Executor never starts)
- any thrown error → a single `error` event, then `run_completed`.

## Cold start

`POST /api/run` runs on a Node serverless function. A first hit can return a
transient 5xx (or simply be slow) while the function boots. The client
(`lib/useTraceStream.ts`) treats retryable statuses and network blips as a
**"warming"** state and auto-retries with backoff **before** it starts consuming
the stream, so the first Live click never surfaces a raw error. The UI also fires a
cheap `GET /api/run` on mount to pre-warm the function. The **Sample** replay path
is fully client-side and therefore instant.

## Retrieval & provenance

Provenance is **grounded in retrieval, never fabricated by the model** — that's what
lets the gate trust the scores. The default retriever is a bundled in-memory corpus
(`lib/corpus.ts`, deterministic keyword scoring in `[0,1]`); setting
`MEMORY_SERVICE_URL` routes retrieval to a live memory service with local fallback.

## The gate

Rules live in `lib/governance.ts`. A rule returns a `PolicyViolation` (or `null`).
`evaluatePolicy(action, rules)` resolves the tier: a hard **block** beats a
**review** request, which beats **allow** — so `block` if any block-severity
violation, else `needs_approval` if any review-severity one, else `allow`.
Thresholds are explicit:

| Rule | Applies to | Decides |
|---|---|---|
| `require-provenance` | every action | **block** if no supporting sources |
| `no-unverified-external-send` | outbound `send_email` | **block** unless some source ≥ the confidence threshold (default **0.70**) |
| `no-pii-in-external-output` | outbound `send_email` | **block** if the payload contains personal data (SSN / card / phone) |
| `destructive-action-needs-approval` | `delete_record` / destructive kinds | **needs-approval** unless an approval token is attached |
| `require-model-consensus` | multi-model (triad) runs | **needs-approval** when model agreement falls below the threshold (default **100%**, unanimous) |
| `require-distinct-voices` | multi-model (triad) runs | **needs-approval** when agreeing votes resolve to < 2 distinct attested instances (`minDistinctVoices`) |
| `red-cell-independence` | red-cell-reviewed actions | **needs-approval** when reviewer ≡ generator, or the generator is unattested |
| `red-cell-objection` | red-cell-reviewed actions | **needs-approval** when the adversarial reviewer objects (critique attached) |

The third state (`needs_approval`) models human-in-the-loop: the run parks at an
**Awaiting approval** node instead of executing or hard-failing.

### Attested voices + the Red Cell

Every `ModelVote` carries a `voice: { provider, model }` — the attested identity the
vote was cast under — and `Consensus.distinctVoices` counts the distinct instances
behind the chosen kind; `ProposedAction.proposedBy` attests the generator. After the
Reasoner, when a review-capable instance distinct from the generator exists,
`lib/redcell.ts` attaches a `redCell: { verdict, critique, voice }` adversarial
review to the action; the three rules above make independence *checked*, not assumed.
All additive/optional — legacy traces parse unchanged, and `distinctVoices` falls back
to provider labels when voices are absent. Scope honesty: a voice attests the
configured `(provider, model id)` that was called; it cannot attest a provider's
internal routing. Headless verification: `npx tsx scripts/verify-governance.ts`
(32 checks: echo-collapse review, voice-collapse review, objection routing, plus a
deterministic offline two-voter loop end to end).

### Model consensus (the triad)

The Reasoner step can be decided by a **triad of models** — Claude (`@anthropic-ai/sdk`)
plus Gemini and Grok via guarded `fetch` (`lib/providers.ts`), behind one
`ActionProposer` seam. `lib/consensus.ts` runs the available models in parallel,
records each one's vote, and attaches a `consensus` (`{ votes, agreementRatio,
chosenKind }`) to the proposed action; `aggregateVotes` is pure and ties break
toward the primary. A provider with no key — or a failed call — **abstains** rather
than failing the run, so the triad degrades gracefully to a single model (the
offline/CI path stays deterministic with one voter). The `require-model-consensus`
rule then holds a split decision for a human, with the agreement threshold editable
from the UI just like the send-confidence one (`consensusThreshold`).

### Editable policy (the threshold is real, not cosmetic)

`buildPolicy({ externalSendThreshold, consensusThreshold })` assembles the rule set
with tunable thresholds (via `makeNoUnverifiedExternalSend` and
`makeRequireModelConsensus`). The UI's Policies panel edits either threshold and
re-runs:

- **Live** — the threshold is sent in the request body and `runLoop` evaluates the
  real gate with it.
- **Sample** — `lib/policy-replay.ts` keeps the recorded events up to the proposed
  action, then **re-runs `evaluatePolicy()`** over that action with the edited
  threshold and regenerates the tail (gate → execute | halt). The fixture's
  baked-in decision is never replayed.

Either way, lowering the threshold below a source's score flips a previously-blocked
send to allow — the executor then runs. `scripts/verify-trace.ts` asserts the flip
at the 0.55 boundary.

## Why NDJSON + pure projection

- **NDJSON** streams incrementally with zero framing overhead and is trivial to
  validate line-by-line — the parser stays resilient to truncation and noise.
- **Pure projection** (`lib/trace-model.ts`, `TraceEvent[] → {nodes, edges,
  status}`) keeps all business logic out of React: the UI is a deterministic
  function of the event log, which is why the same code renders Live and Sample
  identically and why headless contract tests (`scripts/verify-trace.ts`) can
  cover it without a browser.
