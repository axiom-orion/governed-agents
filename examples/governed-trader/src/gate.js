/* ============================================================
   governed-trader — the pre-trade policy gate  (GT_GATE)
   ------------------------------------------------------------
   A trade is the canonical irreversible, real-money action — the higher-stakes
   version of the "unverified external send" the sibling repo `governed-agents`
   was built to block. This is that gate, pointed at orders: a pure, synchronous
   evaluatePolicy(order, ctx, policy) -> allow | block | needs_approval, decided
   by NAMED rules with THRESHOLDS (not prompts), pre-execution, with a streamed
   NDJSON TraceEvent record — the same contract governed-agents streams.

   The strategy is the vehicle; the governance is the point. The top tier
   (autonomous real-money execution) is UNOCCUPIED by design: in `live` mode every
   risk-increasing order routes to a human; nothing here ever sends real money.

   Rules (each named, threshold-driven):
     require-provenance        a trade with no signal source            -> block
     restricted-symbol         a halted / restricted instrument         -> block
     stale-data                signal older than maxDataAgeSec          -> block
     off-market-price          price far from the reference (sanity)    -> block
     min-confidence            signal below the confidence floor        -> block
     max-order-notional        order larger than the per-order cap      -> block
     max-position-pct          resulting position > % of equity         -> block
     max-gross-leverage        total gross exposure > leverage cap       -> block
     daily-loss-breaker        day P&L past the drawdown halt (kill-switch) -> block
     market-closed             order dated off the trading calendar      -> block
     gap-circuit-breaker       (equities) new risk into an opening gap   -> block
     pdt-rule                  (equities) the FINRA pattern-day-trader trip-wire -> block
     require-corroboration     single-source order above a size         -> needs_approval
     live-needs-approval       (live mode) every risk-increasing order   -> needs_approval

   Asset-class aware: equity-only rules check order.assetClass === 'equity', so
   the crypto tape (24/7, no calendar, no PDT) is untouched by them. Leverage is
   one shared rule — the equities policy passes a cap BELOW the Reg-T 2.0 floor
   on purpose: regulation is the floor, not the target.

   Runs no-build under Node and in the browser.
   ============================================================ */
