// scripts/verify-policy.ts
// Headless edge-case verification of the example policy set in lib/governance.ts.
// Pure-rule checks only: no model, no network, no clock dependence.
//
// The claims under test, stated plainly:
//   1. PII: the formats a financial-services email leaks (US/UK identifiers, phones,
//      IBANs, bank details) block an outbound send — and routine numbers (dates, order
//      ids, a checksum-invalid IBAN) do not.
//   2. Provenance: a score counts only when it is a finite number in [0, 1]; malformed
//      scores never clear the send threshold or satisfy require-provenance.
//   3. Kinds: an action kind the policy was not written for is blocked, not trusted.
//   4. Approval: a destructive action clears only when its token matches a retrieved
//      approval record — the proposer cannot approve itself through the payload.
//   5. No shipped Sample scenario changes its decision under the default policy.
//
// Run: npx tsx scripts/verify-policy.ts

import {
  APPROVAL_SOURCE_PREFIX,
  DESTRUCTIVE_KINDS,
  KNOWN_ACTION_KINDS,
  buildPolicy,
  evaluatePolicy,
  isValidScore,
  type Decision,
  type PolicyDecision,
  type Provenance,
  type ProposedAction,
} from "../lib/governance";
import { replayWithPolicy } from "../lib/policy-replay";
import { sampleRuns } from "../mocks/trace.sample";

interface Result {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
}
const results: Result[] = [];
function check(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, detail });
}

const policy = buildPolicy();
const gate = (a: ProposedAction): PolicyDecision => evaluatePolicy(a, policy);
const rulesFired = (d: PolicyDecision): string => d.violations.map((v) => v.rule).join(", ") || "none";

function source(score: number, sourceId = "mem-1"): Provenance {
  return { sourceId, snippet: "a retrieved, verified source", score };
}

function email(body: string, provenance: readonly Provenance[] = [source(0.9)]): ProposedAction {
  return {
    kind: "send_email",
    payload: { to: "ops@client.example", subject: "Follow-up", body },
    justification: "j",
    provenance,
  };
}

function expectDecision(name: string, action: ProposedAction, want: Decision, rule?: string): void {
  const d = gate(action);
  const ruleOk = rule === undefined || d.violations.some((v) => v.rule === rule);
  check(name, d.decision === want && ruleOk, `got ${d.decision} (rules: ${rulesFired(d)})`);
}

// --- 1. PII: leaks block ---------------------------------------------------------------
const PII = "no-pii-in-external-output";
const leaks: ReadonlyArray<readonly [string, string]> = [
  ["SSN, dashed", "SSN 123-45-6789 on file."],
  ["SSN, spaced", "Their SSN is 123 45 6789."],
  ["SSN, bare but labelled", "Social security number: 123456789."],
  ["card, spaced", "Card 4111 1111 1111 1111."],
  ["card, dashed", "Card 4111-1111-1111-1111."],
  ["phone, (555) 123-4567", "Call (555) 123-4567 after 5."],
  ["phone, spaced", "Call 555 123 4567 after 5."],
  ["phone, international +44", "Reach me on +44 20 7946 0958."],
  ["IBAN, compact", "Pay GB82WEST12345698765432 by Friday."],
  ["IBAN, grouped and followed by words", "Pay GB82 WEST 1234 5698 7654 32 and confirm."],
  ["IBAN, lowercase", "iban gb82west12345698765432"],
  ["UK sort code, labelled", "Sort code 12-34-56, thanks."],
  ["UK sort code next to an account number", "Details: 12-34-56 12345678."],
  ["account number, labelled", "Account no. 12345678 is overdrawn."],
];
for (const [label, body] of leaks) expectDecision(`PII blocks: ${label}`, email(body), "block", PII);

// --- 1b. PII: routine numbers do not ------------------------------------------------------
const routine: ReadonlyArray<readonly [string, string]> = [
  ["a dd-mm-yy date", "Meeting moved to 12-03-26."],
  ["an unlabelled 9-digit order id", "Order 123456789 shipped."],
  ["an IBAN-shaped string that fails the checksum", "Ref GB00WEST12345698765432."],
  ["a too-short + number", "Score was +1 20 30 overall."],
  ["plain business prose", "Refunds are issued within 5 business days of a Q3 2026 cancellation."],
];
for (const [label, body] of routine) expectDecision(`PII allows: ${label}`, email(body), "allow");

// --- 2. Provenance scores must be valid -------------------------------------------------------
const SEND = "no-unverified-external-send";
expectDecision("send threshold: score exactly 0.70 clears", email("hi", [source(0.7)]), "allow");
expectDecision("send threshold: 0.6999 blocks", email("hi", [source(0.6999)]), "block", SEND);
expectDecision("send threshold: NaN blocks", email("hi", [source(Number.NaN)]), "block", SEND);
expectDecision("send threshold: out-of-range 5.0 blocks", email("hi", [source(5)]), "block", SEND);
expectDecision("send threshold: negative score blocks", email("hi", [source(-0.1)]), "block", SEND);
expectDecision("send threshold: Infinity blocks", email("hi", [source(Number.POSITIVE_INFINITY)]), "block", SEND);
expectDecision(
  "send threshold: one valid source clears despite a malformed sibling",
  email("hi", [source(5, "mem-bad"), source(0.8, "mem-good")]),
  "allow",
);

