// mocks/trace.sample.ts
// Hard-coded sample logs that drive the UI until the live /api/run stream is
// wired in at P5. Two complete runs — one the gate ALLOWS, one it BLOCKS — plus
// helpers to serialize them to NDJSON, inject malformed lines, and replay them
// as a chunked stream (chunks split mid-line on purpose, to exercise the
// incremental parser). Every value here is shaped exactly like a real
// TraceEvent; the UI cannot tell this apart from the wire.

// Relative import (not the @/ alias) so this module also loads cleanly under
// the plain-Node check script in scripts/check-model.ts.
import type { TraceEvent } from "../lib/trace-events";

// --- ALLOW run -------------------------------------------------------------
// Researcher gathers high-confidence sources → Reasoner proposes an internal
// write_record → gate allows (has provenance, not an external send) → executor
// runs.
export const allowRun: readonly TraceEvent[] = [
  {
    type: "run_started",
    runId: "run_allow_8f21",
    task: "Summarize the Q2 onboarding policy and save the summary as an internal record.",
    at: "2026-06-02T15:04:01.000Z",
  },
  { type: "step_started", stepId: "s1", role: "researcher", at: "2026-06-02T15:04:01.220Z" },
  {
    type: "step_completed",
    stepId: "s1",
    role: "researcher",
    summary: "Retrieved 3 passages describing the Q2 onboarding policy.",
    provenance: [
      {
        sourceId: "doc:onboarding-policy-2026#sec-2",
        snippet:
          "New hires complete identity verification and equipment setup within the first two business days.",
        score: 0.92,
      },
      {
        sourceId: "doc:onboarding-policy-2026#sec-4",
        snippet:
          "Manager-led orientation is scheduled in week one; compliance training must close by week two.",
        score: 0.86,
      },
      {
        sourceId: "kb:hr-faq#onboarding-timeline",
        snippet: "Provisioning requests submitted before noon are fulfilled same day.",
        score: 0.74,
      },
    ],
    at: "2026-06-02T15:04:03.880Z",
  },
  { type: "step_started", stepId: "s2", role: "reasoner", at: "2026-06-02T15:04:03.950Z" },
  {
    type: "step_completed",
    stepId: "s2",
    role: "reasoner",
    summary: "Synthesized a two-sentence summary grounded in the two strongest passages.",
    provenance: [
      {
        sourceId: "doc:onboarding-policy-2026#sec-2",
        snippet:
          "New hires complete identity verification and equipment setup within the first two business days.",
        score: 0.92,
      },
      {
        sourceId: "doc:onboarding-policy-2026#sec-4",
        snippet:
          "Manager-led orientation is scheduled in week one; compliance training must close by week two.",
        score: 0.86,
      },
    ],
    at: "2026-06-02T15:04:06.110Z",
  },
  {
    type: "action_proposed",
    stepId: "s2",
    action: {
      kind: "write_record",
      payload: { collection: "summaries", title: "Q2 Onboarding Policy", visibility: "internal" },
      justification: "Persist the grounded summary so downstream agents can reuse it.",
      provenance: [
        {
          sourceId: "doc:onboarding-policy-2026#sec-2",
          snippet:
            "New hires complete identity verification and equipment setup within the first two business days.",
          score: 0.92,
        },
        {
          sourceId: "doc:onboarding-policy-2026#sec-4",
          snippet:
            "Manager-led orientation is scheduled in week one; compliance training must close by week two.",
          score: 0.86,
        },
      ],
    },
    at: "2026-06-02T15:04:06.200Z",
  },
  {
    type: "gate_decision",
    stepId: "s2",
    decision: { decision: "allow", violations: [], evaluatedAt: "2026-06-02T15:04:06.260Z" },
    at: "2026-06-02T15:04:06.260Z",
  },
  { type: "step_started", stepId: "s3", role: "executor", at: "2026-06-02T15:04:06.320Z" },
  {
    type: "executed",
    stepId: "s3",
    result: "Wrote record summaries/q2-onboarding-policy (rev 1).",
    at: "2026-06-02T15:04:06.940Z",
  },
  {
    type: "step_completed",
    stepId: "s3",
    role: "executor",
    summary: "Persisted the summary record to the internal collection.",
    provenance: [],
    at: "2026-06-02T15:04:07.010Z",
  },
  { type: "run_completed", runId: "run_allow_8f21", at: "2026-06-02T15:04:07.050Z" },
];

