// app/api/governance/sweep/route.ts
// The fail-closed TTL sweeper. Any PENDING hold past its TTL with no human decision is
// auto-rejected (TIMEOUT) and audited. For a governance system the only defensible default
// is deny-if-no-human-acks, so this is non-negotiable: silence becomes refusal, not release.
//
// Wire this to a Vercel Cron (e.g. every minute) — or a Supabase scheduled function on the
// live path. It is the backstop that guarantees the posture even if no operator is watching.
//
// Auth: in live mode require a shared secret (CRON_SECRET) so only the scheduler can fire it.
// In simulator mode it is harmless (synthetic, no real agents) and left open for the demo.

import { getSource, governanceSourceKind } from "@/governance/registry";
import { appendAudit } from "@/governance/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function sweep(req: Request): Promise<Response> {
  if (governanceSourceKind() === "cognigate") {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.get("authorization");
    if (secret && auth !== `Bearer ${secret}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const { timedOut } = await getSource().sweepExpired();
  for (const hold of timedOut) {
    await appendAudit({
      eventType: "COSIGN_TIMEOUT",
      actor: "system:ttl-sweeper",
      agentCarId: hold.agentCarId,
      payload: { requestId: hold.id, actionType: hold.actionType, autoDecision: "REJECT", posture: "fail-closed" },
    });
  }

  return Response.json({
    sweptAt: new Date().toISOString(),
    timedOut: timedOut.map((h) => ({ id: h.id, actionType: h.actionType, agentCarId: h.agentCarId })),
  });
}

// Vercel Cron issues GET; allow POST too for manual/testing triggers.
export const GET = sweep;
export const POST = sweep;
