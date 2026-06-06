// components/panels/ProvenancePanel.tsx
// Sources backing the selected step: sourceId, snippet, score. The score is shown
// exactly as it appears in the stream. When the outbound-send rule is in play, each
// score is also labeled against the active threshold with a pass/fail mark — so a
// reviewer sees "0.55 — below 0.70 required" rather than a bare number, and the
// pass/fail is carried by an icon + text, never color alone.

import type { Provenance } from "@/lib/governance";

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function ProvenanceRow({
  source,
  threshold,
}: {
  source: Provenance;
  threshold?: number;
}) {
  const evaluated = threshold !== undefined;
  const passes = evaluated && source.score >= threshold;
  const barTone = !evaluated ? "bg-slate-400" : passes ? "bg-emerald-500" : "bg-red-500";

  return (
    <li className="rounded-md border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <code className="break-all font-mono text-xs text-slate-500">{source.sourceId}</code>
        <span
          className="shrink-0 font-mono text-xs tabular-nums text-slate-700"
          title="retrieval score from the stream"
        >
          {source.score}
        </span>
      </div>
      <p className="mt-1.5 text-sm leading-snug text-slate-700">{source.snippet}</p>
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={"h-full rounded-full " + barTone}
          style={{ width: `${clamp01(source.score) * 100}%` }}
          aria-hidden="true"
        />
      </div>
      {evaluated ? (
        <p
          className={
            "mt-1.5 inline-flex items-center gap-1 text-xs font-medium " +
            (passes ? "text-emerald-700" : "text-red-700")
          }
        >
          <span aria-hidden="true">{passes ? "✓" : "✕"}</span>
          {source.score.toFixed(2)} — {passes ? "meets" : "below"} {threshold.toFixed(2)} required
        </p>
      ) : null}
    </li>
  );
}

export function ProvenancePanel({
  sources,
  contextLabel,
  threshold,
  showThreshold = false,
}: {
  sources: readonly Provenance[];
  contextLabel?: string;
  threshold?: number;
  /** When true, label each score against `threshold` with a pass/fail mark. */
  showThreshold?: boolean;
}) {
  const effectiveThreshold = showThreshold ? threshold : undefined;
  return (
    <section aria-label="Provenance" className="flex min-h-0 flex-col">
      <header className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Provenance</h2>
        {contextLabel ? (
          <span className="font-mono text-xs text-slate-400">{contextLabel}</span>
        ) : null}
      </header>
      {sources.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-200 bg-white p-3 text-sm text-slate-400">
          No sources in the stream for this step.
        </p>
      ) : (
        <ul className="flex flex-col gap-2 overflow-y-auto">
          {sources.map((source, index) => (
            <ProvenanceRow
              key={`${source.sourceId}#${index}`}
              source={source}
              threshold={effectiveThreshold}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
