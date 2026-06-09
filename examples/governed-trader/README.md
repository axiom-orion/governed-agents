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

It runs on two real, read-only, frozen markets — **24/7 long/short crypto** (BTC/ETH/SOL)
and **calendar-bound, long-only US equities/ETFs** (AAPL MSFT NVDA AMZN META TSLA PTON
RIVN GLD TLT, 357 trading days) — because each asset class lies and breaks in its own way,
and the gate has to know the difference.

It makes two hand-waved claims measurable:

> **Governance.** Same tape, signals, sizing, and costs — the *only* variable is the gate.
> On crypto, an **ungoverned** order stream breaches hard rules on **16** decisions; the
> **governed** run breaches **0** — and is *better risk-adjusted*, giving up 2.26 pts of
> return to cut **max drawdown from −3.73% to −2.58%**. On equities: **120 → 0**, with **3**
> large single-source orders routed to a human, every block carrying a named rule and a
> logged reason (`min-confidence ×192, max-gross-leverage ×16, gap-circuit-breaker ×5,
> require-corroboration ×3`). There it costs **0.55 pts** — governance is insurance you pay
> for, not a return booster, and the eval says so out loud.
>
> **Honesty.** On equities the honest result is a **LOSS (−6.51%)** — point-in-time, net of
> costs, dividends credited, universe chosen at the start. Let the same strategy cheat
> (peek + zero cost + hindsight universe + no dividends) and it "earns" **+50.11%**.
> The auditor isolates each lie — lookahead **+137.0 pts**, costs **+7.8**, hindsight
> universe **+4.9**, ignored dividends **−0.2** (skipping dividends *understates* a long
> book — honesty is not pessimism) — and **refuses to attest** any of them.

Numbers produced by `node eval/run_eval.js`, not asserted. CPU-only, no API key, no network.
The eval closes with a **caveats** section naming which rules actually bound on this tape and
which are guards proven only in the self-tests — because a number is only as honest as its
footnotes.

```
3) GOVERNANCE, US equities — 10 instruments × 357 trading days, long-only
                         ungoverned    governed
   hard-rule breaches    120           0
   blocked / held        —             209 / 3
   worst single-day      -2.6%         -2.53%   (halt: -3%)
   max drawdown          -14.67%       -15.06%
   net return            -7.13%        -7.68%
   rules that bound on this tape: min-confidence ×192, max-gross-leverage ×16,
                                  gap-circuit-breaker ×5, require-corroboration ×3
4) HONESTY, US equities — naive (all four lies) 50.11%  vs  honest -6.51%
   lookahead +137.03 · zero-cost +7.84 · hindsight universe +4.88 · ignored dividends -0.23 pts
   attest(no dividends, hindsight universe): REFUSED
```

## Safety — this is the design, not a limitation

- **Paper / sim only.** Market data is **read-only and frozen** (crypto: Crypto.com
  Exchange public API; equities: Yahoo Finance public chart API); **no orders are ever
  placed** and there is no brokerage integration of any kind.
- **Supervised — the top tier is empty.** In `live` mode every risk-increasing order routes
  to a human (`live-needs-approval`); there is no autonomous real-money execution path.
