// scripts/test.mjs
// `npm test`: runs every offline verification suite that CI runs, in order, and stops at
// the first failure. Each suite runs with AGENTS_OFFLINE=1, so `npm test` never calls a
// model API — even on a machine where ANTHROPIC_API_KEY is set — and stays deterministic.
//
// Plain Node, no extra dependencies; works on macOS, Linux and Windows.

import { spawnSync } from "node:child_process";

const SUITES = [
  { name: "Trace projection contract", script: "scripts/verify-trace.ts" },
  { name: "Attested independence + Red Cell", script: "scripts/verify-governance.ts" },
  {
    name: "Cosign intervention surface",
    script: "scripts/verify-cosign.ts",
    // `server-only` modules resolve only under the react-server condition.
    nodeOptions: "--conditions=react-server",
  },
  { name: "Loop smoke test (allowed → allow, blocked → block)", script: "scripts/run.ts" },
];

for (const suite of SUITES) {
  console.log(`\n▶ ${suite.name}`);
  const env = { ...process.env, AGENTS_OFFLINE: "1" };
  if (suite.nodeOptions !== undefined) {
    env.NODE_OPTIONS = [process.env.NODE_OPTIONS, suite.nodeOptions].filter(Boolean).join(" ");
  }
  const run = spawnSync("npx", ["--no-install", "tsx", suite.script], {
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
  });
  if (run.status !== 0) {
    console.error(`\n✗ ${suite.name} failed`);
    process.exit(run.status ?? 1);
  }
}

console.log(`\n✓ all ${SUITES.length} offline suites passed`);
