// components/panels/OversightPanel.tsx
// The Red Cell's adversarial review of the proposed action — shown only when an action
// carries one. Oversight is theater unless the reviewer is provably NOT the generator,
// so this panel states the reviewing instance's attested identity and whether it is
// independent of the proposer; an objection (or a collapsed/unattested reviewer) is what
// routes the action to a human, with the critique in plain sight.

import type { ProposedAction, RedCellReview, VoiceIdentity } from "@/lib/governance";

function sameVoice(a: VoiceIdentity, b: VoiceIdentity): boolean {
  return a.provider === b.provider && a.model === b.model;
}

export function OversightPanel({ action }: { action?: ProposedAction }) {
  const review: RedCellReview | undefined = action?.redCell;
  if (!review) return null;

  const proposedBy = action?.proposedBy;
  const independent = proposedBy !== undefined && !sameVoice(review.voice, proposedBy);
  const objected = review.verdict === "object";

  const tone = objected || !independent ? "amber" : "emerald";
  const box =
    tone === "emerald"
      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
      : "border-amber-300 bg-amber-50 text-amber-800";

  return (
    <section aria-label="Red Cell oversight" className="flex flex-col">
      <header className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Red Cell oversight</h2>
        <code className="text-[10px] text-slate-400" title="attested reviewer identity">
          {review.voice.provider}/{review.voice.model}
        </code>
      </header>

      <div className={"flex items-center gap-2 rounded-md border px-3 py-2 " + box}>
        <span aria-hidden="true" className="text-base font-bold leading-none">
          {objected ? "✕" : "✓"}
        </span>
        <span className="text-sm font-semibold uppercase tracking-wide">
          {objected ? "Objects" : "Concurs"}
        </span>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-slate-600">{review.critique}</p>

      <p
        className={
          "mt-2 inline-flex items-center gap-1.5 text-xs font-medium " +
          (independent ? "text-emerald-700" : "text-amber-700")
        }
        title="A verdict is honored only when the reviewer is a provably distinct model instance."
      >
        <span aria-hidden="true">{independent ? "✓" : "⏸"}</span>
        {proposedBy === undefined
          ? "Proposer identity unattested — independence can't be proven, so it routes to a human"
          : independent
            ? "Independent of the proposing instance — verdict honored"
            : "Reviewer is the proposing instance — oversight is theater, routes to a human"}
      </p>
    </section>
  );
}
