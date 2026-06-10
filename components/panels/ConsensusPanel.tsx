// components/panels/ConsensusPanel.tsx
// The triad's votes for the proposed action: which model chose what, under which
// attested identity, and whether they agreed enough — AND whether the agreeing votes
// are independent instances or one voice echoed. Corroboration counts voices, not the
// votes that repeat them, so a unanimous echo (3 votes, 1 instance) is flagged and
// routes to a human via require-distinct-voices, exactly like a split does.

import type { Consensus, ModelVote } from "@/lib/governance";

const MODEL_LABEL: Readonly<Record<string, string>> = {
  claude: "Claude",
  gemini: "Gemini",
  grok: "Grok",
  anthropic: "Claude",
  "offline-stub": "Offline stub",
};

const DEFAULT_MIN_DISTINCT_VOICES = 2;

/** Stable identity key for a vote — attested voice when present, else the legacy label. */
function voiceKey(v: ModelVote): string {
  return v.voice ? `${v.voice.provider}::${v.voice.model}` : `label::${v.model}`;
}

function distinctVoicesFor(votes: readonly ModelVote[], kind: string): number {
  const keys = new Set<string>();
  for (const v of votes) if (v.abstained !== true && v.kind === kind) keys.add(voiceKey(v));
  return keys.size;
}

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

  const agreeing = consensus.votes.filter(
    (v) => v.abstained !== true && v.kind === consensus.chosenKind,
  ).length;
  const distinct =
    consensus.distinctVoices ?? distinctVoicesFor(consensus.votes, consensus.chosenKind);
  const attested = consensus.votes.some((v) => v.voice !== undefined);
  const isEcho = participating >= 2 && distinct < DEFAULT_MIN_DISTINCT_VOICES;

  return (
    <section aria-label="Model consensus" className="flex flex-col">
      <header className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Model consensus</h2>
        <span
          className={
            "font-mono text-xs " + (agreed && !isEcho ? "text-emerald-700" : "text-amber-700")
          }
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
            <span className="flex flex-col">
              <span className="text-xs font-semibold text-slate-700">
                {MODEL_LABEL[vote.model] ?? vote.model}
              </span>
              {vote.voice ? (
                <code className="text-[10px] text-slate-400" title="attested model identity">
                  {vote.voice.provider}/{vote.voice.model}
                </code>
              ) : null}
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

      {attested ? (
        <p
          className={
            "mt-2 inline-flex items-center gap-1.5 text-xs font-medium " +
            (isEcho ? "text-amber-700" : "text-slate-500")
          }
          title="Corroboration counts independent model instances, not the votes that echo them."
        >
          <span aria-hidden="true">{isEcho ? "⏸" : "✓"}</span>
          {isEcho
            ? `Echo — ${agreeing} agreeing votes resolve to ${distinct} instance; needs a 2nd independent voice`
            : `${distinct} distinct attested voices behind the choice`}
        </p>
      ) : null}

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
