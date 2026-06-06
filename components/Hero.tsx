// components/Hero.tsx
// The narrative frame: a non-expert who reads nothing else should get the point
// here, then click ONE button to watch the gate block a risky action. Sits above
// the interactive tool.

export function Hero({
  onWatchBlock,
  onExplore,
}: {
  onWatchBlock: () => void;
  onExplore: () => void;
}) {
  return (
    <section className="border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-5xl px-6 py-10 sm:py-12">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Governance layer for AI agents
        </span>

        <h1 className="mt-4 max-w-3xl text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Agents that know what they&rsquo;re <span className="text-blue-600">not allowed</span> to
          do.
        </h1>

        <div className="mt-4 max-w-2xl space-y-2 text-base text-slate-600">
          <p>
            <span className="font-semibold text-slate-800">The problem:</span> give an AI agent
            real tools and it will take real, irreversible actions — send the email, write the
            record, delete the row — sometimes on weak or unverified evidence.
          </p>
          <p>
            <span className="font-semibold text-slate-800">The approach:</span> check every action
            an agent proposes against an explicit policy <em>before</em> it runs, with scored
            provenance and an auditable, streamed trace of exactly what happened and why.
          </p>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onWatchBlock}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            <span aria-hidden="true">▶</span> Watch it block a risky action
          </button>
          <button
            type="button"
            onClick={onExplore}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
          >
            Explore freely
          </button>
        </div>

        <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-500">
          {[
            "Policy gate evaluated before execution",
            "Provenance scored 0–1 per source",
            "Every decision streamed as an auditable trace",
          ].map((point) => (
            <li key={point} className="inline-flex items-center gap-2">
              <span aria-hidden="true" className="text-emerald-600">
                ✓
              </span>
              {point}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
