// components/panels/GateDecision.tsx
// The governance gate's decision for the selected step, and — on a block — each
// PolicyViolation (rule + detail). Green for allow, red for block; these are
// the only places color carries meaning. All text comes from the stream.

import type { GateNodeData } from "@/lib/trace-model";

export function GateDecision({ gate }: { gate?: GateNodeData }) {
  if (!gate) {
    return (
      <section aria-label="Gate decision" className="flex flex-col">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Gate decision</h2>
        <p className="rounded-md border border-dashed border-slate-200 bg-white p-3 text-sm text-slate-400">
          No gate decision for the selected step.
        </p>
      </section>
    );
  }

  const { decision, violations, evaluatedAt } = gate.decision;
  const tone =
    decision === "allow"
      ? { box: "border-emerald-300 bg-emerald-50 text-emerald-800", glyph: "✓", label: "Allowed" }
      : decision === "needs_approval"
        ? { box: "border-amber-300 bg-amber-50 text-amber-800", glyph: "⏸", label: "Needs approval" }
        : { box: "border-red-300 bg-red-50 text-red-800", glyph: "✕", label: "Blocked" };

  return (
    <section aria-label="Gate decision" className="flex flex-col">
      <header className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Gate decision</h2>
        <span className="font-mono text-xs text-slate-400">{evaluatedAt}</span>
      </header>

      <div className={"flex items-center gap-2 rounded-md border px-3 py-2 " + tone.box}>
        <span aria-hidden="true" className="text-base font-bold leading-none">
          {tone.glyph}
        </span>
        <span className="text-sm font-semibold uppercase tracking-wide">{tone.label}</span>
      </div>

      {decision === "allow" ? (
        <p className="mt-3 text-sm text-slate-500">No policy violations.</p>
      ) : (
        <div className="mt-3">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {decision === "needs_approval" ? "Requires approval" : "Policy violations"}
          </h3>
          <ul className="flex flex-col gap-2">
            {violations.map((violation, index) => {
              const review = (violation.severity ?? "block") === "review";
              return (
                <li
                  key={`${violation.rule}#${index}`}
                  className={
                    "rounded-md border bg-white p-3 " +
                    (review ? "border-amber-200" : "border-red-200")
                  }
                >
                  <code
                    className={
                      "font-mono text-xs font-semibold " +
                      (review ? "text-amber-700" : "text-red-700")
                    }
                  >
                    {violation.rule}
                  </code>
                  <p className="mt-1 text-sm leading-snug text-slate-700">{violation.detail}</p>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
