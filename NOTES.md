# NOTES — codebase recon (Step 0)

> Map of the existing **governed-agents** app, written before any feature work so the
> tracks below build on what's actually in the code (not the handoff's outside
> observations). Anything the handoff inferred from the live UI is reconciled against
> source here. Keep this file updated as tracks land.

## TL;DR for the handoff

- **It's real.** `POST /api/run` runs a server-side Researcher→Reasoner→gate→Executor/Halt
  loop and streams one `TraceEvent` per line (NDJSON, not SSE). The browser parses it
  incrementally. The gate is a pure function that ALLOWs/BLOCKs the proposed action before
  the Executor ever runs.
- **One important correction to the handoff's "ground truth":** the polished allowed/blocked
  examples it observed (onboarding-policy `0.92`, vendor-call note `0.55`) are the **Sample**
  (recorded replay) fixtures in `mocks/trace.sample.ts`. The **Live** path runs *different*
  seed tasks (`lib/tasks.ts`: a refund-policy record and a `partner-success@acme-partner.example`
  email) and produces `mem-N` provenance from a keyword retriever. Live and Sample are **not the
  same content today.** This is fine and even useful, but every track has to be clear about
  which path it's touching.
- **Gate threshold is `0.7`, hard-coded** inside the `no-unverified-external-send` rule
  (`p.score >= 0.7`). There is no global threshold and no config object yet — Track 3 has to
  introduce one.
- **Sample gate decisions are baked into the fixture**, not recomputed. To make Track 3's
  "edit a rule → decision flips" real, the replay path must **re-run `evaluatePolicy()`** over
  the fixture's proposed action with the edited threshold, instead of replaying the recorded
  `gate_decision`/`halted` events verbatim.

---

## 1. Framework, tooling, conventions

