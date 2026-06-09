/* ============================================================
   governed-trader — emit a real NDJSON audit trace  (node eval/emit_trace.js)
   ------------------------------------------------------------
   The glass-box, made concrete. Runs the GOVERNED loop on a two-name equity
   slice chosen to exercise every outcome — a crashed momentum name (PTON:
   gaps + blocks) and a dividend payer (AAPL: corroboration holds + a credited
   ex-date) — and streams the same NDJSON `TraceEvent` schema governed-agents
   renders in its trace UI. Each line is one event: run_started, action_proposed,
   gate_decision (allow / block / needs_approval, with the named rule + reason),
   executed / awaiting_approval / halted, run_completed.

       node eval/emit_trace.js              # pretty summary + a readable sample
       node eval/emit_trace.js --ndjson > trace.ndjson   # the full machine-readable stream

   Nothing is placed; this is the decision record of a paper run.
   ============================================================ */
'use strict';
const C = require('../src/conductor.js');
const EQ = require('../data/equities.js');

// thresholds chosen so the slice exercises ALL THREE outcomes (allow, block, hold) plus
// real executions and a credited dividend — a glass-box that shows the whole machine.
const policyCfg = { maxGrossLeverage: 1.0, maxPositionPct: 0.30, maxOrderNotional: 20000, maxDailyLossPct: 0.03, maxGapPct: 0.08, minConfidence: 0.55, corroborationMinNotional: 8500 };
const res = C.run({ enforce: true, data: EQ.subset(['PTON', 'AAPL']), policyCfg: policyCfg, targetPct: 0.10, rebalanceBandPct: 0.03, trace: true });
const events = res.trace.events();

// --ndjson: the full machine-readable stream (pipe it to a file or a viewer)
if (process.argv.indexOf('--ndjson') !== -1) { process.stdout.write(res.trace.toNdjson()); process.exit(0); }

// default: a human summary + a readable sample of the decision points
function count(type) { return events.filter(function (e) { return e.type === type; }).length; }
const decisions = events.filter(function (e) { return e.type === 'gate_decision'; });
const tallyOutcome = decisions.reduce(function (m, e) { m[e.decision.decision] = (m[e.decision.decision] || 0) + 1; return m; }, {});

console.log('governed-trader — NDJSON audit trace (governed run, PTON + AAPL slice)\n');
console.log('run ' + res.trace.runId + ' · ' + events.length + ' events · '
  + count('action_proposed') + ' proposed → '
  + (tallyOutcome.allow || 0) + ' allow / ' + (tallyOutcome.block || 0) + ' block / ' + (tallyOutcome.needs_approval || 0) + ' needs_approval'
  + ' · ' + count('executed') + ' executed, ' + count('halted') + ' halted, ' + count('awaiting_approval') + ' held');
console.log('result: ' + res.returnPct + '% net · ' + res.blocked + ' blocked · ' + res.held + ' held · $' + res.divs + ' dividends credited\n');

// show the first proposed→decision→outcome of each KIND so every branch is visible
console.log('a readable sample — one of each outcome (full stream: `node eval/emit_trace.js --ndjson > trace.ndjson`)\n');
['block', 'needs_approval', 'allow'].forEach(function (kind) {
  const gd = decisions.find(function (e) { return e.decision.decision === kind; });
  if (!gd) return;
  const proposed = events.find(function (e) { return e.type === 'action_proposed' && e.stepId === gd.stepId; });
  const o = proposed.action;
  const reason = (gd.decision.violations || []).map(function (v) { return v.rule; }).join(', ') || '(clean)';
  console.log('  ' + kind.toUpperCase());
  console.log('    proposed : ' + o.side + ' ' + o.qty.toFixed(2) + ' ' + o.instrument + ' @ ' + o.price + (o.gapPct != null ? ' (gap ' + (o.gapPct * 100).toFixed(1) + '%)' : ''));
  console.log('    decision : ' + gd.decision.decision + (reason !== '(clean)' ? ' — ' + reason : ''));
  console.log('    ' + JSON.stringify(gd).slice(0, 160) + (JSON.stringify(gd).length > 160 ? '…' : ''));
});
console.log('\n(each printed line above is one NDJSON event; redirect stdout to capture all ' + events.length + ' of them.)');
