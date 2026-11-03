// lib/governance.ts
// Pre-action governance gate for a multi-agent flow.
// This is the differentiator: agents propose actions; the gate ALLOWS or BLOCKS
// each one against an explicit policy, and every decision is auditable.
// Strict TypeScript, no `any`. Pure + synchronous so it is trivially testable.

export type AgentRole = "researcher" | "reasoner" | "executor";

export interface Provenance {
  readonly sourceId: string;
  readonly snippet: string;
  readonly score: number; // retrieval confidence in [0, 1]
}

export interface AgentStep {
  readonly id: string;
  readonly role: AgentRole;
  readonly summary: string;
  readonly provenance: readonly Provenance[];
  readonly at: string; // ISO-8601
}

export interface ProposedAction {
  readonly kind: string; // e.g. "send_email" | "write_record"
  readonly payload: Readonly<Record<string, unknown>>;
  readonly justification: string;
  readonly provenance: readonly Provenance[];
  /** Present when the action was decided by a multi-model vote (the triad). */
  readonly consensus?: Consensus;
  /** Attested identity of the model instance whose draft was chosen (the generator). */
  readonly proposedBy?: VoiceIdentity;
  /** Present when an independent adversarial reviewer (the Red Cell) examined the action. */
  readonly redCell?: RedCellReview;
}

/**
 * The attested identity of one model instance — the unit "independence" is counted in.
 * For API-backed voices this is the configured (provider, model id) pair: it attests what
 * we *configured and called*, and deliberately claims no more — it cannot see through a
 * provider's internal routing (that residual trust is named in the docs, not papered over).
 */
export interface VoiceIdentity {
  readonly provider: string; // proposer label, e.g. "anthropic" | "gemini" | "grok" | "offline-stub"
  readonly model: string; // the model id the call was made with
}

/** Two voices are the same instance when provider and model id both match. */
export function sameVoice(a: VoiceIdentity, b: VoiceIdentity): boolean {
  return a.provider === b.provider && a.model === b.model;
}

/** One model's vote in a multi-model action proposal. */
export interface ModelVote {
  readonly model: string; // provider label, e.g. "claude" | "gemini" | "grok"
  readonly kind: string; // the action kind this model proposed
  readonly justification: string;
  /** True when the provider was unavailable (no key) or its call failed. */
  readonly abstained?: boolean;
  /** Attested identity of the instance that cast this vote (absent on legacy traces). */
  readonly voice?: VoiceIdentity;
}

/** Outcome of aggregating the triad's votes for one action. */
export interface Consensus {
  readonly votes: readonly ModelVote[];
  /** Share of participating (non-abstaining) models that backed the chosen kind, [0,1]. */
  readonly agreementRatio: number;
  /** The action kind the participating models most agreed on. */
  readonly chosenKind: string;
  /** Distinct attested voices among the votes that backed the chosen kind (absent on legacy traces). */
  readonly distinctVoices?: number;
}

/** The Red Cell's adversarial verdict on a proposed action. */
export interface RedCellReview {
  /** "object" = the strongest case against the action stands; route to a human. */
  readonly verdict: "concur" | "object";
  readonly critique: string;
  /** Attested identity of the reviewing instance — compared against `proposedBy`. */
  readonly voice: VoiceIdentity;
}

// Three-tier outcome: a clean action is allowed; a hard violation blocks; a
// "review" violation routes to a human (needs_approval) when nothing hard-blocks.
export type Decision = "allow" | "block" | "needs_approval";

export interface PolicyViolation {
  readonly rule: string;
  readonly detail: string;
  /** "block" (default) fails the action; "review" routes it for human approval. */
  readonly severity?: "block" | "review";
}

export interface PolicyDecision {
  readonly decision: Decision;
  readonly violations: readonly PolicyViolation[];
  readonly evaluatedAt: string;
}

export interface PolicyRule {
  readonly name: string;
  // Return a violation if the action fails this rule, else null.
  evaluate(action: ProposedAction): PolicyViolation | null;
}

const severityOf = (v: PolicyViolation): "block" | "review" => v.severity ?? "block";