| Aspect | Value |
|---|---|
| Framework | **Next.js 15.1** (`^15.1.6`), **App Router** (`app/`), React **19** |
| Language | TypeScript **5.7**, `strict` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` + `isolatedModules`. **No `any` anywhere.** |
| Styling | **Tailwind CSS 3.4** (utility classes inline; no CSS modules). Enterprise slate/emerald/red palette. |
| Graph | **React Flow** = `@xyflow/react` **v12.3** |
| LLM | `@anthropic-ai/sdk` `^0.100`, server-only key |
| Path alias | `@/*` → repo root (`tsconfig.json`) |
| Module style | ESM, `import type` required for types (verbatimModuleSyntax) |
| Node | v22 (CI `node-version: "22"`) |

**Conventions to match:** file-top comment block describing the file's role; readonly-heavy
interfaces; pure/sync helpers split from React; runtime type guards before trusting any
external data; functions return typed shapes, never `any`; Tailwind classes composed via
string concatenation or `[...].join(" ")`.

### Routes / components
```
app/layout.tsx            Root layout, metadata, slate body
app/page.tsx              "/"        → <TraceViewer/>           (promoted from /trace at "P5")
app/trace/page.tsx        "/trace"   → <TraceViewer/>           (same component, legacy entry)
app/api/run/route.ts      "POST /api/run" streaming route handler

components/TraceViewer.tsx           top-level client UI: header controls + canvas + panels
components/TraceCanvas.tsx           React Flow render of nodes/edges
components/panels/GateDecision.tsx   gate decision + violations (selected step)
components/panels/ProvenancePanel.tsx provenance rows (sourceId / snippet / score + bar)

lib/governance.ts    C1 contract: types + evaluatePolicy() + the policy rules  ← gate lives here
lib/trace-events.ts  C2 contract: the TraceEvent discriminated union (wire format)
lib/trace-model.ts   pure projection TraceEvent[] → {nodes, edges, status} + selection helpers
lib/loop.ts          the orchestrator generator (yields TraceEvents)
lib/agents.ts        runResearcher / runReasoner / runExecutor
lib/model-client.ts  Anthropic client + forced tool-use + OFFLINE deterministic stub
lib/recall.ts        retrieval dispatcher (local corpus, or remote MEMORY_SERVICE_URL)
lib/corpus.ts        bundled synthetic corpus + localRecall keyword scorer
lib/tasks.ts         SEED_TASKS: "allowed" + "blocked" (LIVE path)
lib/ndjson.ts        incremental NDJSON parser + runtime TraceEvent validator
lib/useTraceStream.ts React hook: source → parsed events → TraceModel
mocks/trace.sample.ts Recorded allow/block runs + malformed-line injector (SAMPLE path)

scripts/run.ts          CLI harness: runs the loop, prints NDJSON (npm run demo[:allow|:block])
scripts/verify-trace.ts headless contract test for the projection + parser  ← CI gate
scripts/check-model.ts  asserts configured model ids are current             ← CI gate
```

---

## 2. `/api/run` — how it streams, and the exact event shapes

**Transport:** **NDJSON** — `content-type: application/x-ndjson`, `cache-control: no-cache,
no-transform`, `x-accel-buffering: no`. Each `TraceEvent` is `JSON.stringify`'d + `"\n"` and
`controller.enqueue`'d **as each loop step completes** (incremental, not buffered). `runtime =
"nodejs"`, `dynamic = "force-dynamic"`, `maxDuration = 60`. Not SSE, no `data:` framing.

**Request body:** `{ taskId?: string }` (one of the seed ids) **or** `{ task?: string }`
(free text). The UI sends `{ taskId: "allowed" | "blocked" }`. `GET /api/run` returns a small
self-describing JSON (endpoint + seed task list).

**Event schema** (`lib/trace-events.ts` — frozen C2 union). One per line, in this order for a
normal run:

```ts
| { type: "run_started";   runId: string; task: string; at: string }
| { type: "step_started";  stepId: string; role: AgentRole; at: string }
| { type: "step_completed";stepId: string; role: AgentRole; summary: string; provenance: Provenance[]; at: string }
| { type: "action_proposed";stepId: string; action: ProposedAction; at: string }
| { type: "gate_decision"; stepId: string; decision: PolicyDecision; at: string }
| { type: "executed";      stepId: string; result: string; at: string }     // allow path only
| { type: "halted";        stepId: string; reason: string; at: string }     // block path only
| { type: "run_completed"; runId: string; at: string }
| { type: "error";         message: string; at: string }
```
`AgentRole = "researcher" | "reasoner" | "executor"`. `at` is ISO-8601.

Referenced sub-shapes (`lib/governance.ts`):
```ts
Provenance      = { sourceId: string; snippet: string; score: number /* [0,1] */ }
ProposedAction  = { kind: string; payload: Record<string, unknown>; justification: string; provenance: Provenance[] }
PolicyViolation = { rule: string; detail: string }
PolicyDecision  = { decision: "allow" | "block"; violations: PolicyViolation[]; evaluatedAt: string }
```

**Sequence:**
- allow: `run_started → step_started(researcher) → step_completed(researcher) → step_started(reasoner) → step_completed(reasoner) → action_proposed → gate_decision(allow) → step_started(executor) → executed → step_completed(executor) → run_completed`
- block: `… → action_proposed → gate_decision(block) → halted → run_completed` (executor never starts)
- any throw inside the loop → a single `error` event, then `run_completed`.

---

## 3. The gate — where policy lives and how it decides

**File:** `lib/governance.ts` (marked a "frozen C1 contract — owned by the loop").

**Engine:** `evaluatePolicy(action, rules)` is **pure + synchronous**. It maps every rule over
the action, keeps the non-null violations, and returns
`{ decision: violations.length === 0 ? "allow" : "block", violations, evaluatedAt }`.
**Block-if-any-violation.** A `PolicyRule` is `{ name, evaluate(action): PolicyViolation | null }`.

**Rules shipped (the active `defaultPolicy` = both):**
| Rule id | Logic | Threshold |
|---|---|---|
| `require-provenance` | violates if `action.provenance.length === 0` | n/a (presence) |
| `no-unverified-external-send` | only applies when `action.kind === "send_email"` **and** `payload.to` is non-empty; violates unless **some** provenance `score >= 0.7` | **`0.7`, hard-coded in the closure** |

So: thresholds are **per-rule and embedded**, there is **no global threshold and no config
object**. Track 3 must introduce a configurable threshold (cleanest: a rule *factory*
`makeNoUnverifiedExternalSend(threshold = 0.7)` so the existing `noUnverifiedExternalSend`
export stays valid and CI/verify-trace keep passing).

**Scores are normalized [0,1]:**
- `localRecall` (corpus): `score = matchedKeywords / entry.keywords.length`, rounded to 2dp.
- `scoreRemote` (memory service): `importance / maxImportance` across the batch, 2dp.
- The UI renders the score **verbatim** from the stream (no re-derivation) — see Provenance panel.

---

## 4. Sample / replay fixtures + malformed-line injection

**File:** `mocks/trace.sample.ts`.

- `allowRun` / `blockRun`: complete, hand-authored `TraceEvent[]` shaped exactly like the wire.
  These are what the deployed **Sample** mode plays, and they match the handoff's observed
  examples:
  - allow → task "Summarize the Q2 onboarding policy…", provenance `doc:onboarding-policy-2026#sec-2` (0.92), `#sec-4` (0.86), `kb:hr-faq#onboarding-timeline` (0.74); ends `executed` ("Wrote record summaries/q2-onboarding-policy (rev 1).").
  - block → task "Email the vendor to confirm the contract renewal terms.", provenance `email:thread-4471#msg-9` (0.42) and `note:vendor-call-2026-05-19` (0.55); proposed `send_email` to `vendor@acme-supplies.example`; `gate_decision: block` on `no-unverified-external-send`; `halted`.
