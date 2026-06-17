// scripts/verify-governance.ts
// Headless verification of attested consensus independence + the Red Cell mode (§7-2).
// Pure-rule checks first (no model, no network), then a deterministic offline two-voter
// loop run that exercises the full path end-to-end with zero keys.
//
// The claims under test, stated plainly:
//   1. Corroboration counts VOICES, not votes — a unanimous consensus whose agreeing
//      votes resolve to one attested instance is routed to a human, not honored.
//   2. A Red Cell verdict is honored only when the reviewer's attested voice differs
//      from the generator's; an unattested generator cannot prove independence.
//   3. An objection from an independent Red Cell routes the action to a human with
//      the critique attached.
//
// Run: npx tsx scripts/verify-governance.ts

import {
  DEFAULT_MIN_DISTINCT_VOICES,
  buildPolicy,
  distinctVoicesFor,
  evaluatePolicy,
  isConsequentialKind,
  makeRequireDistinctVoices,
  redCellMustBeIndependent,
  redCellObjection,
  sameVoice,
  type Consensus,
  type ModelVote,
  type ProposedAction,
  type VoiceIdentity,
} from "../lib/governance";
import { runConsensusReasoner, voiceOf } from "../lib/consensus";
import { runRedCell, withRedCell } from "../lib/redcell";
import { runLoop } from "../lib/loop";
import { OFFLINE_VOICE_FIXTURES, offlineVoterPair } from "../mocks/governance.fixtures";
import type { Voter } from "../lib/providers";
import type { ActionDraft, ActionProposer, RedCellDraft } from "../lib/model-client";
import type { TraceEvent } from "../lib/trace-events";

interface Result {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
}
const results: Result[] = [];
function check(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, detail });
}

const claude: VoiceIdentity = { provider: "anthropic", model: "claude-sonnet-4-6" };
const gemini: VoiceIdentity = { provider: "gemini", model: "gemini-2.5-flash" };
const grok: VoiceIdentity = { provider: "grok", model: "grok-3" };

function vote(voice: VoiceIdentity, kind: string, abstained = false): ModelVote {
  return { model: voice.provider, kind, justification: "j", voice, abstained };
}

function actionWith(consensus?: Consensus, extra: Partial<ProposedAction> = {}): ProposedAction {
  return {
    kind: "write_record",
    payload: { record: "note" },
    justification: "j",
    provenance: [{ sourceId: "mem-1", snippet: "s", score: 0.9 }],
    ...(consensus !== undefined ? { consensus } : {}),
    ...extra,
  };
}

// A fake reviewer voice for the fallback-chain checks. Its review() either fails (the
// provider errored / was safety-filtered) or returns a fixed verdict. voiceOf() reads
// the proposer label + model, so these are attested-distinct by construction.
function reviewerVoter(voice: VoiceIdentity, behavior: "fail" | RedCellDraft): Voter {
  const proposer: ActionProposer = {
    label: voice.provider,
    proposeAction: async (): Promise<ActionDraft> => ({ kind: "write_record", justification: "j" }),
    review: async (): Promise<RedCellDraft> => {
      if (behavior === "fail") throw new Error(`${voice.provider} review unavailable`);
      return behavior;
    },
  };
  return { proposer, model: voice.model };
}

