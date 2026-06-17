// lib/providers.ts
// Extra model providers for the consensus triad: Gemini (Google) and Grok (xAI),
// each behind the same ActionProposer seam as the Anthropic client. Implemented
// with plain `fetch` + runtime guards (mirroring lib/recall.ts) so there are no new
// SDK dependencies, and every response is validated before it is trusted.
//
// A provider is only added to the vote when its API key is present; any failed call
// is surfaced as an abstention by the consensus layer, never a crash. Model ids are
// env-overridable — the defaults are placeholders; set GEMINI_MODEL / XAI_MODEL to
// ids current for your account.

import {
  MODELS,
  isOffline,
  parseActionDraft,
  parseRedCellDraft,
  type ActionDraft,
  type ActionProposer,
  type ModelClient,
  type ProposeInput,
  type RedCellDraft,
} from "./model-client";

export const TRIAD_MODELS = {
  claude: MODELS.reasoner,
  gemini: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
  grok: process.env.XAI_MODEL ?? "grok-3",
} as const;

const REQUEST_TIMEOUT_MS = 12_000;

// JSON-Schema for the proposed action (OpenAI/xAI flavor — lowercase types).
const ACTION_PARAMETERS = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["send_email", "write_record"] },
    to: { type: "string" },
    subject: { type: "string" },
    body: { type: "string" },
    record: { type: "string" },
    justification: { type: "string" },
  },
  required: ["kind", "justification"],
} as const;

// JSON-Schema for the Red Cell verdict (OpenAI/xAI flavor — lowercase types).
const REVIEW_PARAMETERS = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["concur", "object"] },
    critique: { type: "string" },
  },
  required: ["verdict", "critique"],
} as const;

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

async function postJson(url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

// --- Gemini (Google Generative Language API) -------------------------------
// Structured output via responseSchema + responseMimeType=application/json.
function geminiText(data: unknown): string {
  const candidates = isRecord(data) ? data.candidates : undefined;
  const first = Array.isArray(candidates) ? candidates[0] : undefined;
  const content = isRecord(first) ? first.content : undefined;
  const parts = isRecord(content) ? content.parts : undefined;
  const part0 = Array.isArray(parts) ? parts[0] : undefined;
  const text = isRecord(part0) ? part0.text : undefined;
  if (typeof text !== "string" || text.length === 0) {
    throw new Error("gemini returned no JSON content");
  }
  return text;
}

class GeminiActionProposer implements ActionProposer {
  public readonly label = "gemini";
  constructor(private readonly apiKey: string) {}

  public async proposeAction(input: ProposeInput): Promise<ActionDraft> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      input.model,
    )}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const data = await postJson(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.system }] },
        contents: [{ role: "user", parts: [{ text: input.user }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              kind: { type: "STRING", enum: ["send_email", "write_record"] },
              to: { type: "STRING" },
              subject: { type: "STRING" },
              body: { type: "STRING" },
              record: { type: "STRING" },
              justification: { type: "STRING" },
            },
            required: ["kind", "justification"],
          },
        },
      }),
    });
    return parseActionDraft(JSON.parse(geminiText(data)) as unknown);
  }

  public async review(input: ProposeInput): Promise<RedCellDraft> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      input.model,
    )}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const data = await postJson(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.system }] },
        contents: [{ role: "user", parts: [{ text: input.user }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              verdict: { type: "STRING", enum: ["concur", "object"] },
              critique: { type: "STRING" },
            },
            required: ["verdict", "critique"],
          },
        },
      }),
    });
    return parseRedCellDraft(JSON.parse(geminiText(data)) as unknown);
  }
}

// --- Grok (xAI, OpenAI-compatible) -----------------------------------------
// Structured output via forced function/tool calling.
function grokToolArguments(data: unknown): string {
  const choices = isRecord(data) ? data.choices : undefined;
  const first = Array.isArray(choices) ? choices[0] : undefined;
  const message = isRecord(first) ? first.message : undefined;
  const toolCalls = isRecord(message) ? message.tool_calls : undefined;
  const call0 = Array.isArray(toolCalls) ? toolCalls[0] : undefined;
  const fn = isRecord(call0) ? call0.function : undefined;
  const args = isRecord(fn) ? fn.arguments : undefined;
  if (typeof args !== "string" || args.length === 0) {
    throw new Error("grok returned no tool call");
  }
  return args;
}

class GrokActionProposer implements ActionProposer {
  public readonly label = "grok";
  constructor(private readonly apiKey: string) {}

  public async proposeAction(input: ProposeInput): Promise<ActionDraft> {
    const data = await postJson("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "propose_action",
              description: "Propose exactly one concrete next action for the executor.",
              parameters: ACTION_PARAMETERS,
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "propose_action" } },
      }),
    });
    return parseActionDraft(JSON.parse(grokToolArguments(data)) as unknown);
  }

  public async review(input: ProposeInput): Promise<RedCellDraft> {
    const data = await postJson("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "red_cell_review",
              description: "Deliver the Red Cell's adversarial verdict on the proposed action.",
              parameters: REVIEW_PARAMETERS,
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "red_cell_review" } },
      }),
    });
    return parseRedCellDraft(JSON.parse(grokToolArguments(data)) as unknown);
  }
}

/** A model in the vote, paired with the model id it should be called with. */
export interface Voter {
  readonly proposer: ActionProposer;
  readonly model: string;
}

/**
 * The extra (non-primary) voters that have an API key configured — Gemini and/or
 * Grok. Unlike {@link createReasonerVoters} this ignores AGENTS_OFFLINE, so the
 * provider-check script can probe them directly.
 */
export function createExtraVoters(): Voter[] {
  const voters: Voter[] = [];
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (geminiKey !== undefined && geminiKey.length > 0) {
    voters.push({ proposer: new GeminiActionProposer(geminiKey), model: TRIAD_MODELS.gemini });
  }
  const xaiKey = process.env.XAI_API_KEY?.trim();
  if (xaiKey !== undefined && xaiKey.length > 0) {
    voters.push({ proposer: new GrokActionProposer(xaiKey), model: TRIAD_MODELS.grok });
  }
  return voters;
}

/**
 * The voters for the Reasoner step: always the primary (Claude/offline), plus
 * Gemini and Grok when their keys are present. Offline/CI keeps a single voter so
 * the deterministic demo is unchanged; the triad activates only with real keys.
 */
export function createReasonerVoters(primary: ModelClient): Voter[] {
  const voters: Voter[] = [{ proposer: primary, model: MODELS.reasoner }];
  if (isOffline()) return voters;
  return [...voters, ...createExtraVoters()];
}