// --- BLOCK run -------------------------------------------------------------
// Only low-confidence sources are found → Reasoner proposes an external
// send_email → gate blocks (no-unverified-external-send) → run halts; executor
// never runs.
export const blockRun: readonly TraceEvent[] = [
  {
    type: "run_started",
    runId: "run_block_b704",
    task: "Email the vendor to confirm the contract renewal terms.",
    at: "2026-06-02T15:09:12.000Z",
  },
  { type: "step_started", stepId: "r1", role: "researcher", at: "2026-06-02T15:09:12.180Z" },
  {
    type: "step_completed",
    stepId: "r1",
    role: "researcher",
    summary: "Found only two low-confidence mentions of the renewal terms.",
    provenance: [
      {
        sourceId: "email:thread-4471#msg-9",
        snippet: "...think the renewal is around the same rate as last year, but I'd double-check...",
        score: 0.42,
      },
      {
        sourceId: "note:vendor-call-2026-05-19",
        snippet: "Verbal mention of a possible 12-month extension; nothing confirmed in writing.",
        score: 0.55,
      },
    ],
    at: "2026-06-02T15:09:14.700Z",
  },
  { type: "step_started", stepId: "r2", role: "reasoner", at: "2026-06-02T15:09:14.760Z" },
  {
    type: "step_completed",
    stepId: "r2",
    role: "reasoner",
    summary: "Drafted a renewal-confirmation email to the vendor.",
    provenance: [
      {
        sourceId: "note:vendor-call-2026-05-19",
        snippet: "Verbal mention of a possible 12-month extension; nothing confirmed in writing.",
        score: 0.55,
      },
    ],
    at: "2026-06-02T15:09:17.020Z",
  },
  {
    type: "action_proposed",
    stepId: "r2",
    action: {
      kind: "send_email",
      payload: {
        to: "vendor@acme-supplies.example",
        subject: "Confirming our renewal terms",
        body: "Hi — confirming the 12-month renewal at the same rate as last year. Best, Procurement",
      },
      justification: "Confirm the renewal terms with the vendor before the deadline.",
      provenance: [
        {
          sourceId: "note:vendor-call-2026-05-19",
          snippet: "Verbal mention of a possible 12-month extension; nothing confirmed in writing.",
          score: 0.55,
        },
      ],
    },
    at: "2026-06-02T15:09:17.090Z",
  },
  {
    type: "gate_decision",
    stepId: "r2",
    decision: {
      decision: "block",
      violations: [
        {
          rule: "no-unverified-external-send",
          detail: "outbound to vendor@acme-supplies.example lacks a high-confidence source",
        },
      ],
      evaluatedAt: "2026-06-02T15:09:17.150Z",
    },
    at: "2026-06-02T15:09:17.150Z",
  },
  {
    type: "halted",
    stepId: "r2",
    reason: "Action blocked by governance gate: no-unverified-external-send.",
    at: "2026-06-02T15:09:17.200Z",
  },
  { type: "run_completed", runId: "run_block_b704", at: "2026-06-02T15:09:17.240Z" },
];

