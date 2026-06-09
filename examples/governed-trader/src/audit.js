/* ============================================================
   governed-trader — the Backtest-Honesty Auditor  (GT_AUDIT)
   ------------------------------------------------------------
   The most on-brand agent: its whole job is to keep a trading claim HONEST.
   Backtests lie in two famous ways — they peek at the future (lookahead) and
   they ignore costs (fees + slippage). This auditor runs the SAME strategy
   four ways to isolate each lie, and reports the overstatement; and it REFUSES
   to attest a result that used lookahead or zero costs (propose, never publish a
   number you can't stand behind — the axiom-orion "measured, not asserted" law).

   honestyReport() -> { naiveReturnPct, honestReturnPct, inflationPctPts,
                        fromLookahead, fromCosts, feesPaid }
   attest(opts)    -> { clean, reasons }  (clean iff point-in-time AND costs modeled
                       AND dividends credited AND the universe was not hindsight-picked)

   Equities add two more famous lies, so honestyReportEquities() isolates FOUR:
     lookahead            peeking at the next bar
     zero-cost            fees + slippage not modeled
     ignored-dividends    cash dividends not credited — for a long book this
                          UNDERSTATES the result; honesty is not pessimism, and
                          misstatement is refused in either direction
     hindsight-universe   instruments picked by their realized (future) returns —
                          the selection/survivorship lie behind most great backtests
   ============================================================ */
(function (root) {
  'use strict';
  const C = (typeof require !== 'undefined') ? require('./conductor.js') : root.GT_CONDUCTOR;
  const EQ = (typeof require !== 'undefined') ? require('../data/equities.js') : root.GT_EQUITIES;

  function honestyReport(opts) {
    opts = opts || {};
    const base = { enforce: false, targetPct: opts.targetPct, stratCfg: opts.stratCfg, data: opts.data };
    const honest = C.run(Object.assign({}, base, { feeBps: 10, slipBps: 5, lookahead: false }));
    const naive = C.run(Object.assign({}, base, { feeBps: 0, slipBps: 0, lookahead: true }));
    const noCost = C.run(Object.assign({}, base, { feeBps: 0, slipBps: 0, lookahead: false }));
    const peek = C.run(Object.assign({}, base, { feeBps: 10, slipBps: 5, lookahead: true }));
    return {
      naiveReturnPct: naive.returnPct,
      honestReturnPct: honest.returnPct,
      inflationPctPts: +(naive.returnPct - honest.returnPct).toFixed(2),
      fromLookahead: +(peek.returnPct - honest.returnPct).toFixed(2),
      fromCosts: +(noCost.returnPct - honest.returnPct).toFixed(2),
      feesPaid: honest.fees,
    };
  }

  // who would have been picked at the END of the window — the hindsight universe
  function hindsightTop(data, k) {
    return data.SERIES
      .map(function (s) { return { instrument: s.instrument, r: s.closes[s.closes.length - 1] / s.closes[0] }; })
      .sort(function (a, b) { return b.r - a.r; })
      .slice(0, k)
      .map(function (x) { return x.instrument; });
  }

  // the equities report: the same strategy run honestly once, then with each lie
  // switched on in isolation, then with all four at once ("naive").
  function honestyReportEquities(opts) {
    opts = opts || {};
    const data = opts.data || EQ;
    const winners = hindsightTop(data, opts.hindsightTopK || 4);
    const base = { enforce: false, targetPct: opts.targetPct, stratCfg: opts.stratCfg, policyCfg: opts.policyCfg, data: data };
    const honest = C.run(Object.assign({}, base, { feeBps: 10, slipBps: 5 }));
    const peek = C.run(Object.assign({}, base, { feeBps: 10, slipBps: 5, lookahead: true }));
    const noCost = C.run(Object.assign({}, base, { feeBps: 0, slipBps: 0 }));
    const noDivs = C.run(Object.assign({}, base, { feeBps: 10, slipBps: 5, creditDividends: false }));
    const hindsight = C.run(Object.assign({}, base, { data: data.subset(winners), feeBps: 10, slipBps: 5 }));
    const naive = C.run(Object.assign({}, base, { data: data.subset(winners), feeBps: 0, slipBps: 0, lookahead: true, creditDividends: false }));
    return {
      naiveReturnPct: naive.returnPct,
      honestReturnPct: honest.returnPct,
      inflationPctPts: +(naive.returnPct - honest.returnPct).toFixed(2),
      fromLookahead: +(peek.returnPct - honest.returnPct).toFixed(2),
      fromCosts: +(noCost.returnPct - honest.returnPct).toFixed(2),
      fromIgnoredDividends: +(noDivs.returnPct - honest.returnPct).toFixed(2), // negative for a long book: skipping dividends understates
      fromHindsightUniverse: +(hindsight.returnPct - honest.returnPct).toFixed(2),
      hindsightUniverse: winners,
      feesPaid: honest.fees,
      divsReceived: honest.divs,
    };
  }

  // the gate equivalent for *claims*: refuse to publish a backtest that cheated.
  function attest(opts) {
    opts = opts || {};
    const reasons = [];
    if (opts.lookahead) reasons.push('lookahead: the strategy was allowed to peek at the next bar');
    if ((opts.feeBps != null && opts.feeBps <= 0) || (opts.slipBps != null && opts.slipBps <= 0)) reasons.push('zero-cost: fees and/or slippage were not modeled');
    if (opts.dividendsCredited === false) reasons.push('ignored-dividends: cash dividends were not credited — misstatement is refused in either direction');
    if (opts.universe === 'hindsight') reasons.push('hindsight-universe: instruments were selected by their realized future returns (selection/survivorship bias)');
    return { clean: reasons.length === 0, reasons: reasons };
  }

  const API = { honestyReport: honestyReport, honestyReportEquities: honestyReportEquities, hindsightTop: hindsightTop, attest: attest };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (root) root.GT_AUDIT = API;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : null));
