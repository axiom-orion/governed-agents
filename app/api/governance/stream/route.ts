// app/api/governance/stream/route.ts
// The realtime channel for the console: an NDJSON stream of governance events — the
// fleet snapshot, holds as they arrive, decisions as they resolve, and drift/quarantine
// signals. Mirrors the trace UI's NDJSON transport (one validated JSON object per line),
// so the client renders only from events it has validated with Zod.
//
// In simulator mode the source scripts the timeline (the Cason↔Causey hold, the Scribe
// drift); in live mode the same route forwards CogniGate/ASTS events over Supabase
// Realtime. Either way the route is read-only — no decision is accepted here. Decisions
// go through the decideCosign Server Action.

import { getSource } from "@/governance/registry";
import type { GovernanceStreamEvent } from "@/governance/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HEARTBEAT_MS = 5_000;
// Hold the connection open long enough to deliver the scripted timeline, then close so the
// serverless function returns. The client reconnects on remount if it wants the script again.
const WINDOW_MS = 45_000;

export async function GET(req: Request): Promise<Response> {
  const source = getSource();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: GovernanceStreamEvent): void => {
        if (closed) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      const now = (): string => new Date().toISOString();

      // 1. snapshot: fleet + any already-open holds.
      send({ type: "fleet", at: now(), agents: await source.getFleet() });
      send({ type: "holds", at: now(), holds: await source.listPendingHolds() });

      // 2. live arrivals.
      const unsubHolds = source.watchHolds((hold) => send({ type: "hold_opened", at: now(), hold }));
      const unsubDrift = source.watchDrift((event) => {
        send({ type: "drift", at: now(), event });
        // Reflect the quarantine in the fleet so the read-only view goes red.
        void source.getFleet().then((agents) => {
          const agent = agents.find((a) => a.carId === event.agentCarId);
          if (agent) send({ type: "agent_update", at: now(), agent });
        });
      });

      const heartbeat = setInterval(() => send({ type: "heartbeat", at: now() }), HEARTBEAT_MS);

      const cleanup = (): void => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(windowTimer);
        unsubHolds();
        unsubDrift();
        try {
          controller.close();
        } catch {
          // already closed — ignore
        }
      };

      const windowTimer = setTimeout(cleanup, WINDOW_MS);
      req.signal.addEventListener("abort", cleanup, { once: true });
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
