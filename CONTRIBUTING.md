# Contributing to governed-agents

Thanks for your interest in contributing. This is a governed multi-agent flow —
**Researcher → Reasoner → governance gate → execute/halt** — with a trace UI rendered
purely from the `TraceEvent` stream. The whole point is auditability: every action an
agent proposes is allowed or blocked against an explicit policy, and the run can be
reconstructed from the event stream alone. Contributions should preserve those properties.

## Stack

- **Next.js 15** (App Router) + **React 19**
- **TypeScript 5.7**, strict (see [Code style](#code-style--strict-typescript) below)
- **Tailwind CSS 3** + PostCSS
- **`@anthropic-ai/sdk`** for live Claude calls; **React Flow** (`@xyflow/react`) for the trace canvas
- **tsx** to run the TypeScript harness scripts directly

## Running locally

```bash
npm install
cp .env.example .env.local   # optional — ANTHROPIC_API_KEY for live models
npm run typecheck            # tsc --noEmit — strict, no `any`
npm run check:model          # verify the configured Claude model ids are current
npm run demo                 # run both seed tasks (allowed + blocked) and print the stream
npm run demo:allow           # just the allowed task
npm run demo:block           # just the blocked task
npm run dev                  # landing + POST /api/run at http://localhost:3000 ; trace UI at /trace
npm run build                # production build
```

These are the only scripts defined in `package.json` — please keep this list and the scripts
in sync if you add one.

## The offline deterministic stub

The loop runs end-to-end with **zero external setup**. When `ANTHROPIC_API_KEY` is unset/empty
**or** `AGENTS_OFFLINE=1`, `createModelClient()` returns the `OfflineModelClient` in
`lib/model-client.ts` instead of calling Claude. That stub is **deterministic**: given the same
task it always produces the same `ActionDraft` (it picks `send_email` vs `write_record` from
keyword matching on the task text and extracts a recipient with a fixed regex).

Implications for contributors:

- `npm run demo`, `demo:allow`, and `demo:block` all run offline by default. The two seed tasks
  in `lib/tasks.ts` are tuned so the offline path produces the expected gate outcome — `allowed`
  must end in `allow`, `blocked` must end in `block`. `scripts/run.ts` asserts this and exits
  non-zero on a mismatch, so it doubles as a smoke test.
- Do not introduce nondeterminism (wall-clock branching, randomness, network calls) into the
  offline path. If your change touches `OfflineModelClient`, the agents, the corpus, or the seed
  tasks, run `npm run demo` and confirm both seed tasks still PASS.
- Set a real `ANTHROPIC_API_KEY` (server-only) to exercise the live `AnthropicModelClient`. Keys
  must never reach the client bundle — keep them in Route Handlers / server modules only.

## Code style / strict TypeScript

`tsconfig.json` enables `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`,
`noFallthroughCasesInSwitch`, and `verbatimModuleSyntax`. Every PR must pass `npm run typecheck`
with **no errors and no new suppressions**.

- **No `any`.** Model untyped boundaries (tool inputs, parsed JSON) with `unknown` and narrow
  explicitly — see `parseActionDraft()` / `asOptionalString()` in `lib/model-client.ts` for the
  expected pattern.
- Prefer **`readonly`** fields and `readonly T[]` for data that should not be mutated — this is
  how the contracts in `lib/governance.ts` and `lib/trace-events.ts` are defined.
- `verbatimModuleSyntax` is on, so use **`import type { ... }`** for type-only imports.
- Because `noUncheckedIndexedAccess` is on, indexed access yields `T | undefined` — handle the
  `undefined` case rather than asserting it away.
- Keep governance logic **pure and synchronous** where it already is (`evaluatePolicy` and the
  `PolicyRule`s) so it stays trivially testable.

## Adding a policy example

Policies live in `lib/governance.ts` as `PolicyRule` objects. A rule has a `name` and an
`evaluate(action)` that returns a `PolicyViolation` when the action fails the rule, or `null`
when it passes. To add one:

1. Add a `PolicyRule` next to `requireProvenance` / `noUnverifiedExternalSend`, keeping
   `evaluate` **pure** (decide solely from the `ProposedAction` — no I/O, no clock).
2. Make the violation's `rule` field match the rule `name` so blocks are traceable back to the
   rule that fired.
3. Add it to the exported `defaultPolicy` array if it should run in the live loop. The gate
   blocks if **any** rule returns a violation.
4. If you want a runnable demonstration, add a seed task to `lib/tasks.ts` whose `expected`
   outcome exercises the new rule, then verify with `npm run demo`.

`lib/governance.ts` is a **frozen contract owned by the loop** — extend the example policy set,
but do not change the shapes of `ProposedAction`, `PolicyDecision`, `PolicyViolation`, or the
`evaluatePolicy()` signature without coordinating, since the trace UI and wire format depend on them.

## TraceEvents are append-only and immutable

`TraceEvent` (`lib/trace-events.ts`) is the **NDJSON wire format** between the loop (emitter) and
the UI (consumer) — one event per line over a streamed Route Handler. Treat the event log as an
**append-only, immutable audit record**:

- The loop in `lib/loop.ts` **only ever yields** events; it never edits or retracts one already
  emitted. New information is a new event, never a mutation of a prior one.
- Never mutate a `TraceEvent` after it is yielded, and never reorder the stream. Consumers
  (e.g. `lib/trace-model.ts`) fold the events in arrival order; `lib/ndjson.ts` validates each
  line at runtime and **skips malformed lines** rather than patching them.
- The UI renders **only** from the stream — if a value is not in an event, it is not displayed.
  Do not add UI that fabricates or back-fills data the loop did not emit.
- Adding a **new event variant** to the `TraceEvent` union is the supported way to surface new
  information. When you do, update the NDJSON validation in `lib/ndjson.ts` and the projection in
  `lib/trace-model.ts` so the new variant is handled. Avoid changing or removing existing variants'
  fields, which would break the frozen format.

## Tests are a known gap — PRs welcome

There is currently **no unit or integration test suite** in this repo. The `npm run demo` harness
(`scripts/run.ts`) and `scripts/verify-trace.ts` provide a basic end-to-end smoke check, but that
is the extent of automated verification today.

This is a deliberate, acknowledged gap, and **PRs adding tests are very welcome** — high-value
targets include:

- `evaluatePolicy()` and each `PolicyRule` in `lib/governance.ts` (pure, easy to unit-test).
- The NDJSON parser/validator in `lib/ndjson.ts`, including the malformed-line skipping behavior.
- The pure projection in `lib/trace-model.ts` (`TraceEvent[]` → nodes/edges/status).
- An integration test that runs `runLoop` against the offline stub and asserts the allow/block
  outcomes for the seed tasks.

If you add a test runner, wire it into `package.json` scripts (e.g. a `test` script) and reference
it here so the next contributor finds it.

## Pull requests

- Keep PRs focused and run `npm run typecheck` + `npm run demo` before opening one.
- Preserve the audit guarantees above: pure policies, append-only events, UI driven only by the stream.
- Describe what changed and how you verified it.
