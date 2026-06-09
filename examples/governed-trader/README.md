# governed-trader

> An example within [**governed-agents**](../../). It takes that repo's idea — a typed
> pre-execution policy gate with a streamed NDJSON trace — and points it at a trade. It's a
> self-contained, zero-dependency Node package; run everything from this directory. CI for
> it lives in the parent repo's workflow.

**A trading agent's hard problem isn't prediction — it's that a trade is the canonical
irreversible, real-money action.** So here the governance *is* the product: an LLM/rule
agent proposes orders, and a typed **pre-trade policy gate** allows / blocks / routes-for-
approval each one *before* it executes, with a streamed audit trace. The strategy is the
vehicle; **no market alpha is claimed.**

It makes two hand-waved claims measurable, on **real, read-only, frozen** crypto data:

> **Governance.** Same signals, sizing, and costs — the *only* variable is the gate.
> An **ungoverned** order stream breaches a hard risk limit on **29** decisions; the
> **governed** run breaches **0**, pre-execution, with a logged reason for each — while
> still trading, at a cost of **0.48 pts** of return (8.77% → 8.29%) and a *lower* worst day.
>
> **Honesty.** The same strategy reported **naively** (peeking at the next bar + zero
> cost) shows **11.12%**; reported **honestly** (point-in-time, net of fees + slippage) it
> shows **8.77%** — a **2.35-point overstatement** (lookahead 2.09, costs 0.24). The
> auditor **refuses to attest** the naive number.

Numbers produced by `node eval/run_eval.js`, not asserted. CPU-only, no API key, no network.

```
1) GOVERNANCE — same signals, sizing & costs; the only variable is the gate
                         ungoverned    governed
   risk-limit breaches   29            0
   blocked / held        —             24 / 0
   worst single-day      -2.95%        -2.18%   (halt: -5%)
   net return            8.77%         8.29%
2) HONESTY — naive (peek + 0 cost) 11.12%  vs  honest (point-in-time, net) 8.77%
   overstatement 2.35 pts   attest(lookahead, zero-cost): REFUSED
```

## Safety — this is the design, not a limitation

- **Paper / sim only.** Market data is **read-only** (frozen candles from the Crypto.com
  Exchange public API); **no orders are ever placed**.
- **Supervised — the top tier is empty.** In `live` mode every risk-increasing order routes
  to a human (`live-needs-approval`); there is no autonomous real-money execution path.
- Same posture as the rest of the [axiom-orion](https://github.com/axiom-orion) work:
  *propose, never publish.*

## How it works

A loop mirroring [`governed-agents`](https://github.com/axiom-orion/governed-agents) and the
cason-heritage Keeper: walk the tape point-in-time → **strategy** proposes an order →
**gate** decides → execute (paper) / hold-for-approval / block → track P&L + the daily
drawdown + an NDJSON trace. It **reuses governed-agents' `evaluatePolicy` + `TraceEvent`
contract**, pointed at the highest-stakes action there is.

### The gate — named rules with thresholds (not prompts)

| rule | decision |
|---|---|
| `require-provenance` · `restricted-symbol` · `stale-data` · `off-market-price` | block |
| `min-confidence` · `max-order-notional` · `max-position-pct` · `max-gross-leverage` | block |
| `daily-loss-breaker` (the kill-switch — no new risk past the halt) | block |
| `require-corroboration` (a large single-source bet needs a 2nd signal or a human) | needs-approval |
| `live-needs-approval` (live mode — the top tier is unoccupied) | needs-approval |

Edit a threshold and the same order flips (block ↔ allow) — the `governed-agents`
"watch it block" demo, with money on the line.

### The Backtest-Honesty Auditor

Its whole job is to keep a *claim* honest: it runs the strategy four ways to isolate the
lookahead and cost lies, reports the overstatement, and **refuses to attest** a run that
peeked or skipped costs — the gate, applied to numbers.

## Run it

```sh
node eval/run_eval.js     # the two measured claims, on the frozen real data
npm test                  # the self-tests (gate · conductor · audit) — 28 assertions
```

## Layout

| Path | Purpose |
|---|---|
| `src/gate.js` | the pre-trade policy gate (evaluatePolicy) + the NDJSON `TraceEvent` factory |
| `src/strategy.js` | the transparent SMA-cross signal (the vehicle, not an alpha claim) |
| `src/broker.js` | the paper broker — fills at close with fees + slippage; positions; mark-to-market |
| `src/conductor.js` | the governed loop (governed vs ungoverned is one switch) |
| `src/audit.js` | the Backtest-Honesty Auditor (lookahead + cost isolation; attest) |
| `data/candles.js` | real BTC/ETH/SOL daily closes, frozen for reproducibility |
| `eval/run_eval.js` · `tests/*.selftest.js` | the measured claims + the self-tests |

## Roadmap

Position-reconciliation drift auditor (believed vs venue positions), a live-mode approval
glass-box (watch an order held for a human), and a multi-model **consensus** signal so the
corroboration rule fires on disagreement — each a further Vorion primitive, on paper.

---

Part of [**axiom-orion**](https://github.com/axiom-orion) — small, eval-driven pieces that
turn one hand-waved claim into an honest number. The pre-execution gate, provenance, and
audit trace are the same principles the [**Vorion**](https://github.com/vorionsys)
governance platform applies to autonomous agents — here on the action that matters most.
