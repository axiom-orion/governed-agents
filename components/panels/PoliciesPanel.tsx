"use client";

// components/panels/PoliciesPanel.tsx
// The inspectable + editable policy. Lists the active rules in plain English with
// their thresholds, and makes the outbound-send confidence threshold editable.
// Lower it below a source's score and re-run, and the gate's decision flips for
// real (Sample recomputes the gate; Live re-runs with the override) — the flip is
// highlighted so it's unmistakable.

import type { Decision } from "@/lib/governance";

interface Flip {
  readonly from: Decision;
  readonly to: Decision;
}

function DecisionTag({ decision }: { decision: Decision }) {
  const allowed = decision === "allow";
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold " +
        (allowed ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800")
      }
    >
      <span aria-hidden="true">{allowed ? "✓" : "✕"}</span>
      {allowed ? "ALLOW" : "BLOCK"}
    </span>
  );
}

export function PoliciesPanel({
  threshold,
  appliedThreshold,
  defaultThreshold,
  dirty,
  onThresholdChange,
  onRerun,
  onReset,
  flip,
  sendRuleApplies,
  bestSendScore,
}: {
  threshold: number;
  appliedThreshold: number;
  defaultThreshold: number;
  dirty: boolean;
  onThresholdChange: (n: number) => void;
  onRerun: () => void;
  onReset: () => void;
  flip?: Flip | null;
  sendRuleApplies: boolean;
  bestSendScore?: number;
}) {
  const isDefault = Math.abs(threshold - defaultThreshold) < 1e-9;
  const fmt = (n: number): string => n.toFixed(2);

  return (
    <section aria-label="Policies" className="flex flex-col">
      <header className="mb-2">
        <h2 className="text-sm font-semibold text-slate-900">Policies</h2>
        <p className="text-xs text-slate-500">Edit a rule, re-run, and watch the gate flip.</p>
      </header>

      {flip ? (
        <div
          role="status"
          className="mb-3 rounded-md border border-blue-300 bg-blue-50 p-3 text-sm text-slate-700"
        >
          <p className="font-semibold text-blue-900">Policy edited — the gate decision changed</p>
          <p className="mt-1 flex items-center gap-2">
            <DecisionTag decision={flip.from} />
            <span aria-hidden="true" className="text-slate-400">
              →
            </span>
            <DecisionTag decision={flip.to} />
            <span className="text-xs text-slate-500">
              at threshold {fmt(appliedThreshold)}
            </span>
          </p>
        </div>
      ) : null}

      <ul className="flex flex-col gap-2">
        {/* require-provenance — fixed rule */}
        <li className="rounded-md border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <code className="font-mono text-xs font-semibold text-slate-700">
              require-provenance
            </code>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
              always on
            </span>
          </div>
          <p className="mt-1 text-sm leading-snug text-slate-600">
            Every action must cite at least one supporting source.
          </p>
        </li>

        {/* no-unverified-external-send — editable threshold */}
        <li className="rounded-md border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <code className="font-mono text-xs font-semibold text-slate-700">
              no-unverified-external-send
            </code>
            <span className="font-mono text-xs tabular-nums text-slate-500">
              ≥ {fmt(threshold)}
            </span>
          </div>
          <p className="mt-1 text-sm leading-snug text-slate-600">
            An outbound email needs at least one source scoring{" "}
            <span className="font-medium">≥ {fmt(threshold)}</span> confidence.
          </p>

          <div className="mt-2.5 flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={threshold}
              onChange={(e) => onThresholdChange(Number(e.target.value))}
              aria-label="Confidence threshold for no-unverified-external-send"
              className="h-1.5 flex-1 cursor-pointer accent-blue-600"
            />
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={threshold}
              onChange={(e) => onThresholdChange(Number(e.target.value))}
              aria-label="Confidence threshold (numeric)"
              className="w-16 rounded border border-slate-300 px-1.5 py-1 text-right font-mono text-xs tabular-nums text-slate-700"
            />
          </div>

          {sendRuleApplies && bestSendScore !== undefined ? (
            <p className="mt-2 text-xs text-slate-500">
              The current send&rsquo;s best source scores{" "}
              <span className="font-semibold text-amber-700">{fmt(bestSendScore)}</span>. Set the
              threshold at or below {fmt(bestSendScore)} and re-run to{" "}
              <span className="font-medium text-emerald-700">allow</span> it; above to{" "}
              <span className="font-medium text-red-700">block</span>.
            </p>
          ) : (
            <p className="mt-2 text-xs text-slate-400">
              Only affects outbound email sends (e.g. the blocked vendor task); internal records
              aren&rsquo;t gated by this rule.
            </p>
          )}
        </li>
      </ul>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onRerun}
          className={
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold text-white transition-colors " +
            (dirty ? "bg-blue-600 hover:bg-blue-700" : "bg-slate-900 hover:bg-slate-800")
          }
        >
          <span aria-hidden="true">▶</span> Re-run with this policy
        </button>
        <button
          type="button"
          onClick={onReset}
          disabled={isDefault}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reset to defaults
        </button>
      </div>
      {dirty ? (
        <p className="mt-1.5 text-xs text-amber-700">
          Threshold edited to {fmt(threshold)} — re-run to apply (active: {fmt(appliedThreshold)}).
        </p>
      ) : null}
    </section>
  );
}
