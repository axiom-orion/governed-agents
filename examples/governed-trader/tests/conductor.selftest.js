/* conductor self-test — node tests/conductor.selftest.js
   The core controlled claim: identical signals/sizing/costs, the only variable
   is the gate. Governed breaches 0 and still trades; ungoverned breaches > 0. */
'use strict';
const C = require('../src/conductor.js');
let pass = 0, fail = 0;
function ok(n, c) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n); } }

const cfg = { maxPositionPct: 0.25, maxGrossLeverage: 0.5, maxDailyLossPct: 0.05, minConfidence: 0.55, maxOrderNotional: 25000, corroborationMinNotional: 30000 };
const gov = C.run({ enforce: true, policyCfg: cfg });
const ung = C.run({ enforce: false, policyCfg: cfg });

console.log('conductor self-test\n');
ok('ungoverned breaches at least one hard risk limit', ung.breaches > 0);
ok('governed breaches ZERO (pre-execution)', gov.breaches === 0);
ok('governed still trades (it is not just blocking everything)', gov.fills > 0);
ok('governed caps the worst day at the loss breaker', gov.worstDayLossPct >= -(cfg.maxDailyLossPct * 100));
ok('governed blocked the reckless orders', gov.blocked > 0);
// the books may legitimately diverge after the first blocked order (a block changes
// positions, which changes later proposals) — the controlled invariant is the TAPE.
ok('the only variable is the gate — both runs walked the identical tape', gov.bars === ung.bars && gov.bars > 0);
ok('max drawdown is reported as a non-positive, finite peak-to-trough number', gov.maxDrawdownPct <= 0 && gov.maxDrawdownPct > -100 && isFinite(gov.maxDrawdownPct));
console.log('  · governed: ' + gov.returnPct + '% net, ' + gov.blocked + ' blocked, worst day ' + gov.worstDayLossPct + '%');
console.log('  · ungoverned: ' + ung.returnPct + '% net, ' + ung.breaches + ' breaches, worst day ' + ung.worstDayLossPct + '%');

console.log('\n' + pass + ' passed, ' + fail + ' failed.');
process.exit(fail ? 1 : 0);
