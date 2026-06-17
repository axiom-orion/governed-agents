# Status & decisions

A durable snapshot of where the model-governance layer stands and why — so the
context survives chat archiving. Last updated end of the consensus/Red-Cell arc.

## What's live

`governed-agents.vercel.app` — Researcher → Reasoner → governance gate → execute / halt /
needs-approval, rendered from a streamed NDJSON trace.

- **Triad consensus** at the Reasoner: Claude + Gemini + Grok each propose the action
  (`lib/consensus.ts`, `lib/providers.ts`). Each vote carries an **attested voice**
  `{provider, model}`; the gate requires agreement (`require-model-consensus`) and
  counts **distinct instances**, not echoes (`require-distinct-voices`).
- **Red Cell** adversarial review (`lib/redcell.ts`): on **consequential actions only**
  (outbound sends + destructive kinds) an independent voice makes the case *against* the
  action. `red-cell-independence` + `red-cell-objection` route a non-independent or
  objected action to a human. Internal records are gated by the hard rules but skip the
  generative red team.
- Single-model / offline (no extra keys) is the **unchanged** deterministic path.

## Key decisions (rationale)

| Decision | Why | PR |
|---|---|---|
| Consensus = **agreement gate** (split → needs-approval) | "use 3 models for accuracy" only means something if disagreement is caught | #3 |
| **Attested voices**, corroboration counts instances not votes | a unanimous echo of one voice isn't corroboration | #8/#9 |
| Red Cell = adversarial **mode**, honored only if reviewer ≠ generator | oversight is theater unless provably independent | #8/#9 |
| Reviewer **fallback chain** (try each independent voice in order) | Gemini's review call fails ~80% (safety filter) — don't drop oversight | #11 |
| Red Cell **scoped to consequential actions** | a working "never rubber-stamp" reviewer objects to *any* single internal note on this corpus; reserve it for what can cause harm | #12 |
| `allowed` seed task → single verbatim source | remove the conflation objection (then superseded by the scoping above) | #10 |

## Enabling the triad (operational)

- Set **`GEMINI_API_KEY`** + **`XAI_API_KEY`** in Vercel → Settings → Environment
  Variables (server-side; **no `NEXT_PUBLIC_`**). Optional `GEMINI_MODEL` /
  `XAI_MODEL` (defaults `gemini-2.5-flash` / `grok-3` — ids drift, verify per account).
- **Network policy**: Claude (`api.anthropic.com`) and Gemini
  (`*.googleapis.com`) are on Vercel's Trusted allowlist; **Grok needs `api.x.ai`
  added** (Network access → Custom, keep defaults). No secrets store yet — env vars are
  visible to anyone who can edit the environment.
- Verify keys + model ids from a terminal: **`npm run check:providers`**.
- Cloud Code sessions auto-install deps via the `.claude/settings.json` SessionStart hook.

## Known caveats

- **Gemini review ~80% failure**: its safety filter rejects the adversarial Red-Cell
  prompt, so it abstains. The **fallback chain** (#11) covers it — oversight falls
  through to Grok. Optional future fix: `safetySettings: BLOCK_NONE` on the Gemini
  `review()` call so Gemini itself can review.
- **Vercel deploy lag**: the GitHub → production deploy webhook has lagged several
  minutes (a merge lands but prod updates late). Check
  `mcp__Vercel__get_deployment("governed-agents.vercel.app")` for the live commit.
- The live **Red Cell objects on real merits** — it's adversarial by design; expect
  `needs_approval` on consequential actions it can fault.

## Open / pending

- **#12 production confirmation**: at session end prod was still on #11 (deploy
  lagging). Once `32ff7bd` deploys, re-probe to confirm:
  - `POST /api/run {"taskId":"allowed"}` → `write_record`, **no `redCell`**, allow → executed.
  - `POST /api/run {"taskId":"blocked"}` → `send_email`, `redCell` present, **block** (hard rule wins).
- **Direction reassessment** (your call): is per-action adversarial oversight the right
  centerpiece, or should the demo foreground the consensus/attestation story? The corpus
  is small and refund-themed — a richer corpus would let the Red Cell concur on
  genuinely-corroborated material.

## Verify everything

```bash
npm run typecheck && npm run check:model && npm run verify:governance   # 42 checks
AGENTS_OFFLINE=1 npm run demo                                           # allow + block
npm run build
```