(function (root) {
  'use strict';
  function now() { return new Date().toISOString(); }
  function sev(v) { return v.severity || 'block'; }

  function evaluatePolicy(order, ctx, rules) {
    ctx = ctx || {};
    const violations = (rules || []).map(function (r) { return r.evaluate(order, ctx); }).filter(Boolean);
    const block = violations.some(function (v) { return sev(v) === 'block'; });
    const review = violations.some(function (v) { return sev(v) === 'review'; });
    return { decision: block ? 'block' : review ? 'needs_approval' : 'allow', violations: violations, evaluatedAt: now() };
  }

  // --- helpers over the order/account ---
  function notionalOf(o) { return o.notional != null ? o.notional : Math.abs((o.qty || 0) * (o.price || 0)); }
  function indepSources(o) {
    const seen = {}; (o.provenance || []).forEach(function (p) { seen[(p.sourceId || '').split(':')[0]] = 1; }); // count distinct source *families*
    return Object.keys(seen).length;
  }
  function resultingPosNotional(o, ctx) {
    const cur = (ctx.positions && ctx.positions[o.instrument]) || 0;
    const delta = (o.side === 'sell' ? -1 : 1) * (o.qty || 0);
    return Math.abs((cur + delta) * (o.price || ctx.refPrice || 0));
  }
  function increasesRisk(o, ctx) {
    const cur = (ctx.positions && ctx.positions[o.instrument]) || 0;
    const delta = (o.side === 'sell' ? -1 : 1) * (o.qty || 0);
    return Math.abs(cur + delta) > Math.abs(cur) + 1e-9; // grows absolute exposure
  }

  function buildPolicy(cfg) {
    cfg = cfg || {};
    const c = {
      maxOrderNotional: cfg.maxOrderNotional != null ? cfg.maxOrderNotional : 25000,
      maxPositionPct: cfg.maxPositionPct != null ? cfg.maxPositionPct : 0.25,
      maxGrossLeverage: cfg.maxGrossLeverage != null ? cfg.maxGrossLeverage : 1.0,
      maxDailyLossPct: cfg.maxDailyLossPct != null ? cfg.maxDailyLossPct : 0.05,
      maxDataAgeSec: cfg.maxDataAgeSec != null ? cfg.maxDataAgeSec : 120,
      maxPriceDeviation: cfg.maxPriceDeviation != null ? cfg.maxPriceDeviation : 0.05,
      minConfidence: cfg.minConfidence != null ? cfg.minConfidence : 0.55,
      corroborationMinNotional: cfg.corroborationMinNotional != null ? cfg.corroborationMinNotional : 10000,
      restricted: cfg.restricted || [],
      live: !!cfg.live,
      maxGapPct: cfg.maxGapPct != null ? cfg.maxGapPct : 0.08,            // equities: opening gap beyond this -> no NEW risk that bar
      pdtEquityMin: cfg.pdtEquityMin != null ? cfg.pdtEquityMin : 25000,  // FINRA pattern-day-trader equity floor
      pdtMaxDayTrades: cfg.pdtMaxDayTrades != null ? cfg.pdtMaxDayTrades : 3, // day trades allowed per 5 trading days under the floor
    };
    return [
      { name: 'require-provenance', evaluate: function (o) { return (o.provenance || []).length ? null : { rule: 'require-provenance', detail: 'order cites no signal source' }; } },
      { name: 'restricted-symbol', evaluate: function (o) { return c.restricted.indexOf(o.instrument) !== -1 ? { rule: 'restricted-symbol', detail: o.instrument + ' is restricted / halted' } : null; } },
      { name: 'stale-data', evaluate: function (o) { return (o.dataAgeSec != null && o.dataAgeSec > c.maxDataAgeSec) ? { rule: 'stale-data', detail: 'signal data is ' + o.dataAgeSec + 's old (> ' + c.maxDataAgeSec + 's)' } : null; } },
      { name: 'off-market-price', evaluate: function (o, ctx) { if (!ctx.refPrice || !o.price) return null; const dev = Math.abs(o.price - ctx.refPrice) / ctx.refPrice; return dev > c.maxPriceDeviation ? { rule: 'off-market-price', detail: 'price is ' + (dev * 100).toFixed(1) + '% off the reference' } : null; } },
      // Conviction gates NEW risk only: a fading signal is exactly when a book should be
      // allowed to reduce — demanding fresh conviction to exit would trap it.
      { name: 'min-confidence', evaluate: function (o, ctx) { return (increasesRisk(o, ctx) && o.confidence != null && o.confidence < c.minConfidence) ? { rule: 'min-confidence', detail: 'signal confidence ' + o.confidence.toFixed(2) + ' < ' + c.minConfidence + ' — too weak to ADD risk' } : null; } },
      // The three SIZE caps are reduce-only-exempt: an order that shrinks exposure is never
      // blocked for being "too big" — a risk system that traps a book over its own caps
      // cannot de-risk. Sanity rules (provenance, restricted, stale, off-market, calendar)
      // still apply to every order, reducing or not.
      { name: 'max-order-notional', evaluate: function (o, ctx) { return (increasesRisk(o, ctx) && notionalOf(o) > c.maxOrderNotional) ? { rule: 'max-order-notional', detail: '$' + Math.round(notionalOf(o)) + ' exceeds the $' + c.maxOrderNotional + ' per-order cap' } : null; } },
      { name: 'max-position-pct', evaluate: function (o, ctx) { if (!ctx.equity || !increasesRisk(o, ctx)) return null; const p = resultingPosNotional(o, ctx) / ctx.equity; return p > c.maxPositionPct ? { rule: 'max-position-pct', detail: 'resulting position ' + (p * 100).toFixed(0) + '% of equity > ' + (c.maxPositionPct * 100) + '%' } : null; } },
      { name: 'max-gross-leverage', evaluate: function (o, ctx) { if (!ctx.equity || !increasesRisk(o, ctx)) return null; const gross = (ctx.grossNotional || 0) + notionalOf(o); const lev = gross / ctx.equity; return lev > c.maxGrossLeverage ? { rule: 'max-gross-leverage', detail: 'gross exposure ' + lev.toFixed(2) + 'x > ' + c.maxGrossLeverage + 'x cap' } : null; } },
      { name: 'daily-loss-breaker', evaluate: function (o, ctx) { if (!ctx.dayStartEquity) return null; const dd = (ctx.dayPnl || 0) / ctx.dayStartEquity; return (dd <= -c.maxDailyLossPct && increasesRisk(o, ctx)) ? { rule: 'daily-loss-breaker', detail: 'day P&L ' + (dd * 100).toFixed(1) + '% past the -' + (c.maxDailyLossPct * 100) + '% halt — no new risk' } : null; } },
      { name: 'market-closed', evaluate: function (o, ctx) { return (o.t && ctx.tradingDays && !ctx.tradingDays.has(o.t)) ? { rule: 'market-closed', detail: o.t + ' is not a trading day on this market’s calendar' } : null; } },
      { name: 'gap-circuit-breaker', evaluate: function (o, ctx) { return (o.assetClass === 'equity' && o.gapPct != null && o.gapPct > c.maxGapPct && increasesRisk(o, ctx)) ? { rule: 'gap-circuit-breaker', detail: o.instrument + ' opened ' + (o.gapPct * 100).toFixed(1) + '% off the prior close (> ' + (c.maxGapPct * 100) + '%) — no new risk into a gap; exits stay allowed' } : null; } },
      { name: 'pdt-rule', evaluate: function (o, ctx) { return (o.assetClass === 'equity' && o.isDayTrade && ctx.equity != null && ctx.equity < c.pdtEquityMin && (ctx.dayTradesLast5 || 0) >= c.pdtMaxDayTrades) ? { rule: 'pdt-rule', detail: 'day trade #' + ((ctx.dayTradesLast5 || 0) + 1) + ' in 5 sessions with $' + Math.round(ctx.equity) + ' equity (< $' + c.pdtEquityMin + ') — FINRA pattern-day-trader rule' } : null; } },
      { name: 'require-corroboration', evaluate: function (o, ctx) { return (increasesRisk(o, ctx) && notionalOf(o) > c.corroborationMinNotional && indepSources(o) < 2) ? { rule: 'require-corroboration', detail: 'single-source order > $' + c.corroborationMinNotional + ' — a second independent signal or a human is required', severity: 'review' } : null; } },
      { name: 'live-needs-approval', evaluate: function (o, ctx) { return (c.live && increasesRisk(o, ctx)) ? { rule: 'live-needs-approval', detail: 'live mode — a risk-increasing order awaits human approval (the top tier is unoccupied)', severity: 'review' } : null; } },
    ];
  }

  function reasonOf(decision, severity) {
    return (decision.violations || []).filter(function (v) { return severity ? sev(v) === severity : true; }).map(function (v) { return v.rule + ': ' + v.detail; }).join('; ');
  }

  // --- the NDJSON trace (governed-agents TraceEvent schema) ---
  function Trace(task) {
    const runId = 'gt-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    const events = [];
    function push(e) { e.at = now(); events.push(e); return e; }
    return {
      runId: runId,
      runStarted: function () { return push({ type: 'run_started', runId: runId, task: task }); },
      stepStarted: function (stepId, role) { return push({ type: 'step_started', stepId: stepId, role: role }); },
      stepCompleted: function (stepId, role, summary, provenance) { return push({ type: 'step_completed', stepId: stepId, role: role, summary: summary, provenance: provenance || [] }); },
      actionProposed: function (stepId, action) { return push({ type: 'action_proposed', stepId: stepId, action: action }); },
      gateDecision: function (stepId, decision) { return push({ type: 'gate_decision', stepId: stepId, decision: decision }); },
      executed: function (stepId, result) { return push({ type: 'executed', stepId: stepId, result: result }); },
      awaitingApproval: function (stepId, reason) { return push({ type: 'awaiting_approval', stepId: stepId, reason: reason }); },
      halted: function (stepId, reason) { return push({ type: 'halted', stepId: stepId, reason: reason }); },
      runCompleted: function () { return push({ type: 'run_completed', runId: runId }); },
      events: function () { return events.slice(); },
      toNdjson: function () { return events.map(function (e) { return JSON.stringify(e); }).join('\n') + '\n'; },
    };
  }

  const API = { evaluatePolicy: evaluatePolicy, buildPolicy: buildPolicy, reasonOf: reasonOf, Trace: Trace, notionalOf: notionalOf, indepSources: indepSources };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (root) root.GT_GATE = API;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : null));
