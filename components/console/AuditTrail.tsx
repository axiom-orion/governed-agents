// components/console/AuditTrail.tsx
// The Truth Chain as it fills: every decision writes a COSIGN_DECISION (intent) and a
// COSIGN_RESULT (outcome); a timed-out hold writes a COSIGN_TIMEOUT server-side. Each row
// shows its hash so the linkage is visible. Honest scope: this is tamper-EVIDENT (an edit
// breaks the chain) but not tamper-PROOF — a holder of write access could rewrite it; true
// WORM needs an external ledger.

import type { AuditRow } from "./CosignHoldCard";

export function AuditTrail({ rows }: { rows: readonly AuditRow[] }) {
  return (
    <section aria-label="Audit trail" className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-slate-900">Truth Chain</h2>
        <span className="text-[11px] text-slate-400">append-only · hash-linked</span>
      </header>
      <div className="p-4">
        {rows.length === 0 ? (
          <p className="text-sm text-slate-400">
            No decisions yet. Approve, reject, or let a hold time out — each writes a hash-linked row
            here.
          </p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {rows.map((row, i) => (
              <li
                key={row.hash ?? `${row.eventType}-${row.ts}-${i}`}
                className="flex items-center gap-2 rounded-md border border-slate-100 bg-slate-50/60 px-2.5 py-1.5 text-[11px]"
              >
                <span className="font-mono text-slate-300">{(i + 1).toString().padStart(2, "0")}</span>
                <span className="font-semibold text-slate-700">{row.eventType}</span>
                <span className="text-slate-400">{row.actor}</span>
                <span className="ml-auto font-mono text-slate-400">
                  {row.hash ? `${row.hash.slice(0, 14)}…` : row.note ?? ""}
                </span>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-3 text-[10px] leading-relaxed text-slate-400">
          Tamper-evident, not tamper-proof: an in-place edit breaks the chain, but a service-role
          holder could rewrite it. True WORM needs an external ledger.
        </p>
      </div>
    </section>
  );
}
