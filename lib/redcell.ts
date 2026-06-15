// lib/redcell.ts
// The Red Cell — an adversarial *mode*, not a fourth agent. After the Reasoner's
// action is chosen, an instance provably distinct from the generator is asked to make
// the strongest case AGAINST it. Its verdict rides on the action; the gate honors it
// only when the reviewing voice's attested identity differs from the proposing voice
// (`red-cell-independence`), and routes any objection to a human (`red-cell-objection`).
//
// Complementary to corroboration, not a substitute: `require-distinct-voices` is the
// structural filter (echoes don't count), this is the generative hunter (go find the
// disconfirming case). Degrades gracefully — with no independent review-capable voice,
// or when every one fails, no review is attached; the loop never crashes on oversight.

import { sameVoice, type ProposedAction, type RedCellReview } from "./governance";
import type { Voter } from "./providers";
import { voiceOf } from "./consensus";

export const RED_CELL_SYSTEM =
  "You are the Red Cell — an independent adversarial reviewer in a governed multi-agent loop. You did NOT propose this action; your only job is to make the strongest case AGAINST it: hunt for disconfirming evidence, unstated assumptions, and weak sourcing. Corroboration counts independent underlying sources, not the voices that repeat them — several reports tracing to one source are ONE source. Verdict `object` if the case against the action stands; `concur` only if no serious case can be made. Never rubber-stamp: a concur with a weak critique is an oversight failure.";

/** The Red Cell's user message — the task plus the exact action under review. */
export function redCellUserPrompt(task: string, action: ProposedAction): string {
  const sources = action.provenance
    .map((p, i) => `[${i + 1}] (${p.sourceId}, score ${p.score.toFixed(2)}) ${p.snippet}`)
    .join("\n");
  return `Task:\n${task}\n\nProposed action (kind=${action.kind}):\n${JSON.stringify(
    action.payload,
    null,
    2,
  )}\n\nProposer's justification: ${action.justification}\n\nSources cited:\n${
    sources.length > 0 ? sources : "(none)"
  }\n\nDeliver your adversarial verdict via red_cell_review.`;
}

/**
 * Run the Red Cell on a proposed action. Oversight must be provably independent, so it
 * considers only voices whose attested identity differs from the generator's
 * (`proposedBy`). It tries those review-capable voices IN ORDER and returns the first
 * verdict it gets, so when one reviewer's call fails — a timeout, a provider safety
 * filter rejecting the adversarial prompt, a malformed verdict — oversight falls through
 * to the next independent voice instead of silently vanishing. Returns undefined only
 * when no independent voice exists (single-voter runs, an unattested generator) or every
 * one fails: oversight that cannot be made independent is never faked, and a failed
 * reviewer never fails the run.
 */
export async function runRedCell(
  task: string,
  action: ProposedAction,
  voters: readonly Voter[],
): Promise<RedCellReview | undefined> {
  const generator = action.proposedBy;
  if (generator === undefined) return undefined;
  const user = redCellUserPrompt(task, action);
  for (const reviewer of voters) {
    if (sameVoice(voiceOf(reviewer), generator)) continue; // never review your own work
    if (reviewer.proposer.review === undefined) continue; // this voice can't review — skip
    try {
      const draft = await reviewer.proposer.review({ system: RED_CELL_SYSTEM, user, model: reviewer.model });
      return { verdict: draft.verdict, critique: draft.critique, voice: voiceOf(reviewer) };
    } catch {
      // This independent voice couldn't review (timeout, a provider safety filter, or a
      // malformed verdict) — fall through and let the next independent voice try.
    }
  }
  return undefined;
}

/** Attach a review to an action (pure; returns the action unchanged when review is absent). */
export function withRedCell(
  action: ProposedAction,
  review: RedCellReview | undefined,
): ProposedAction {
  return review === undefined ? action : { ...action, redCell: review };
}