const note = (provenance: readonly Provenance[]): ProposedAction => ({
  kind: "write_record",
  payload: { record: "internal note" },
  justification: "j",
  provenance,
});
expectDecision("require-provenance: no sources blocks", note([]), "block", "require-provenance");
expectDecision(
  "require-provenance: only malformed scores blocks",
  note([source(Number.NaN), source(2)]),
  "block",
  "require-provenance",
);
expectDecision("require-provenance: one valid source allows", note([source(0.3)]), "allow");
check(
  "isValidScore: accepts 0 and 1, rejects NaN / ∞ / out of range",
  isValidScore(0) && isValidScore(1) && ![Number.NaN, Number.POSITIVE_INFINITY, -0.01, 1.01].some(isValidScore),
);

// --- 3. Unknown kinds fail closed ----------------------------------------------------------
expectDecision(
  "unknown kind 'wire_transfer' blocks",
  { kind: "wire_transfer", payload: { to: "acct" }, justification: "j", provenance: [source(0.1)] },
  "block",
  "known-action-kind",
);
check(
  "every destructive kind is a known kind",
  [...DESTRUCTIVE_KINDS].every((k) => KNOWN_ACTION_KINDS.has(k)),
);
check(
  "no known kind trips known-action-kind",
  [...KNOWN_ACTION_KINDS].every(
    (kind) =>
      !gate({ kind, payload: {}, justification: "j", provenance: [source(0.9)] }).violations.some(
        (v) => v.rule === "known-action-kind",
      ),
  ),
);

// --- 4. Approval must be grounded in retrieval -----------------------------------------------
const APPROVAL = "destructive-action-needs-approval";
const ticket = (token: string, score = 0.95): Provenance =>
  source(score, `${APPROVAL_SOURCE_PREFIX}${token}`);
const del = (payload: Record<string, unknown>, provenance: readonly Provenance[] = [source(0.9)]): ProposedAction => ({
  kind: "delete_record",
  payload: { collection: "vendors", ...payload },
  justification: "j",
  provenance,
});
expectDecision("delete without an approval needs a human", del({}), "needs_approval", APPROVAL);
expectDecision("delete with only approved: true needs a human", del({ approved: true }), "needs_approval", APPROVAL);
expectDecision("delete with an empty approvalToken needs a human", del({ approvalToken: "" }), "needs_approval", APPROVAL);
expectDecision("delete with a whitespace approvalToken needs a human", del({ approvalToken: "   " }), "needs_approval", APPROVAL);
expectDecision(
  "delete with a non-string approvalToken needs a human",
  del({ approvalToken: 4821 }, [ticket("4821")]),
  "needs_approval",
  APPROVAL,
);
expectDecision(
  "delete whose token matches no retrieved record needs a human",
  del({ approvalToken: "OPS-9999" }, [ticket("OPS-4821")]),
  "needs_approval",
  APPROVAL,
);
const unmatched = gate(del({ approvalToken: "OPS-9999" }, [ticket("OPS-4821")]));
check(
  "an unmatched token is named in the violation detail",
  unmatched.violations.some((v) => v.rule === APPROVAL && v.detail.includes("OPS-9999")),
  rulesFired(unmatched),
);
expectDecision(
  "delete whose matching ticket has a malformed score needs a human",
  del({ approvalToken: "OPS-4821" }, [source(0.9), ticket("OPS-4821", Number.NaN)]),
  "needs_approval",
  APPROVAL,
);
expectDecision(
  "delete whose token matches a retrieved ticket clears",
  del({ approvalToken: "OPS-4821" }, [ticket("OPS-4821")]),
  "allow",
);
expectDecision(
  "an approval does not excuse PII: a blocked send stays blocked",
  { ...email("SSN 123-45-6789"), payload: { to: "x@y.example", body: "SSN 123-45-6789", approvalToken: "OPS-4821" } },
  "block",
  PII,
);

// --- 5. Shipped Sample scenarios keep their recorded decisions -------------------------------
for (const [id, run] of Object.entries(sampleRuns)) {
  const recorded = run.find((e) => e.type === "gate_decision");
  if (recorded === undefined || recorded.type !== "gate_decision") continue;
  const replayed = replayWithPolicy(run, {}).find((e) => e.type === "gate_decision");
  const got = replayed?.type === "gate_decision" ? replayed.decision.decision : "missing";
  check(
    `sample '${id}' keeps its recorded decision (${recorded.decision.decision})`,
    got === recorded.decision.decision,
    `replayed ${got}`,
  );
}

// --- report ----------------------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
for (const r of results) {
  // eslint-disable-next-line no-console
  console.log(`${r.ok ? "ok " : "FAIL"} ${r.name}${!r.ok && r.detail !== undefined ? ` — ${r.detail}` : ""}`);
}
// eslint-disable-next-line no-console
console.log(`\n${results.length - failed.length}/${results.length} policy edge-case checks passed`);
if (failed.length > 0) process.exit(1);
