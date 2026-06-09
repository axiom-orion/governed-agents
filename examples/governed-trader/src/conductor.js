/* ============================================================
   governed-trader — the conductor  (GT_CONDUCTOR)
   ------------------------------------------------------------
   The runnable loop, mirroring governed-agents and the cason-heritage Keeper:
   walk the market tape point-in-time → strategy proposes an order → the gate
   decides → execute (paper) / hold-for-approval / block → track P&L, the daily
   drawdown, and a streamable NDJSON trace.

   run({ enforce }) is the whole experiment in one switch:
     • enforce:true  (governed)   — execute only on `allow`; block/needs_approval are skipped.
     • enforce:false (ungoverned) — execute every order; a fill that violated a hard
                                     rule is counted as a RISK-LIMIT BREACH.
   Everything else (signals, sizing, costs) is identical, so the only variable is
   the gate. That is what makes "breaches: X → 0" an honest, controlled number.

   Point-in-time by construction: the strategy only sees closes up to the current
   bar — unless opts.lookahead is set, the dishonest variant the auditor catches.

   Runs no-build under Node and in the browser.
   ============================================================ */
(function (root) {
  'use strict';
  const GATE = (typeof require !== 'undefined') ? require('./gate.js') : root.GT_GATE;
  const STRAT = (typeof require !== 'undefined') ? require('./strategy.js') : root.GT_STRATEGY;
  const BROKER = (typeof require !== 'undefined') ? require('./broker.js') : root.GT_BROKER;
  const DATA = (typeof require !== 'undefined') ? require('../data/candles.js') : root.GT_DATA;

  function hardViolation(decision) { return (decision.violations || []).some(function (v) { return (v.severity || 'block') === 'block'; }); }

  function run(opts) {
    opts = opts || {};
    const data = opts.data || DATA;
    const targetPct = opts.targetPct != null ? opts.targetPct : 0.20;  // base position target (× confidence)
    const enforce = opts.enforce !== false;
    const policy = GATE.buildPolicy(opts.policyCfg || {});
    const broker = BROKER.Broker({ cash: opts.cash || 100000, feeBps: opts.feeBps, slipBps: opts.slipBps });
    const trace = opts.trace ? GATE.Trace('governed-trader ' + (enforce ? 'governed' : 'ungoverned')) : null;
    if (trace) trace.runStarted();

    const bars = data.bars();
    const hist = {};            // instrument -> point-in-time closes
    const future = {};          // instrument -> full closes (only used if lookahead)
    data.SERIES.forEach(function (s) { future[s.instrument] = s.closes; hist[s.instrument] = []; });
    const lastPrice = {};
    let curDate = null, dayStartEquity = broker.cash(), worstDayLossPct = 0;
    let breaches = 0, blocked = 0, held = 0, fills = 0, step = 0;

    bars.forEach(function (bar) {
      lastPrice[bar.instrument] = bar.close;
      if (bar.t !== curDate) { curDate = bar.t; dayStartEquity = broker.equity(lastPrice); }
      hist[bar.instrument].push(bar.close);

      // signal (point-in-time, unless the dishonest lookahead variant peeks at the next close)
      const closes = opts.lookahead && bar.i + 1 < future[bar.instrument].length
        ? hist[bar.instrument].concat([future[bar.instrument][bar.i + 1]]) : hist[bar.instrument];
      const sig = STRAT.signal(closes, opts.stratCfg);
      const equity = broker.equity(lastPrice);
      const targetNotional = sig.side === 'flat' ? 0 : (sig.side === 'sell' ? -1 : 1) * targetPct * equity * sig.confidence;
      const targetQty = bar.close ? targetNotional / bar.close : 0;
      const curQty = (broker.positions()[bar.instrument]) || 0;
      const deltaQty = targetQty - curQty;
      if (Math.abs(deltaQty * bar.close) < 50) return; // ignore dust

      const order = {
        instrument: bar.instrument, side: deltaQty >= 0 ? 'buy' : 'sell', qty: Math.abs(deltaQty),
        price: bar.close, notional: Math.abs(deltaQty * bar.close), confidence: sig.confidence,
        provenance: sig.provenance, dataAgeSec: opts.dataAgeSec || 0,
      };
      const ctx = { equity: equity, positions: broker.positions(), grossNotional: broker.grossNotional(lastPrice), dayPnl: equity - dayStartEquity, dayStartEquity: dayStartEquity, refPrice: bar.close };
      const decision = GATE.evaluatePolicy(order, ctx, policy);
      const sid = (trace ? trace.runId : 'r') + ':s' + (++step);
      if (trace) { trace.actionProposed(sid, order); trace.gateDecision(sid, decision); }

      let doFill = false;
      if (enforce) {
        if (decision.decision === 'allow') doFill = true;
        else if (decision.decision === 'needs_approval') { held++; if (trace) trace.awaitingApproval(sid, GATE.reasonOf(decision, 'review')); }
        else { blocked++; if (trace) trace.halted(sid, GATE.reasonOf(decision)); }
      } else {
        doFill = true;                            // ungoverned: execute regardless
        if (hardViolation(decision)) breaches++;  // ...and a violating fill is a breach
      }
      if (doFill) { broker.fill(order); fills++; if (trace) trace.executed(sid, order.side + ' ' + order.qty.toFixed(4) + ' ' + order.instrument); }

      const dd = (broker.equity(lastPrice) - dayStartEquity) / dayStartEquity;
      if (dd < worstDayLossPct) worstDayLossPct = dd;
    });

    if (trace) trace.runCompleted();
    const finalEquity = broker.equity(lastPrice);
    return {
      mode: enforce ? 'governed' : 'ungoverned',
      finalEquity: +finalEquity.toFixed(2),
      returnPct: +(((finalEquity / (opts.cash || 100000)) - 1) * 100).toFixed(2),
      breaches: breaches, blocked: blocked, held: held, fills: fills,
      worstDayLossPct: +(worstDayLossPct * 100).toFixed(2),
      fees: +broker.fees().toFixed(2),
      trace: trace,
    };
  }
  const API = { run: run };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (root) root.GT_CONDUCTOR = API;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : null));
