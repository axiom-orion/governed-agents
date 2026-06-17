"use client";

// lib/governance-stream.ts
// Client hook that turns the governance NDJSON stream (/api/governance/stream) into a
// validated event list. Every line is parsed and checked against the GovernanceStreamEvent
// Zod schema before the console is allowed to trust it — a malformed line is skipped and
// counted, never rendered. Same "render only from validated events" discipline as the
// trace UI, applied to the realtime control channel.
//
// No browser storage: state lives in React memory only. The connection is read-only;
// decisions never travel this channel (they go through the decideCosign Server Action).

import { useEffect, useState } from "react";
import { GovernanceStreamEvent } from "@/governance/types";
import type { GovernanceStreamEvent as GovEvent } from "@/governance/types";

export type StreamConnection = "connecting" | "open" | "closed" | "error";

export interface GovernanceStreamState {
  readonly events: readonly GovEvent[];
  readonly connection: StreamConnection;
  readonly skipped: number;
}

function parseLines(buffer: string): { events: GovEvent[]; rest: string; skipped: number } {
  const events: GovEvent[] = [];
  let skipped = 0;
  let idx = buffer.indexOf("\n");
  let rest = buffer;
  while (idx !== -1) {
    const line = rest.slice(0, idx).trim();
    rest = rest.slice(idx + 1);
    if (line.length > 0) {
      let json: unknown;
      try {
        json = JSON.parse(line);
      } catch {
        skipped += 1;
        idx = rest.indexOf("\n");
        continue;
      }
      const parsed = GovernanceStreamEvent.safeParse(json);
      if (parsed.success) events.push(parsed.data);
      else skipped += 1;
    }
    idx = rest.indexOf("\n");
  }
  return { events, rest, skipped };
}

export function useGovernanceStream(url: string, nonce = 0): GovernanceStreamState {
  const [events, setEvents] = useState<readonly GovEvent[]>([]);
  const [connection, setConnection] = useState<StreamConnection>("connecting");
  const [skipped, setSkipped] = useState(0);

  useEffect(() => {
    setEvents([]);
    setSkipped(0);
    setConnection("connecting");

    let cancelled = false;
    const controller = new AbortController();

    const run = async (): Promise<void> => {
      try {
        const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
        if (cancelled) return;
        setConnection("open");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (cancelled) return;
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { events: parsed, rest, skipped: bad } = parseLines(buffer);
          buffer = rest;
          if (parsed.length > 0) setEvents((prev) => prev.concat(parsed));
          if (bad > 0) setSkipped((prev) => prev + bad);
        }
        if (!cancelled) setConnection("closed");
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) return;
        setConnection("error");
      }
    };

    void run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [url, nonce]);

  return { events, connection, skipped };
}
