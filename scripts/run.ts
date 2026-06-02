// scripts/run.ts
// No-UI harness: runs the loop in-process and prints the TraceEvent stream as it is
// produced (the same NDJSON the route emits), then a per-run outcome summary. Lets P3
// be validated before any UI exists.
//
//   npm run demo           # both seed tasks (allowed, then blocked)
//   npm run demo:allow     # just the allowed task
//   npm run demo:block     # just the blocked task
//   npx tsx scripts/run.ts "<free-text task>"

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

const TAGS: Readonly<Record<string, string>> = {
  run_started: "▶ run_started   ",
  step_started: "  · started     ",
  step_completed: "  ✓ completed   ",
  action_proposed: "  → proposed    ",
  gate_decision: "  ⚖ gate        ",
  executed: "  ⚡ executed    ",
  halted: "  ⛔ halted      ",
  run_completed: "■ run_completed ",
  error: "  ✗ error       ",
};

async function main(): Promise<void> {
  loadEnv();
  const { runLoop } = await import("../lib/loop");
  const { SEED_TASKS, getTask } = await import("../lib/tasks");
  const { createModelClient, isOffline } = await import("../lib/model-client");
  type SeedTask = (typeof SEED_TASKS)[number];

  const arg = process.argv[2];
  let toRun: SeedTask[];
  if (arg === undefined) {
    toRun = [...SEED_TASKS];
  } else {
    const seed = getTask(arg);
    if (seed !== undefined) {
      toRun = [seed];
    } else {
      const custom: SeedTask = { id: "custom", label: "Custom task", expected: "allow", task: arg };
      toRun = [custom];
    }
  }

  console.log(
    `model client: ${isOffline() ? "offline-stub (no ANTHROPIC_API_KEY)" : "anthropic (live model)"}`,
  );

  let allOk = true;
  for (const seed of toRun) {
    console.log(`\n=== RUN: ${seed.id} — ${seed.label} ===`);
    console.log(`task: ${seed.task}\n`);

    let outcome: "allow" | "block" | "error" | "?" = "?";
    for await (const event of runLoop(seed.task, createModelClient())) {
      // Print the raw NDJSON line (the wire format), prefixed with a readable tag.
      console.log(`${TAGS[event.type] ?? event.type} ${JSON.stringify(event)}`);
      if (event.type === "gate_decision") outcome = event.decision.decision;
      else if (event.type === "error") outcome = "error";
    }

    const isCustom = seed.id === "custom";
    const ok = isCustom ? outcome !== "error" : outcome === seed.expected;
    const verdict = isCustom ? "(no expectation)" : ok ? "PASS ✓" : "FAIL ✗";
    console.log(`\n--- outcome: ${outcome} (expected ${seed.expected}) ${verdict} ---`);
    allOk = allOk && ok;
  }

  if (!allOk) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