// --- PII-LEAK BLOCK --------------------------------------------------------
// A well-sourced action (high-confidence record) is still blocked because the
// outbound email body contains personal data — a different rule from the
// confidence threshold (no-pii-in-external-output).
export const piiRun: readonly TraceEvent[] = [
  {
    type: "run_started",
    runId: "run_pii_3a90",
    task: "Email the customer's account summary, including their SSN, to the external auditor.",
    at: "2026-06-03T10:00:00.000Z",
  },
  { type: "step_started", stepId: "p1", role: "researcher", at: "2026-06-03T10:00:00.200Z" },
  {
    type: "step_completed",
    stepId: "p1",
    role: "researcher",
    summary: "Retrieved the customer's verified account record (high confidence).",
    provenance: [
      {
        sourceId: "doc:customer-record#cus-7741",
        snippet:
          "Account holder verified; balance and plan current. Record flagged: contains personal data (SSN, DOB).",
        score: 0.88,
      },
    ],
    at: "2026-06-03T10:00:02.400Z",
  },
  { type: "step_started", stepId: "p2", role: "reasoner", at: "2026-06-03T10:00:02.500Z" },
  {
    type: "step_completed",
    stepId: "p2",
    role: "reasoner",
    summary: "Drafted an account-summary email to the external auditor.",
    provenance: [
      {
        sourceId: "doc:customer-record#cus-7741",
        snippet:
          "Account holder verified; balance and plan current. Record flagged: contains personal data (SSN, DOB).",
        score: 0.88,
      },
    ],
    at: "2026-06-03T10:00:04.600Z",
  },
  {
    type: "action_proposed",
    stepId: "p2",
    action: {
      kind: "send_email",
      payload: {
        to: "audit@third-party.example",
        subject: "Account summary for review",
        body: "Customer cus-7741, SSN 123-45-6789, current balance $4,120. Sending for your audit.",
      },
      justification: "Provide the requested account summary to the external auditor.",
      provenance: [
        {
          sourceId: "doc:customer-record#cus-7741",
          snippet:
            "Account holder verified; balance and plan current. Record flagged: contains personal data (SSN, DOB).",
          score: 0.88,
        },
      ],
    },
    at: "2026-06-03T10:00:04.700Z",
  },
  {
    type: "gate_decision",
    stepId: "p2",
    decision: {
      decision: "block",
      violations: [
        {
          rule: "no-pii-in-external-output",
          detail: "outbound message appears to contain a US Social Security number",
          severity: "block",
        },
      ],
      evaluatedAt: "2026-06-03T10:00:04.760Z",
    },
    at: "2026-06-03T10:00:04.760Z",
  },
  {
    type: "halted",
    stepId: "p2",
    reason: "Action blocked by governance gate: no-pii-in-external-output.",
    at: "2026-06-03T10:00:04.800Z",
  },
  { type: "run_completed", runId: "run_pii_3a90", at: "2026-06-03T10:00:04.840Z" },
];

// --- DESTRUCTIVE → NEEDS APPROVAL ------------------------------------------
// An irreversible delete is neither allowed nor blocked: the gate parks it for a
// human (the third decision state) via destructive-action-needs-approval.
export const approvalRun: readonly TraceEvent[] = [
  {
    type: "run_started",
    runId: "run_appr_b15c",
    task: "Delete the 42 duplicate vendor records flagged by last night's dedupe job.",
    at: "2026-06-04T08:30:00.000Z",
  },
  { type: "step_started", stepId: "a1", role: "researcher", at: "2026-06-04T08:30:00.180Z" },
  {
    type: "step_completed",
    stepId: "a1",
    role: "researcher",
    summary: "Found the dedupe job output listing 42 duplicate vendor records.",
    provenance: [
      {
        sourceId: "job:dedupe-2026-06-03#report",
        snippet: "42 vendor records identified as exact duplicates of an existing canonical record.",
        score: 0.81,
      },
    ],
    at: "2026-06-04T08:30:02.300Z",
  },
  { type: "step_started", stepId: "a2", role: "reasoner", at: "2026-06-04T08:30:02.380Z" },
  {
    type: "step_completed",
    stepId: "a2",
    role: "reasoner",
    summary: "Proposed deleting the 42 flagged duplicate vendor records.",
    provenance: [
      {
        sourceId: "job:dedupe-2026-06-03#report",
        snippet: "42 vendor records identified as exact duplicates of an existing canonical record.",
        score: 0.81,
      },
    ],
    at: "2026-06-04T08:30:04.500Z",
  },
  {
    type: "action_proposed",
    stepId: "a2",
    action: {
      kind: "delete_record",
      payload: { collection: "vendors", count: 42, reason: "dedupe-2026-06-03" },
      justification: "Remove the duplicate vendor records identified by the dedupe job.",
      provenance: [
        {
          sourceId: "job:dedupe-2026-06-03#report",
          snippet:
            "42 vendor records identified as exact duplicates of an existing canonical record.",
          score: 0.81,
        },
      ],
    },
    at: "2026-06-04T08:30:04.600Z",
  },
  {
    type: "gate_decision",
    stepId: "a2",
    decision: {
      decision: "needs_approval",
      violations: [
        {
          rule: "destructive-action-needs-approval",
          detail: "delete_record is irreversible and requires human approval before it runs",
          severity: "review",
        },
      ],
      evaluatedAt: "2026-06-04T08:30:04.660Z",
    },
    at: "2026-06-04T08:30:04.660Z",
  },
  {
    type: "awaiting_approval",
    stepId: "a2",
    reason: "destructive-action-needs-approval: delete_record is irreversible and requires human approval before it runs",
    at: "2026-06-04T08:30:04.700Z",
  },
  { type: "run_completed", runId: "run_appr_b15c", at: "2026-06-04T08:30:04.740Z" },
];

