/* ============================================================
   governed-trader — the eval  (node eval/run_eval.js)
   ------------------------------------------------------------
   Turns hand-waved trading claims into reproducible numbers, on real
   (read-only, frozen) market data — 24/7 crypto AND calendar-bound US equities:

     1/3. GOVERNANCE: an ungoverned order stream breaches hard rules on N
          decisions; the governed run — identical tape, signals, sizing, and
          costs, the ONLY difference being the gate — breaches 0, with a named
          rule and a logged reason for each block.
     2/4. HONESTY: the same strategy, reported naively, is overstated vs the
          honest point-in-time, net, dividend-credited result. Equities add the
          two stock-specific lies: a hindsight-picked universe (selection bias)
          and ignored dividends — which UNDERSTATES a long book; the auditor
          refuses misstatement in either direction.

   No alpha is claimed; the strategy is a transparent SMA cross and on this
   equity window it LOSES money honestly — which is the point: the same losing
   strategy "earns" double digits once you let it cheat. Nothing is asserted
   that this script does not compute. CPU-only, no network, no API key.
   ============================================================ */
'use strict';
const C = require('../src/conductor.js');
const AUDIT = require('../src/audit.js');
const EQ = require('../data/equities.js');

function pad(s, n) { s = String(s); return s + ' '.repeat(Math.max(0, n - s.length)); }
function tally(hits) { return Object.keys(hits).sort(function (a, b) { return hits[b] - hits[a]; }).map(function (k) { return k + ' ×' + hits[k]; }).join(', ') || '—'; }

/* ---------------- crypto (BTC/ETH/SOL, 24/7, long/short) ---------------- */
const policyCfg = { maxPositionPct: 0.25, maxGrossLeverage: 0.5, maxDailyLossPct: 0.05, minConfidence: 0.55, maxOrderNotional: 25000, corroborationMinNotional: 30000 };
const ungoverned = C.run({ enforce: false, policyCfg: policyCfg });
const governed = C.run({ enforce: true, policyCfg: policyCfg });
const honesty = AUDIT.honestyReport({});

console.log('governed-trader — eval (real frozen data: BTC/ETH/SOL daily + 10 US equities/ETFs)\n');

console.log('1) GOVERNANCE, crypto — same tape, signals, sizing & costs; the only variable is the gate');
console.log('   ' + pad('', 22) + pad('ungoverned', 14) + 'governed');
console.log('   ' + pad('hard-rule breaches', 22) + pad(ungoverned.breaches, 14) + governed.breaches);
console.log('   ' + pad('blocked / held', 22) + pad('—', 14) + (governed.blocked + ' / ' + governed.held));
console.log('   ' + pad('worst single-day', 22) + pad(ungoverned.worstDayLossPct + '%', 14) + governed.worstDayLossPct + '%   (halt: -' + (policyCfg.maxDailyLossPct * 100) + '%)');
console.log('   ' + pad('net return', 22) + pad(ungoverned.returnPct + '%', 14) + governed.returnPct + '%');
console.log('   rules that did the work: ' + tally(governed.ruleHits) + '\n');

console.log('2) HONESTY, crypto — the same strategy, reported naively vs honestly');
console.log('   ' + pad('naive (peek + 0 cost)', 28) + honesty.naiveReturnPct + '%');
console.log('   ' + pad('honest (point-in-time, net)', 28) + honesty.honestReturnPct + '%');
console.log('   ' + pad('overstatement', 28) + honesty.inflationPctPts + ' pts  (lookahead ' + honesty.fromLookahead + ', costs ' + honesty.fromCosts + ', fees $' + honesty.feesPaid + ')\n');

