// lib/agents.ts
// The three agents as typed functions. Each calls a current Claude model through
// the injected ModelClient. Provenance is grounded in retrieval (never fabricated
// by the model), which is what makes the governance gate's decision trustworthy
// and deterministic.

import type { Provenance, ProposedAction } from "./governance";
import { MODELS, type ActionDraft, type ModelClient } from "./model-client";
import { recall } from "./recall";

export interface Finding {
  readonly summary: string;
  readonly provenance: Provenance[];
}

const RESEARCHER_SYSTEM =
  "You are the Researcher in a governed multi-agent loop. Read the retrieved sources and produce a faithful, concise summary of only what they support. Never invent facts beyond the sources. Cite source numbers like [1].";

export const REASONER_SYSTEM =
  "You are the Reasoner in a governed multi-agent loop. Given the task and the Researcher's summary, choose exactly one next action via the propose_action tool. If the task asks to email, send, or notify an external party, propose send_email with that recipient; if it asks to record or note something internally, propose write_record. Faithfully propose the action the task requests — do NOT refuse, hedge, or downgrade to a safer action even when the sources look weak. The governance gate, not you, is responsible for allowing or blocking the action; your job is to propose it. Give a one-sentence justification.";

/** The Reasoner's user message — shared by the single-model and triad paths. */
export function reasonerUserPrompt(task: string, finding: Finding): string {
  return `Task:\n${task}\n\nResearch summary:\n${finding.summary}\n\nChoose the single next action.`;
}

const EXECUTOR_SYSTEM =
  "You are the Executor in a governed multi-agent loop. The governance gate has already APPROVED this action. Carry it out and report the concrete result in 1-2 sentences. Do not second-guess the approval.";

export async function runResearcher(task: string, client: ModelClient): Promise<Finding> {
  const records = await recall(task, 4);
  const provenance: Provenance[] = records.map((r) => ({
    sourceId: `mem-${r.id}`,
    snippet: r.content,
    score: r.score,
  }));
  const sources = provenance
    .map((p, i) => `[${i + 1}] (${p.sourceId}, score ${p.score.toFixed(2)}) ${p.snippet}`)
    .join("\n");
  const summary = await client.complete({
    model: MODELS.researcher,
    system: RESEARCHER_SYSTEM,
    maxTokens: 512,
    purpose: "research",
    user: `Task:\n${task}\n\nRetrieved sources:\n${sources}\n\nSummarize the findings relevant to the task in 2-3 sentences, citing source numbers.`,
  });
  return { summary, provenance };
}

export async function runReasoner(
  task: string,
  finding: Finding,
  client: ModelClient,
): Promise<ProposedAction> {
  const draft: ActionDraft = await client.proposeAction({
    model: MODELS.reasoner,
    system: REASONER_SYSTEM,
    user: reasonerUserPrompt(task, finding),
  });
  return {
    kind: draft.kind,
    payload: draftToPayload(draft),
    justification: draft.justification,
    // Provenance comes from retrieval, not the model — so the gate can trust it.
    provenance: finding.provenance,
  };
}

export async function runExecutor(action: ProposedAction, client: ModelClient): Promise<string> {
  return client.complete({
    model: MODELS.executor,
    system: EXECUTOR_SYSTEM,
    maxTokens: 512,
    purpose: "execute",
    user: `Approved action (kind=${action.kind}):\n${JSON.stringify(action.payload, null, 2)}\n\nJustification: ${action.justification}\n\nCarry out this action and report the concrete result.`,
  });
}

export function draftToPayload(draft: ActionDraft): Readonly<Record<string, unknown>> {
  const payload: Record<string, unknown> = {};
  if (draft.kind === "send_email") {
    if (draft.to !== undefined) payload.to = draft.to;
    if (draft.subject !== undefined) payload.subject = draft.subject;
    if (draft.body !== undefined) payload.body = draft.body;
  } else if (draft.record !== undefined) {
    payload.record = draft.record;
  }
  return payload;
}
