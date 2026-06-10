// lib/consensus.ts
// The triad: run the Reasoner step across multiple models, aggregate their votes,
// and attach the result to the proposed action so the gate can require agreement.
// aggregateVotes is pure (and unit-checked); runConsensusReasoner orchestrates the
// parallel calls and degrades gracefully — a provider that fails simply abstains.

import {
  distinctVoicesFor,
  type Consensus,
  type ModelVote,
  type ProposedAction,
  type VoiceIdentity,
} from "./governance";
import { REASONER_SYSTEM, draftToPayload, reasonerUserPrompt, type Finding } from "./agents";
import type { ActionDraft } from "./model-client";
import type { Voter } from "./providers";

/** The attested identity a voter casts its vote under: (provider label, model id). */
export function voiceOf(v: Voter): VoiceIdentity {
  return { provider: v.proposer.label, model: v.model };
}

export interface Aggregate {
  readonly chosenKind: string;
  /** Share of participating (non-abstaining) models backing the chosen kind, [0,1]. */
  readonly agreementRatio: number;
}

/** Pure: tally non-abstaining votes; ties break toward the primary model's vote. */
export function aggregateVotes(votes: readonly ModelVote[], primaryLabel: string): Aggregate {
  const participating = votes.filter((v) => v.abstained !== true);
  if (participating.length === 0) return { chosenKind: "write_record", agreementRatio: 0 };

  const counts = new Map<string, number>();
  for (const v of participating) counts.set(v.kind, (counts.get(v.kind) ?? 0) + 1);

  let chosenKind = participating[0]!.kind;
  let best = 0;
  for (const [kind, n] of counts) {
    if (n > best) {
      best = n;
      chosenKind = kind;
    }
  }
  // On a tie, prefer the primary's vote so the chosen action stays deterministic.
  const primaryVote = participating.find((v) => v.model === primaryLabel);
  if (primaryVote && (counts.get(primaryVote.kind) ?? 0) === best) chosenKind = primaryVote.kind;

  return { chosenKind, agreementRatio: best / participating.length };
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * Propose an action via the voter set. With a single voter (offline / Claude-only)
 * this is exactly the single-model path and attaches no consensus. With ≥2 voters
 * it runs them in parallel, records each vote, and attaches the consensus so the
 * `require-model-consensus` rule can hold a split decision for a human.
 */
export async function runConsensusReasoner(
  task: string,
  finding: Finding,
  voters: readonly Voter[],
): Promise<ProposedAction> {
  const system = REASONER_SYSTEM;
  const user = reasonerUserPrompt(task, finding);

  const primary = voters[0];
  if (primary === undefined) throw new Error("no model available to propose an action");

  if (voters.length < 2) {
    const draft = await primary.proposer.proposeAction({ system, user, model: primary.model });
    return {
      kind: draft.kind,
      payload: draftToPayload(draft),
      justification: draft.justification,
      provenance: finding.provenance,
      proposedBy: voiceOf(primary),
    };
  }

  const settled = await Promise.allSettled(
    voters.map((v) => v.proposer.proposeAction({ system, user, model: v.model })),
  );

  const votes: ModelVote[] = voters.map((v, i) => {
    const r = settled[i];
    if (r !== undefined && r.status === "fulfilled") {
      return {
        model: v.proposer.label,
        kind: r.value.kind,
        justification: r.value.justification,
        voice: voiceOf(v),
      };
    }
    return {
      model: v.proposer.label,
      kind: "—",
      justification: r !== undefined && r.status === "rejected" ? errorMessage(r.reason) : "no response",
      abstained: true,
      voice: voiceOf(v),
    };
  });

  const { chosenKind, agreementRatio } = aggregateVotes(votes, primary.proposer.label);

  const draftAt = (i: number): ActionDraft | undefined => {
    const r = settled[i];
    return r !== undefined && r.status === "fulfilled" ? r.value : undefined;
  };

  // Representative draft for the chosen kind — prefer the primary's, else the first match.
  let chosen = draftAt(0);
  let chosenBy = 0;
  if (chosen?.kind !== chosenKind) {
    for (let i = 0; i < voters.length; i += 1) {
      const d = draftAt(i);
      if (d?.kind === chosenKind) {
        chosen = d;
        chosenBy = i;
        break;
      }
    }
  }
  if (chosen === undefined) throw new Error("all models abstained from proposing an action");
  const chosenVoter = voters[chosenBy];

  const consensus: Consensus = {
    votes,
    agreementRatio,
    chosenKind,
    // Attested independence: how many distinct instances actually backed the choice.
    distinctVoices: distinctVoicesFor(votes, chosenKind),
  };
  return {
    kind: chosen.kind,
    payload: draftToPayload(chosen),
    justification: chosen.justification,
    provenance: finding.provenance,
    consensus,
    proposedBy: chosenVoter !== undefined ? voiceOf(chosenVoter) : undefined,
  };
}
