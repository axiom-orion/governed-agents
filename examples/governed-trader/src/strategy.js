/* ============================================================
   governed-trader — the strategy (the vehicle, not the point)  (GT_STRATEGY)
   ------------------------------------------------------------
   A deliberately TRANSPARENT signal: a fast/slow SMA momentum cross. We make
   NO alpha claim — the strategy exists only to generate orders for the gate to
   govern. Confidence is the normalized SMA gap; provenance is the one signal it
   rests on (so the corroboration rule has something to check). Pure and
   point-in-time: it only ever sees closes up to and including "now".

   Runs no-build under Node and in the browser.
   ============================================================ */
(function (root) {
  'use strict';
  function sma(a, n) { if (a.length < n) return null; let s = 0; for (let i = a.length - n; i < a.length; i++) s += a[i]; return s / n; }
  // closes: point-in-time history (ascending), closes[last] is the current bar.
  function signal(closes, cfg) {
    cfg = cfg || {};
    const fast = cfg.fast || 3, slow = cfg.slow || 8, scale = cfg.scale || 0.03;
    const f = sma(closes, fast), s = sma(closes, slow);
    if (f == null || s == null) return { side: 'flat', confidence: 0, gap: 0, provenance: [] };
    const gap = (f - s) / s;
    const side = gap > 0.0005 ? 'buy' : gap < -0.0005 ? 'sell' : 'flat';
    const confidence = Math.min(1, Math.abs(gap) / scale);
    return { side: side, confidence: +confidence.toFixed(3), gap: +gap.toFixed(4), provenance: [{ sourceId: 'ta:sma-cross', score: +confidence.toFixed(3), ageSec: 0 }] };
  }
  const API = { signal: signal, sma: sma };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (root) root.GT_STRATEGY = API;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : null));
