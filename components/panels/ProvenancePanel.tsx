// components/panels/ProvenancePanel.tsx
// Sources backing the selected step: sourceId, snippet, score. The score is the
// only number rendered here, and it is shown exactly as it appears in the
// stream (no rounding, no derived confidence). The bar is a visual encoding of
// that same score — no separate number is invented.

import type { Provenance } from "@/lib/governance";

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function ProvenanceRow({ source }: { source: Provenance }) {
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
          className="h-full rounded-full bg-slate-400"
          style={{ width: `${clamp01(source.score) * 100}%` }}
          aria-hidden="true"
        />
      </div>
    </li>
  );
}

export function ProvenancePanel({
  sources,
  contextLabel,
}: {
  sources: readonly Provenance[];
  contextLabel?: string;
}) {
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
            <ProvenanceRow key={`${source.sourceId}#${index}`} source={source} />
          ))}
        </ul>
      )}
    </section>
  );
}
