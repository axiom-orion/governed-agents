/* gate self-test — node tests/gate.selftest.js
   Every risk rule blocks/allows as specified, the demo's threshold-flip holds,
   and the NDJSON trace is well-formed. Exit 0 = all pass. */
'use strict';
const GATE = require('../src/gate.js');
let pass = 0, fail = 0;
function ok(n, c) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n); } }
function has(d, rule) { return (d.violations || []).some(function (v) { return v.rule === rule; }); }

const ctx = { equity: 100000, positions: {}, grossNotional: 0, dayStartEquity: 100000, dayPnl: 0, refPrice: 60000 };
const policy = GATE.buildPolicy({ maxOrderNotional: 25000, maxPositionPct: 0.25, maxGrossLeverage: 0.5, minConfidence: 0.55, maxDataAgeSec: 120, maxPriceDeviation: 0.05, corroborationMinNotional: 30000, restricted: ['LUNA_USDT'] });
const clean = { instrument: 'BTC_USDT', side: 'buy', qty: 0.1, price: 60000, confidence: 0.8, dataAgeSec: 0, provenance: [{ sourceId: 'ta:sma-cross', score: 0.8 }] };

console.log('gate self-test\n');
ok('a clean order is ALLOWED', GATE.evaluatePolicy(clean, ctx, policy).decision === 'allow');
ok('no provenance -> block', has(GATE.evaluatePolicy(Object.assign({}, clean, { provenance: [] }), ctx, policy), 'require-provenance'));
ok('restricted symbol -> block', has(GATE.evaluatePolicy(Object.assign({}, clean, { instrument: 'LUNA_USDT' }), ctx, policy), 'restricted-symbol'));
ok('stale data -> block', has(GATE.evaluatePolicy(Object.assign({}, clean, { dataAgeSec: 600 }), ctx, policy), 'stale-data'));
ok('off-market price -> block', has(GATE.evaluatePolicy(Object.assign({}, clean, { price: 80000 }), ctx, policy), 'off-market-price'));
ok('below confidence floor -> block', has(GATE.evaluatePolicy(Object.assign({}, clean, { confidence: 0.3 }), ctx, policy), 'min-confidence'));
ok('over per-order notional -> block', has(GATE.evaluatePolicy(Object.assign({}, clean, { qty: 1 }), ctx, policy), 'max-order-notional'));
ok('over position % -> block', has(GATE.evaluatePolicy({ instrument: 'BTC_USDT', side: 'buy', qty: 0.5, price: 60000, confidence: 0.8, provenance: [{ sourceId: 'a' }, { sourceId: 'b' }] }, ctx, GATE.buildPolicy({ maxOrderNotional: 1e9, maxPositionPct: 0.25 })), 'max-position-pct'));
ok('over gross leverage -> block', has(GATE.evaluatePolicy(clean, Object.assign({}, ctx, { grossNotional: 49000 }), policy), 'max-gross-leverage'));
ok('past the daily-loss halt + risk-increasing -> block', has(GATE.evaluatePolicy(clean, Object.assign({}, ctx, { dayPnl: -6000 }), policy), 'daily-loss-breaker'));
ok('single-source order above the floor -> needs_approval (review)', GATE.evaluatePolicy({ instrument: 'BTC_USDT', side: 'buy', qty: 1, price: 60000, confidence: 0.9, provenance: [{ sourceId: 'ta:sma-cross' }] }, ctx, GATE.buildPolicy({ maxOrderNotional: 1e9, maxPositionPct: 1, corroborationMinNotional: 30000 })).decision === 'needs_approval');

/* reduce-only exemption: size + conviction caps gate NEW risk only — a book must
   always be allowed to trade toward flat, else its own caps trap it over a limit. */
const longCtx = Object.assign({}, ctx, { positions: { BTC_USDT: 1.0 }, grossNotional: 60000 });
const exit = { instrument: 'BTC_USDT', side: 'sell', qty: 1.0, price: 60000, confidence: 0.1, dataAgeSec: 0, provenance: [{ sourceId: 'ta:sma-cross', score: 0.1 }] };
ok('a $60k EXIT passes the $25k order cap, the leverage cap, and the conviction floor (reduce-only exemption)',
  GATE.evaluatePolicy(exit, longCtx, policy).decision === 'allow');
ok('...but the same $60k order as a fresh ENTRY is blocked by all three',
  (function () { const d = GATE.evaluatePolicy(Object.assign({}, exit, { side: 'buy' }), longCtx, policy); return has(d, 'max-order-notional') && has(d, 'max-gross-leverage') && has(d, 'min-confidence'); })());
ok('sanity rules still apply to a reducing order (stale data blocks the exit too)',
  has(GATE.evaluatePolicy(Object.assign({}, exit, { dataAgeSec: 600 }), longCtx, policy), 'stale-data'));

/* the signature demo: edit a threshold and the same order flips */
const o = Object.assign({}, clean, { qty: 0.1 }); // $6,000
ok('$6k order BLOCKED at a $5k cap', GATE.evaluatePolicy(o, ctx, GATE.buildPolicy({ maxOrderNotional: 5000 })).decision === 'block');
ok('...and FLIPS to allow at a $50k cap', GATE.evaluatePolicy(o, ctx, GATE.buildPolicy({ maxOrderNotional: 50000 })).decision === 'allow');

/* live mode: the top tier is unoccupied — risk-increasing orders await a human */
ok('live mode routes a risk-increasing order to needs_approval', GATE.evaluatePolicy(clean, ctx, GATE.buildPolicy({ live: true })).decision === 'needs_approval');

/* trace */
const t = GATE.Trace('test'); t.runStarted(); t.actionProposed('s', clean); t.gateDecision('s', GATE.evaluatePolicy(clean, ctx, policy)); t.executed('s', 'buy'); t.runCompleted();
const lines = t.toNdjson().trim().split('\n').map(function (l) { return JSON.parse(l); });
ok('trace is valid NDJSON, run_started..run_completed', lines[0].type === 'run_started' && lines[lines.length - 1].type === 'run_completed' && lines.some(function (e) { return e.type === 'gate_decision'; }));

console.log('\n' + pass + ' passed, ' + fail + ' failed.');
process.exit(fail ? 1 : 0);