- `toNdjson(events)` → NDJSON string. `buildTraceStream(ndjson, {chunkSize, delayMs})` replays
  it as a byte stream **split mid-line on purpose** to exercise the incremental parser
  (UI uses `chunkSize: 256, delayMs: 60`).
- `withMalformedLines(ndjson)` injects exactly **`INJECTED_MALFORMED_COUNT = 4`** bad lines
  (a bare JSON string, invalid JSON, a known type missing fields, an unknown type) plus a blank
  line (blank ≠ malformed). The parser skips all of them and still recovers every valid event.
- ⚠️ The fixture's `gate_decision` and `halted` events are **literal recordings**, so today the
  Sample path does **not** run the gate — it replays the recorded decision. (See Track 3 note.)

**Parser** (`lib/ndjson.ts`): `NdjsonTraceParser` buffers partial tails, splits on `\n`,
`JSON.parse`es each line, then validates against the **full `isTraceEvent` runtime guard**
(exhaustive over the union). Invalid JSON *or* valid-JSON-that-isn't-a-TraceEvent → pushed to
`malformed[]`, never thrown. `flush()` handles the unterminated final line.

---

## 5. React Flow layer + side panels + selection

- **`TraceCanvas.tsx`** maps `model.nodes` → React Flow nodes at fixed
  `x = index * COLUMN_GAP, y = 0` (left→right; not draggable — position is derived, not
  authored). Custom `TraceFlowNode`: a label chip (Researcher/Reasoner/Gate/Halt), a verbatim
  `HH:MM:SS` from the event `at`, and a body **truncated to 2 lines** (`line-clamp-2`). Gate
  node is green(allow)/red(block) with a status dot; halt node is red. After each node-set
  change it forces `updateNodeInternals` + `fitView` (deterministic re-measure). Clicking a node
  → `onSelect(node.id)`; clicking the pane → `onSelect(null)`.
- **Selection model** (`lib/trace-model.ts`, all pure):
  - `defaultSelectedId(model)` → the **gate node** if present, else the first node.
  - `provenanceForNode(model, id)` → for a step: its action's provenance (if any) else its own;
    for gate/halt: falls back to the referenced step's provenance.
  - `gateForNode(model, id)` → the gate decision for the selected node's step.
- **`TraceViewer.tsx`** owns all UI state: `mode` (live|sample), `runId` (allow|block),
  `started`, `injectNoise`, `replayNonce` (forces a fresh single-use replay), `selectedId`.
  Builds the `TraceStreamSource` (a `url` POST for Live, a `stream` factory for Sample) and feeds
  `useTraceStream`. Header shows Live/Sample toggle, the two run buttons, Replay, a status pill
  (idle/running/completed/halted/error), connecting/streaming indicators, task text, runId, the
  inject-malformed checkbox (Sample only), and the "Skipped N of 4 malformed lines" readout.
- **Panels** render **only** from the stream: `GateDecision` (Allow/Block + violations — the one
  place color carries meaning, with a dot), `ProvenancePanel` (sourceId / snippet / raw score +
  a width-encoded bar). The step's own **summary/result text is not shown in any panel today** —
  only the (truncated) node body shows it. (Relevant to Track 4: "node click → expand full text".)

---

## 6. Cold start / Live vs offline

- `createModelClient()` returns the **Anthropic** client when `ANTHROPIC_API_KEY` is set, else a
  **deterministic offline stub** (also forced by `AGENTS_OFFLINE=1`). The deployed site clearly
  has a key (handoff saw real generated content), so Live = real Claude; the offline stub is what
  CI and local-without-key use.
- The observed **503 then 200** on first Live click is a **Vercel function cold start**, not app
  logic. `useTraceStream` throws on `!response.ok` → `connection: "error"` → the UI surfaces
  `stream request failed (HTTP 503)`. Track 2's job: detect that first-call failure/latency, show
  a "Warming up the agent…" state, and auto-retry so the first click never looks broken.
- Retrieval defaults to the bundled corpus; `MEMORY_SERVICE_URL` can route to a live memory
  service with local fallback on any error (so a misconfigured service never breaks a run).

---

## 7. CI / quality gates I must keep green

`.github/workflows/ci.yml` runs on PRs:
1. `npm run typecheck` — strict, no `any`.
2. `npm run check:model` — configured model ids must be in the current set
   (`claude-opus-4-8/4-7/4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5`).
3. `npx tsx scripts/verify-trace.ts` — projection + parser contract (asserts exact node order,
   edge counts, gate decisions, malformed-count == 4, etc.).
4. `npm run demo` with `AGENTS_OFFLINE=1` — allowed→allow, blocked→block via the offline stub.

