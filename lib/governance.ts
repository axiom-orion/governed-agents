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
export const requireProvenance: PolicyRule = {
  name: "require-provenance",
  evaluate: (a) =>
    a.provenance.length === 0
      ? { rule: "require-provenance", detail: "action has no supporting sources" }
      : null,
};

export const noUnverifiedExternalSend: PolicyRule = {
  name: "no-unverified-external-send",
  evaluate: (a) => {
    if (a.kind !== "send_email") return null;
    const to = typeof a.payload.to === "string" ? a.payload.to : "";
    const hasHighConfidenceSource = a.provenance.some((p) => p.score >= 0.7);
    return to.length > 0 && !hasHighConfidenceSource
      ? { rule: "no-unverified-external-send", detail: `outbound to ${to} lacks a high-confidence source` }
      : null;
  },
};

export const defaultPolicy: readonly PolicyRule[] = [
  requireProvenance,
  noUnverifiedExternalSend,
];
