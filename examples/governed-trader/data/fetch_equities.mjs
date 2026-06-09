/* ============================================================
   governed-trader — equities data fetcher (run manually, once)
   ------------------------------------------------------------
   Fetches real daily OHLC + dividend events for the US equity/ETF universe
   from the Yahoo Finance public chart API (read-only; NO order placement)
   and freezes them into data/equities.js so the backtest is reproducible by
   anyone, offline, with no API key. CI never runs this — the frozen file is
   the corpus.

   Honesty constraints enforced here, at generation time:
     • the window must contain NO split events for any symbol (so raw traded
       prices are position-continuous and we never trade at adjusted prices);
     • every symbol must share the same trading-day calendar (one DATES axis);
     • no null bars survive.

   Usage:  node data/fetch_equities.mjs        (writes data/equities.js)
   ============================================================ */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const UNIVERSE = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'TSLA', 'PTON', 'RIVN', 'GLD', 'TLT'];
const START = '2025-01-02', END = '2026-06-07'; // window chosen after all 2024 splits (e.g. NVDA 10:1 2024-06-10)
const p1 = Math.floor(Date.parse(START + 'T00:00:00Z') / 1000);
const p2 = Math.floor(Date.parse(END + 'T00:00:00Z') / 1000);
const UA = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' };

function dayOf(ts) { return new Date(ts * 1000).toISOString().slice(0, 10); } // 09:30 ET stamps land on the same UTC date
function round(x, dp) { return +x.toFixed(dp); }

async function fetchSym(sym) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?period1=${p1}&period2=${p2}&interval=1d&events=div%2Csplit`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${sym}: HTTP ${res.status}`);
  const j = await res.json();
  const r = j.chart && j.chart.result && j.chart.result[0];
  if (!r) throw new Error(`${sym}: empty chart result`);
  const q = r.indicators.quote[0];
  const rows = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    if (q.close[i] == null || q.open[i] == null) continue; // drop null bars
    const dp = q.close[i] < 10 ? 4 : 2;
    rows.push({ d: dayOf(r.timestamp[i]), o: round(q.open[i], dp), c: round(q.close[i], dp) });
  }
  const ev = r.events || {};
  const splits = Object.values(ev.splits || {});
  if (splits.length) throw new Error(`${sym}: ${splits.length} split event(s) inside the window — pick a split-free window`);
  const divs = Object.values(ev.dividends || {})
    .map((d) => ({ ex: dayOf(d.date), amount: round(d.amount, 4) }))
    .sort((a, b) => (a.ex < b.ex ? -1 : 1));
  return { sym, rows, divs };
}

const out = [];
for (const sym of UNIVERSE) {
  out.push(await fetchSym(sym));
  await new Promise((r) => setTimeout(r, 400)); // be polite
  console.error(`${sym}: ${out[out.length - 1].rows.length} bars, ${out[out.length - 1].divs.length} dividends`);
}

// one shared trading-day axis — refuse to freeze a corpus where calendars diverge
const axis = out[0].rows.map((r) => r.d);
for (const s of out) {
  const ds = s.rows.map((r) => r.d);
  if (ds.length !== axis.length || ds.some((d, i) => d !== axis[i]))
    throw new Error(`${s.sym}: trading-day calendar differs from ${out[0].sym} (${ds.length} vs ${axis.length} bars)`);
}
// every dividend ex-date must be a trading day on the axis
const axisSet = new Set(axis);
for (const s of out) for (const d of s.divs) if (!axisSet.has(d.ex)) throw new Error(`${s.sym}: dividend ex-date ${d.ex} not on the trading axis`);