// --- APPROVED DESTRUCTIVE → ALLOW ------------------------------------------
// The same delete, but with an approval token attached, clears the gate and runs —
// showing the approval path resolving to allow.
export const approvedRun: readonly TraceEvent[] = [
  {
    type: "run_started",
    runId: "run_okok_c2d7",
    task: "Delete the 42 duplicate vendor records — approved by the data steward (OPS-4821).",
    at: "2026-06-04T09:15:00.000Z",
  },
  { type: "step_started", stepId: "k1", role: "researcher", at: "2026-06-04T09:15:00.180Z" },
  {
    type: "step_completed",
    stepId: "k1",
    role: "researcher",
    summary: "Confirmed the dedupe job output and the attached steward approval OPS-4821.",
    provenance: [
      {
        sourceId: "job:dedupe-2026-06-03#report",
        snippet: "42 vendor records identified as exact duplicates of an existing canonical record.",
        score: 0.81,
      },
      {
        sourceId: "ticket:OPS-4821",
        snippet: "Data steward approved deletion of the 42 flagged duplicates.",
        score: 0.95,
      },
    ],
    at: "2026-06-04T09:15:02.300Z",
  },
  { type: "step_started", stepId: "k2", role: "reasoner", at: "2026-06-04T09:15:02.380Z" },
  {
    type: "step_completed",
    stepId: "k2",
    role: "reasoner",
    summary: "Proposed the approved deletion of the 42 duplicate vendor records.",
    provenance: [
      {
        sourceId: "ticket:OPS-4821",
        snippet: "Data steward approved deletion of the 42 flagged duplicates.",
        score: 0.95,
      },
    ],
    at: "2026-06-04T09:15:04.500Z",
  },
  {
    type: "action_proposed",
    stepId: "k2",
    action: {
      kind: "delete_record",
      payload: { collection: "vendors", count: 42, approved: true, approvalToken: "OPS-4821" },
      justification: "Remove the duplicate vendor records; deletion is approved (OPS-4821).",
      provenance: [
        {
          sourceId: "ticket:OPS-4821",
          snippet: "Data steward approved deletion of the 42 flagged duplicates.",
          score: 0.95,
        },
      ],
    },
    at: "2026-06-04T09:15:04.600Z",
  },
  {
    type: "gate_decision",
    stepId: "k2",
    decision: { decision: "allow", violations: [], evaluatedAt: "2026-06-04T09:15:04.660Z" },
    at: "2026-06-04T09:15:04.660Z",
  },
  { type: "step_started", stepId: "k3", role: "executor", at: "2026-06-04T09:15:04.720Z" },
  {
    type: "executed",
    stepId: "k3",
    result: "Deleted 42 duplicate vendor records (approved via OPS-4821).",
    at: "2026-06-04T09:15:05.200Z",
  },
  {
    type: "step_completed",
    stepId: "k3",
    role: "executor",
    summary: "Removed the 42 duplicate vendor records.",
    provenance: [],
    at: "2026-06-04T09:15:05.260Z",
  },
  { type: "run_completed", runId: "run_okok_c2d7", at: "2026-06-04T09:15:05.300Z" },
];

