/* equities self-test — node tests/equities.selftest.js
   The stock-specific machinery: the frozen real dataset's integrity, the
   equity-only gate rules (calendar, gap, PDT), cash-dividend accounting, the
   governed/ungoverned asymmetry on the equity tape, and the four-lie
   backtest-honesty audit (lookahead, costs, dividends, hindsight universe). */
'use strict';
const GATE = require('../src/gate.js');
const BROKER = require('../src/broker.js');
const C = require('../src/conductor.js');
const AUDIT = require('../src/audit.js');
const EQ = require('../data/equities.js');
let pass = 0, fail = 0;
function ok(n, c) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n); } }
function has(d, rule) { return (d.violations || []).some(function (v) { return v.rule === rule; }); }

console.log('equities self-test\n');

/* --- the frozen corpus: real, aligned, dividend-bearing --- */
ok('ten instruments on one shared trading-day axis', EQ.instruments.length === 10 && EQ.SERIES.every(function (s) { return s.closes.length === EQ.DATES.length && s.opens.length === EQ.DATES.length; }));
ok('the axis has no weekends (a US-listed tape)', EQ.DATES.every(function (d) { const wd = new Date(d + 'T12:00:00Z').getUTCDay(); return wd >= 1 && wd <= 5; }));
const axisSet = new Set(EQ.DATES);
const payers = Object.keys(EQ.DIVIDENDS);
ok('dividend payers present (AAPL & TLT among them), every ex-date on the axis, every amount > 0',
  payers.indexOf('AAPL') !== -1 && payers.indexOf('TLT') !== -1 &&
  payers.every(function (k) { return EQ.DIVIDENDS[k].every(function (d) { return axisSet.has(d.ex) && d.amount > 0; }); }));
ok('subset() restricts instruments and their dividends', (function () { const s = EQ.subset(['AAPL', 'GLD']); return s.instruments.join(',') === 'AAPL,GLD' && Object.keys(s.DIVIDENDS).join(',') === 'AAPL'; })());

/* --- equity-only gate rules --- */
const policy = GATE.buildPolicy({ maxGapPct: 0.08, pdtEquityMin: 25000, pdtMaxDayTrades: 3 });
const ctx = { equity: 100000, positions: {}, grossNotional: 0, dayStartEquity: 100000, dayPnl: 0, refPrice: 200, tradingDays: axisSet };
const entry = { instrument: 'AAPL', side: 'buy', qty: 10, price: 200, confidence: 0.8, dataAgeSec: 0, provenance: [{ sourceId: 'ta:sma-cross', score: 0.8 }], assetClass: 'equity', t: EQ.DATES[100] };

ok('a clean equity order on a trading day is ALLOWED', GATE.evaluatePolicy(entry, ctx, policy).decision === 'allow');
ok('an order dated on a holiday/weekend -> market-closed block', has(GATE.evaluatePolicy(Object.assign({}, entry, { t: '2025-01-01' }), ctx, policy), 'market-closed'));
ok('new risk into a 12% opening gap -> gap-circuit-breaker block', has(GATE.evaluatePolicy(Object.assign({}, entry, { gapPct: 0.12 }), ctx, policy), 'gap-circuit-breaker'));
ok('...but the EXIT on the same gap day stays allowed (reduce-only exemption)',
  GATE.evaluatePolicy(Object.assign({}, entry, { side: 'sell', gapPct: 0.12 }), Object.assign({}, ctx, { positions: { AAPL: 10 } }), policy).decision === 'allow');
ok('a crypto order is exempt from the equity gap rule', !has(GATE.evaluatePolicy(Object.assign({}, entry, { assetClass: 'crypto', gapPct: 0.12, t: null }), ctx, policy), 'gap-circuit-breaker'));
const pdtCtx = Object.assign({}, ctx, { equity: 20000, dayTradesLast5: 3 });
ok('4th day trade under $25k equity -> pdt-rule block (FINRA trip-wire)', has(GATE.evaluatePolicy(Object.assign({}, entry, { isDayTrade: true }), pdtCtx, policy), 'pdt-rule'));
ok('...and the same trade clears at $30k equity', !has(GATE.evaluatePolicy(Object.assign({}, entry, { isDayTrade: true }), Object.assign({}, pdtCtx, { equity: 30000 }), policy), 'pdt-rule'));

/* --- dividends are cash on the ex-date, sign-correct --- */
const b = BROKER.Broker({ cash: 10000, feeBps: 0, slipBps: 0 });
b.fill({ instrument: 'TLT', side: 'buy', qty: 100, price: 90 });
const credited = b.dividend('TLT', 0.30);
ok('a long 100 shares is credited 100 × the per-share dividend', credited === 30 && b.divs() === 30);
ok('no position, no dividend', b.dividend('AAPL', 0.25) === 0);
const s = BROKER.Broker({ cash: 10000 }); s.fill({ instrument: 'TLT', side: 'sell', qty: 50, price: 90 });
ok('a short PAYS the dividend (sign falls out of the position)', s.dividend('TLT', 0.30) === -15);

