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
   attest(opts)    -> { clean, reasons }  (clean iff point-in-time AND costs modeled)
   ============================================================ */
(function (root) {
  'use strict';
  const C = (typeof require !== 'undefined') ? require('./conductor.js') : root.GT_CONDUCTOR;

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

  // the gate equivalent for *claims*: refuse to publish a backtest that cheated.
  function attest(opts) {
    opts = opts || {};
    const reasons = [];
    if (opts.lookahead) reasons.push('lookahead: the strategy was allowed to peek at the next bar');
    if ((opts.feeBps != null && opts.feeBps <= 0) || (opts.slipBps != null && opts.slipBps <= 0)) reasons.push('zero-cost: fees and/or slippage were not modeled');
    return { clean: reasons.length === 0, reasons: reasons };
  }

  const API = { honestyReport: honestyReport, attest: attest };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (root) root.GT_AUDIT = API;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : null));