// --- TRIAD CONSENSUS: AGREE → ALLOW ----------------------------------------
// All three models independently propose the same internal write_record. The
// gate's require-model-consensus rule is satisfied (unanimous), so the action runs.
export const consensusRun: readonly TraceEvent[] = [
  {
    type: "run_started",
    runId: "run_triad_1c0a",
    task: "Summarize the Q3 incident retro and record an internal summary for the on-call team.",
    at: "2026-06-05T11:00:00.000Z",
  },
  { type: "step_started", stepId: "c1", role: "researcher", at: "2026-06-05T11:00:00.200Z" },
  {
    type: "step_completed",
    stepId: "c1",
    role: "researcher",
    summary: "Retrieved the Q3 incident retro notes (high confidence).",
    provenance: [
      {
        sourceId: "doc:incident-retro-2026-q3",
        snippet: "Root cause, timeline, and three remediation items agreed in the Q3 retro.",
        score: 0.9,
      },
    ],
    at: "2026-06-05T11:00:02.300Z",
  },
  { type: "step_started", stepId: "c2", role: "reasoner", at: "2026-06-05T11:00:02.380Z" },
  {
    type: "step_completed",
    stepId: "c2",
    role: "reasoner",
    summary: "All three models proposed an internal write_record — unanimous.",
    provenance: [
      {
        sourceId: "doc:incident-retro-2026-q3",
        snippet: "Root cause, timeline, and three remediation items agreed in the Q3 retro.",
        score: 0.9,
      },
    ],
    at: "2026-06-05T11:00:05.400Z",
  },
  {
    type: "action_proposed",
    stepId: "c2",
    action: {
      kind: "write_record",
      payload: { collection: "retros", title: "Q3 Incident Retro", visibility: "internal" },
      justification: "Persist the retro summary so the on-call team can reuse it.",
      provenance: [
        {
          sourceId: "doc:incident-retro-2026-q3",
          snippet: "Root cause, timeline, and three remediation items agreed in the Q3 retro.",
          score: 0.9,
        },
      ],
      consensus: {
        votes: [
          { model: "claude", kind: "write_record", justification: "Record the retro internally." },
          { model: "gemini", kind: "write_record", justification: "Save an internal summary." },
          { model: "grok", kind: "write_record", justification: "Log the retro for on-call." },
        ],
        agreementRatio: 1,
        chosenKind: "write_record",
      },
    },
    at: "2026-06-05T11:00:05.500Z",
  },
  {
    type: "gate_decision",
    stepId: "c2",
    decision: { decision: "allow", violations: [], evaluatedAt: "2026-06-05T11:00:05.560Z" },
    at: "2026-06-05T11:00:05.560Z",
  },
  { type: "step_started", stepId: "c3", role: "executor", at: "2026-06-05T11:00:05.620Z" },
  {
    type: "executed",
    stepId: "c3",
    result: "Wrote record retros/q3-incident-retro (rev 1).",
    at: "2026-06-05T11:00:06.100Z",
  },
  {
    type: "step_completed",
    stepId: "c3",
    role: "executor",
    summary: "Persisted the retro summary to the internal collection.",
    provenance: [],
    at: "2026-06-05T11:00:06.160Z",
  },
  { type: "run_completed", runId: "run_triad_1c0a", at: "2026-06-05T11:00:06.200Z" },
];

