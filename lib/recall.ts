// lib/recall.ts
// Retrieval dispatcher. Defaults to the bundled in-memory corpus (zero setup).
// If MEMORY_SERVICE_URL is set, retrieval is routed to a live memory service over
// the C3 contract (POST /recall -> { records: MemoryRecord[] }); on any failure it
// falls back to the local corpus so a misconfigured service never breaks a run.

import { localRecall, type MemoryRecord, type MemoryType, type ScoredRecord } from "./corpus";

const REMOTE_TIMEOUT_MS = 8000;
const MEMORY_TYPES: readonly MemoryType[] = ["working", "episodic", "semantic", "procedural"];

export async function recall(query: string, k = 4): Promise<ScoredRecord[]> {
  const url = process.env.MEMORY_SERVICE_URL?.trim();
  if (url !== undefined && url.length > 0) {
    try {
      return await remoteRecall(url, query, k);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[recall] remote /recall failed (${message}); falling back to local corpus`);
    }
  }
  return localRecall(query, k);
}

async function remoteRecall(baseUrl: string, query: string, k: number): Promise<ScoredRecord[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/u, "")}/recall`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, k }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: unknown = await res.json();
    return scoreRemote(parseRecords(data), k);
  } finally {
    clearTimeout(timer);
  }
}

function parseRecords(data: unknown): MemoryRecord[] {
  if (typeof data !== "object" || data === null) throw new Error("malformed /recall response");
  const recordsRaw = (data as { records?: unknown }).records;
  if (!Array.isArray(recordsRaw)) throw new Error("malformed /recall response: missing records[]");
  const out: MemoryRecord[] = [];
  for (const r of recordsRaw) {
    if (typeof r !== "object" || r === null) continue;
    const rec = r as Record<string, unknown>;
    const { id, content, type, importance, superseded } = rec;
    if (typeof id !== "number" || typeof content !== "string") continue;
    out.push({
      id,
      content,
      type: MEMORY_TYPES.includes(type as MemoryType) ? (type as MemoryType) : "semantic",
      importance: typeof importance === "number" ? importance : 0,
      superseded: typeof superseded === "boolean" ? superseded : false,
    });
  }
  return out;
}

// The C3 contract returns `importance`, not a [0,1] score. Normalize importance
// across the returned batch into a confidence score so the gate has something to
// reason about. Seed-task outcomes are only guaranteed with the default local corpus.
function scoreRemote(records: readonly MemoryRecord[], k: number): ScoredRecord[] {
  const active = records.filter((r) => !r.superseded);
  const maxImportance = active.reduce((m, r) => Math.max(m, r.importance), 0);
  const scored = active.map<ScoredRecord>((r) => ({
    ...r,
    score: maxImportance > 0 ? Math.round((r.importance / maxImportance) * 100) / 100 : 0,
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, k));
}
