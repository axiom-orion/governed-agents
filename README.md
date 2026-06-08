# Governed Agents

**Agents that know what they're _not_ allowed to do.**

Give an AI agent real tools and it will take real, irreversible actions — send the
email, write the record, delete the row — sometimes on weak or unverified evidence.
**Governed Agents** puts an explicit **policy gate** in front of every action an
agent proposes: the gate **allows**, **blocks**, or **routes for human approval**
_before_ anything runs, with scored provenance and an auditable, streamed trace of
exactly what happened and why.

**▶ Live demo: [governed-agents.vercel.app](https://governed-agents.vercel.app)** —
land, click **“Watch it block a risky action,”** then edit a policy threshold and
re-run to watch the same action flip from **blocked** to **allowed**. Zero setup;
the agents call a current Claude model server-side.

![Architecture: Researcher → Reasoner → Governance gate → allow / block / needs-approval, streamed as NDJSON to the UI](docs/architecture.svg)

> 🎥 **90-second walkthrough:** _placeholder — add link here._
> <!-- Record a short Loom/YouTube clip (watch-it-block → edit policy → flip → raw trace) and drop the URL above. -->

---

## Why this exists (the thesis)

The interesting problem with agents isn't capability — it's **governance**. An agent
that can act needs a layer that decides, _per action_, whether it's allowed to. That
layer should be:

- **Pre-execution** — checked _before_ the side effect, not flagged after.
- **Explicit** — policy is named rules with thresholds, not vibes baked into a prompt.
- **Grounded** — decisions key off provenance that comes from retrieval, never
  fabricated by the model.
- **Auditable** — every step is an event on a trace you can inspect and replay.

The graph is the vehicle; **governance is the point.**

## See it in 30 seconds

| Try this | What it shows |
|---|---|
| **▶ Watch it block a risky action** | A guided walkthrough narrates, step by step, _why_ an outbound email is blocked: the only source scores 0.55, the rule requires ≥ 0.70, so the action halts before anything is sent. |
| **Edit the threshold → Re-run** | Lower `no-unverified-external-send` below 0.55 and the **same** action flips **BLOCK → ALLOW**. The flip is real: Sample recomputes the gate, Live re-runs the backend with your override. |
| **View raw trace** | The actual streamed `TraceEvent`s, in order, pretty-printed — proof it's a real NDJSON stream, not a canned animation. |
| **Scenario picker** | A spread of governance behaviors: confidence threshold, **PII leak**, and an **irreversible delete** that needs **human approval** (a third decision state). |

## How it works

A run is a small server-side loop — **Researcher → Reasoner → governance gate →
execute / halt / hold** — that emits **one `TraceEvent` per line (NDJSON)**, flushed
as each step completes. The browser parses it incrementally, validates every line,
projects it to a node/edge graph, and renders. The gate
([`lib/governance.ts`](lib/governance.ts)) is a pure, synchronous function, so its
decisions are deterministic and testable without a browser.

**Full data flow, transport, and the event schema:**
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

```ts
// the wire format (lib/trace-events.ts)
type TraceEvent =
  | { type: "run_started";       runId: string; task: string; at: string }
  | { type: "step_started";      stepId: string; role: AgentRole; at: string }
  | { type: "step_completed";    stepId: string; role: AgentRole; summary: string; provenance: Provenance[]; at: string }
  | { type: "action_proposed";   stepId: string; action: ProposedAction; at: string }
  | { type: "gate_decision";     stepId: string; decision: PolicyDecision; at: string }
  | { type: "executed";          stepId: string; result: string; at: string }   // allow
  | { type: "halted";            stepId: string; reason: string; at: string }   // block
  | { type: "awaiting_approval"; stepId: string; reason: string; at: string }   // needs-approval
  | { type: "run_completed";     runId: string; at: string }
  | { type: "error";             message: string; at: string };
```

## The policy

`evaluatePolicy(action, rules)` resolves a three-tier outcome — a hard **block**
beats a **review** request beats **allow**:

| Rule | Applies to | Decides |
|---|---|---|
| `require-provenance` | every action | **block** if no supporting sources |
| `no-unverified-external-send` | outbound `send_email` | **block** unless some source ≥ the confidence threshold (default **0.70**, editable in the UI) |
| `no-pii-in-external-output` | outbound `send_email` | **block** if the payload contains personal data (SSN / card / phone) |
| `destructive-action-needs-approval` | `delete_record` / destructive kinds | **needs-approval** unless an approval token is attached |
| `require-model-consensus` | multi-model (triad) runs | **needs-approval** when model agreement falls below the threshold (default unanimous) |

The thresholds are genuinely editable: they flow to the **Live** backend in the
request body, and the **Sample** replay **recomputes** the gate
([`lib/policy-replay.ts`](lib/policy-replay.ts)) rather than replaying a baked-in
decision — so the flip is real on both paths.

### Model consensus (the triad)

The Reasoner step can be decided by a **triad** — Claude + Gemini + Grok — voting on
the action ([`lib/consensus.ts`](lib/consensus.ts), [`lib/providers.ts`](lib/providers.ts)).
Each model proposes independently; if they don't agree, `require-model-consensus`
holds the run for a human instead of acting on a split decision. A provider with no
key simply **abstains**, so it degrades gracefully to a single model. Set
`GEMINI_API_KEY` + `XAI_API_KEY` to light up Live; the *“model triad agrees / splits”*
Sample scenarios demo it with zero keys.

## Quickstart

```bash
npm install
cp .env.example .env.local   # optional — ANTHROPIC_API_KEY for live models; omit to use the offline stub
npm run dev                  # http://localhost:3000

# headless / CI
npm run typecheck            # strict TS, no `any`
npm run check:model          # verify the configured Claude model ids are current
npx tsx scripts/verify-trace.ts   # projection + parser + policy-flip contract (52 checks)
AGENTS_OFFLINE=1 npm run demo     # run the seed tasks and print the stream (allow + block)
```

With no `ANTHROPIC_API_KEY` the loop uses a deterministic **offline stub**, so it
runs end-to-end with zero setup; set the key (server-only) for live Claude calls.
Models (override via env): Researcher `claude-haiku-4-5`, Reasoner
`claude-sonnet-4-6`, Executor `claude-haiku-4-5`.

## Tech stack

Next.js 15 (App Router) · React 19 · TypeScript (strict, `noUncheckedIndexedAccess`,
no `any`) · Tailwind CSS · React Flow (`@xyflow/react`) · `@anthropic-ai/sdk`
server-side, with Gemini + Grok over guarded REST for the consensus triad · deployed
on Vercel.

## Design decisions & tradeoffs

- **NDJSON, not SSE.** One JSON object per line streams incrementally with zero
  framing overhead and is trivial to validate line-by-line. The parser stays
  resilient to truncation and noise (there's a “Inject malformed lines” toggle that
  proves bad lines are skipped, not fatal).
- **The UI is a pure projection of the event log.** All logic lives in
  `lib/trace-model.ts` (`TraceEvent[] → {nodes, edges, status}`); React just renders
  it. That's why Live and Sample render through the _same_ code, and why a headless
  script can contract-test the whole projection without a browser.
- **Provenance is grounded in retrieval, never the model.** The Reasoner proposes an
  action but the scores attached to it come from the retriever — so the gate can
  trust them. The model is explicitly told _not_ to self-police; the gate does.
- **The gate is pure and synchronous.** Decisions are deterministic and unit-testable,
  and the same `evaluatePolicy` powers Live, the Sample recompute, and CI.
- **Sample recomputes, it doesn't replay.** Making the editable-policy flip _real_ on
  the recorded path meant re-running the gate over the fixture's proposed action
  instead of replaying its baked-in decision — otherwise editing a rule would be
  theater.
- **Cold start is a UX problem, not just an infra one.** A serverless first hit can
  5xx while booting; the client treats that as a “warming” state and auto-retries
  before consuming the stream, and pre-warms with a cheap `GET`, so a reviewer's
  first click never looks broken.

## What I'd build next

- **Human-in-the-loop approval that resolves** — an approve/deny affordance on the
  `needs_approval` state that continues the run (the third state currently parks).
- **Policy as data** — load rules/thresholds from a versioned config or small DSL,
  with per-rule provenance requirements, instead of code.
- **An eval harness** — a labeled set of (task → expected decision) cases run in CI to
  catch policy regressions, with precision/recall on block decisions.
- **Durable audit log** — persist every `gate_decision` (who/what/why/when) to a real
  store, queryable and exportable, rather than living only in the stream.
- **More gate types** — rate limits, spend caps, recipient allowlists, and
  data-residency rules, composed into named policy bundles.

## Project layout

```
app/api/run/route.ts   POST /api/run — streams NDJSON; optional policy override
lib/loop.ts            the orchestrator: Researcher → Reasoner → gate → execute/halt/hold
lib/agents.ts          the three agents (provenance grounded in retrieval)
lib/governance.ts      the gate: types, evaluatePolicy(), the policy rules  ← the thesis
lib/policy-replay.ts   recomputes the gate over a recorded run (real flips on Sample)
lib/trace-events.ts    the TraceEvent wire format (NDJSON)
lib/ndjson.ts          incremental parser + runtime validation (skips malformed lines)
lib/trace-model.ts     pure projection TraceEvent[] → nodes/edges/status
components/            React Flow canvas + hero + guided walkthrough + audit panels
mocks/trace.sample.ts  recorded runs for the instant Sample mode
scripts/verify-trace.ts headless contract test (CI)
docs/ARCHITECTURE.md   data flow + full event schema
```

## About

Built by **[axiom-orion](https://github.com/axiom-orion)** as a portfolio project
exploring agent governance. Source:
**[github.com/axiom-orion/governed-agents](https://github.com/axiom-orion/governed-agents)**.
The deployed app links back to this repo and to the architecture docs from its header.

## License

[MIT](LICENSE).