// --- TRIAD CONSENSUS: SPLIT → NEEDS APPROVAL -------------------------------
// The models disagree on whether to act externally (send_email) or just log it
// (write_record). The majority kind wins the action, but because they did NOT
// agree, require-model-consensus routes it to a human instead of executing.
export const splitRun: readonly TraceEvent[] = [
  {
    type: "run_started",
    runId: "run_split_9d4e",
    task: "Follow up with the partner about the Q3 renewal.",
    at: "2026-06-05T12:30:00.000Z",
  },
  { type: "step_started", stepId: "x1", role: "researcher", at: "2026-06-05T12:30:00.200Z" },
  {
    type: "step_completed",
    stepId: "x1",
    role: "researcher",
    summary: "Found a note asking to follow up — ambiguous whether by email or internal tracking.",
    provenance: [
      {
        sourceId: "note:partner-call-2026-08",
        snippet: "Partner asked us to follow up on the renewal; unclear if by email or just tracked.",
        score: 0.8,
      },
    ],
    at: "2026-06-05T12:30:02.400Z",
  },
  { type: "step_started", stepId: "x2", role: "reasoner", at: "2026-06-05T12:30:02.480Z" },
  {
    type: "step_completed",
    stepId: "x2",
    role: "reasoner",
    summary: "Models split: 2 of 3 chose an internal record, 1 wanted to email the partner.",
    provenance: [
      {
        sourceId: "note:partner-call-2026-08",
        snippet: "Partner asked us to follow up on the renewal; unclear if by email or just tracked.",
        score: 0.8,
      },
    ],
    at: "2026-06-05T12:30:05.600Z",
  },
  {
    type: "action_proposed",
    stepId: "x2",
    action: {
      kind: "write_record",
      payload: { collection: "partner-followups", note: "Logged the Q3 renewal follow-up." },
      justification: "Log the renewal follow-up internally (the majority choice).",
      provenance: [
        {
          sourceId: "note:partner-call-2026-08",
          snippet: "Partner asked us to follow up on the renewal; unclear if by email or just tracked.",
          score: 0.8,
        },
      ],
      consensus: {
        votes: [
          { model: "claude", kind: "write_record", justification: "Log the follow-up internally." },
          { model: "gemini", kind: "send_email", justification: "Email the partner directly." },
          { model: "grok", kind: "write_record", justification: "Track it internally for now." },
        ],
        agreementRatio: 0.67,
        chosenKind: "write_record",
      },
    },
    at: "2026-06-05T12:30:05.700Z",
  },
  {
    type: "gate_decision",
    stepId: "x2",
    decision: {
      decision: "needs_approval",
      violations: [
        {
          rule: "require-model-consensus",
          detail:
            "models disagreed (claude: write_record, gemini: send_email, grok: write_record) — 67% agreement is below the 100% required",
          severity: "review",
        },
      ],
      evaluatedAt: "2026-06-05T12:30:05.760Z",
    },
    at: "2026-06-05T12:30:05.760Z",
  },
  {
    type: "awaiting_approval",
    stepId: "x2",
    reason:
      "require-model-consensus: models disagreed (claude: write_record, gemini: send_email, grok: write_record) — 67% agreement is below the 100% required",
    at: "2026-06-05T12:30:05.820Z",
  },
  { type: "run_completed", runId: "run_split_9d4e", at: "2026-06-05T12:30:05.860Z" },
];

// --- ATTESTED INDEPENDENCE: UNANIMOUS ECHO → NEEDS APPROVAL ----------------
// All three votes agree (100%), so require-model-consensus is satisfied — but their
// attested voices resolve to ONE model instance. Corroboration counts voices, not the
// votes that echo them, so require-distinct-voices routes it to a human.
export const echoConsensusRun: readonly TraceEvent[] = [
  {
    type: "run_started",
    runId: "run_echo_2d1b",
    task: "Confirm the vendor's SOC 2 status and record it for procurement.",
    at: "2026-06-06T09:00:00.000Z",
  },
  { type: "step_started", stepId: "e1", role: "researcher", at: "2026-06-06T09:00:00.200Z" },
  {
    type: "step_completed",
    stepId: "e1",
    role: "researcher",
    summary: "One vendor blog post asserts SOC 2 Type II; no independent attestation found.",
    provenance: [
      {
        sourceId: "doc:vendor-blog-soc2",
        snippet: "The vendor's own blog states it is SOC 2 Type II certified.",
        score: 0.55,
      },
    ],
    at: "2026-06-06T09:00:02.300Z",
  },
  { type: "step_started", stepId: "e2", role: "reasoner", at: "2026-06-06T09:00:02.380Z" },
  {
    type: "step_completed",
    stepId: "e2",
    role: "reasoner",
    summary: "Three votes agree to record it — but every vote is the same instance.",
    provenance: [
      {
        sourceId: "doc:vendor-blog-soc2",
        snippet: "The vendor's own blog states it is SOC 2 Type II certified.",
        score: 0.55,
      },
    ],
    at: "2026-06-06T09:00:05.400Z",
  },
  {
    type: "action_proposed",
    stepId: "e2",
    action: {
      kind: "write_record",
      payload: { collection: "procurement", title: "Vendor SOC 2", status: "certified" },
      justification: "Record the vendor's SOC 2 status for the procurement file.",
      provenance: [
        {
          sourceId: "doc:vendor-blog-soc2",
          snippet: "The vendor's own blog states it is SOC 2 Type II certified.",
          score: 0.55,
        },
      ],
      proposedBy: { provider: "anthropic", model: "claude-sonnet-4-6" },
      consensus: {
        votes: [
          {
            model: "claude",
            kind: "write_record",
            justification: "Record it.",
            voice: { provider: "anthropic", model: "claude-sonnet-4-6" },
          },
          {
            model: "claude",
            kind: "write_record",
            justification: "Record it.",
            voice: { provider: "anthropic", model: "claude-sonnet-4-6" },
          },
          {
            model: "claude",
            kind: "write_record",
            justification: "Record it.",
            voice: { provider: "anthropic", model: "claude-sonnet-4-6" },
          },
        ],
        agreementRatio: 1,
        chosenKind: "write_record",
        distinctVoices: 1,
      },
    },
    at: "2026-06-06T09:00:05.500Z",
  },
  {
    type: "gate_decision",
    stepId: "e2",
    decision: {
      decision: "needs_approval",
      violations: [
        {
          rule: "require-distinct-voices",
          detail:
            "3 agreeing vote(s) resolve to 1 distinct model instance(s) — corroboration counts voices, not echoes (need ≥ 2)",
          severity: "review",
        },
      ],
      evaluatedAt: "2026-06-06T09:00:05.560Z",
    },
    at: "2026-06-06T09:00:05.560Z",
  },
  {
    type: "awaiting_approval",
    stepId: "e2",
    reason:
      "require-distinct-voices: 3 agreeing vote(s) resolve to 1 distinct model instance(s) — corroboration counts voices, not echoes (need ≥ 2)",
    at: "2026-06-06T09:00:05.620Z",
  },
  { type: "run_completed", runId: "run_echo_2d1b", at: "2026-06-06T09:00:05.700Z" },
];

