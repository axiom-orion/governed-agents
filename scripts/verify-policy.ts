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
  APPROVAL_MIN_SCORE,
  APPROVAL_SOURCE_PREFIX,
  DESTRUCTIVE_KINDS,
  KNOWN_ACTION_KINDS,
  MAX_SCANNED_CHARS,
  SCAN_SEPARATOR,
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
const rulesFired = (d: PolicyDecision): string =>
  d.violations.map((v) => v.rule).join(", ") || "none";

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

/** Assert the gate's decision, optionally that `rule` fired and its detail mentions `detailHas`. */
function expectDecision(
  name: string,
  action: ProposedAction,
  want: Decision,
  rule?: string,
  detailHas?: string,
): void {
  const d = gate(action);
  const ruleOk =
    rule === undefined ||
    d.violations.some((v) => v.rule === rule && (detailHas === undefined || v.detail.includes(detailHas)));
  check(name, d.decision === want && ruleOk, `got ${d.decision} (rules: ${rulesFired(d)})`);
}

// --- 1. PII: leaks block, under the signature that names them ------------------------------
// The third field is the signature label the violation must report, so a leak caught by a
// neighbouring shape (an IBAN's digits read as a card) is a failure, not a pass.
const PII = "no-pii-in-external-output";
const SSN = "US Social Security number";
const CARD = "credit-card number";
const PHONE = "phone number";
const IBAN = "IBAN";
const SORT_CODE = "UK sort code";
const ACCOUNT = "bank account number";
const leaks: ReadonlyArray<readonly [string, string, string]> = [
  ["SSN, dashed", "SSN 123-45-6789 on file.", SSN],
  ["SSN, spaced", "Their SSN is 123 45 6789.", SSN],
  ["SSN, bare but labelled", "Social security number: 123456789.", SSN],
  ["card, spaced", "Card 4111 1111 1111 1111.", CARD],
  ["card, dashed", "Card 4111-1111-1111-1111.", CARD],
  ["phone, (555) 123-4567", "Call (555) 123-4567 after 5.", PHONE],
  ["phone, spaced", "Call 555 123 4567 after 5.", PHONE],
  ["phone, +44", "Reach me on +44 20 7946 0958.", PHONE],
  ["phone, +44 with a (0) trunk prefix", "Reach me on +44 (0)20 7946 0958.", PHONE],
  ["phone, +33 with a 1-digit area code", "Call +33 1 23 45 67 89.", PHONE],
  ["phone, +61 with a 1-digit area code", "Call +61 2 9876 5432.", PHONE],
  ["phone, +353 (not read as an SSN)", "Call +353 86 1234 5678.", PHONE],
  ["IBAN, compact", "Pay GB82WEST12345698765432 by Friday.", IBAN],
  ["IBAN, grouped and followed by words", "Pay GB82 WEST 1234 5698 7654 32 and confirm.", IBAN],
  ["IBAN, lowercase", "iban gb82west12345698765432", IBAN],
  ["IBAN, behind a colon label", "IBAN:GB82WEST12345698765432", IBAN],
  ["IBAN, behind an = label", "iban=GB82WEST12345698765432", IBAN],
  ["IBAN, dashed groups", "IBAN GB82-WEST-1234-5698-7654-32", IBAN],
  ["IBAN, all-digit DE (not read as a card)", "Pay DE89 3704 0044 0532 0130 00 today.", IBAN],
  ["IBAN, NL", "NL91ABNA0417164300", IBAN],
  ["IBAN, NO (15 chars, the minimum)", "NO9386011117947", IBAN],
  ["IBAN, MT (31 chars, alphanumeric BBAN)", "MT84MALT011000012345MTLCAST001S", IBAN],
  ["UK sort code, labelled", "Sort code 12-34-56, thanks.", SORT_CODE],
  ["UK sort code next to an account number", "Details: 12-34-56 12345678.", SORT_CODE],
  ["UK sort code after an account number", "Details: 12345678 / 12-34-56.", SORT_CODE],
  ["account number, 'no.'", "Account no. 12345678 is overdrawn.", ACCOUNT],
  ["account number, 'number is'", "Your account number is 12345678.", ACCOUNT],
  ["account number, 'ID:'", "Account ID: 12345678.", ACCOUNT],
  ["account number, 'acct #'", "Ref acct #12345678.", ACCOUNT],
  ["account number, 'A/C'", "Pay A/C 12345678 today.", ACCOUNT],
  ["phone, 0044 international prefix", "Call 0044 20 7946 0958.", PHONE],
  ["phone, UK mobile national format", "Text 07700 900123.", PHONE],
  ["phone, +44 dotted and run on into a number", "Ring +44.20.7946.0958.1234.", PHONE],
  ["card, 13-digit Visa passing Luhn", "Card 4222222222222.", CARD],
  ["card, 19-digit passing Luhn", "Card 6304000000000000000.", CARD],
  ["SSN, full-width digits", "SSN \uFF11\uFF12\uFF13-\uFF14\uFF15-\uFF16\uFF17\uFF18\uFF19.", SSN],
  ["SSN, en-dashes", "SSN 123\u201345\u20136789.", SSN],
  ["SSN, zero-width space inside", "SSN 123-4\u200B5-6789.", SSN],
  ["SSN, no-break spaces", "SSN 123\u00A045\u00A06789.", SSN],
  ["SSN, a left-to-right mark between groups", "SSN 123\u200E-45-6789.", SSN],
  ["SSN, an invisible tag character inside", "SSN 123-4\u{E0041}5-6789.", SSN],
  ["SSN, Devanagari digits", "SSN \u0967\u0968\u0969-\u096A\u096B-\u096C\u096D\u096E\u096F.", SSN],
  ["SSN, hyphen-bullet dashes", "SSN 123\u204345\u20436789.", SSN],
  ["card, Arabic-Indic digits", "Card \u0664\u0661\u0661\u0661 \u0661\u0661\u0661\u0661 \u0661\u0661\u0661\u0661 \u0661\u0661\u0661\u0661.", CARD],
  ["card, a bidi mark between groups", "Card 4111\u200E 1111 1111 1111.", CARD],
  ["card, 14-digit Diners passing Luhn", "Card 36227206271667.", CARD],
  ["phone, UK mobile 5-3-3", "Text 07700 900 123.", PHONE],
  ["phone, UK mobile dashed", "Text 07700-900123.", PHONE],
  ["phone, UK London landline", "Call 020 7946 0958.", PHONE],
  ["phone, UK 5-6 landline", "Call 01632 960123.", PHONE],
  ["phone, 00 then a space", "Call 00 44 20 7946 0958.", PHONE],
  ["sort code beside an account, Luhn-valid digits (not a card)", "Details: 12-34-56 12345673.", SORT_CODE],
  ["account number, dash after the label", "Account number - 12345678.", ACCOUNT],
  ["account number, grouped digits", "Account number 1234 5678.", ACCOUNT],
  ["account number, 15 digits (not a card)", "Account number 123456789012345.", ACCOUNT],
];
for (const [label, body, signature] of leaks) {
  expectDecision(`PII blocks: ${label}`, email(body), "block", PII, signature);
}

