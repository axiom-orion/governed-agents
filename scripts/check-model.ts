// scripts/check-model.ts
// Verifies the Claude model IDs the agents are configured to use are current
// (per docs.claude.com). Run: npm run check:model

export {}; // mark this file a module so its top-level helpers don't collide in global scope

function loadEnv(): void {
  const proc = process as typeof process & { loadEnvFile?: (path?: string) => void };
  if (typeof proc.loadEnvFile !== "function") return;
  for (const path of [".env.local", ".env"]) {
    try {
      proc.loadEnvFile(path);
    } catch {
      // file absent — fine
    }
  }
}

// Current, non-retired model IDs (docs.claude.com, Haiku/Sonnet/Opus tiers).
const CURRENT_MODEL_IDS: readonly string[] = [
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
];

async function main(): Promise<void> {
  loadEnv();
  const { MODELS } = await import("../lib/model-client");

  console.log("Configured agent models:");
  let ok = true;
  for (const [role, id] of Object.entries(MODELS)) {
    const known = CURRENT_MODEL_IDS.includes(id);
    console.log(`  ${role.padEnd(11)} ${id}${known ? "  ✓" : "  ✗ (not a current model id)"}`);
    if (!known) ok = false;
  }

  if (ok) {
    console.log("\nAll configured model ids are current. ✓");
  } else {
    console.error("\nOne or more configured model ids are not in the current set. See docs.claude.com.");
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