/* --- the governed/ungoverned asymmetry on the real equity tape --- */
const policyCfg = { maxGrossLeverage: 1.0, maxPositionPct: 0.18, maxOrderNotional: 20000, maxDailyLossPct: 0.03, maxGapPct: 0.08, minConfidence: 0.55, corroborationMinNotional: 15000 };
const opts = { data: EQ, policyCfg: policyCfg, targetPct: 0.15, rebalanceBandPct: 0.05 };
const ung = C.run(Object.assign({ enforce: false }, opts));
const gov = C.run(Object.assign({ enforce: true }, opts));
ok('ungoverned breaches hard rules on the equity tape', ung.breaches > 0);
ok('governed breaches ZERO (pre-execution)', gov.breaches === 0);
ok('governed still trades', gov.fills > 0);
ok('governed gated orders (blocked or held for a human)', gov.blocked + gov.held > 0);
ok('both runs walked the identical tape', gov.bars === ung.bars && gov.bars === 3570);
ok('dividends were credited as cash during the run', gov.divs > 0);
ok('the equity book is long-only (no borrow/locate is modeled)', gov.assetClass === 'equity');
ok('named rules did the work (a per-rule tally exists, blocks AND review/holds)', Object.keys(gov.ruleHits).length > 0 && Object.keys(gov.ruleHits).every(function (k) { return gov.ruleHits[k] > 0; }));
ok('max drawdown is a non-positive, finite peak-to-trough number', gov.maxDrawdownPct <= 0 && gov.maxDrawdownPct > -100 && isFinite(gov.maxDrawdownPct));

/* --- the NDJSON glass-box: a traced governed run is well-formed and shows every branch --- */
const traced = C.run({ enforce: true, data: EQ.subset(['PTON', 'AAPL']), policyCfg: { maxGrossLeverage: 1.0, maxPositionPct: 0.30, maxOrderNotional: 20000, maxDailyLossPct: 0.03, maxGapPct: 0.08, minConfidence: 0.55, corroborationMinNotional: 8500 }, targetPct: 0.10, rebalanceBandPct: 0.03, trace: true });
const lines = traced.trace.toNdjson().trim().split('\n').map(function (l) { return JSON.parse(l); });
const types = {}; lines.forEach(function (e) { types[e.type] = 1; });
const outcomes = {}; lines.filter(function (e) { return e.type === 'gate_decision'; }).forEach(function (e) { outcomes[e.decision.decision] = 1; });
ok('the trace is valid NDJSON, run_started..run_completed', lines[0].type === 'run_started' && lines[lines.length - 1].type === 'run_completed');
ok('the trace records the full decision lifecycle (proposed → decision → executed/halted/awaiting)', types.action_proposed && types.gate_decision && types.executed && types.halted && types.awaiting_approval);
ok('the slice exercises all three gate outcomes (allow + block + needs_approval)', outcomes.allow && outcomes.block && outcomes.needs_approval);

/* --- the four-lie audit --- */
const h = AUDIT.honestyReportEquities({ policyCfg: policyCfg, targetPct: 0.15 });
ok('lookahead inflates the equity backtest', h.fromLookahead > 0);
ok('zero-cost inflates it', h.fromCosts > 0);
ok('ignoring dividends UNDERSTATES a long book (honesty is not pessimism)', h.fromIgnoredDividends < 0);
ok('a hindsight-picked universe inflates it (selection bias)', h.fromHindsightUniverse > 0);
ok('the naive number (all four lies at once) is above the honest one', h.naiveReturnPct > h.honestReturnPct);
ok('attest CLEAN for the honest spec', AUDIT.attest({ lookahead: false, feeBps: 10, slipBps: 5, dividendsCredited: true, universe: 'point-in-time' }).clean);
ok('attest REFUSES ignored dividends', !AUDIT.attest({ feeBps: 10, slipBps: 5, dividendsCredited: false }).clean);
ok('attest REFUSES a hindsight universe', !AUDIT.attest({ feeBps: 10, slipBps: 5, universe: 'hindsight' }).clean);
console.log('  · honest ' + h.honestReturnPct + '% vs naive ' + h.naiveReturnPct + '% (lookahead ' + h.fromLookahead + ', costs ' + h.fromCosts + ', dividends ' + h.fromIgnoredDividends + ', selection ' + h.fromHindsightUniverse + ' pts)');

console.log('\n' + pass + ' passed, ' + fail + ' failed.');
process.exit(fail ? 1 : 0);
