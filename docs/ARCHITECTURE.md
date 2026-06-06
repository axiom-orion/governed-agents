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
        │    summarize)     action)        allow / block        │
        │       │             │               │                 │
        │   provenance     ProposedAction      ▼                │
        │   (scored 0–1)   (+ provenance)  allow → Executor runs │
        │                                  block → Halt          │
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
- Request body: `{ "taskId": "<seed id>" }` or `{ "task": "<free text>" }`.
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
| `run_completed` | `runId` | once, last |
| `error` | `message` | on any thrown failure |

`role` ∈ `researcher | reasoner | executor`.

### Referenced shapes (`lib/governance.ts`)

```ts
Provenance      = { sourceId: string; snippet: string; score: number /* [0,1] */ }
ProposedAction  = { kind: string; payload: Record<string, unknown>;
                    justification: string; provenance: Provenance[] }
PolicyViolation = { rule: string; detail: string }
Decision        = "allow" | "block"
PolicyDecision  = { decision: Decision; violations: PolicyViolation[]; evaluatedAt: string }
```

### Event order

- **allow** — `run_started → step_started(researcher) → step_completed(researcher)
  → step_started(reasoner) → step_completed(reasoner) → action_proposed →
  gate_decision(allow) → step_started(executor) → executed →
  step_completed(executor) → run_completed`
- **block** — `… → action_proposed → gate_decision(block) → halted →
  run_completed` (the Executor never starts)
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

Rules live in `lib/governance.ts`. `evaluatePolicy(action, rules)` returns `block`
if **any** rule reports a violation, else `allow`. Thresholds are explicit:

| Rule | Applies to | Decides |
|---|---|---|
| `require-provenance` | every action | block if no supporting sources |
| `no-unverified-external-send` | outbound `send_email` | block unless some source ≥ the confidence threshold (default **0.70**) |

## Why NDJSON + pure projection

- **NDJSON** streams incrementally with zero framing overhead and is trivial to
  validate line-by-line — the parser stays resilient to truncation and noise.
- **Pure projection** (`lib/trace-model.ts`, `TraceEvent[] → {nodes, edges,
  status}`) keeps all business logic out of React: the UI is a deterministic
  function of the event log, which is why the same code renders Live and Sample
  identically and why headless contract tests (`scripts/verify-trace.ts`) can
  cover it without a browser.
