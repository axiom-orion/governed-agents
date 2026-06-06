"use client";

// components/RawTraceDrawer.tsx
// A slide-over panel that shows the actual streamed TraceEvents, in order, exactly
// as they arrived on the wire (one NDJSON line each, pretty-printed). This is the
// "it's a real stream" proof for engineers — the same array the canvas is
// projected from, nothing massaged.

import { useState } from "react";
import type { TraceEvent } from "@/lib/trace-events";

const TYPE_TONE: Readonly<Record<string, string>> = {
  run_started: "text-slate-500",
  step_started: "text-slate-500",
  step_completed: "text-sky-700",
  action_proposed: "text-violet-700",
  gate_decision: "text-amber-700",
  executed: "text-emerald-700",
  halted: "text-red-700",
  awaiting_approval: "text-amber-700",
  run_completed: "text-slate-500",
  error: "text-red-700",
};

function toNdjson(events: readonly TraceEvent[]): string {
  return events.map((e) => JSON.stringify(e)).join("\n") + (events.length > 0 ? "\n" : "");
}

export function RawTraceDrawer({
  events,
  open,
  onClose,
}: {
  events: readonly TraceEvent[];
  open: boolean;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(toNdjson(events));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable (e.g. insecure context) — non-fatal
    }
  };

  return (
    <div
      className={
        "fixed inset-0 z-40 transition-opacity " +
        (open ? "opacity-100" : "pointer-events-none opacity-0")
      }
      aria-hidden={!open}
    >
      {/* scrim */}
      <button
        type="button"
        aria-label="Close raw trace"
        tabIndex={open ? 0 : -1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-slate-900/30"
      />
      {/* panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Raw trace events"
        className={
          "absolute right-0 top-0 flex h-full w-full max-w-xl flex-col border-l border-slate-200 bg-white shadow-xl transition-transform duration-200 " +
          (open ? "translate-x-0" : "translate-x-full")
        }
      >
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Raw trace</h2>
            <p className="text-xs text-slate-500">
              {events.length} event{events.length === 1 ? "" : "s"} · NDJSON, exactly as streamed
              from <code className="font-mono">/api/run</code>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void copy()}
              disabled={events.length === 0}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {copied ? "Copied ✓" : "Copy NDJSON"}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Close
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-3">
          {events.length === 0 ? (
            <p className="p-3 text-sm text-slate-400">
              No events yet — run a task and the streamed events will appear here line by line.
            </p>
          ) : (
            <ol className="flex flex-col gap-2">
              {events.map((event, index) => (
                <li
                  key={`${event.type}-${index}`}
                  className="overflow-hidden rounded-md border border-slate-200 bg-white"
                >
                  <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-1.5">
                    <code
                      className={
                        "font-mono text-xs font-semibold " +
                        (TYPE_TONE[event.type] ?? "text-slate-600")
                      }
                    >
                      {index + 1}. {event.type}
                    </code>
                  </div>
                  <pre className="overflow-x-auto px-3 py-2 text-[11px] leading-relaxed text-slate-700">
                    {JSON.stringify(event, null, 2)}
                  </pre>
                </li>
              ))}
            </ol>
          )}
        </div>
      </aside>
    </div>
  );
}