// --- 1b. PII: routine numbers and prose do not ----------------------------------------------
const routine: ReadonlyArray<readonly [string, string]> = [
  ["a dd-mm-yy date", "Meeting moved to 12-03-26."],
  ["a date and an order id in one sentence", "On 12-03-26 order 12345678 shipped."],
  ["an unlabelled 9-digit order id", "Order 123456789 shipped."],
  ["an IBAN-shaped string that fails the checksum", "Ref GB00WEST12345698765432."],
  ["a too-short + number", "Score was +1 20 30 overall."],
  ["a signed percentage", "Revenue grew +3.2% in 2026."],
  ["plain business prose", "Refunds are issued within 5 business days of a Q3 2026 cancellation."],
  ["a CY26 token before words", "The CY26 targets were approved by the board."],
  ["a US25 token before words", "The US25 budget review is scheduled for Friday."],
  ["an EU27 token before words", "The EU27 planning kicks off next week."],
  ["an FY26 token before short words", "FY26 for all the new hires starts in March."],
  ["'account' as a verb", "We account for 1500000 in annual revenue."],
  ["'accounts' with a large number", "Accounts 1234567 through 1234999 were migrated."],
  ["a zero-padded id", "Invoice 00123456 is attached."],
  ["a 14-digit id failing Luhn", "Shipment 12345678901234 left the depot."],
  ["random digit groups after a CC## token", "XI11 6811 173 4802 plan."],
  ["a 6-digit ref beside an ISO date (Luhn joining)", "Ref 123454 2026-03-12."],
  ["a zero-padded id with separators", "Ref 0001-2345-6789."],
  // Each of these passes mod-97: only its own IBAN guard keeps it from blocking.
  ["4-letter words after FY26 that pass mod-97 (BBAN-digit guard)", "FY26 plan team good next."],
  ["an 8-digit token after QQ12 that passes mod-97 (group-length guard)", "QQ12 10000010 12345."],
];
for (const [label, body] of routine) expectDecision(`PII allows: ${label}`, email(body), "allow");

