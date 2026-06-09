/* audit self-test — node tests/audit.selftest.js
   The honesty auditor detects the two lies and refuses to attest a cheated run. */
'use strict';
const AUDIT = require('../src/audit.js');
let pass = 0, fail = 0;
function ok(n, c) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n); } }

const r = AUDIT.honestyReport({});
console.log('audit self-test\n');
ok('the naive backtest reports a higher return than the honest one', r.naiveReturnPct > r.honestReturnPct);
ok('the overstatement is positive', r.inflationPctPts > 0);
ok('lookahead inflates the return', r.fromLookahead > 0);
ok('costs (fees + slippage) reduce the return', r.fromCosts >= 0 && r.feesPaid > 0);
ok('attest CLEAN for a point-in-time, net-of-cost run', AUDIT.attest({ lookahead: false, feeBps: 10, slipBps: 5 }).clean === true);
ok('attest REFUSES a lookahead run', AUDIT.attest({ lookahead: true, feeBps: 10, slipBps: 5 }).clean === false);
ok('attest REFUSES a zero-cost run', AUDIT.attest({ lookahead: false, feeBps: 0, slipBps: 0 }).clean === false);
console.log('  · honest ' + r.honestReturnPct + '% vs naive ' + r.naiveReturnPct + '% (overstated ' + r.inflationPctPts + ' pts)');

console.log('\n' + pass + ' passed, ' + fail + ' failed.');
process.exit(fail ? 1 : 0);