async function main(): Promise<void> {
  // --- 1) voices are counted, not assumed -----------------------------------------
  check("sameVoice: identical -> true", sameVoice(claude, { ...claude }));
  check("sameVoice: same provider, different model -> false", !sameVoice(claude, { ...claude, model: "claude-haiku-4-5" }));

  const echo = [vote(claude, "write_record"), vote(claude, "write_record"), vote(claude, "write_record")];
  const triad = [vote(claude, "write_record"), vote(gemini, "write_record"), vote(grok, "write_record")];
  check("distinctVoicesFor: 3 echoes of one instance -> 1", distinctVoicesFor(echo, "write_record") === 1);
  check("distinctVoicesFor: the triad -> 3", distinctVoicesFor(triad, "write_record") === 3);
  check(
    "distinctVoicesFor: abstentions and other kinds excluded",
    distinctVoicesFor([vote(claude, "write_record"), vote(gemini, "send_email"), vote(grok, "write_record", true)], "write_record") === 1,
  );
  // legacy votes (no voice) fall back to the provider label
  const legacy: ModelVote[] = [
    { model: "claude", kind: "write_record", justification: "j" },
    { model: "gemini", kind: "write_record", justification: "j" },
  ];
  check("distinctVoicesFor: legacy votes fall back to labels", distinctVoicesFor(legacy, "write_record") === 2);

  const rule = makeRequireDistinctVoices();
  const echoConsensus: Consensus = { votes: echo, agreementRatio: 1.0, chosenKind: "write_record" };
  const echoViolation = rule.evaluate(actionWith(echoConsensus));
  check(
    "require-distinct-voices: unanimous echo (100% agreement, 1 voice) -> review",
    echoViolation !== null && echoViolation.severity === "review",
    echoViolation?.detail,
  );
  const triadConsensus: Consensus = { votes: triad, agreementRatio: 1.0, chosenKind: "write_record", distinctVoices: 3 };
  check("require-distinct-voices: attested triad -> clean", rule.evaluate(actionWith(triadConsensus)) === null);
  check("require-distinct-voices: no consensus -> not its business", rule.evaluate(actionWith()) === null);
  check(
    "require-distinct-voices: threshold knob flips the echo to allowed at min=1",
    makeRequireDistinctVoices(1).evaluate(actionWith(echoConsensus)) === null,
  );
  check(
    "gate: echo-consensus action routes to needs_approval",
    evaluatePolicy(actionWith(echoConsensus), buildPolicy()).decision === "needs_approval",
  );
  check(
    "gate: attested-triad action stays allowed",
    evaluatePolicy(actionWith(triadConsensus), buildPolicy()).decision === "allow",
  );
  check("default minimum distinct voices is 2", DEFAULT_MIN_DISTINCT_VOICES === 2);

  // --- 2) red-cell independence is attested, not assumed --------------------------
  const review = { verdict: "concur" as const, critique: "no case stands", voice: gemini };
  check(
    "red-cell-independence: distinct reviewer -> honored (no violation)",
    redCellMustBeIndependent.evaluate(actionWith(undefined, { proposedBy: claude, redCell: review })) === null,
  );
  const collapsed = redCellMustBeIndependent.evaluate(
    actionWith(undefined, { proposedBy: gemini, redCell: review }),
  );
  check(
    "red-cell-independence: reviewer == generator -> review (oversight is theater)",
    collapsed !== null && collapsed.severity === "review",
    collapsed?.detail,
  );
  const unattested = redCellMustBeIndependent.evaluate(actionWith(undefined, { redCell: review }));
  check(
    "red-cell-independence: unattested generator -> review (unverifiable is not verified)",
    unattested !== null && unattested.severity === "review",
  );
  check(
    "red-cell-independence: no red cell -> not its business",
    redCellMustBeIndependent.evaluate(actionWith()) === null,
  );

  // --- 3) objections route to a human ---------------------------------------------
  const objection = redCellObjection.evaluate(
    actionWith(undefined, {
      proposedBy: claude,
      redCell: { verdict: "object", critique: "single-source claim", voice: gemini },
    }),
  );
  check(
    "red-cell-objection: object -> review with the critique attached",
    objection !== null && objection.severity === "review" && objection.detail.includes("single-source claim"),
  );
  check(
    "red-cell-objection: concur -> clean",
    redCellObjection.evaluate(actionWith(undefined, { proposedBy: claude, redCell: review })) === null,
  );
  check(
    "gate: independent objection -> needs_approval, never block",
    evaluatePolicy(
      actionWith(undefined, {
        proposedBy: claude,
        redCell: { verdict: "object", critique: "c", voice: gemini },
      }),
      buildPolicy(),
    ).decision === "needs_approval",
  );

  // --- 3b) the reviewer fallback chain: a failed voice falls through, not silent ---
  // The reviewer is always an independent voice, tried in order; one that fails (e.g. a
  // provider safety filter rejecting the adversarial prompt) must not drop oversight.
  const objVerdict: RedCellDraft = { verdict: "object", critique: "single-source claim" };
  const concurVerdict: RedCellDraft = { verdict: "concur", critique: "no case stands" };
  const reviewedBy = actionWith(undefined, { proposedBy: claude });

  const fellThrough = await runRedCell("t", reviewedBy, [
    reviewerVoter(claude, concurVerdict), // the generator — must be skipped
    reviewerVoter(gemini, "fail"), // first independent voice fails
    reviewerVoter(grok, concurVerdict), // oversight falls through to here
  ]);
  check(
    "fallback: a failed reviewer falls through to the next independent voice",
    fellThrough !== undefined && sameVoice(fellThrough.voice, grok) && fellThrough.verdict === "concur",
    fellThrough && `reviewer=${fellThrough.voice.provider}`,
  );
  check(
    "fallback: the generator is never its own reviewer",
    fellThrough !== undefined && !sameVoice(fellThrough.voice, claude),
  );

  const firstWins = await runRedCell("t", reviewedBy, [
    reviewerVoter(gemini, objVerdict),
    reviewerVoter(grok, concurVerdict),
  ]);
  check(
    "fallback: the first independent voice that returns a verdict wins",
    firstWins !== undefined && sameVoice(firstWins.voice, gemini) && firstWins.verdict === "object",
  );

  const allFail = await runRedCell("t", reviewedBy, [
    reviewerVoter(gemini, "fail"),
    reviewerVoter(grok, "fail"),
  ]);
  check("fallback: every independent voice failing -> undefined (abstain, never faked)", allFail === undefined);

  const onlyGenerator = await runRedCell("t", reviewedBy, [reviewerVoter(claude, concurVerdict)]);
  check("fallback: no independent voice (only the generator can review) -> undefined", onlyGenerator === undefined);

  // --- 3c) the Red Cell is scoped to consequential actions ------------------------
  // Adversarial review is reserved for what can cause harm — sends and destructive
  // kinds — not every internal note (the hard rules still gate those).
  check("consequential: send_email -> true", isConsequentialKind("send_email"));
  check("consequential: delete_record -> true", isConsequentialKind("delete_record"));
  check("consequential: write_record -> false (internal note)", !isConsequentialKind("write_record"));

  // --- 4) deterministic offline two-voter path, end to end ------------------------
  // Two offline stubs under different model ids are attested-distinct by construction,
  // so consensus + red cell run with zero keys — the same discipline as the CI demo.
  const voters = offlineVoterPair();
  check(
    "fixtures: the two offline voters are attested-distinct",
    !sameVoice(voiceOf(voters[0]!), voiceOf(voters[1]!)),
  );

  const finding = {
    summary: "Both sources confirm the onboarding policy update.",
    provenance: [{ sourceId: "mem-1", snippet: "policy updated", score: 0.9 }],
  };
  const proposed = await runConsensusReasoner("Write an internal record of the findings.", finding, voters);
  check("offline consensus: attached with 2 distinct voices", proposed.consensus?.distinctVoices === 2);
  check("offline consensus: proposedBy attested", proposed.proposedBy !== undefined);
  const benignReview = await runRedCell("Write an internal record of the findings.", proposed, voters);
  check("offline red cell: runs on the non-proposing voice", benignReview !== undefined && proposed.proposedBy !== undefined && !sameVoice(benignReview.voice, proposed.proposedBy));
  check("offline red cell: concurs on corroborated material", benignReview?.verdict === "concur");
  check(
    "gate: reviewed benign action stays allowed",
    evaluatePolicy(withRedCell(proposed, benignReview), buildPolicy()).decision === "allow",
  );

  // an action whose material admits it is unverified draws an objection from the stub
  const weakTask = "Write an internal record noting this unverified single source claim.";
  const weakFinding = {
    summary: "One unverified single source mentions the claim.",
    provenance: [{ sourceId: "mem-9", snippet: "unverified single source", score: 0.4 }],
  };
  const weakProposed = await runConsensusReasoner(weakTask, weakFinding, voters);
  const weakReview = await runRedCell(weakTask, weakProposed, voters);
  check("offline red cell: objects to unverified material", weakReview?.verdict === "object");
  check(
    "gate: objected action routes to needs_approval",
    evaluatePolicy(withRedCell(weakProposed, weakReview), buildPolicy()).decision === "needs_approval",
  );

  // full loop A — an INTERNAL record: the hard rules still gate it, but the Red Cell is
  // scoped out (no generative red team on internal notes), so it allows and executes —
  // even though runRedCell, called directly above, would have objected to this material.
  const recordEvents: TraceEvent[] = [];
  for await (const e of runLoop(weakTask, OFFLINE_VOICE_FIXTURES.client, buildPolicy(), voters)) {
    recordEvents.push(e);
  }
  const recordProposed = recordEvents.find((e) => e.type === "action_proposed");
  check(
    "loop(write_record): consensus attached but the Red Cell is scoped out (no redCell)",
    recordProposed?.type === "action_proposed" &&
      recordProposed.action.kind === "write_record" &&
      recordProposed.action.consensus?.distinctVoices === 2 &&
      recordProposed.action.redCell === undefined,
  );
  check(
    "loop(write_record): allowed and executed (no oversight needed for an internal note)",
    recordEvents.some((e) => e.type === "gate_decision" && e.decision.decision === "allow") &&
      recordEvents.some((e) => e.type === "executed"),
  );
  check(
    "loop(write_record): ends with run_completed",
    recordEvents[recordEvents.length - 1]?.type === "run_completed",
  );

  // full loop B — a CONSEQUENTIAL outbound send that clears the hard rules (a 1.00 source)
  // but draws an independent objection: the Red Cell runs and the run parks for a human.
  const sendTask =
    "Email partner@example.com the Q2 refund policy update; flag that it rests on a single source.";
  const sendEvents: TraceEvent[] = [];
  for await (const e of runLoop(sendTask, OFFLINE_VOICE_FIXTURES.client, buildPolicy(), voters)) {
    sendEvents.push(e);
  }
  const sendProposed = sendEvents.find((e) => e.type === "action_proposed");
  const sendGate = sendEvents.find((e) => e.type === "gate_decision");
  const sendParked = sendEvents.find((e) => e.type === "awaiting_approval");
  check(
    "loop(send_email): the Red Cell runs on the consequential action and objects",
    sendProposed?.type === "action_proposed" &&
      sendProposed.action.kind === "send_email" &&
      sendProposed.action.redCell?.verdict === "object",
  );
  check(
    "loop(send_email): the independent objection parks the run for a human",
    sendGate?.type === "gate_decision" &&
      sendGate.decision.decision === "needs_approval" &&
      sendParked?.type === "awaiting_approval" &&
      sendParked.reason.includes("red-cell-objection"),
  );
  check(
    "loop(send_email): ends with run_completed",
    sendEvents[sendEvents.length - 1]?.type === "run_completed",
  );

  // --- report ----------------------------------------------------------------------
  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    // eslint-disable-next-line no-console
    console.log(`${r.ok ? "ok " : "FAIL"} ${r.name}${!r.ok && r.detail !== undefined ? ` — ${r.detail}` : ""}`);
  }
  // eslint-disable-next-line no-console
  console.log(`\n${results.length - failed.length}/${results.length} governance checks passed`);
  if (failed.length > 0) process.exit(1);
}

void main();