// --- 1b'. PII: where the payload hides it ----------------------------------------------------
expectDecision(
  "PII blocks: a leak nested inside an array field is scanned",
  { ...email("hi"), payload: { to: "ops@client.example", attachments: [{ note: "SSN 123-45-6789" }] } },
  "block",
  PII,
  SSN,
);
// The size cap, pinned on both sides. A `{ body }` payload scans its key, the separator and
// the body, so the body that lands exactly on the cap is the cap minus that overhead.
const BODY_OVERHEAD = "body".length + SCAN_SEPARATOR.length;
const bodyOnly = (length: number): ProposedAction => ({
  ...email("hi"),
  payload: { body: "x".repeat(length - BODY_OVERHEAD) },
});
const piiRuleFired = (a: ProposedAction): boolean => gate(a).violations.some((v) => v.rule === PII);
check("PII scan: a payload at the size cap is scanned, not refused", !piiRuleFired(bodyOnly(MAX_SCANNED_CHARS)));
expectDecision(
  "PII blocks: a payload one character over the cap fails closed",
  bodyOnly(MAX_SCANNED_CHARS + 1),
  "block",
  PII,
  "too large to scan",
);

const withPayload = (payload: Readonly<Record<string, unknown>>): ProposedAction => ({
  ...email("hi"),
  payload: { to: "ops@client.example", ...payload },
});
expectDecision(
  "PII blocks: a leak five levels deep is scanned",
  withPayload({ meta: { a: { b: { c: { d: "SSN 123-45-6789" } } } } }),
  "block",
  PII,
  SSN,
);
expectDecision(
  "PII blocks: a payload nested past the depth limit fails closed",
  withPayload({ a: { b: { c: { d: { e: { f: { g: "fine" } } } } } } }),
  "block",
  PII,
  "nested deeper",
);
expectDecision("PII blocks: a card stored as a number", withPayload({ cc: 4111111111111111 }), "block", PII, CARD);
expectDecision("PII blocks: a card stored as an object key", withPayload({ "4111 1111 1111 1111": "x" }), "block", PII, CARD);
expectDecision(
  "PII blocks: a payload with too many values fails closed",
  withPayload({ list: Array.from({ length: 20_000 }, (_, i) => i % 10) }),
  "block",
  PII,
  "more than",
);
const cyclic: Record<string, unknown> = { note: "hi" };
cyclic.self = cyclic;
expectDecision("PII blocks: a cyclic payload fails closed", withPayload(cyclic), "block", PII, "nested deeper");
// Built directly: spreading it into withPayload() would run the getter in the test itself.
const throwing: Record<string, unknown> = { to: "ops@client.example" };
Object.defineProperty(throwing, "body", {
  enumerable: true,
  get: () => {
    throw new Error("boom");
  },
});
expectDecision(
  "PII blocks: a payload whose getter throws fails closed",
  { ...email("hi"), payload: throwing },
  "block",
  PII,
  "could not be read",
);

// --- 1c. PII: documented fail-closed trade-offs ------------------------------------------------
// The exact spaced SSN (3-2-4) and phone (3-3-4) shapes are ambiguous; the gate blocks them
// rather than guess. Pinned so a change to this trade-off is deliberate.
expectDecision("trade-off: a spaced 3-2-4 run reads as an SSN", email("Room 123 45 6789."), "block", PII, SSN);
expectDecision(
  "trade-off: an 8-digit number beside a dd-dd-dd date reads as a sort code",
  email("Order 12345678 (12-03-26)."),
  "block",
  PII,
  SORT_CODE,
);
expectDecision(
  "trade-off: a spaced 3-3-4 run reads as a phone",
  email("Units shipped: 120 450 1000 this week."),
  "block",
  PII,
  PHONE,
);

// --- 2. Provenance scores must be valid -------------------------------------------------------
const SEND = "no-unverified-external-send";
const sendTo = (to: unknown): ProposedAction => ({
  ...email("hi"),
  payload: to === undefined ? { subject: "s", body: "hi" } : { to, subject: "s", body: "hi" },
  // A high-scoring source: the threshold would allow, so only the recipient check blocks.
  provenance: [source(0.9)],
});
expectDecision("send: a missing recipient blocks", sendTo(undefined), "block", SEND, "no single recipient");
expectDecision("send: a comma-separated list blocks", sendTo("a@x.example, evil@y.example"), "block", SEND, "no single recipient");
expectDecision("send: a header injection blocks", sendTo("a@x.example\nBcc: evil@y.example"), "block", SEND, "no single recipient");
expectDecision("send: a value with no address blocks", sendTo("the vendor"), "block", SEND, "no single recipient");
expectDecision("send: one address with a high-scoring source clears", sendTo("a@x.example"), "allow");
expectDecision("send: a blank recipient blocks", sendTo("   "), "block", SEND, "no single recipient");
expectDecision("send: an array of recipients blocks", sendTo(["a@x.example"]), "block", SEND, "no single recipient");
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

