// lib/model-client.ts
// The model surface for the three agents. The default client calls a live Claude
// model via @anthropic-ai/sdk (server-only key). When no ANTHROPIC_API_KEY is set,
// or AGENTS_OFFLINE=1, a deterministic offline stub is used instead so the loop,
// gate, and stream all run end-to-end with zero external setup.

import Anthropic from "@anthropic-ai/sdk";

export type ActionKind = "send_email" | "write_record";

/** Structured action emitted by the Reasoner via forced tool use. */
export interface ActionDraft {
  readonly kind: ActionKind;
  readonly to?: string;
  readonly subject?: string;
  readonly body?: string;
  readonly record?: string;
  readonly justification: string;
}

export interface CompleteInput {
  readonly system: string;
  readonly user: string;
  readonly model: string;
  readonly maxTokens?: number;
  /** Hint used only by the offline stub to shape its canned output. */
  readonly purpose?: "research" | "execute";
}

export interface ProposeInput {
  readonly system: string;
  readonly user: string;
  readonly model: string;
}

/** Anything that can propose a structured action — the unit the triad votes with. */
export interface ActionProposer {
  readonly label: string;
  proposeAction(input: ProposeInput): Promise<ActionDraft>;
}

export interface ModelClient extends ActionProposer {
  complete(input: CompleteInput): Promise<string>;
}

/**
 * Per-role model IDs (Haiku/Sonnet tier). Override via env.
 * IDs verified current against docs.claude.com (see `npm run check:model`).
 */
export const MODELS = {
  researcher: process.env.RESEARCHER_MODEL ?? "claude-haiku-4-5",
  reasoner: process.env.REASONER_MODEL ?? "claude-sonnet-4-6",
  executor: process.env.EXECUTOR_MODEL ?? "claude-haiku-4-5",
} as const;

const PROPOSE_ACTION_TOOL: Anthropic.Tool = {
  name: "propose_action",
  description:
    "Propose exactly one concrete next action for the executor, grounded in the research findings.",
  input_schema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["send_email", "write_record"],
        description:
          "send_email for any outbound/external message; write_record for an internal note or record.",
      },
      to: { type: "string", description: "Recipient address. REQUIRED when kind is send_email." },
      subject: { type: "string", description: "Email subject (kind=send_email)." },
      body: { type: "string", description: "Email body (kind=send_email)." },
      record: { type: "string", description: "The internal note/record text (kind=write_record)." },
      justification: {
        type: "string",
        description: "One sentence on why this action follows from the findings.",
      },
    },
    required: ["kind", "justification"],
    additionalProperties: false,
  },
};

function isRefusal(stopReason: string | null): boolean {
  return stopReason === "refusal";
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function parseActionDraft(input: unknown): ActionDraft {
  if (typeof input !== "object" || input === null) {
    throw new Error("propose_action returned a non-object input");
  }
  const rec = input as Record<string, unknown>;
  const kind = rec.kind;
  if (kind !== "send_email" && kind !== "write_record") {
    throw new Error(`propose_action returned an invalid kind: ${String(kind)}`);
  }
  const justification = asOptionalString(rec.justification);
  return {
    kind,
    to: asOptionalString(rec.to),
    subject: asOptionalString(rec.subject),
    body: asOptionalString(rec.body),
    record: asOptionalString(rec.record),
    justification: justification ?? "(no justification provided)",
  };
}

class AnthropicModelClient implements ModelClient {
  public readonly label = "anthropic";
  private readonly client: Anthropic;

  constructor(client: Anthropic) {
    this.client = client;
  }

  public async complete(input: CompleteInput): Promise<string> {
    const message = await this.client.messages.create({
      model: input.model,
      max_tokens: input.maxTokens ?? 1024,
      // cache_control marks the frozen system prefix cacheable; it activates once the
      // prefix exceeds the model's minimum cacheable size.
      system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: input.user }],
    });
    if (isRefusal(message.stop_reason)) {
      throw new Error("model refused the request (stop_reason=refusal)");
    }
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (text.length === 0) throw new Error("model returned no text content");
    return text;
  }

  public async proposeAction(input: ProposeInput): Promise<ActionDraft> {
    const message = await this.client.messages.create({
      model: input.model,
      max_tokens: 1024,
      system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }],
      tools: [PROPOSE_ACTION_TOOL],
      tool_choice: { type: "tool", name: PROPOSE_ACTION_TOOL.name },
      messages: [{ role: "user", content: input.user }],
    });
    if (isRefusal(message.stop_reason)) {
      throw new Error("model refused the request (stop_reason=refusal)");
    }
    const toolUse = message.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (toolUse === undefined) {
      throw new Error("model did not return a propose_action tool call");
    }
    return parseActionDraft(toolUse.input);
  }
}

function extractEmail(text: string): string | undefined {
  const match = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z][a-z-]*/iu);
  return match?.[0];
}

class OfflineModelClient implements ModelClient {
  public readonly label = "offline-stub";

  public async complete(input: CompleteInput): Promise<string> {
    if (input.purpose === "execute") {
      return "[offline] Action carried out (simulated): the approved action was performed and logged.";
    }
    return "[offline] Reviewed the retrieved sources and summarized the facts relevant to the task. Set ANTHROPIC_API_KEY for a live model summary.";
  }

  public async proposeAction(input: ProposeInput): Promise<ActionDraft> {
    const text = input.user.toLowerCase();
    const wantsSend = /\b(email|e-mail|send|outbound|notify|message)\b/u.test(text);
    if (wantsSend) {
      return {
        kind: "send_email",
        to: extractEmail(input.user) ?? "recipient@example.com",
        subject: "Follow-up",
        body: "Confirming the details discussed.",
        justification: "The task requests an outbound email to the named recipient.",
      };
    }
    return {
      kind: "write_record",
      record: "Internal note capturing the research findings for the team.",
      justification: "The task requests an internal record of the findings.",
    };
  }
}

/** True when the loop will use the deterministic offline stub instead of a live model. */
export function isOffline(): boolean {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  return process.env.AGENTS_OFFLINE === "1" || key === undefined || key.length === 0;
}

export function createModelClient(): ModelClient {
  if (isOffline()) return new OfflineModelClient();
  return new AnthropicModelClient(new Anthropic());
}