/* ------------- US equities/ETFs (calendar-bound, long-only, dividends) ------------- */
const eqPolicyCfg = { maxGrossLeverage: 1.0, maxPositionPct: 0.18, maxOrderNotional: 20000, maxDailyLossPct: 0.03, maxGapPct: 0.08, minConfidence: 0.55, corroborationMinNotional: 15000 };
const eqOpts = { data: EQ, policyCfg: eqPolicyCfg, targetPct: 0.15, rebalanceBandPct: 0.05 };
const eqUn = C.run(Object.assign({ enforce: false }, eqOpts));
const eqGo = C.run(Object.assign({ enforce: true }, eqOpts));
const eqH = AUDIT.honestyReportEquities({ policyCfg: eqPolicyCfg, targetPct: 0.15 });

console.log('3) GOVERNANCE, US equities — ' + EQ.instruments.length + ' instruments × ' + EQ.DATES.length + ' trading days (' + EQ.DATES[0] + '..' + EQ.DATES[EQ.DATES.length - 1] + '), long-only');
console.log('   ' + pad('', 22) + pad('ungoverned', 14) + 'governed');
console.log('   ' + pad('hard-rule breaches', 22) + pad(eqUn.breaches, 14) + eqGo.breaches);
console.log('   ' + pad('blocked / held', 22) + pad('—', 14) + (eqGo.blocked + ' / ' + eqGo.held));
console.log('   ' + pad('worst single-day', 22) + pad(eqUn.worstDayLossPct + '%', 14) + eqGo.worstDayLossPct + '%   (halt: -' + (eqPolicyCfg.maxDailyLossPct * 100) + '%)');
console.log('   ' + pad('net return', 22) + pad(eqUn.returnPct + '%', 14) + eqGo.returnPct + '%');
console.log('   ' + pad('dividends credited', 22) + pad('$' + eqUn.divs, 14) + '$' + eqGo.divs);
console.log('   rules that did the work: ' + tally(eqGo.ruleHits) + '\n');

console.log('4) HONESTY, US equities — the four lies, isolated on the same tape');
console.log('   ' + pad('naive (all four lies)', 30) + eqH.naiveReturnPct + '%   (peek + 0 cost + no dividends + hindsight universe: ' + eqH.hindsightUniverse.join(' ') + ')');
console.log('   ' + pad('honest (PIT, net, divs, full)', 30) + eqH.honestReturnPct + '%');
console.log('   ' + pad('overstatement', 30) + eqH.inflationPctPts + ' pts');
console.log('   ' + pad('· lookahead alone', 30) + '+' + eqH.fromLookahead + ' pts  (daily-bar peeking compounds into absurdity — why cheating backtests look like genius)');
console.log('   ' + pad('· zero-cost alone', 30) + '+' + eqH.fromCosts + ' pts  (fees paid honestly: $' + eqH.feesPaid + ')');
console.log('   ' + pad('· hindsight universe alone', 30) + '+' + eqH.fromHindsightUniverse + ' pts  (selection/survivorship bias)');
console.log('   ' + pad('· ignored dividends alone', 30) + eqH.fromIgnoredDividends + ' pts  (NEGATIVE: skipping dividends UNDERSTATES a long book — honesty is not pessimism)');
console.log('   => the honest number is a LOSS (' + eqH.honestReturnPct + '%); the same strategy "earns" ' + eqH.naiveReturnPct + '% once allowed to cheat. No alpha is claimed — that is the point.\n');

const a = AUDIT.attest({ lookahead: false, feeBps: 10, slipBps: 5, dividendsCredited: true });
const b = AUDIT.attest({ lookahead: true, feeBps: 0, slipBps: 0 });
const d = AUDIT.attest({ feeBps: 10, slipBps: 5, dividendsCredited: false, universe: 'hindsight' });
console.log('   attest(point-in-time, net, dividends credited):  ' + (a.clean ? 'CLEAN' : 'REFUSED'));
console.log('   attest(lookahead, zero-cost):                    ' + (b.clean ? 'CLEAN' : 'REFUSED — ' + b.reasons.join('; ')));
console.log('   attest(no dividends, hindsight universe):        ' + (d.clean ? 'CLEAN' : 'REFUSED — ' + d.reasons.join('; ')));
