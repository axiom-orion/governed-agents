// components/console/FleetRail.tsx
// Read-only fleet view: ten genealogy agents, each with its CAR ID, BASIS tier, status,
// attestation method, and last action. The attestation column is load-bearing for honesty —
// only Scribe (self-hosted, open weights) can be fingerprinted in weight space; the nine
// API-backed agents are attested by canary-probe behavioral checks, never by I(θ).

import type { AgentState } from "@/governance/types";
import { StatusChip } from "./StatusChip";

function AttestationBadge({ agent }: { agent: AgentState }) {
  const weight = agent.attestation === "WEIGHT_SPACE_ITHETA";
  return (
    <span
      className={
        "rounded px-1.5 py-0.5 text-[10px] font-medium " +
        (weight ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-500")
      }
      title={
        weight
          ? "Self-hosted open weights — attested by weight-space I(θ) fingerprinting"
          : "API-backed (no weight access) — attested by canary-probe behavioral checks"
      }
    >
      {weight ? "I(θ) weight-space" : "canary-probe"}
    </span>
  );
}

export function FleetRail({ agents }: { agents: readonly AgentState[] }) {
  const quarantined = agents.filter((a) => a.status === "QUARANTINED").length;
  return (
    <section aria-label="Fleet" className="flex flex-col">
      <header className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Fleet</h2>
        <span className="text-[11px] text-slate-400">
          {agents.length} agents{quarantined > 0 ? ` · ${quarantined} quarantined` : ""}
        </span>
      </header>
      <ul className="flex flex-col gap-1.5">
        {agents.map((agent) => {
          const red = agent.status === "QUARANTINED";
          return (
            <li
              key={agent.carId}
              className={
                "rounded-md border p-2.5 transition-colors " +
                (red ? "border-red-300 bg-red-50" : "border-slate-200 bg-white")
              }
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-800">{agent.name}</span>
                  <span className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px] font-semibold text-slate-500">
                    {agent.tier}
                  </span>
                </div>
                <StatusChip status={agent.status} />
              </div>
              <p className="mt-0.5 font-mono text-[10px] text-slate-400">{agent.carId}</p>
              <p className="mt-1 text-[11px] text-slate-500">{agent.role}</p>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <AttestationBadge agent={agent} />
              </div>
              <p className={"mt-1.5 text-[11px] leading-snug " + (red ? "text-red-700" : "text-slate-500")}>
                {agent.lastAction ?? "—"}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
