# governed-agents

A governed multi-agent flow — **Researcher → Reasoner → governance gate → execute/halt** — with a
trace UI that renders a run **purely from the `TraceEvent` stream**. The differentiator is the
pre-action **governance gate**: agents propose actions; the gate ALLOWS or BLOCKS each one against an
explicit policy, and every decision is auditable.

## Contracts (frozen)

- `lib/governance.ts` — C1: `AgentRole`, `Provenance`, `ProposedAction`, `PolicyDecision`,
  `PolicyViolation`, `evaluatePolicy()`, and an example policy set. **Owned by the loop; do not modify here.**
- `lib/trace-events.ts` — C2: the `TraceEvent` discriminated union (the NDJSON wire format).

## The loop (P3 — runnable core)

`Researcher → Reasoner → governance gate → execute-or-halt`, emitting one `TraceEvent` per line over a
streamed Route Handler. Self-contained by default — no backend and no API key required.

| File | Role |
|---|---|
| `lib/corpus.ts` | Bundled synthetic corpus + `localRecall` (deterministic keyword retrieval). |
| `lib/recall.ts` | Retrieval dispatcher: local corpus by default; `MEMORY_SERVICE_URL` routes to a live C3 `POST /recall`, with local fallback. |
| `lib/model-client.ts` | Typed Claude client (Haiku/Sonnet tier) + forced tool-use for the Reasoner's `ProposedAction`. Falls back to a deterministic offline stub when no key is set. |
| `lib/agents.ts` | The three agents. Provenance is grounded in retrieval, never fabricated by the model — so the gate can trust it. |
| `lib/loop.ts` | The orchestrator: yields `TraceEvent`s; the executor runs **only** when `evaluatePolicy()` returns `"allow"`. |
| `lib/tasks.ts` | Two seed tasks — one ALLOWED, one BLOCKED. |
| `app/api/run/route.ts` | `POST /api/run` — streams NDJSON incrementally. `maxDuration` raised; Anthropic key is server-only. |
| `scripts/run.ts` | No-UI harness that prints the event stream end-to-end. |

**Models** (Haiku/Sonnet tier, override via env): Researcher `claude-haiku-4-5`, Reasoner
`claude-sonnet-4-6`, Executor `claude-haiku-4-5`.

**The gate doing real work:** the `allowed` task proposes an internal `write_record` backed by a
high-confidence source → **allow**, executor runs. The `blocked` task proposes an outbound `send_email`
whose sources are all below the 0.7 confidence threshold → **block** (`no-unverified-external-send`),
executor never runs.

## Trace UI (this branch — P4)

Rendered **only** from the `TraceEvent` stream; no business logic, no fabricated metrics. If a value
isn't in the stream, it isn't displayed.

| File | Role |
|---|---|
| `lib/ndjson.ts` | Incremental NDJSON parser + runtime `TraceEvent` validation; malformed lines are skipped. |
| `lib/trace-model.ts` | Pure projection `TraceEvent[]` → nodes/edges/run status (no React, no policy logic). |
| `lib/useTraceStream.ts` | React hook: consumes `/api/run` (or a mock stream) and exposes the live model. |
| `mocks/trace.sample.ts` | Hard-coded allow run + block run, plus an NDJSON builder with injected malformed lines. |
| `components/TraceCanvas.tsx` | React Flow: one node per step, edges = handoffs, gate node green=allow / red=block. |
| `components/panels/ProvenancePanel.tsx` | Sources for the selected step: `sourceId`, `snippet`, `score`. |
| `components/panels/GateDecision.tsx` | The gate `decision` and, on block, each `PolicyViolation`. |
| `components/TraceViewer.tsx` | Wires the hook + canvas + panels; lets you replay the allow / block run. |

Until P5 integration, the UI is driven by `mocks/trace.sample.ts`. `useTraceStream` already parses NDJSON
incrementally, so swapping in the live `/api/run` stream is a one-line change.

## Develop

```bash
npm install
cp .env.example .env.local   # optional — ANTHROPIC_API_KEY for live models; omit to use the offline stub
npm run typecheck            # tsc --noEmit — strict, no `any`
npm run check:model          # verify the configured Claude model ids are current
npm run demo                 # run both seed tasks (allowed + blocked) and print the stream
npm run demo:allow           # just the allowed task   (npm run demo:block for the blocked one)
npm run dev                  # P3 landing + POST /api/run at http://localhost:3000 ; P4 UI at /trace
```

With no `ANTHROPIC_API_KEY`, the loop uses a deterministic offline stub so it runs end-to-end with
zero setup; set the key (server-only) for live Claude calls.
