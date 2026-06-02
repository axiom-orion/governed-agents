"use client";

// lib/useTraceStream.ts
// React hook that turns an NDJSON TraceEvent stream into a live render model.
// The primary source is the streaming Route Handler at /api/run; until that is
// wired in (P5), the same code path is driven by a mock stream factory from
// mocks/trace.sample.ts. Malformed lines are skipped and counted, never thrown.

import { useEffect, useMemo, useState } from "react";
import type { TraceEvent } from "./trace-events";
import { NdjsonTraceParser } from "./ndjson";
import { projectTrace, EMPTY_TRACE_MODEL } from "./trace-model";
import type { TraceModel } from "./trace-model";

export type TraceStreamSource =
  | { readonly kind: "url"; readonly url: string; readonly init?: RequestInit }
  | { readonly kind: "stream"; readonly open: () => ReadableStream<Uint8Array> }
  | { readonly kind: "events"; readonly events: readonly TraceEvent[] };

export type ConnectionState = "idle" | "connecting" | "streaming" | "done" | "error";

export interface TraceStreamState {
  readonly model: TraceModel;
  readonly events: readonly TraceEvent[];
  readonly malformedCount: number;
  readonly connection: ConnectionState;
  readonly streamError?: string;
}

async function consume(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onParsed: (events: readonly TraceEvent[], malformed: number) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const parser = new NdjsonTraceParser();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (signal.aborted) return;
      if (done) break;
      const { events, malformed } = parser.push(decoder.decode(value, { stream: true }));
      if (events.length > 0 || malformed.length > 0) onParsed(events, malformed.length);
    }
    const tail = parser.flush();
    if (tail.events.length > 0 || tail.malformed.length > 0) {
      onParsed(tail.events, tail.malformed.length);
    }
  } finally {
    reader.releaseLock();
  }
}

export function useTraceStream(source: TraceStreamSource | null): TraceStreamState {
  const [events, setEvents] = useState<readonly TraceEvent[]>([]);
  const [malformedCount, setMalformedCount] = useState(0);
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [streamError, setStreamError] = useState<string | undefined>(undefined);

  useEffect(() => {
    setEvents([]);
    setMalformedCount(0);
    setStreamError(undefined);

    if (!source) {
      setConnection("idle");
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const onParsed = (incoming: readonly TraceEvent[], malformed: number): void => {
      if (cancelled) return;
      if (incoming.length > 0) setEvents((prev) => prev.concat(incoming));
      if (malformed > 0) setMalformedCount((prev) => prev + malformed);
    };

    const run = async (): Promise<void> => {
      try {
        if (source.kind === "events") {
          setConnection("done");
          onParsed(source.events.slice(), 0);
          return;
        }

        setConnection("connecting");
        let stream: ReadableStream<Uint8Array>;
        if (source.kind === "url") {
          const response = await fetch(source.url, { ...source.init, signal: controller.signal });
          if (!response.ok || !response.body) {
            throw new Error(`stream request failed (HTTP ${response.status})`);
          }
          stream = response.body;
        } else {
          stream = source.open();
        }
        if (cancelled) return;

        setConnection("streaming");
        await consume(stream, controller.signal, onParsed);
        if (!cancelled) setConnection("done");
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setConnection("error");
        setStreamError(err instanceof Error ? err.message : "unknown stream error");
      }
    };

    void run();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [source]);

  const model = useMemo<TraceModel>(
    () => (events.length > 0 ? projectTrace(events) : EMPTY_TRACE_MODEL),
    [events],
  );

  return { model, events, malformedCount, connection, streamError };
}
