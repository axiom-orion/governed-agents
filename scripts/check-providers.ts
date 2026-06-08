// scripts/check-providers.ts
// Connectivity check for the consensus triad's extra providers (Gemini + Grok).
// Pings each provider that has an API key with a tiny propose_action call and
// prints ✓/✗ per provider — so you can verify keys + model ids from the terminal
// before enabling the triad on a deployment.
//
// Makes real network calls; it is NOT part of CI (no keys ⇒ nothing to check,
// exit 0). No key values are ever printed.

import { createExtraVoters } from "../lib/providers";
import { REASONER_SYSTEM } from "../lib/agents";

const PROBE_USER =
  "Task:\nWrite an internal note confirming the provider connectivity check ran.\n\n" +
  "Research summary:\nThis is a one-off connectivity probe; no external action is needed.\n\n" +
  "Choose the single next action.";

function printEnv(): void {
  const state = (name: string): string =>
    (process.env[name]?.trim() ?? "").length > 0 ? "set" : "—  (not set)";
  console.log("Configured environment:");
  console.log(`  GEMINI_API_KEY: ${state("GEMINI_API_KEY")}`);
  console.log(`  GEMINI_MODEL:   ${process.env.GEMINI_MODEL ?? "(default: gemini-2.5-flash)"}`);
  console.log(`  XAI_API_KEY:    ${state("XAI_API_KEY")}`);
  console.log(`  XAI_MODEL:      ${process.env.XAI_MODEL ?? "(default: grok-3)"}`);
  console.log("");
}

async function main(): Promise<void> {
  printEnv();

  const voters = createExtraVoters();
  if (voters.length === 0) {
    console.log("No extra providers configured.");
    console.log("Set GEMINI_API_KEY and/or XAI_API_KEY to enable the consensus triad.");
    console.log("(Claude-only runs work fine — consensus just won't engage until a 2nd model is present.)");
    return;
  }

  let failures = 0;
  for (const voter of voters) {
    const label = voter.proposer.label.padEnd(7);
    const started = Date.now();
    try {
      const draft = await voter.proposer.proposeAction({
        system: REASONER_SYSTEM,
        user: PROBE_USER,
        model: voter.model,
      });
      console.log(`✓ ${label} ${voter.model}  →  proposed ${draft.kind} (${Date.now() - started}ms)`);
    } catch (err) {
      failures += 1;
      // Collapse provider error bodies (often multi-line JSON) to a tidy one-liner.
      const raw = err instanceof Error ? err.message : String(err);
      const message = raw.replace(/\s+/g, " ").trim().slice(0, 180);
      console.log(`✗ ${label} ${voter.model}  →  ${message} (${Date.now() - started}ms)`);
    }
  }

  console.log("");
  if (failures > 0) {
    console.log(
      `${failures} of ${voters.length} provider(s) failed. Most common causes: a stale model id ` +
        "(set GEMINI_MODEL / XAI_MODEL to a current id) or billing not enabled (xAI).",
    );
    process.exitCode = 1;
  } else {
    console.log(`All ${voters.length} configured provider(s) responded — the triad is ready. ✓`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
