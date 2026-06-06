// app/api/run/route.ts
// Streaming Route Handler. POST runs the loop and emits one TraceEvent per line
// (newline-delimited JSON), flushed incrementally as each step completes — not
// buffered. The Anthropic key stays server-side (this never runs in the browser).

import { runLoop } from "@/lib/loop";
import { SEED_TASKS, getTask } from "@/lib/tasks";
import { buildPolicy } from "@/lib/governance";
import { createModelClient } from "@/lib/model-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Raise the function timeout for the multi-step model loop. 60s is safe on every
// Vercel plan (Hobby caps at 60; Pro 300; Enterprise 900) and the loop finishes in
// seconds — bump to 300 on Pro+ if you want more headroom.
export const maxDuration = 60;

interface RunRequest {
  readonly task?: string;
  readonly taskId?: string;
  /** Optional gate override so an edited policy flips a real Live run, not just Sample. */
  readonly externalSendThreshold?: number;
}

function readThreshold(policy: unknown): number | undefined {
  if (typeof policy !== "object" || policy === null) return undefined;
  const value = (policy as Record<string, unknown>).externalSendThreshold;
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : undefined;
}

function readRunRequest(body: unknown): RunRequest {
  if (typeof body !== "object" || body === null) return {};
  const rec = body as Record<string, unknown>;
  return {
    task: typeof rec.task === "string" ? rec.task : undefined,
    taskId: typeof rec.taskId === "string" ? rec.taskId : undefined,
    externalSendThreshold: readThreshold(rec.policy),
  };
}

export function GET(): Response {
  return Response.json({
    endpoint: "POST /api/run",
    body: { task: "free-text task", taskId: "or one of the seed task ids" },
    seedTasks: SEED_TASKS.map((t) => ({ id: t.id, label: t.label, expected: t.expected })),
  });
}

export async function POST(req: Request): Promise<Response> {
  let parsed: unknown = {};
  try {
    parsed = await req.json();
  } catch {
    // empty / non-JSON body is allowed; fall through to validation
  }
  const { task, taskId, externalSendThreshold } = readRunRequest(parsed);

  let resolvedTask = task;
  if (resolvedTask === undefined && taskId !== undefined) {
    const seed = getTask(taskId);
    if (seed === undefined) {
      return Response.json(
        { error: `unknown taskId '${taskId}'`, available: SEED_TASKS.map((t) => t.id) },
        { status: 400 },
      );
    }
    resolvedTask = seed.task;
  }
  if (resolvedTask === undefined || resolvedTask.trim().length === 0) {
    return Response.json(
      { error: "provide { task } or { taskId }", available: SEED_TASKS.map((t) => t.id) },
      { status: 400 },
    );
  }

  const taskText = resolvedTask;
  const policy = buildPolicy({ externalSendThreshold });
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of runLoop(taskText, createModelClient(), policy)) {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({ type: "error", message, at: new Date().toISOString() })}\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
