// lib/corpus.ts
// Bundled, synthetic in-memory corpus + a deterministic keyword retriever.
// The default run needs no backend: localRecall scores the seed queries so the
// governance gate behaves predictably (a well-sourced internal action is ALLOWED;
// an under-sourced outbound send is BLOCKED). Never put real user data here — this
// corpus is safe to ship and serve publicly.

export type MemoryType = "working" | "episodic" | "semantic" | "procedural";

/** Shape of a stored memory — mirrors the C3 memory-service `MemoryRecord`. */
export interface MemoryRecord {
  readonly id: number;
  readonly content: string;
  readonly type: MemoryType;
  readonly importance: number;
  readonly superseded: boolean;
}

/** A retrieval hit: a record plus a confidence score in [0, 1]. */
export interface ScoredRecord extends MemoryRecord {
  readonly score: number;
}

/** Internal corpus entry — a MemoryRecord plus the keywords used for scoring. */
interface CorpusEntry extends MemoryRecord {
  readonly keywords: readonly string[];
}

const CORPUS: readonly CorpusEntry[] = [
  {
    id: 1,
    content:
      "Q2 refund policy update: refunds are issued within 5 business days for cancellations made in the first 30 days.",
    type: "semantic",
    importance: 0.9,
    superseded: false,
    keywords: ["refund", "policy", "q2", "update"],
  },
  {
    id: 2,
    content:
      "Refund eligibility: orders qualify for a full refund within a 30-day return window from the delivery date.",
    type: "semantic",
    importance: 0.8,
    superseded: false,
    keywords: ["refund", "eligibility", "return", "window"],
  },
  {
    id: 3,
    content:
      "Support runbook: log every refund decision as an internal record note for the support team.",
    type: "procedural",
    importance: 0.75,
    superseded: false,
    keywords: ["support", "record", "internal", "note", "refund", "team"],
  },
  {
    id: 4,
    content:
      "Partner program overview: partners advance through onboarding tiers; renewal terms are set per contract.",
    type: "semantic",
    importance: 0.6,
    superseded: false,
    keywords: ["partner", "program", "onboarding", "tier", "renewal"],
  },
  {
    id: 5,
    content:
      "Outreach guideline: confirm every figure against a verified source before sending an external email.",
    type: "procedural",
    importance: 0.7,
    superseded: false,
    keywords: ["email", "outreach", "external", "guideline", "verify"],
  },
  {
    id: 6,
    content:
      "Security note: never include unverified financial figures in outbound communications.",
    type: "procedural",
    importance: 0.65,
    superseded: false,
    keywords: ["security", "financial", "outbound", "unverified"],
  },
  {
    id: 7,
    content:
      "Deprecated refund policy (superseded): refunds were once limited to a 14-day window.",
    type: "episodic",
    importance: 0.2,
    superseded: true,
    keywords: ["refund", "policy", "deprecated"],
  },
];

const round2 = (n: number): number => Math.round(n * 100) / 100;

function tokenize(text: string): ReadonlySet<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .filter((t) => t.length > 0),
  );
}

function toScored(entry: CorpusEntry, score: number): ScoredRecord {
  return {
    id: entry.id,
    content: entry.content,
    type: entry.type,
    importance: entry.importance,
    superseded: entry.superseded,
    score,
  };
}

/**
 * Deterministic in-memory retrieval over the bundled corpus.
 * Score = fraction of an entry's keywords present in the query, in [0, 1].
 * Superseded records are never returned. Returns the top-k by score; if nothing
 * matches, returns the single best entry so downstream provenance is never empty.
 */
export function localRecall(query: string, k = 4): ScoredRecord[] {
  const q = tokenize(query);
  const scored = CORPUS.filter((e) => !e.superseded).map((e) => {
    const matched = e.keywords.filter((kw) => q.has(kw)).length;
    const score = e.keywords.length === 0 ? 0 : round2(matched / e.keywords.length);
    return toScored(e, score);
  });
  scored.sort((a, b) => b.score - a.score);
  const hits = scored.filter((r) => r.score > 0).slice(0, Math.max(1, k));
  return hits.length > 0 ? hits : scored.slice(0, 1);
}

/** Count of active (non-superseded) records — handy for diagnostics. */
export const CORPUS_SIZE = CORPUS.filter((e) => !e.superseded).length;
