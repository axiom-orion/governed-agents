// cloudflare-worker.mjs — the Cloudflare Worker entry point.
//
// `fetch` serves the Next.js app as built by `opennextjs-cloudflare build`.
// `scheduled` runs the fail-closed TTL sweep on the Cron Trigger in wrangler.jsonc — the job
// vercel.json's cron did on Vercel. The sweep auto-rejects any pending human-approval hold
// past its TTL, so silence becomes refusal. When the CRON_SECRET secret is set (live mode),
// the request carries it, exactly as the route expects from a scheduler.

// @ts-ignore — generated at build time by `opennextjs-cloudflare build`
import { default as handler } from "./.open-next/worker.js";

export default {
  fetch: handler.fetch,

  async scheduled(controller, env, ctx) {
    const headers = env.CRON_SECRET ? { authorization: `Bearer ${env.CRON_SECRET}` } : {};
    const request = new Request("https://cron.invalid/api/governance/sweep", { method: "POST", headers });
    ctx.waitUntil(
      Promise.resolve(handler.fetch(request, env, ctx)).then(async (response) => {
        const body = await response.text();
        console.log(`governance sweep (${controller.cron}): HTTP ${response.status} ${body}`);
        // A failed sweep fails the cron run, so it shows up in the Worker's logs and metrics.
        if (!response.ok) throw new Error(`governance sweep failed: HTTP ${response.status}`);
      }),
    );
  },
};
