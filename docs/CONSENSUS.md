# Model consensus and the Red Cell

Moved here from the README. The rules these feed (`require-model-consensus`,
`require-distinct-voices`, `red-cell-independence`, `red-cell-objection`) are listed in the
README's policy table; operational notes are in [`STATUS.md`](STATUS.md).

## Model consensus (the triad)

The Reasoner step can be decided by a **triad** — Claude + Gemini + Grok — voting on
the action ([`lib/consensus.ts`](../lib/consensus.ts), [`lib/providers.ts`](../lib/providers.ts)).
Each model proposes independently; if they don't agree, `require-model-consensus`
holds the run for a human instead of acting on a split decision. A provider with no
key simply **abstains**, so it degrades gracefully to a single model. Set
`GEMINI_API_KEY` + `XAI_API_KEY` to light up Live; the *“model triad agrees / splits”*
Sample scenarios demo it with zero keys.

## Attested independence + the Red Cell (oversight that can prove it's not theater)

Every vote now carries an attested **voice identity** — the configured
`(provider, model id)` pair — and the consensus records how many **distinct
instances** actually backed the chosen action. A unanimous "consensus" whose agreeing
votes resolve to one instance is one voice echoed N times; `require-distinct-voices`
routes it to a human instead of honoring it. After the action is chosen, the **Red
Cell** ([`lib/redcell.ts`](../lib/redcell.ts)) — an adversarial *mode*, not a fourth
agent — runs on an instance provably distinct from the generator and makes the
strongest case against the action; the gate refuses to honor its verdict if the
voices collapse, and parks any objection for a human. Honest scope: for API-backed
voices this attests what we *configured and called* — it cannot see through a
provider's internal routing, and that residual trust is named, not papered over.
Verified headlessly with zero keys: `npx tsx scripts/verify-governance.ts` (or `npm test` for every offline suite).

Both are **glass-boxed in the trace UI**: the consensus panel shows each vote's attested
`provider/model` and flags an *echo* (agreeing votes that resolve to one instance); a Red
Cell panel shows the reviewer's verdict, its attested identity, and whether it's independent
of the proposer. Two Sample scenarios demo them with zero keys — *"unanimous, but one voice
echoed"* and *"the Red Cell objects"* — and the projections are pinned in `verify-trace`
(70 checks).

Verify your keys + model ids from the terminal before deploying:

```bash
npm run check:providers   # pings each configured provider, prints ✓/✗ per model
```