// --- RED CELL: INDEPENDENT OBJECTION → NEEDS APPROVAL ----------------------
// The Reasoner proposes an action; an independent reviewer (a provably distinct
// instance) makes the case against it and objects, so red-cell-objection routes it
// to a human with the critique attached.
export const redCellRun: readonly TraceEvent[] = [
  {
    type: "run_started",
    runId: "run_redcell_4f7c",
    task: "Merge the Causey cluster into the Cason paternal line if the evidence supports it.",
    at: "2026-06-07T14:00:00.000Z",
  },
  { type: "step_started", stepId: "r1", role: "researcher", at: "2026-06-07T14:00:00.200Z" },
  {
    type: "step_completed",
    stepId: "r1",
    role: "researcher",
    summary: "Name adjacency (Cason/Causey) and an overlapping VA→MD migration window.",
    provenance: [
      {
        sourceId: "doc:dorchester-causey-1670",
        snippet: "A John Causey appears in Dorchester County, MD records c. 1670.",
        score: 0.5,
      },
    ],
    at: "2026-06-07T14:00:02.300Z",
  },
  { type: "step_started", stepId: "r2", role: "reasoner", at: "2026-06-07T14:00:02.380Z" },
  {
    type: "step_completed",
    stepId: "r2",
    role: "reasoner",
    summary: "Proposes recording the merge as a leading hypothesis.",
    provenance: [
      {
        sourceId: "doc:dorchester-causey-1670",
        snippet: "A John Causey appears in Dorchester County, MD records c. 1670.",
        score: 0.5,
      },
    ],
    at: "2026-06-07T14:00:05.400Z",
  },
  {
    type: "action_proposed",
    stepId: "r2",
    action: {
      kind: "write_record",
      payload: { collection: "lineage", title: "Cason–Causey merge", confidence: "leading" },
      justification: "Name and geography align, so record the merge as a leading hypothesis.",
      provenance: [
        {
          sourceId: "doc:dorchester-causey-1670",
          snippet: "A John Causey appears in Dorchester County, MD records c. 1670.",
          score: 0.5,
        },
      ],
      proposedBy: { provider: "anthropic", model: "claude-sonnet-4-6" },
      redCell: {
        verdict: "object",
        critique:
          "Name adjacency plus an overlapping migration window is a single indirect strand, not corroboration; no primary record ties the lines, so this fails the proof standard and must not be recorded as leading.",
        voice: { provider: "grok", model: "grok-3" },
      },
    },
    at: "2026-06-07T14:00:05.500Z",
  },
  {
    type: "gate_decision",
    stepId: "r2",
    decision: {
      decision: "needs_approval",
      violations: [
        {
          rule: "red-cell-objection",
          detail:
            "the red cell (grok/grok-3) objects: Name adjacency plus an overlapping migration window is a single indirect strand, not corroboration; no primary record ties the lines…",
          severity: "review",
        },
      ],
      evaluatedAt: "2026-06-07T14:00:05.560Z",
    },
    at: "2026-06-07T14:00:05.560Z",
  },
  {
    type: "awaiting_approval",
    stepId: "r2",
    reason:
      "red-cell-objection: the red cell (grok/grok-3) objects: Name adjacency plus an overlapping migration window is a single indirect strand, not corroboration…",
    at: "2026-06-07T14:00:05.620Z",
  },
  { type: "run_completed", runId: "run_redcell_4f7c", at: "2026-06-07T14:00:05.700Z" },
];

