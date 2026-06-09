/* ============================================================
   governed-trader — bundled market data (real, read-only)
   ------------------------------------------------------------
   Daily closes for three instruments, fetched once from the Crypto.com
   Exchange public market-data API (read-only; NO order placement) and frozen
   here so the backtest is reproducible by anyone, offline, with no API key —
   the same eval-corpus discipline the other axiom-orion repos use.

   Source: Crypto.com Exchange · get_candlestick · timeframe 1D
   Captured: 2026-06-09 · close-to-close · ascending by day.
   ============================================================ */
(function (root) {
  'use strict';
  const SERIES = [
    { instrument: 'BTC_USDT', timeframe: '1D', start: '2026-05-20',
      closes: [77552.02, 77616.72, 75541.10, 76755.67, 77074.00, 77316.28, 75938.10, 74444.48, 73623.69, 73458.65, 73888.02, 73691.71, 71414.74, 66751.94, 64144.92, 63884.91, 61061.17, 60888.73, 63332.76, 63091.06, 60950.17] },
    { instrument: 'ETH_USDT', timeframe: '1D', start: '2026-05-20',
      closes: [2129.49, 2134.05, 2065.96, 2117.38, 2099.87, 2112.72, 2074.05, 2024.71, 2009.41, 2014.26, 2022.72, 2006.97, 2006.70, 1860.13, 1813.14, 1770.65, 1583.49, 1569.62, 1690.68, 1690.17, 1628.91] },
    { instrument: 'SOL_USDT', timeframe: '1D', start: '2026-05-20',
      closes: [86.17, 87.36, 84.38, 85.77, 85.27, 85.05, 83.72, 82.44, 82.12, 82.04, 82.74, 82.44, 81.27, 74.23, 71.62, 68.87, 63.64, 62.21, 66.50, 66.82, 64.13] },
  ];
  function dayISO(start, i) { const d = new Date(start + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); }
  // bars(): a flat, time-ordered tape across instruments — [{ t, instrument, close }]
  function bars() {
    const out = [];
    SERIES.forEach(function (s) { s.closes.forEach(function (c, i) { out.push({ t: dayISO(s.start, i), instrument: s.instrument, close: c, i: i }); }); });
    out.sort(function (a, b) { return a.t < b.t ? -1 : a.t > b.t ? 1 : (a.instrument < b.instrument ? -1 : 1); });
    return out;
  }
  const API = { SERIES: SERIES, bars: bars, instruments: SERIES.map(function (s) { return s.instrument; }) };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (root) root.GT_DATA = API;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : null));
