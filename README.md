# governed-agents

A governed multi-agent flow — **Researcher → Reasoner → governance gate → execute/halt** — with a
trace UI that renders a run **purely from the `TraceEvent` stream**. The differentiator is the
pre-action **governance gate**: agents propose actions; the gate ALLOWS or BLOCKS each one against an
explicit policy, and every decision is auditable.

## Contracts (frozen)

- `lib/governance.ts` — C1: `AgentRole`, `Provenance`, `ProposedAction`, `PolicyDecision`,
  `PolicyViolation`, `evaluatePolicy()`, and an example policy set. **Owned by the loop; do not modify here.**
- `lib/trace-events.ts` — C2: the `TraceEvent` discriminated union (the NDJSON wire format).

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
npm run typecheck     # tsc --noEmit — strict, no `any`
npm run check:model   # asserts both allow + block paths project correctly and malformed lines are skipped
npm run dev           # http://localhost:3000
```