// --- the gate -------------------------------------------------------------
// A hard block beats a review request; a review request beats allow. So an action
// that both leaks PII (block) and is destructive (review) is BLOCKED, not queued.
export function evaluatePolicy(
  action: ProposedAction,
  rules: readonly PolicyRule[],
): PolicyDecision {
  const violations = rules
    .map((r) => r.evaluate(action))
    .filter((v): v is PolicyViolation => v !== null);
  const hasBlock = violations.some((v) => severityOf(v) === "block");
  const hasReview = violations.some((v) => severityOf(v) === "review");
  const decision: Decision = hasBlock ? "block" : hasReview ? "needs_approval" : "allow";
  return { decision, violations, evaluatedAt: new Date().toISOString() };
}

// --- example policy set (pre-action gating) -------------------------------

/** Default confidence an outbound send needs from at least one source. */
export const DEFAULT_SEND_THRESHOLD = 0.7;

/** Default share of the triad that must agree on the action (1.0 = unanimous). */
export const DEFAULT_CONSENSUS_THRESHOLD = 1.0;

/** Tunable knobs for {@link buildPolicy}; everything has a safe default. */
export interface PolicyConfig {
  /** Min provenance score (in [0,1]) an external send needs; default 0.7. */
  readonly externalSendThreshold?: number;
  /** Min agreement among the triad (in [0,1]) before acting; default 1.0 (unanimous). */
  readonly consensusThreshold?: number;
  /** Min distinct attested model instances behind a consensus; default 2. */
  readonly minDistinctVoices?: number;
}

/**
 * A retrieval score counts as evidence only when it is a finite number in [0, 1] — the
 * range `Provenance.score` promises. NaN, ±Infinity or an out-of-range value (5.0) is
 * malformed, and malformed evidence never clears a threshold: unverifiable is not verified.
 */
export function isValidScore(score: unknown): score is number {
  return typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 1;
}

export const requireProvenance: PolicyRule = {
  name: "require-provenance",
  evaluate: (a) => {
    if (a.provenance.length === 0) {
      return { rule: "require-provenance", detail: "action has no supporting sources" };
    }
    return a.provenance.some((p) => isValidScore(p.score))
      ? null
      : {
          rule: "require-provenance",
          detail: "no supporting source carries a valid retrieval score in [0, 1]",
        };
  },
};

/**
 * Factory for the outbound-send rule with a configurable confidence threshold.
 * The threshold is the single knob the UI exposes: lower it below a source's
 * score and a previously-blocked send flips to allow — a real change in the gate,
 * not a cosmetic one.
 */
export function makeNoUnverifiedExternalSend(
  threshold: number = DEFAULT_SEND_THRESHOLD,
): PolicyRule {
  return {
    name: "no-unverified-external-send",
    evaluate: (a) => {
      if (a.kind !== "send_email") return null;
      const to = typeof a.payload.to === "string" ? a.payload.to : "";
      const hasHighConfidenceSource = a.provenance.some(
        (p) => isValidScore(p.score) && p.score >= threshold,
      );
      return to.length > 0 && !hasHighConfidenceSource
        ? {
            rule: "no-unverified-external-send",
            detail: `outbound to ${to} lacks a source scoring ≥ ${threshold.toFixed(2)}`,
          }
        : null;
    },
  };
}

/** The outbound-send rule at the default threshold (kept for the frozen contract). */
export const noUnverifiedExternalSend: PolicyRule = makeNoUnverifiedExternalSend();

// PII signatures. Still a pattern list, not a vetted detector (production should put a
// DLP / PII service behind this rule), but it covers the formats a financial-services
// email actually leaks: US and UK identifiers, international phones, and bank details.
// Ambiguous shapes are context-gated so routine numbers don't trip the gate: a bare
// 9-digit run is an SSN only when labelled, and a dd-dd-dd run is a sort code only when
// labelled or sitting next to an 8-digit account number (otherwise it is likely a date).

/** One detector; `found` is pure. Every regex below carries the `g` flag for `matchAll`. */
interface PiiSignature {
  readonly label: string;
  readonly found: (text: string) => boolean;
}

/** A regex detector, optionally confirmed per match (e.g. a digit-count or checksum test). */
function byPattern(re: RegExp, valid?: (match: string) => boolean): (text: string) => boolean {
  return (text) => {
    for (const m of text.matchAll(re)) {
      if (valid === undefined || valid(m[0])) return true;
    }
    return false;
  };
}

