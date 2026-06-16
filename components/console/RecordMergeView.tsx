// components/console/RecordMergeView.tsx
// The per-action-type view for a RECORD_MERGE hold: both candidate records laid out side
// by side, then the distinguishing evidence that makes the merge wrong. The action_payload
// is validated with Zod before render — an unrecognized shape falls back honestly rather
// than rendering garbage. This is what makes the Cason↔Causey refusal legible in seconds.

import { RecordMergePayload } from "@/governance/types";
import type { GenealogyRecord } from "@/governance/types";

function RecordColumn({ record, side }: { record: GenealogyRecord; side: "left" | "right" }) {
  const accent = side === "left" ? "border-slate-200" : "border-slate-200";
  return (
    <div className={"flex flex-1 flex-col rounded-md border bg-slate-50/60 p-3 " + accent}>
      <h4 className="text-sm font-semibold text-slate-900">{record.name}</h4>
      <p className="mt-0.5 font-mono text-[11px] text-slate-400">{record.recordId}</p>
      <dl className="mt-2 space-y-0.5 text-xs text-slate-600">
        <div className="flex gap-1.5">
          <dt className="font-medium text-slate-400">Born</dt>
          <dd>{record.born}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="font-medium text-slate-400">Died</dt>
          <dd>{record.died ?? "—"}</dd>
        </div>
      </dl>
      <ol className="mt-3 space-y-1.5 border-l border-slate-200 pl-3">
        {record.timeline.map((t, i) => (
          <li key={i} className="text-xs leading-snug">
            <span className="font-mono font-semibold text-slate-700">{t.year}</span>
            <span className="text-slate-400"> · {t.place}</span>
            <p className="text-slate-600">{t.event}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function RecordMergeView({ payload }: { payload: unknown }) {
  const parsed = RecordMergePayload.safeParse(payload);
  if (!parsed.success) {
    return (
      <p className="rounded-md border border-dashed border-slate-200 bg-white p-3 text-sm text-slate-400">
        Action payload did not match the RECORD_MERGE shape — withholding render rather than
        showing an unverified view.
      </p>
    );
  }
  const { left, right, distinguishingEvidence, proposedConfidence } = parsed.data;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          Agent proposes merging these into one record.{" "}
          <span className="text-slate-400">
            Agent confidence{" "}
            <span className="font-mono font-semibold text-slate-600">{proposedConfidence.toFixed(2)}</span>
          </span>
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <RecordColumn record={left} side="left" />
        <div className="flex items-center justify-center px-1 text-xs font-semibold text-slate-300 sm:flex-col">
          <span aria-hidden="true">⟷</span>
        </div>
        <RecordColumn record={right} side="right" />
      </div>

      <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
        <p className="flex items-start gap-2 text-sm font-semibold text-amber-900">
          <span aria-hidden="true">⚑</span>
          <span>{distinguishingEvidence.headline}</span>
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-amber-900/90">{distinguishingEvidence.detail}</p>
        <ul className="mt-2 space-y-1">
          {distinguishingEvidence.divergencePoints.map((point, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-amber-900/90">
              <span aria-hidden="true" className="mt-0.5 text-amber-500">
                ▪
              </span>
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