const internalNote = (provenance: readonly Provenance[]): ProposedAction => ({
  kind: "write_record",
  payload: { record: "internal note" },
  justification: "j",
  provenance,
});
expectDecision("require-provenance: no sources blocks", internalNote([]), "block", "require-provenance");
expectDecision(
  "require-provenance: only malformed scores blocks",
  internalNote([source(Number.NaN), source(2)]),
  "block",
  "require-provenance",
);
expectDecision("require-provenance: one valid source allows", internalNote([source(0.3)]), "allow");
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
const deletion = (
  payload: Readonly<Record<string, unknown>>,
  provenance: readonly Provenance[] = [source(0.9)],
): ProposedAction => ({
  kind: "delete_record",
  payload: { collection: "vendors", ...payload },
  justification: "j",
  provenance,
});
expectDecision("delete without an approval needs a human", deletion({}), "needs_approval", APPROVAL);
expectDecision(
  "delete with only approved: true needs a human",
  deletion({ approved: true }),
  "needs_approval",
  APPROVAL,
);
expectDecision(
  "delete with an empty approvalToken needs a human",
  deletion({ approvalToken: "" }),
  "needs_approval",
  APPROVAL,
);
expectDecision(
  "delete with a whitespace approvalToken needs a human",
  deletion({ approvalToken: "   " }),
  "needs_approval",
  APPROVAL,
);
expectDecision(
  "delete with a non-string approvalToken needs a human",
  deletion({ approvalToken: 4821 }, [ticket("4821")]),
  "needs_approval",
  APPROVAL,
);
expectDecision(
  "delete whose token matches no retrieved record needs a human",
  deletion({ approvalToken: "OPS-9999" }, [ticket("OPS-4821")]),
  "needs_approval",
  APPROVAL,
  "OPS-9999",
);
expectDecision(
  "delete whose matching ticket has a malformed score needs a human",
  deletion({ approvalToken: "OPS-4821" }, [source(0.9), ticket("OPS-4821", Number.NaN)]),
  "needs_approval",
  APPROVAL,
);
expectDecision(
  "delete whose ticket was retrieved at score 0 needs a human",
  deletion({ approvalToken: "OPS-4821" }, [source(0.9), ticket("OPS-4821", 0)]),
  "needs_approval",
  APPROVAL,
);
expectDecision(
  "delete whose ticket scores just under the approval bar needs a human",
  deletion({ approvalToken: "OPS-4821" }, [source(0.9), ticket("OPS-4821", APPROVAL_MIN_SCORE - 0.01)]),
  "needs_approval",
  APPROVAL,
);
expectDecision(
  "delete whose ticket scores exactly the approval bar clears",
  deletion({ approvalToken: "OPS-4821" }, [ticket("OPS-4821", APPROVAL_MIN_SCORE)]),
  "allow",
);
expectDecision(
  "delete whose token matches a retrieved ticket clears",
  deletion({ approvalToken: "OPS-4821" }, [ticket("OPS-4821")]),
  "allow",
);
expectDecision(
  "a token with surrounding whitespace is trimmed before matching its ticket",
  deletion({ approvalToken: "  OPS-4821 " }, [ticket("OPS-4821")]),
  "allow",
);

// --- 5. Shipped Sample scenarios keep their recorded decisions -------------------------------
let samplesReplayed = 0;
for (const [id, run] of Object.entries(sampleRuns)) {
  const recorded = run.find((e) => e.type === "gate_decision");
  if (recorded === undefined || recorded.type !== "gate_decision") continue;
  samplesReplayed++;
  const replayed = replayWithPolicy(run, {}).find((e) => e.type === "gate_decision");
  const got = replayed?.type === "gate_decision" ? replayed.decision.decision : "missing";
  check(
    `sample '${id}' keeps its recorded decision (${recorded.decision.decision})`,
    got === recorded.decision.decision,
    `replayed ${got}`,
  );
}
check(
  "every shipped sample run carries a recorded gate decision to replay",
  samplesReplayed > 0 && samplesReplayed === Object.keys(sampleRuns).length,
  `${samplesReplayed}/${Object.keys(sampleRuns).length} replayed`,
);

// --- report ----------------------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
for (const r of results) {
  // eslint-disable-next-line no-console
  console.log(`${r.ok ? "ok " : "FAIL"} ${r.name}${!r.ok && r.detail !== undefined ? ` — ${r.detail}` : ""}`);
}
// eslint-disable-next-line no-console
console.log(`\n${results.length - failed.length}/${results.length} policy edge-case checks passed`);
if (failed.length > 0) process.exit(1);
