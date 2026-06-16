// auth/operator.ts
// Operator identity for the cosign write path. v1 is a single env-configured operator —
// enough to attribute every decision to a named human in the audit chain without standing
// up full auth. Upgrade path: swap getOperator() for a Supabase Auth session lookup when
// the demo needs roles or multiple operators.
//
// server-only: the decision path resolves the operator on the server; this never ships to
// the client bundle.
//
// Posture: in simulator mode a default demo operator is always present, so the public
// demo works end-to-end with no setup. In live mode (GOVERNANCE_SOURCE=cognigate) an
// operator identity must be configured (OPERATOR_ID); absent it, getOperator() returns
// null and the Server Action refuses the decision as unauthenticated — fail-closed.

import "server-only";
import { governanceSourceKind } from "@/governance/registry";

export interface Operator {
  readonly id: string;
  readonly name: string;
}

export async function getOperator(): Promise<Operator | null> {
  const id = process.env.OPERATOR_ID?.trim();
  const name = process.env.OPERATOR_NAME?.trim();
  if (id) return { id, name: name && name.length > 0 ? name : id };

  // No configured operator: allowed only in the synthetic simulator, refused live.
  if (governanceSourceKind() === "simulator") {
    return { id: "operator", name: "Operator (demo)" };
  }
  return null;
}
