// governance/audit.ts
// The Truth Chain: an append-only, hash-linked audit log. Every decision on the write
// path is recorded here BEFORE and AFTER it is acted on, so the record of what a human
// (or the fail-closed sweeper) did exists independently of whether the enforcement
// plane acknowledged it.
//
// server-only: this module is never bundled into the client. The decision path and the
// service-role key it implies stay on the server; a client import is a build error.
//
// Tamper-evident, not tamper-proof: the chain detects any in-place edit or deletion of a
// past row (the hashes stop linking), but a holder of write access to the store could
// still rewrite the whole chain. True WORM needs an external ledger — see the limitations
// note in the console and docs/COSIGN.md.

import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { AuditEvent, AuditInput } from "./types";
import { AuditInput as AuditInputSchema } from "./types";

/** Deterministic JSON: object keys sorted recursively, so the hash is stable. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

/**
 * The chain hash for a row: sha256 over the previous hash followed by the canonical
 * serialization of the row's content (id, ts, agentCarId, eventType, actor, payload).
 * Including the prev hash is what links the chain; including the whole row content is
 * what makes any field edit detectable, not just the payload.
 */
export function chainHash(prevHash: string | null, content: Omit<AuditEvent, "hash" | "prevHash">): string {
  return createHash("sha256")
    .update(prevHash ?? "")
    .update(canonical(content))
    .digest("hex");
}

/** Append-only audit store. The simulator backs this in memory; live mode backs it in Postgres. */
export interface AuditStore {
  head(): Promise<string | null>;
  append(event: AuditEvent): Promise<void>;
  all(): Promise<AuditEvent[]>;
}

/** Zero-infra in-memory store — used by the simulator and by the headless verifier. */
export class MemoryAuditStore implements AuditStore {
  readonly #events: AuditEvent[] = [];
  async head(): Promise<string | null> {
    return this.#events.at(-1)?.hash ?? null;
  }
  async append(event: AuditEvent): Promise<void> {
    this.#events.push(event);
  }
  async all(): Promise<AuditEvent[]> {
    return this.#events.slice();
  }
}

// A process-wide default store so the Server Action and reads share one chain within a
// warm server instance. Pluggable so the live path can swap in a Supabase-backed store.
let activeStore: AuditStore = new MemoryAuditStore();
export function setAuditStore(store: AuditStore): void {
  activeStore = store;
}
export function getAuditStore(): AuditStore {
  return activeStore;
}

/**
 * Append a row to the chain. The caller supplies intent ({eventType, actor, payload});
 * the store supplies identity, timestamp, and the hash linkage. Input is validated with
 * Zod first, so a malformed call cannot poison the chain.
 */
export async function appendAudit(input: AuditInput, store: AuditStore = activeStore): Promise<AuditEvent> {
  const parsed = AuditInputSchema.parse(input);
  const prevHash = await store.head();
  const content: Omit<AuditEvent, "hash" | "prevHash"> = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    agentCarId: parsed.agentCarId ?? null,
    eventType: parsed.eventType,
    actor: parsed.actor,
    payload: parsed.payload,
  };
  const event: AuditEvent = { ...content, prevHash, hash: chainHash(prevHash, content) };
  await store.append(event);
  return event;
}

export interface ChainVerification {
  readonly ok: boolean;
  /** Index of the first row whose linkage or hash fails, or -1 if the chain is intact. */
  readonly brokenAt: number;
  readonly length: number;
}

/** Recompute the chain and confirm every row links to the last and hashes to its content. */
export function verifyChain(events: readonly AuditEvent[]): ChainVerification {
  let prev: string | null = null;
  for (let i = 0; i < events.length; i += 1) {
    const e = events[i]!;
    const content: Omit<AuditEvent, "hash" | "prevHash"> = {
      id: e.id,
      ts: e.ts,
      agentCarId: e.agentCarId,
      eventType: e.eventType,
      actor: e.actor,
      payload: e.payload,
    };
    if (e.prevHash !== prev || e.hash !== chainHash(prev, content)) {
      return { ok: false, brokenAt: i, length: events.length };
    }
    prev = e.hash;
  }
  return { ok: true, brokenAt: -1, length: events.length };
}