export type SampleRunId =
  | "allow"
  | "block"
  | "pii"
  | "approval"
  | "approved"
  | "consensus"
  | "split"
  | "echo"
  | "redcell";

export const sampleRuns: Readonly<Record<SampleRunId, readonly TraceEvent[]>> = {
  allow: allowRun,
  block: blockRun,
  pii: piiRun,
  approval: approvalRun,
  approved: approvedRun,
  consensus: consensusRun,
  split: splitRun,
  echo: echoConsensusRun,
  redcell: redCellRun,
};

// --- serialization + replay ------------------------------------------------

/** Serialize events to NDJSON (one TraceEvent per line, trailing newline). */
export function toNdjson(events: readonly TraceEvent[]): string {
  return events.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

/**
 * Sprinkle malformed lines into an NDJSON string: a bare JSON string, invalid
 * JSON, a known type with missing fields, an unknown type, and a blank line.
 * The parser must skip all of these (counting the four non-blank ones as
 * malformed) while still emitting every valid event.
 */
export function withMalformedLines(ndjson: string): string {
  const NOISE: readonly string[] = [
    '"not an object — valid JSON, not a TraceEvent"',
    "{ this is not valid json ",
    '{"type":"step_started","stepId":"x"}',
    '{"type":"totally_made_up_event","at":"2026-06-02T15:04:02.000Z"}',
    "   ",
  ];
  const lines = ndjson.split("\n").filter((l) => l.length > 0);
  const out: string[] = [];
  // lead with one bad line, then interleave the rest every few events
  out.push(NOISE[0] ?? "");
  let noiseCursor = 1;
  lines.forEach((line, index) => {
    out.push(line);
    if ((index + 1) % 3 === 0 && noiseCursor < NOISE.length) {
      out.push(NOISE[noiseCursor] ?? "");
      noiseCursor += 1;
    }
  });
  while (noiseCursor < NOISE.length) {
    out.push(NOISE[noiseCursor] ?? "");
    noiseCursor += 1;
  }
  return out.join("\n") + "\n";
}

/** Count of malformed (non-blank) lines that {@link withMalformedLines} injects. */
export const INJECTED_MALFORMED_COUNT = 4;

export interface MockStreamOptions {
  /** Bytes per chunk; small values force mid-line splits. */
  readonly chunkSize?: number;
  /** Delay between chunks (ms) to simulate progressive streaming. */
  readonly delayMs?: number;
}

/**
 * Replay an NDJSON string as a byte stream, chunked (and intentionally split
 * mid-line) so the incremental parser is genuinely exercised. Single-use —
 * call again to get a fresh stream.
 */
export function buildTraceStream(
  ndjson: string,
  options: MockStreamOptions = {},
): ReadableStream<Uint8Array> {
  const chunkSize = options.chunkSize ?? 24;
  const delayMs = options.delayMs ?? 0;
  const bytes = new TextEncoder().encode(ndjson);
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkSize, bytes.length);
      const slice = bytes.slice(offset, end);
      offset = end;
      if (delayMs > 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, delayMs);
        });
      }
      controller.enqueue(slice);
    },
  });
}
