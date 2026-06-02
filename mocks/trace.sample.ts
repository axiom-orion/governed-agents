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

export type SampleRunId = "allow" | "block";

export const sampleRuns: Readonly<Record<SampleRunId, readonly TraceEvent[]>> = {
  allow: allowRun,
  block: blockRun,
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