const captured = new Date().toISOString().slice(0, 10);
const lines = [];
lines.push('/* ============================================================');
lines.push('   governed-trader — bundled US equities/ETF data (real, read-only)');
lines.push('   ------------------------------------------------------------');
lines.push('   Daily opens + closes and cash-dividend events for ten US-listed');
lines.push('   instruments, fetched once from the Yahoo Finance public chart API');
lines.push('   (read-only; NO order placement) and frozen here so the backtest is');
lines.push('   reproducible by anyone, offline, with no API key.');
lines.push('');
lines.push('   Prices are RAW traded prices (not dividend-adjusted); dividends are');
lines.push('   separate events the broker credits as CASH on the ex-date — the honest');
lines.push('   accounting. The window was chosen split-free and that is ASSERTED at');
lines.push('   generation time (see fetch_equities.mjs), so raw prices are position-');
lines.push('   continuous. All symbols share one trading-day calendar (also asserted).');
lines.push('');
lines.push(`   Source: Yahoo Finance v8 chart API · interval 1d · events=div,split`);
lines.push(`   Window: ${axis[0]} .. ${axis[axis.length - 1]} (${axis.length} trading days) · Captured: ${captured}`);
lines.push(`   Regenerate: node data/fetch_equities.mjs`);
lines.push('   ============================================================ */');
lines.push('(function (root) {');
lines.push("  'use strict';");
lines.push(`  // the shared trading-day axis — weekends + NYSE holidays are simply absent`);
lines.push(`  const DATES = ${JSON.stringify(axis)};`);
lines.push('  const SERIES = [');
for (const s of out) {
  lines.push(`    { instrument: '${s.sym}',`);
  lines.push(`      opens:  [${s.rows.map((r) => r.o).join(', ')}],`);
  lines.push(`      closes: [${s.rows.map((r) => r.c).join(', ')}] },`);
}
lines.push('  ];');
lines.push('  // cash dividends by ex-date (per share). Holders as of the prior close are paid.');
lines.push('  const DIVIDENDS = {');
for (const s of out) if (s.divs.length) lines.push(`    ${s.sym}: ${JSON.stringify(s.divs)},`);
lines.push('  };');
lines.push("  // bars(): a flat, time-ordered tape across instruments — [{ t, instrument, open, close, i }]");
lines.push('  function bars() {');
lines.push('    const o = [];');
lines.push('    SERIES.forEach(function (s) { s.closes.forEach(function (c, i) { o.push({ t: DATES[i], instrument: s.instrument, open: s.opens[i], close: c, i: i }); }); });');
lines.push('    o.sort(function (a, b) { return a.t < b.t ? -1 : a.t > b.t ? 1 : (a.instrument < b.instrument ? -1 : 1); });');
lines.push('    return o;');
lines.push('  }');
lines.push('  // subset(instruments): the same dataset restricted to a chosen universe —');
lines.push('  // how the auditor builds the "hindsight" universe to measure selection bias.');
lines.push('  function subset(instruments) {');
lines.push('    const keep = {}; instruments.forEach(function (i) { keep[i] = 1; });');
lines.push('    const S = SERIES.filter(function (s) { return keep[s.instrument]; });');
lines.push('    const D = {}; Object.keys(DIVIDENDS).forEach(function (k) { if (keep[k]) D[k] = DIVIDENDS[k]; });');
lines.push('    return makeAPI(S, D);');
lines.push('  }');
lines.push('  function makeAPI(S, D) {');
lines.push('    return {');
lines.push("      assetClass: 'equity', DATES: DATES, SERIES: S, DIVIDENDS: D,");
lines.push('      instruments: S.map(function (s) { return s.instrument; }),');
lines.push('      bars: function () { const o = []; S.forEach(function (s) { s.closes.forEach(function (c, i) { o.push({ t: DATES[i], instrument: s.instrument, open: s.opens[i], close: c, i: i }); }); }); o.sort(function (a, b) { return a.t < b.t ? -1 : a.t > b.t ? 1 : (a.instrument < b.instrument ? -1 : 1); }); return o; },');
lines.push('      subset: subset,');
lines.push('    };');
lines.push('  }');
lines.push('  const API = makeAPI(SERIES, DIVIDENDS);');
lines.push('  API.bars = bars; // identical, kept for symmetry with candles.js');
lines.push('  if (typeof module !== \'undefined\' && module.exports) module.exports = API;');
lines.push('  if (root) root.GT_EQUITIES = API;');
lines.push("})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : null));");
lines.push('');

const dest = join(dirname(fileURLToPath(import.meta.url)), 'equities.js');
writeFileSync(dest, lines.join('\n'));
console.error(`wrote ${dest}: ${UNIVERSE.length} symbols × ${axis.length} days`);
