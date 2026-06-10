// mocks/governance.fixtures.ts
// Deterministic fixtures for scripts/verify-governance.ts. Two offline stub voters
// under different model ids are attested-distinct by construction — (provider, model)
// is the identity — so the consensus + Red Cell path runs end to end with zero keys,
// the same discipline as the CI demo.

import { createOfflineModelClient, type ModelClient } from "../lib/model-client";
import type { Voter } from "../lib/providers";

const client: ModelClient = createOfflineModelClient();

export const OFFLINE_VOICE_FIXTURES: { readonly client: ModelClient } = { client };

/** Two attested-distinct offline voters (same stub, different model ids). */
export function offlineVoterPair(): readonly [Voter, Voter] {
  return [
    { proposer: client, model: "offline-alpha" },
    { proposer: client, model: "offline-beta" },
  ];
}
