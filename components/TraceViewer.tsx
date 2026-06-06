"use client";

// components/TraceViewer.tsx
// Wires the trace stream to the canvas and the two inspector panels.
// P5 integration: the run buttons drive the LIVE streaming route (POST /api/run).
// A "Sample" mode still replays the hard-coded runs through the real NDJSON parser
// (chunked + mid-line split, optionally with malformed lines injected to show they
// are skipped) — useful offline and for demoing resilience.

import { useEffect, useMemo, useState } from "react";
import { useTraceStream } from "@/lib/useTraceStream";
import type { TraceStreamSource } from "@/lib/useTraceStream";
import {
  buildTraceStream,
  INJECTED_MALFORMED_COUNT,
  sampleRuns,
  toNdjson,
  withMalformedLines,
} from "@/mocks/trace.sample";
import type { SampleRunId } from "@/mocks/trace.sample";
import {
  defaultSelectedId,
  gateForNode,
  provenanceForNode,
} from "@/lib/trace-model";
import type { RunStatus, TraceModel } from "@/lib/trace-model";
import { TraceCanvas } from "@/components/TraceCanvas";
import { ProvenancePanel } from "@/components/panels/ProvenancePanel";
import { GateDecision } from "@/components/panels/GateDecision";
import { RawTraceDrawer } from "@/components/RawTraceDrawer";

const REPO_URL = "https://github.com/axiom-orion/governed-agents";
const ARCH_DOC_URL = `${REPO_URL}/blob/master/docs/ARCHITECTURE.md`;

type DataMode = "live" | "sample";

// `id` selects the sample run; `taskId` is the seed task the live route understands.
const RUN_OPTIONS: ReadonlyArray<{ id: SampleRunId; taskId: string; label: string }> = [
  { id: "allow", taskId: "allowed", label: "Run allowed task" },
  { id: "block", taskId: "blocked", label: "Run blocked task" },
];

const STATUS_STYLES: Readonly<Record<RunStatus, { label: string; className: string }>> = {
  idle: { label: "Idle", className: "bg-slate-100 text-slate-600" },
  running: { label: "Running", className: "bg-blue-100 text-blue-700" },
  completed: { label: "Completed", className: "bg-emerald-100 text-emerald-700" },
  halted: { label: "Halted", className: "bg-red-100 text-red-700" },
  error: { label: "Error", className: "bg-red-100 text-red-700" },
};

const ROLE_LABEL: Readonly<Record<string, string>> = {
  researcher: "Researcher",
  reasoner: "Reasoner",
  executor: "Executor",
};

function selectedContextLabel(model: TraceModel, id: string | null): string | undefined {
  if (id === null) return undefined;
  const node = model.nodes.find((n) => n.id === id);
  if (!node) return undefined;
  if (node.kind === "step") return `${ROLE_LABEL[node.role] ?? node.role} · ${node.stepId}`;
  if (node.kind === "gate") return `Gate · ${node.stepId}`;
  return `Halt · ${node.stepId}`;
}

