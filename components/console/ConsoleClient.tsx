"use client";

// components/console/ConsoleClient.tsx
// The intervention console: it wires the read-only governance stream to the three surfaces —
// fleet, cosign queue, drift/quarantine — and threads the one write path (a human decision)
// back through the decideCosign Server Action. State lives in React memory only; no browser
// storage, no client write to the data store.
//
// The stream is the realtime channel (fleet snapshot, holds arriving, drift firing). The
// Server Action is the only mutation. Decisions update the local view and the Truth Chain;
// they never mutate trust data — that stays the enforcement plane's job.

import { useEffect, useRef, useState } from "react";
import type { AgentState, CosignRequest, DriftEvent } from "@/governance/types";
import { useGovernanceStream } from "@/lib/governance-stream";
import { FleetRail } from "./FleetRail";
import { CosignQueue } from "./CosignQueue";
import { DriftPanel } from "./DriftPanel";
import { AuditTrail } from "./AuditTrail";
import type { AuditRow } from "./CosignHoldCard";

const REPO_URL = "https://github.com/axiom-orion/governed-agents";

interface ConsoleClientProps {
  readonly initialFleet: readonly AgentState[];
  readonly initialHolds: readonly CosignRequest[];
}

export function ConsoleClient({ initialFleet, initialHolds }: ConsoleClientProps) {
  const [nonce, setNonce] = useState(0);
  const { events, connection, skipped } = useGovernanceStream("/api/governance/stream", nonce);

  const [fleet, setFleet] = useState<readonly AgentState[]>(initialFleet);
  const [holds, setHolds] = useState<readonly CosignRequest[]>(initialHolds);
  const [drifts, setDrifts] = useState<readonly DriftEvent[]>([]);
  const [audit, setAudit] = useState<readonly AuditRow[]>([]);
  const cursor = useRef(0);

  // Reset derived state whenever the stream is (re)opened.
  useEffect(() => {
    cursor.current = 0;
    setFleet(initialFleet);
    setHolds(initialHolds);
    setDrifts([]);
    setAudit([]);
  }, [nonce, initialFleet, initialHolds]);

  // Apply only events we haven't processed yet.
  useEffect(() => {
    for (let i = cursor.current; i < events.length; i += 1) {
      const ev = events[i]!;
      switch (ev.type) {
        case "fleet":
          setFleet(ev.agents);
          break;
        case "holds":
          setHolds((prev) => mergeHolds(prev, ev.holds));
          break;
        case "hold_opened":
          setHolds((prev) => mergeHolds(prev, [ev.hold]));
          break;
        case "hold_resolved":
          setHolds((prev) =>
            prev.map((h) => (h.id === ev.id ? { ...h, status: ev.status, decidedBy: ev.decidedBy } : h)),
          );
          break;
        case "agent_update":
          setFleet((prev) => prev.map((a) => (a.carId === ev.agent.carId ? ev.agent : a)));
          break;
        case "drift": {
          const driftEvent = ev.event;
          setDrifts((prev) => (prev.some((d) => d.id === driftEvent.id) ? prev : [...prev, driftEvent]));
          setFleet((prev) =>
            prev.map((a) => (a.carId === driftEvent.agentCarId ? { ...a, status: "QUARANTINED" } : a)),
          );
          break;
        }
        case "heartbeat":
          break;
      }
    }
    cursor.current = events.length;
  }, [events]);

  const onResolved = (
    _holdId: string,
    _status: "APPROVED" | "REJECTED" | "TIMEOUT",
    rows: readonly AuditRow[],
  ): void => {
    setAudit((prev) => [...prev, ...rows]);
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
                Intervention console
              </span>
              <ConnectionDot connection={connection} />
            </div>
            <h1 className="mt-1.5 text-lg font-bold tracking-tight text-slate-900">
              Cosign — where a human stops a bad merge
            </h1>
            <p className="mt-0.5 max-w-2xl text-sm text-slate-500">
              The runtime human-in-the-loop surface for the genealogy fleet. Held actions surface
              with their evidence; an operator approves or rejects; the decision routes back to the
              enforcement plane and lands in an append-only audit chain.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500">
              Source: <span className="font-mono">simulator</span> · synthetic data
            </span>
            <div className="flex items-center gap-3 text-[11px]">
              <button
                type="button"
                onClick={() => setNonce((n) => n + 1)}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-600 hover:bg-slate-50"
              >
                Replay
              </button>
              <a href="/" className="font-medium text-blue-600 hover:underline">
                Run trace →
              </a>
              <a href={REPO_URL} target="_blank" rel="noreferrer" className="font-medium text-blue-600 hover:underline">
                Repo →
              </a>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 px-5 py-5 lg:flex-row">
        <aside className="lg:w-72 lg:shrink-0">
          <FleetRail agents={fleet} />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          {drifts.map((d) => (
            <DriftPanel key={d.id} event={d} />
          ))}
          <CosignQueue holds={holds} connection={connection} onResolved={onResolved} />
          <AuditTrail rows={audit} />
          {skipped > 0 ? (
            <p className="text-[11px] text-amber-700">
              Skipped {skipped} malformed stream line{skipped === 1 ? "" : "s"} (validated, not rendered).
            </p>
          ) : null}
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white px-5 py-3">
        <p className="mx-auto max-w-6xl text-[11px] leading-relaxed text-slate-400">
          Scope &amp; limitations: simulator mode is synthetic and scripted — no bridge to a real
          agent, safe for public exposure. The audit chain is tamper-evident, not tamper-proof. Drift
          detection by weight-space I(θ) applies only to the self-hosted open-weight agent (Scribe);
          the API-backed agents are attested by canary-probe behavioral checks. The divergence
          computation lives in the private plane and is not in this repo.
        </p>
      </footer>
    </div>
  );
}

function mergeHolds(prev: readonly CosignRequest[], incoming: readonly CosignRequest[]): CosignRequest[] {
  const byId = new Map(prev.map((h) => [h.id, h]));
  for (const h of incoming) if (!byId.has(h.id)) byId.set(h.id, h);
  return [...byId.values()];
}

function ConnectionDot({ connection }: { connection: string }) {
  const map: Readonly<Record<string, { c: string; label: string }>> = {
    connecting: { c: "bg-amber-400", label: "connecting" },
    open: { c: "bg-emerald-500", label: "live" },
    closed: { c: "bg-slate-300", label: "idle" },
    error: { c: "bg-red-500", label: "stream error" },
  };
  const s = map[connection] ?? map.closed!;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
      <span className={"inline-block h-1.5 w-1.5 rounded-full " + s.c} />
      {s.label}
    </span>
  );
}
