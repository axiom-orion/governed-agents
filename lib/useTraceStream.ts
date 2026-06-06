"use client";

// lib/useTraceStream.ts
// React hook that turns an NDJSON TraceEvent stream into a live render model.
// The primary source is the streaming Route Handler at POST /api/run; the same
// code path also drives a mock replay stream (mocks/trace.sample.ts) for the
// instant "Sample" mode. Malformed lines are skipped and counted, never thrown.
//
// Cold start: a serverless first hit can return a transient 5xx (or just be slow)
// while the function boots. For `url` sources we treat retryable statuses and
// network blips as a "warming" state and auto-retry with backoff BEFORE we start
// consuming the stream — so a reviewer's first Live click never shows a raw error.
// Once bytes are flowing we never silently retry (that could duplicate a run).

import { useEffect, useMemo, useState } from "react";
import type { TraceEvent } from "./trace-events";
import { NdjsonTraceParser } from "./ndjson";
import { projectTrace, EMPTY_TRACE_MODEL } from "./trace-model";
import type { TraceModel } from "./trace-model";

export type TraceStreamSource =
  | { readonly kind: "url"; readonly url: string; readonly init?: RequestInit }
  | { readonly kind: "stream"; readonly open: () => ReadableStream<Uint8Array> }
  | { readonly kind: "events"; readonly events: readonly TraceEvent[] };

export type ConnectionState =
  | "idle"
  | "connecting"
  | "warming"
  | "streaming"
  | "done"
  | "error";

export interface TraceStreamState {
  readonly model: TraceModel;
  readonly events: readonly TraceEvent[];
  readonly malformedCount: number;
  readonly connection: ConnectionState;
  /** 1-based retry number while `connection === "warming"`, else 0. */
  readonly warmupAttempt: number;
  readonly streamError?: string;
}

// Statuses worth retrying: cold-start boot failures and rate limits.
const RETRYABLE_STATUS: ReadonlySet<number> = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 5;
// Backoff (ms) before attempts 2..MAX_ATTEMPTS. Gentle — a cold lambda is usually
// warm within a couple of seconds.
const BACKOFF_MS: readonly number[] = [700, 1400, 2400, 4000];

function backoffFor(attempt: number): number {
  return BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)] ?? 4000;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/** Promise that resolves after `ms`, or rejects if the signal aborts first. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
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

/**
 * Open a `url` source with cold-start tolerance. Retries retryable HTTP statuses
 * and network errors (with backoff) until a streamable 2xx body is returned or
 * attempts are exhausted. `onWarming(attempt)` fires before each retry wait.
 */
async function openUrlWithRetry(
  url: string,
  init: RequestInit | undefined,
  signal: AbortSignal,
  onWarming: (attempt: number) => void,
): Promise<ReadableStream<Uint8Array>> {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      const response = await fetch(url, { ...init, signal });
      if (response.ok && response.body) return response.body;
      const retryable = RETRYABLE_STATUS.has(response.status) && attempt < MAX_ATTEMPTS;
      if (!retryable) {
        throw new Error(`stream request failed (HTTP ${response.status})`);
      }
      onWarming(attempt);
      await delay(backoffFor(attempt), signal);
    } catch (err) {
      if (isAbortError(err)) throw err;
      // A network-level throw (fetch rejected) is treated as a cold-start blip.
      if (attempt >= MAX_ATTEMPTS) throw err;
      onWarming(attempt);
      await delay(backoffFor(attempt), signal);
    }
  }
}

export function useTraceStream(source: TraceStreamSource | null): TraceStreamState {
  const [events, setEvents] = useState<readonly TraceEvent[]>([]);
  const [malformedCount, setMalformedCount] = useState(0);
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [warmupAttempt, setWarmupAttempt] = useState(0);
  const [streamError, setStreamError] = useState<string | undefined>(undefined);

  useEffect(() => {
    setEvents([]);
    setMalformedCount(0);
    setWarmupAttempt(0);
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
          stream = await openUrlWithRetry(source.url, source.init, controller.signal, (attempt) => {
            if (cancelled) return;
            setConnection("warming");
            setWarmupAttempt(attempt);
          });
        } else {
          stream = source.open();
        }
        if (cancelled) return;

        setWarmupAttempt(0);
        setConnection("streaming");
        await consume(stream, controller.signal, onParsed);
        if (!cancelled) setConnection("done");
      } catch (err) {
        if (cancelled || controller.signal.aborted || isAbortError(err)) return;
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

  return { model, events, malformedCount, connection, warmupAttempt, streamError };
}
