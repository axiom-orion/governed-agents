// scripts/verify-trace.ts
// Headless verification of the P4 trace layer — no React, no browser. Proves the
// two acceptance paths (allow + block) project correctly and that malformed
// lines are skipped while every valid event is still recovered.
//
// Run: npx tsx scripts/verify-trace.ts
// (Named distinctly from scripts/check-model.ts, which the P3 loop owns.)

import { NdjsonTraceParser } from "../lib/ndjson";
import type { TraceEvent } from "../lib/trace-events";
import {
  defaultSelectedId,
  gateForNode,
  projectTrace,
  provenanceForNode,
} from "../lib/trace-model";
import type { TraceModel } from "../lib/trace-model";
import {
  allowRun,
  blockRun,
  buildTraceStream,
  INJECTED_MALFORMED_COUNT,
  toNdjson,
  withMalformedLines,
} from "../mocks/trace.sample";

interface Result {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
}
const results: Result[] = [];
function check(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, detail });
}
function eqNum(name: string, actual: number, expected: number): void {
  check(name, actual === expected, `expected ${expected}, got ${actual}`);
}
function eqStr(name: string, actual: string | undefined, expected: string): void {
  check(
    name,
    actual === expected,
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}
function nodeIds(model: TraceModel): string[] {
  return model.nodes.map((n) => n.id);
}

function parseChunked(ndjson: string, size: number): { events: TraceEvent[]; malformed: number } {
  const parser = new NdjsonTraceParser();
  const events: TraceEvent[] = [];
  let malformed = 0;
  for (let i = 0; i < ndjson.length; i += size) {
    const r = parser.push(ndjson.slice(i, i + size));
    events.push(...r.events);
    malformed += r.malformed.length;
  }
  const tail = parser.flush();
  events.push(...tail.events);
  malformed += tail.malformed.length;
  return { events, malformed };
}

async function parseStream(
  stream: ReadableStream<Uint8Array>,
): Promise<{ events: TraceEvent[]; malformed: number }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const parser = new NdjsonTraceParser();
  const events: TraceEvent[] = [];
  let malformed = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const r = parser.push(decoder.decode(value, { stream: true }));
    events.push(...r.events);
    malformed += r.malformed.length;
  }
  const tail = parser.flush();
  events.push(...tail.events);
  malformed += tail.malformed.length;
  return { events, malformed };
}

async function main(): Promise<void> {
  // --- ALLOW path -----------------------------------------------------------
  const allow = projectTrace(allowRun);
  eqStr("allow: status completed", allow.status, "completed");
  check(
    "allow: node order researcher→reasoner→gate→executor",
    JSON.stringify(nodeIds(allow)) === JSON.stringify(["step:s1", "step:s2", "gate:s2", "step:s3"]),
    JSON.stringify(nodeIds(allow)),
  );
  eqNum("allow: 3 handoff edges", allow.edges.length, 3);
  const allowGate = allow.nodes.find((n) => n.kind === "gate");
  if (allowGate && allowGate.kind === "gate") {
    eqStr("allow: gate decision = allow", allowGate.decision.decision, "allow");
    eqNum("allow: 0 violations", allowGate.decision.violations.length, 0);
  } else {
    check("allow: gate present", false, "no gate node");
  }
  const execNode = allow.nodes.find((n) => n.kind === "step" && n.role === "executor");
  if (execNode && execNode.kind === "step") {
    eqStr(
      "allow: executor result from stream",
      execNode.result,
      "Wrote record summaries/q2-onboarding-policy (rev 1).",
    );
  } else {
    check("allow: executor node present", false);
  }
  const researcher = allow.nodes.find((n) => n.kind === "step" && n.role === "researcher");
  if (researcher && researcher.kind === "step") {
    eqNum("allow: researcher has 3 sources", researcher.provenance.length, 3);
  }
  eqStr("allow: default selection is the gate", defaultSelectedId(allow) ?? "", "gate:s2");
  eqNum(
    "allow: provenance for gate = action sources",
    provenanceForNode(allow, "gate:s2").length,
    2,
  );
  check("allow: gateForNode(step:s2)=gate:s2", gateForNode(allow, "step:s2")?.id === "gate:s2");

  // --- BLOCK path -----------------------------------------------------------
  const block = projectTrace(blockRun);
  eqStr("block: status halted", block.status, "halted");
  check(
    "block: node order researcher→reasoner→gate→halt",
    JSON.stringify(nodeIds(block)) === JSON.stringify(["step:r1", "step:r2", "gate:r2", "halt:r2"]),
    JSON.stringify(nodeIds(block)),
  );
  check(
    "block: executor never runs",
    block.nodes.every((n) => !(n.kind === "step" && n.role === "executor")),
  );
  const blockGate = block.nodes.find((n) => n.kind === "gate");
  if (blockGate && blockGate.kind === "gate") {
    eqStr("block: gate decision = block", blockGate.decision.decision, "block");
    eqNum("block: 1 violation", blockGate.decision.violations.length, 1);
    eqStr(
      "block: violation rule",
      blockGate.decision.violations[0]?.rule,
      "no-unverified-external-send",
    );
  } else {
    check("block: gate present", false);
  }
  const haltNode = block.nodes.find((n) => n.kind === "halt");
  check(
    "block: halt reason names the rule",
    haltNode?.kind === "halt" && haltNode.reason.includes("no-unverified-external-send"),
  );
  check("block: gateForNode(halt:r2)=gate:r2", gateForNode(block, "halt:r2")?.id === "gate:r2");

  // --- malformed handling ---------------------------------------------------
  const cleanNdjson = toNdjson(allowRun);
  const noisyNdjson = withMalformedLines(cleanNdjson);

  const clean = parseChunked(cleanNdjson, 7);
  eqNum("clean: all events parsed", clean.events.length, allowRun.length);
  eqNum("clean: 0 malformed", clean.malformed, 0);

  const noisy = parseChunked(noisyNdjson, 5);
  eqNum("noisy/chunked: all valid events recovered", noisy.events.length, allowRun.length);
  eqNum("noisy/chunked: malformed skipped", noisy.malformed, INJECTED_MALFORMED_COUNT);
  check(
    "noisy/chunked: event type sequence preserved",
    JSON.stringify(noisy.events.map((e) => e.type)) === JSON.stringify(allowRun.map((e) => e.type)),
  );
  check(
    "noisy/chunked: round-trip projects identically",
    JSON.stringify(nodeIds(projectTrace(noisy.events))) === JSON.stringify(nodeIds(allow)),
  );

  const streamed = await parseStream(buildTraceStream(noisyNdjson, { chunkSize: 13 }));
  eqNum("noisy/stream: all valid events recovered", streamed.events.length, allowRun.length);
  eqNum("noisy/stream: malformed skipped", streamed.malformed, INJECTED_MALFORMED_COUNT);

  // --- degenerate inputs ----------------------------------------------------
  const empty = projectTrace([]);
  eqStr("empty: status idle", empty.status, "idle");
  eqNum("empty: no nodes", empty.nodes.length, 0);
  const garbage = parseChunked("not json\n{also bad\n42 not an event\n", 4);
  eqNum("garbage-only: zero events", garbage.events.length, 0);
  check("garbage-only: counted as malformed", garbage.malformed > 0);

  // --- report ---------------------------------------------------------------
  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    process.stdout.write(`  [${r.ok ? "PASS" : "FAIL"}] ${r.name}${r.ok ? "" : `  — ${r.detail ?? ""}`}\n`);
  }
  process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed\n`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  process.stdout.write(
    `verify-trace crashed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exitCode = 1;
});