**Implication:** any change to `governance.ts`, `trace-model.ts`, `trace-events.ts`,
`mocks/trace.sample.ts`, or the seed tasks must keep verify-trace.ts and the demo assertions
passing (or update them deliberately and in lockstep).

---

## 8. Implications per track (what recon changes about the plan)

- **Track 1 (narrative / guided block walkthrough):** drive it off the **Sample `blockRun`**
  (the 0.55 vendor note is the clean teaching example). Callouts can reference the real numbers
  in the fixture: only source `0.55` < required `0.7` → `no-unverified-external-send` → halt
  before send.
- **Track 2 (backend visible + cold start):** "View raw trace" = render the already-captured
  `events` array from `useTraceStream` (we keep them). Cold-start handling lives in
  `useTraceStream`/`TraceViewer` around the `fetch` + `!response.ok` path. Document the §2 schema
  in the README.
- **Track 3 (editable policy — highest wow):** introduce a threshold config + a
  `makeNoUnverifiedExternalSend(threshold)` factory in `governance.ts` (keep the old export).
  Crucially, make the Sample/replay path **recompute the gate** via `evaluatePolicy()` over the
  fixture's `action_proposed`, instead of replaying the baked-in `gate_decision`/`halted`. Then
  lowering the threshold below `0.55` flips the vendor email BLOCK→ALLOW for real.
- **Track 4 (polish/a11y):** add a step-detail view in the side panel (full summary/result/
  proposed action), label scores against the threshold ("0.55 — below 0.70 required") with a
  pass/fail mark, add ✓/✕ text+icon to gate (not color-only), make nodes keyboard-focusable, and
  verify the canvas+panel layout collapses to a stack/drawer on narrow widths.
- **Track 6 (more scenarios):** each new task needs a `SeedTask` (live), a recorded Sample run,
  a policy rule, and provenance. New rule types to add: a **PII-leak** rule and a
  **destructive/irreversible-action** rule; optionally a third decision state `"needs_approval"`
  — note this widens the `Decision` union and `gate_decision` handling in the projection + UI, so
  it's the most invasive and should be scoped carefully.
- **Track 5 (artifacts/README):** rewrite README to lead with the problem/thesis, embed the §2
  schema, a diagram, design-decisions + what's-next, and link the repo from the site. Do last.

---

## 9. Branch / workflow note

The handoff suggests "branch per track," but this environment requires all work on
**`claude/loving-clarke-tkolJ`** (no pushing to other branches without permission). Resolution:
one branch, **one well-scoped commit per track**, opening a single PR. Both the **Live** and
**Sample** paths must keep working after every commit.

---

## 10. Implementation status (living)

| Track | Landed | Key files |
|---|---|---|
| **2 — backend visible + cold start** | ✅ | `lib/useTraceStream.ts` (warming/retry + prewarm), `components/RawTraceDrawer.tsx`, header caption, `docs/ARCHITECTURE.md` |
| **1 — narrative + guided block** | ✅ | `components/Hero.tsx`, `components/GuidedWalkthrough.tsx`, `TraceViewer` restructure (scrollable page + bounded tool) |
| **3 — editable policy** | ✅ | `lib/governance.ts` (`makeNoUnverifiedExternalSend`/`buildPolicy`), `lib/policy-replay.ts` (Sample recompute), `loop.ts`+`/api/run` (Live override), `components/panels/PoliciesPanel.tsx`, flip tracking |
| **4 — detail polish + a11y** | ✅ | `components/panels/StepDetail.tsx`, `stepForNode()`, threshold-labeled `ProvenancePanel`, ✓/✕ gate, keyboard-focusable nodes, responsive layout |
| **6 — more scenarios** | ✅ | third state `needs_approval` + `awaiting_approval` event across governance/loop/ndjson/trace-model/UI; PII + destructive rules; 3 new Sample fixtures; scenario registry |
| **5 — portfolio artifacts** | ✅ | README rewrite (problem-first), `docs/architecture.svg`, design-decisions + what's-next; site already links to repo (Track 2) |

**CI gates kept green throughout:** `typecheck`, `check:model`, `scripts/verify-trace.ts`
(now **52 checks**, incl. the policy flip + all three new scenarios), offline `demo`
(allow→allow, block→block).

**Resolved corrections from §TL;DR:** the gate threshold is now configurable end-to-end;
the Sample path recomputes the gate (no baked-in replay); Live ≠ Sample is intentional and
both honor the edited policy. The two original seed tasks (`lib/tasks.ts`) are unchanged, so
the offline demo contract still holds; new scenarios are recorded Sample fixtures.

**Open / deliberately deferred:** the demo GIF + 90-second video are placeholders in the
README (can't be captured here); the `needs_approval` state parks the run (an
approve-to-continue affordance is in "What I'd build next").