export function TraceViewer() {
  const [mode, setMode] = useState<DataMode>("live");
  const [runId, setRunId] = useState<SampleRunId>("allow");
  const [started, setStarted] = useState(false);
  const [injectNoise, setInjectNoise] = useState(true);
  const [replayNonce, setReplayNonce] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  // Pre-warm the serverless function on mount with a cheap GET so the reviewer's
  // first Live click hits a warm lambda. Fire-and-forget; failures are harmless.
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/run", { method: "GET", signal: controller.signal }).catch(() => {});
    return () => controller.abort();
  }, []);

  const source = useMemo<TraceStreamSource | null>(() => {
    if (!started) return null;
    // `replayNonce` participates so "Replay" rebuilds a fresh single-use stream.
    void replayNonce;
    if (mode === "live") {
      const option = RUN_OPTIONS.find((o) => o.id === runId);
      return {
        kind: "url",
        url: "/api/run",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ taskId: option?.taskId ?? "allowed" }),
        },
      };
    }
    const events = sampleRuns[runId];
    const ndjson = injectNoise ? withMalformedLines(toNdjson(events)) : toNdjson(events);
    return {
      kind: "stream",
      open: () => buildTraceStream(ndjson, { chunkSize: 256, delayMs: 60 }),
    };
  }, [started, mode, runId, injectNoise, replayNonce]);

  const { model, events, malformedCount, connection, warmupAttempt, streamError } =
    useTraceStream(source);

  // Prefer the user's selection when it still exists in the current run;
  // otherwise fall back to the most informative node (the gate).
  const effectiveSelectedId = useMemo<string | null>(() => {
    if (selectedId && model.nodes.some((n) => n.id === selectedId)) return selectedId;
    return defaultSelectedId(model);
  }, [selectedId, model]);

  const sources = useMemo(
    () => provenanceForNode(model, effectiveSelectedId),
    [model, effectiveSelectedId],
  );
  const gate = useMemo(() => gateForNode(model, effectiveSelectedId), [model, effectiveSelectedId]);
  const contextLabel = selectedContextLabel(model, effectiveSelectedId);

  const status = STATUS_STYLES[model.status];

  const runTask = (id: SampleRunId): void => {
    setRunId(id);
    setStarted(true);
    setReplayNonce((n) => n + 1);
  };

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold text-slate-900">
              Governed Agents · Run Trace
            </h1>
            <p className="mt-0.5 max-w-2xl text-sm text-slate-500">
              Every action an agent proposes is checked against an explicit policy before it runs.
              This view is rendered entirely from the run&rsquo;s trace event stream.
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
              <span className="font-mono">
                Next.js · server-side agent loop · streaming NDJSON trace · policy gate before execution
              </span>
              <a
                href={ARCH_DOC_URL}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-blue-600 underline-offset-2 hover:underline"
              >
                Architecture &amp; schema →
              </a>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-blue-600 underline-offset-2 hover:underline"
              >
                Repo →
              </a>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="inline-flex overflow-hidden rounded-md border border-slate-300"
              role="group"
              aria-label="Data source"
            >
              {(["live", "sample"] as const).map((m) => {
                const active = m === mode;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    aria-pressed={active}
                    title={m === "live" ? "Stream from POST /api/run" : "Replay a recorded sample run"}
                    className={
                      "px-3 py-1.5 text-sm font-medium transition-colors " +
                      (active ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50")
                    }
                  >
                    {m === "live" ? "Live" : "Sample"}
                  </button>
                );
              })}
            </div>
            <div className="inline-flex overflow-hidden rounded-md border border-slate-300">
              {RUN_OPTIONS.map((option) => {
                const active = started && option.id === runId;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => runTask(option.id)}
                    aria-pressed={active}
                    className={
                      "px-3 py-1.5 text-sm font-medium transition-colors " +
                      (active
                        ? "bg-slate-900 text-white"
                        : "bg-white text-slate-600 hover:bg-slate-50")
                    }
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setReplayNonce((n) => n + 1)}
              disabled={!started}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Replay
            </button>
            <button
              type="button"
              onClick={() => setShowRaw(true)}
              disabled={events.length === 0}
              title="Inspect the raw streamed TraceEvents (NDJSON)"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              View raw trace{events.length > 0 ? ` (${events.length})` : ""}
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <span
            className={"rounded-full px-2 py-0.5 font-semibold " + status.className}
            aria-label={`run status: ${status.label}`}
          >
            {status.label}
          </span>
          {connection === "connecting" ? (
            <span className="text-slate-500">connecting…</span>
          ) : null}
          {connection === "warming" ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800"
              role="status"
            >
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
              Warming up the agent…{warmupAttempt > 1 ? ` (retry ${warmupAttempt})` : ""}
            </span>
          ) : null}
          {connection === "streaming" ? (
            <span className="inline-flex items-center gap-1.5 text-slate-500">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
              streaming
            </span>
          ) : null}
          {mode === "live" && !started ? (
            <span className="text-slate-400">
              Live calls a Claude model server-side and may cold-start on the first run; Sample is
              instant.
            </span>
          ) : null}
          {model.task ? (
            <span className="text-slate-500">
              <span className="text-slate-400">Task:</span> {model.task}
            </span>
          ) : null}
          {model.runId ? (
            <span className="font-mono text-slate-400">{model.runId}</span>
          ) : null}
          {mode === "sample" ? (
            <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-slate-500">
              <input
                type="checkbox"
                checked={injectNoise}
                onChange={(e) => setInjectNoise(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300"
              />
              Inject malformed lines
            </label>
          ) : null}
          {mode === "sample" && injectNoise ? (
            <span className="text-amber-700" role="status">
              Skipped {malformedCount} of {INJECTED_MALFORMED_COUNT} malformed line
              {malformedCount === 1 ? "" : "s"}
            </span>
          ) : null}
          {model.status === "error" && streamError ? (
            <span className="text-red-700">Stream error: {streamError}</span>
          ) : null}
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative h-[50vh] w-full shrink-0 border-b border-slate-200 lg:h-full lg:flex-1 lg:shrink lg:border-b-0 lg:border-r lg:border-slate-200">
          <TraceCanvas model={model} selectedId={effectiveSelectedId} onSelect={setSelectedId} />
          {!started ? (
            <div className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center">
              <p className="max-w-sm text-sm text-slate-400">
                {mode === "live"
                  ? "Run a task to watch the three agents coordinate and the governance gate allow or block the proposed action — streamed live from /api/run."
                  : "Run a sample task to replay a recorded trace through the live NDJSON parser."}
              </p>
            </div>
          ) : null}
        </div>
        <aside className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto bg-white p-5 lg:flex-none lg:basis-[380px]">
          <GateDecision gate={gate} />
          <div className="border-t border-slate-100" />
          <ProvenancePanel sources={sources} contextLabel={contextLabel} />
        </aside>
      </main>

      <RawTraceDrawer events={events} open={showRaw} onClose={() => setShowRaw(false)} />
    </div>
  );
}
