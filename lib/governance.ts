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

/** Tunable knobs for {@link buildPolicy}; everything has a safe default. */
export interface PolicyConfig {
  /** Min provenance score (in [0,1]) an external send needs; default 0.7. */
  readonly externalSendThreshold?: number;
}

export const requireProvenance: PolicyRule = {
  name: "require-provenance",
  evaluate: (a) =>
    a.provenance.length === 0
      ? { rule: "require-provenance", detail: "action has no supporting sources" }
      : null,
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
      const hasHighConfidenceSource = a.provenance.some((p) => p.score >= threshold);
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

// Light, illustrative PII signatures. Real systems would use a vetted detector;
// these are enough to make the policy behavior legible in the demo.
const PII_SIGNATURES: ReadonlyArray<{ readonly label: string; readonly re: RegExp }> = [
  { label: "US Social Security number", re: /\b\d{3}-\d{2}-\d{4}\b/u },
  { label: "credit-card number", re: /\b(?:\d[ -]?){15,16}\b/u },
  { label: "phone number", re: /\b\d{3}[.\-]\d{3}[.\-]\d{4}\b/u },
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
    const hit = PII_SIGNATURES.find((s) => s.re.test(text));
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

function isApproved(payload: Readonly<Record<string, unknown>>): boolean {
  return payload.approved === true || typeof payload.approvalToken === "string";
}

/** Route destructive/irreversible actions to a human unless an approval is attached. */
export const destructiveNeedsApproval: PolicyRule = {
  name: "destructive-action-needs-approval",
  evaluate: (a) => {
    if (!DESTRUCTIVE_KINDS.has(a.kind) || isApproved(a.payload)) return null;
    return {
      rule: "destructive-action-needs-approval",
      detail: `${a.kind} is irreversible and requires human approval before it runs`,
      severity: "review",
    };
  },
};

/** Assemble the active policy from a config; rule order is stable. */
export function buildPolicy(config: PolicyConfig = {}): readonly PolicyRule[] {
  return [
    requireProvenance,
    makeNoUnverifiedExternalSend(config.externalSendThreshold),
    noPiiInExternalOutput,
    destructiveNeedsApproval,
  ];
}

export const defaultPolicy: readonly PolicyRule[] = buildPolicy();
