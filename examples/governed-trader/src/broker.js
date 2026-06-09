/* ============================================================
   governed-trader — the paper broker  (GT_BROKER)
   ------------------------------------------------------------
   A simulated venue: fills at the bar close with explicit SLIPPAGE and a taker
   FEE, tracks positions + cash, and marks the book to market. No real orders are
   ever placed — this is paper/sim only. Modeling fees + slippage honestly is the
   whole point of the backtest-honesty auditor: a "naive" run sets them to zero
   and overstates returns.

   Runs no-build under Node and in the browser.
   ============================================================ */
(function (root) {
  'use strict';
  function Broker(opts) {
    opts = opts || {};
    const feeBps = opts.feeBps != null ? opts.feeBps : 10;   // taker fee, basis points
    const slipBps = opts.slipBps != null ? opts.slipBps : 5; // slippage, basis points
    let cash = opts.cash != null ? opts.cash : 100000;
    const positions = {};
    let fees = 0, slippagePaid = 0;
    return {
      cash: function () { return cash; },
      positions: function () { return Object.assign({}, positions); },
      fees: function () { return fees; },
      grossNotional: function (prices) { let g = 0; Object.keys(positions).forEach(function (i) { g += Math.abs(positions[i] * (prices[i] || 0)); }); return g; },
      equity: function (prices) { let v = cash; Object.keys(positions).forEach(function (i) { v += positions[i] * (prices[i] || 0); }); return v; },
      // execute a fill at order.price, applying slippage (pay up to buy, sell lower) + fee.
      fill: function (order) {
        const dir = order.side === 'sell' ? -1 : 1;
        const px = order.price * (1 + dir * (slipBps / 10000));
        const fee = Math.abs(order.qty * px) * (feeBps / 10000);
        cash -= dir * order.qty * px;
        cash -= fee;
        fees += fee;
        slippagePaid += Math.abs(order.qty * order.price) * (slipBps / 10000);
        positions[order.instrument] = (positions[order.instrument] || 0) + dir * order.qty;
        return { px: px, fee: fee };
      },
    };
  }
  const API = { Broker: Broker };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (root) root.GT_BROKER = API;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : null));