const digitCount = (s: string): number => s.replace(/\D/gu, "").length;

/** ISO 13616 mod-97 check: the number formed by BBAN + country + check digits ≡ 1 (mod 97). */
function isValidIban(compact: string): boolean {
  const iban = compact.toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/u.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    // Letters expand to two digits (A = 10 … Z = 35); fold digit by digit to stay in range.
    const expanded = /[A-Z]/u.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of expanded) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/** IBANs appear compact or in groups of four; join up to 9 adjacent tokens and checksum each prefix. */
function containsIban(text: string): boolean {
  const tokens = text
    .split(/\s+/u)
    .map((t) => t.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/gu, ""))
    .filter((t) => t.length > 0);
  for (let i = 0; i < tokens.length; i++) {
    if (!/^[A-Za-z]{2}\d{2}/u.test(tokens[i] ?? "")) continue;
    let candidate = "";
    for (let j = i; j < tokens.length && j < i + 9; j++) {
      candidate += tokens[j] ?? "";
      if (candidate.length > 34) break;
      if (candidate.length >= 15 && isValidIban(candidate)) return true;
    }
  }
  return false;
}

const PII_SIGNATURES: readonly PiiSignature[] = [
  {
    label: "US Social Security number",
    found: (text) =>
      byPattern(/\b\d{3}[- ]\d{2}[- ]\d{4}\b/gu)(text) ||
      byPattern(/\b(?:ssn|social\s+security(?:\s+(?:number|no))?)\b[^\d]{0,20}\d{9}\b/giu)(text),
  },
  { label: "credit-card number", found: byPattern(/\b(?:\d[ -]?){15,16}\b/gu) },
  { label: "IBAN", found: containsIban },
  {
    label: "UK sort code and account number",
    found: (text) =>
      byPattern(/\bsort[\s-]*code\b[^\d]{0,12}\d{2}[- ]?\d{2}[- ]?\d{2}\b/giu)(text) ||
      byPattern(/\b\d{2}-\d{2}-\d{2}\b[^\d]{0,24}\b\d{8}\b/gu)(text) ||
      byPattern(/\b\d{8}\b[^\d]{0,24}\b\d{2}-\d{2}-\d{2}\b/gu)(text),
  },
  {
    label: "bank account number",
    found: byPattern(/\b(?:account|acct)\.?(?:\s*(?:no\.?|number|num|#))?[\s:#]*\d{6,17}\b/giu),
  },
  {
    label: "phone number",
    found: (text) =>
      // North American: 555-123-4567 · 555.123.4567 · 555 123 4567 · (555) 123-4567
      byPattern(/(?:\(\d{3}\)\s?|\b\d{3}[ .-])\d{3}[ .-]\d{4}\b/gu)(text) ||
      // International with a leading +: +44 20 7946 0958 (8–15 digits, E.164's limit)
      byPattern(/\+\d{1,3}(?:[ .-]?\d{2,4}){2,4}\b/gu, (m) => {
        const n = digitCount(m);
        return n >= 8 && n <= 15;
      })(text),
  },
];

function payloadText(payload: Readonly<Record<string, unknown>>): string {
  return Object.values(payload)
    .filter((v): v is string => typeof v === "string")
    .join(" \n ");
}

/** Block outbound sends whose contents contain personal data. */
export const noPiiInExternalOutput: PolicyRule = {
  name: "no-pii-in-external-output",
  evaluate: (a) => {
    if (a.kind !== "send_email") return null;
    const text = payloadText(a.payload);
    const hit = PII_SIGNATURES.find((s) => s.found(text));
    return hit
      ? {
          rule: "no-pii-in-external-output",
          detail: `outbound message appears to contain a ${hit.label}`,
          severity: "block",
        }
      : null;
  },
};

/** Action kinds that are irreversible and therefore gated behind human approval. */
export const DESTRUCTIVE_KINDS: ReadonlySet<string> = new Set([
  "delete_record",
  "purge",
  "overwrite",
]);

/**
 * Actions consequential enough to warrant adversarial (Red Cell) review: outbound
 * sends and irreversible/destructive kinds. Internal records are still gated by the
 * hard rules — provenance, PII, consensus, distinct voices — but running a
 * "never rubber-stamp" generative red team on every internal note manufactures
 * objections without protecting anything. Scrutiny escalates with the stakes.
 */
export function isConsequentialKind(kind: string): boolean {
  return kind === "send_email" || DESTRUCTIVE_KINDS.has(kind);
}

/**
 * Every action kind the gate knows how to judge. The kind-specific rules above are written
 * against these; a kind outside the set would slip past all of them, so it is blocked
 * instead of trusted (see {@link knownActionKind}).
 */
export const KNOWN_ACTION_KINDS: ReadonlySet<string> = new Set([
  "send_email",
  "write_record",
  ...DESTRUCTIVE_KINDS,
]);

/** Fail closed on action kinds the policy was never written for. */
export const knownActionKind: PolicyRule = {
  name: "known-action-kind",
  evaluate: (a) =>
    KNOWN_ACTION_KINDS.has(a.kind)
      ? null
      : {
          rule: "known-action-kind",
          detail: `"${a.kind}" is not a kind this policy knows how to judge — unknown kinds are blocked, not trusted`,
        },
};

/** Provenance `sourceId` prefix under which a retrieved approval record is filed. */
export const APPROVAL_SOURCE_PREFIX = "ticket:";

function approvalTokenOf(payload: Readonly<Record<string, unknown>>): string | undefined {
  const token = payload.approvalToken;
  return typeof token === "string" && token.trim().length > 0 ? token : undefined;
}

/**
 * An approval is honored only when it is grounded in retrieval: the action's token must
 * match an approval record (`ticket:<token>`, with a valid score) among the sources the
 * Researcher retrieved. Provenance comes from retrieval, never from the model, so the
 * proposer cannot approve its own action — a bare `approved: true`, an empty token, or a
 * token with no matching record all route to a human. This is grounding, not a signature:
 * a production approval should also be verified against the approvals system itself.
 */
function hasRetrievedApproval(a: ProposedAction): boolean {
  const token = approvalTokenOf(a.payload);
  if (token === undefined) return false;
  const record = `${APPROVAL_SOURCE_PREFIX}${token}`;
  return a.provenance.some((p) => p.sourceId === record && isValidScore(p.score));
}

/** Route destructive/irreversible actions to a human unless a retrieved approval backs them. */
export const destructiveNeedsApproval: PolicyRule = {
  name: "destructive-action-needs-approval",
  evaluate: (a) => {
    if (!DESTRUCTIVE_KINDS.has(a.kind) || hasRetrievedApproval(a)) return null;
    const token = approvalTokenOf(a.payload);
    return {
      rule: "destructive-action-needs-approval",
      detail:
        token === undefined
          ? `${a.kind} is irreversible and requires human approval before it runs`
          : `${a.kind} is irreversible; approval token "${token}" matches no retrieved approval record (${APPROVAL_SOURCE_PREFIX}${token}), so a human must approve it`,
      severity: "review",
    };
  },
};

function describeSplit(consensus: Consensus): string {
  const tally = consensus.votes
    .map((v) => `${v.model}: ${v.abstained ? "abstained" : v.kind}`)
    .join(", ");
  return tally;
}

/**
 * Require the triad of models to agree before acting. Only meaningful once at
 * least two models actually voted; below `threshold` agreement, the action is
 * routed to a human (needs_approval) rather than executed on a split decision.
 */
export function makeRequireModelConsensus(
  threshold: number = DEFAULT_CONSENSUS_THRESHOLD,
): PolicyRule {
  return {
    name: "require-model-consensus",
    evaluate: (a) => {
      const consensus = a.consensus;
      if (consensus === undefined) return null;
      const participating = consensus.votes.filter((v) => v.abstained !== true).length;
      if (participating < 2) return null; // need ≥2 models for a disagreement to mean anything
      return consensus.agreementRatio < threshold
        ? {
            rule: "require-model-consensus",
            detail: `models disagreed (${describeSplit(consensus)}) — ${Math.round(
              consensus.agreementRatio * 100,
            )}% agreement is below the ${Math.round(threshold * 100)}% required`,
            severity: "review",
          }
        : null;
    },
  };
}

// --- attested independence (§7-2): voices are counted, not assumed ----------

/** Default minimum number of distinct model instances that must back a consensus. */
export const DEFAULT_MIN_DISTINCT_VOICES = 2;

/** Stable identity key for a vote — attested voice when present, else the legacy label. */
function voiceKey(v: ModelVote): string {
  return v.voice ? `${v.voice.provider}::${v.voice.model}` : `label::${v.model}`;
}

/** Distinct voices among participating votes that backed `kind` (pure; legacy-tolerant). */
export function distinctVoicesFor(votes: readonly ModelVote[], kind: string): number {
  const keys = new Set<string>();
  for (const v of votes) {
    if (v.abstained !== true && v.kind === kind) keys.add(voiceKey(v));
  }
  return keys.size;
}

/**
 * The bloodhound law applied at the model layer: corroboration counts independent
 * VOICES, not the votes that echo them. A unanimous "consensus" whose agreeing votes
 * resolve to one attested instance is one voice echoed N times — it is routed to a
 * human, not honored. Within the default triad (anthropic/gemini/grok) this is an
 * invariant check; it bites when voter sets are user-configured or when a recorded
 * consensus is replayed through the policy.
 */
export function makeRequireDistinctVoices(
  minDistinctVoices: number = DEFAULT_MIN_DISTINCT_VOICES,
): PolicyRule {
  return {
    name: "require-distinct-voices",
    evaluate: (a) => {
      const consensus = a.consensus;
      if (consensus === undefined) return null;
      const participating = consensus.votes.filter((v) => v.abstained !== true).length;
      if (participating < 2) return null; // a single voter is not claiming corroboration
      const distinct =
        consensus.distinctVoices ?? distinctVoicesFor(consensus.votes, consensus.chosenKind);
      const agreeing = consensus.votes.filter(
        (v) => v.abstained !== true && v.kind === consensus.chosenKind,
      ).length;
      return distinct < minDistinctVoices
        ? {
            rule: "require-distinct-voices",
            detail: `${agreeing} agreeing vote(s) resolve to ${distinct} distinct model instance(s) — corroboration counts voices, not echoes (need ≥ ${minDistinctVoices})`,
            severity: "review",
          }
        : null;
    },
  };
}

/**
 * Oversight is theater unless the reviewer is provably not the generator. A Red Cell
 * verdict is honored only when the reviewing instance's attested voice differs from the
 * proposing instance's; an unattested generator can't prove independence, so it routes
 * to a human too — unverifiable is not verified.
 */
export const redCellMustBeIndependent: PolicyRule = {
  name: "red-cell-independence",
  evaluate: (a) => {
    if (a.redCell === undefined) return null;
    if (a.proposedBy === undefined) {
      return {
        rule: "red-cell-independence",
        detail:
          "red-cell verdict cannot be honored: the proposing model's identity is not attested",
        severity: "review",
      };
    }
    return sameVoice(a.redCell.voice, a.proposedBy)
      ? {
          rule: "red-cell-independence",
          detail: `oversight is theater — the red cell resolved to the proposing instance (${a.proposedBy.provider}/${a.proposedBy.model}); its verdict is not honored`,
          severity: "review",
        }
      : null;
  },
};

/** An adversarial objection routes the action to a human with the critique attached. */
export const redCellObjection: PolicyRule = {
  name: "red-cell-objection",
  evaluate: (a) => {
    if (a.redCell === undefined || a.redCell.verdict !== "object") return null;
    const critique =
      a.redCell.critique.length > 220 ? `${a.redCell.critique.slice(0, 220)}…` : a.redCell.critique;
    return {
      rule: "red-cell-objection",
      detail: `the red cell (${a.redCell.voice.provider}/${a.redCell.voice.model}) objects: ${critique}`,
      severity: "review",
    };
  },
};

/** Assemble the active policy from a config; rule order is stable. */
export function buildPolicy(config: PolicyConfig = {}): readonly PolicyRule[] {
  return [
    knownActionKind,
    requireProvenance,
    makeNoUnverifiedExternalSend(config.externalSendThreshold),
    noPiiInExternalOutput,
    destructiveNeedsApproval,
    makeRequireModelConsensus(config.consensusThreshold),
    makeRequireDistinctVoices(config.minDistinctVoices),
    redCellMustBeIndependent,
    redCellObjection,
  ];
}

export const defaultPolicy: readonly PolicyRule[] = buildPolicy();
