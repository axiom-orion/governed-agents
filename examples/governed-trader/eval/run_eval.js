/* ============================================================
   governed-trader — the eval  (node eval/run_eval.js)
   ------------------------------------------------------------
   Turns two hand-waved trading claims into reproducible numbers, on real
   (read-only, frozen) crypto data:

     1. GOVERNANCE: an ungoverned order stream breaches hard risk limits on N
        decisions; the governed run — identical signals, sizing, and costs, the
        ONLY difference being the gate — breaches 0 and caps the worst day at the
        configured drawdown halt.
     2. HONESTY: the same strategy, reported naively (peeking + zero cost), is
        overstated by M percentage points vs the honest point-in-time, net result.

   No alpha is claimed; the strategy is a transparent SMA cross. Nothing is
   asserted that this script does not compute. CPU-only, no network, no API key.
   ============================================================ */
'use strict';
const C = require('../src/conductor.js');
const AUDIT = require('../src/audit.js');

const policyCfg = { maxPositionPct: 0.25, maxGrossLeverage: 0.5, maxDailyLossPct: 0.05, minConfidence: 0.55, maxOrderNotional: 25000, corroborationMinNotional: 30000 };

const ungoverned = C.run({ enforce: false, policyCfg: policyCfg });
const governed = C.run({ enforce: true, policyCfg: policyCfg });
const honesty = AUDIT.honestyReport({});

function pad(s, n) { s = String(s); return s + ' '.repeat(Math.max(0, n - s.length)); }
console.log('governed-trader — eval (real BTC/ETH/SOL daily, read-only, frozen)\n');

console.log('1) GOVERNANCE — same signals, sizing & costs; the only variable is the gate');
console.log('   ' + pad('', 22) + pad('ungoverned', 14) + 'governed');
console.log('   ' + pad('risk-limit breaches', 22) + pad(ungoverned.breaches, 14) + governed.breaches);
console.log('   ' + pad('blocked / held', 22) + pad('—', 14) + (governed.blocked + ' / ' + governed.held));
console.log('   ' + pad('worst single-day', 22) + pad(ungoverned.worstDayLossPct + '%', 14) + governed.worstDayLossPct + '%   (halt: -' + (policyCfg.maxDailyLossPct * 100) + '%)');
console.log('   ' + pad('net return', 22) + pad(ungoverned.returnPct + '%', 14) + governed.returnPct + '%');
console.log('   => the gate eliminated ' + ungoverned.breaches + ' breach(es) -> ' + governed.breaches + ', pre-execution, with a logged reason for each.\n');

console.log('2) HONESTY — the same strategy, reported naively vs honestly');
console.log('   ' + pad('naive (peek + 0 cost)', 26) + honesty.naiveReturnPct + '%');
console.log('   ' + pad('honest (point-in-time, net)', 26) + honesty.honestReturnPct + '%');
console.log('   ' + pad('overstatement', 26) + honesty.inflationPctPts + ' pts  (lookahead ' + honesty.fromLookahead + ', costs ' + honesty.fromCosts + ', fees $' + honesty.feesPaid + ')');
console.log('   => the auditor refuses to publish the naive number; only the honest one attests.\n');

const a = AUDIT.attest({ lookahead: false, feeBps: 10, slipBps: 5 });
const b = AUDIT.attest({ lookahead: true, feeBps: 0, slipBps: 0 });
console.log('   attest(point-in-time, net):  ' + (a.clean ? 'CLEAN' : 'REFUSED'));
console.log('   attest(lookahead, zero-cost): ' + (b.clean ? 'CLEAN' : 'REFUSED — ' + b.reasons.join('; ')));