- Same posture as the rest of the [axiom-orion](https://github.com/axiom-orion) work:
  *propose, never publish.*

## How it works

A loop mirroring [`governed-agents`](../../) and the cason-heritage Keeper: walk the tape
point-in-time → **strategy** proposes an order → **gate** decides → execute (paper) /
hold-for-approval / block → track P&L, worst-day and peak-to-trough drawdown, and an NDJSON trace. It
**reuses governed-agents' `evaluatePolicy` + `TraceEvent` contract**, pointed at the
highest-stakes action there is.

The conductor is **asset-class aware**: equity datasets carry their own trading calendar
(the frozen dates — weekends and NYSE holidays are simply absent), pay **cash dividends on
the ex-date** to holders of the prior close, are traded **long-only** (no borrow/locate is
modeled), and expose each bar's **opening gap** for the circuit-breaker. Turnover is
controlled by a no-trade **rebalance band**, like a real desk.

### The gate — named rules with thresholds (not prompts)

| rule | decision |
|---|---|
| `require-provenance` · `restricted-symbol` · `stale-data` · `off-market-price` | block |
| `min-confidence` · `max-order-notional` · `max-position-pct` · `max-gross-leverage` | block |
| `market-closed` (order dated off the trading calendar) | block |
| `gap-circuit-breaker` (equities: no *new* risk into a >8% opening gap; exits stay allowed) | block |
| `pdt-rule` (equities: the FINRA pattern-day-trader trip-wire, <$25k equity) | block |
| `daily-loss-breaker` (the kill-switch — no new risk past the halt) | block |
| `require-corroboration` (a large single-source bet needs a 2nd signal or a human) | needs-approval |
| `live-needs-approval` (live mode — the top tier is unoccupied) | needs-approval |

Not all of these bind on the bundled window, and the eval **says which** rather than implying
they all fire: on this tape `min-confidence`, `max-gross-leverage`, `gap-circuit-breaker`, and
`require-corroboration` do the work. The rest are guards proven firing in the self-tests but
not triggered here — the `daily-loss-breaker` is insurance the other caps kept us short of (it
would take a contrived ~−1% halt to bind on this gentle drawdown, and tuning it there would be
dishonest), the input guards never saw bad input from a clean signal, and **`pdt-rule` needs
intraday bars to ever fire** — a daily-bar strategy cannot round-trip within a session.

Two design rules learned from real risk systems, encoded and self-tested:

- **Reduce-only exemption.** Size and conviction caps gate *new* risk only — a book must
  always be allowed to trade toward flat, or its own caps trap it over a limit (sanity
  rules still apply to every order). The equities leverage cap (1.0×) sits *below* the
  Reg-T 2.0× floor on purpose: regulation is the floor, not the target.
- **Threshold flip.** Edit a threshold and the same order flips (block ↔ allow) — the
  `governed-agents` "watch it block" demo, with money on the line.

### The Backtest-Honesty Auditor

Its whole job is to keep a *claim* honest. Crypto isolates the two classic lies (lookahead,
zero-cost). Equities add the two stock-specific ones: a **hindsight-picked universe**
(selection/survivorship bias — backtesting today's winners) and **ignored dividends**
(which *understates* a long book — misstatement is refused in either direction). The
auditor runs the same strategy with each lie switched on in isolation, reports the
overstatement, and **refuses to attest** a run that cheated — the gate, applied to numbers.

### The audit trace — the glass-box, as data

Every governed decision is streamed as an NDJSON `TraceEvent` (`run_started` →
`action_proposed` → `gate_decision` → `executed`/`awaiting_approval`/`halted` →
`run_completed`) — the same wire format [`governed-agents`](../../) renders in its trace UI.
`npm run trace` runs a two-name slice chosen to exercise **all three outcomes** plus real
fills and a credited dividend, and prints a readable sample; add `--ndjson` to capture the
full machine-readable stream:

```sh
npm run trace                              # human summary + one of each outcome
node eval/emit_trace.js --ndjson > trace.ndjson   # the full event stream
```

## Run it

```sh
node eval/run_eval.js     # the measured claims on both asset classes, frozen real data
npm test                  # the self-tests (gate · conductor · audit · equities) — 66 assertions
npm run trace             # stream a real NDJSON audit trace of a governed run
```

## Layout

| Path | Purpose |
|---|---|
| `src/gate.js` | the pre-trade policy gate (evaluatePolicy) + the NDJSON `TraceEvent` factory |
| `src/strategy.js` | the transparent SMA-cross signal (the vehicle, not an alpha claim) |
| `src/broker.js` | the paper broker — fills with fees + slippage; positions; ex-date cash dividends |
| `src/conductor.js` | the governed loop (governed vs ungoverned is one switch; asset-class aware) |
| `src/audit.js` | the Backtest-Honesty Auditor (four lies isolated; attest refuses each) |
| `data/candles.js` | real BTC/ETH/SOL daily closes, frozen for reproducibility |
| `data/equities.js` | real US equities/ETFs: opens+closes + dividend events, one NYSE calendar, frozen |
| `data/fetch_equities.mjs` | the one-shot fetcher that froze it (asserts a split-free window, one calendar) |
| `eval/run_eval.js` | the measured claims on both asset classes, with a caveats footer |
| `eval/emit_trace.js` | streams a real NDJSON audit trace (`npm run trace`) |
| `tests/*.selftest.js` | the self-tests — gate · conductor · audit · equities (66 assertions) |

## Roadmap

Position-reconciliation drift auditor (believed vs venue positions), a live-mode approval
glass-box (watch an order held for a human), and a multi-model **consensus** signal so the
corroboration rule fires on disagreement — each a further Vorion primitive, on paper.

---

Part of [**axiom-orion**](https://github.com/axiom-orion) — small, eval-driven pieces that
turn one hand-waved claim into an honest number. The pre-execution gate, provenance, and
audit trace are the same principles the [**Vorion**](https://github.com/vorionsys)
governance platform applies to autonomous agents — here on the action that matters most.
