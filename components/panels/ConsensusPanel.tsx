// components/panels/ConsensusPanel.tsx
// The triad's votes for the proposed action: which model chose what, and whether
// they agreed enough to act. Shown only when an action carries consensus (a real
// multi-model run, or a recorded consensus scenario). A split below the active
// threshold is what routes the action to human approval.

import type { Consensus } from "@/lib/governance";

const MODEL_LABEL: Readonly<Record<string, string>> = {
  claude: "Claude",
  gemini: "Gemini",
  grok: "Grok",
  anthropic: "Claude",
  "offline-stub": "Offline stub",
};

export function ConsensusPanel({
  consensus,
  threshold,
}: {
  consensus?: Consensus;
  threshold: number;
}) {
  if (!consensus) return null;

  const participating = consensus.votes.filter((v) => v.abstained !== true).length;
  const pct = Math.round(consensus.agreementRatio * 100);
  const reqPct = Math.round(threshold * 100);
  const agreed = participating < 2 || consensus.agreementRatio >= threshold;

  return (
    <section aria-label="Model consensus" className="flex flex-col">
      <header className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Model consensus</h2>
        <span
          className={"font-mono text-xs " + (agreed ? "text-emerald-700" : "text-amber-700")}
        >
          {pct}% agree
        </span>
      </header>

      <ul className="flex flex-col gap-1.5">
        {consensus.votes.map((vote, index) => (
          <li
            key={`${vote.model}#${index}`}
            className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5"
          >
            <span className="text-xs font-semibold text-slate-700">
              {MODEL_LABEL[vote.model] ?? vote.model}
            </span>
            {vote.abstained ? (
              <span className="text-xs text-slate-400" title={vote.justification}>
                abstained
              </span>
            ) : (
              <code
                className={
                  "rounded px-1.5 py-0.5 text-[11px] font-medium " +
                  (vote.kind === consensus.chosenKind
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-amber-100 text-amber-800")
                }
              >
                {vote.kind}
              </code>
            )}
          </li>
        ))}
      </ul>

      <p
        className={
          "mt-2 inline-flex items-center gap-1.5 text-xs font-medium " +
          (agreed ? "text-emerald-700" : "text-amber-700")
        }
      >
        <span aria-hidden="true">{agreed ? "✓" : "⏸"}</span>
        {agreed
          ? `Agreement meets the ${reqPct}% required`
          : `Split — ${pct}% is below the ${reqPct}% required, so it needs approval`}
      </p>
    </section>
  );
}
