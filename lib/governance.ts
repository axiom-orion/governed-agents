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

export type Decision = "allow" | "block";

export interface PolicyViolation {
  readonly rule: string;
  readonly detail: string;
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

// --- the gate -------------------------------------------------------------
export function evaluatePolicy(
  action: ProposedAction,
  rules: readonly PolicyRule[],
): PolicyDecision {
  const violations = rules
    .map((r) => r.evaluate(action))
    .filter((v): v is PolicyViolation => v !== null);
  return {
    decision: violations.length === 0 ? "allow" : "block",
    violations,
    evaluatedAt: new Date().toISOString(),
  };
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

/** Assemble the active policy from a config; rule order is stable. */
export function buildPolicy(config: PolicyConfig = {}): readonly PolicyRule[] {
  return [requireProvenance, makeNoUnverifiedExternalSend(config.externalSendThreshold)];
}

export const defaultPolicy: readonly PolicyRule[] = buildPolicy();
