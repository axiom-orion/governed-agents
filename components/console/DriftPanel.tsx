// components/console/DriftPanel.tsx
// The drift money-shot: a model-swap caught and the agent auto-quarantined. Method-aware,
// because the claim has to be true — a WEIGHT_SPACE_ITHETA event shows the I(θ) signature
// divergence in degrees (valid only for the self-hosted open-weight agent); a CANARY_PROBE
// event shows a behavioral distance instead (the only thing observable for an API-backed
// agent). The type system guarantees a canary event can never assert degrees.
//
// Public-tier note: the signatures and divergence shown here are a RENDERED signal. The
// weight-space computation, aggregation, and threshold calibration are private-plane and
// not in this repo. Simulator values are synthetic.

import type { DriftEvent } from "@/governance/types";

// A flat divergence scale: a green "within band" zone near zero and a red marker where the
// observed value lands. Reads at a glance as "far outside the band."
function DivergenceScale({ value, band, max, unit }: { value: number; band: number; max: number; unit: string }) {
  const pct = (v: number): number => Math.max(0, Math.min(100, (v / max) * 100));
  return (
    <div className="flex flex-col gap-1">
      <div className="relative h-3 overflow-hidden rounded-full bg-slate-100">
        <div className="absolute inset-y-0 left-0 bg-emerald-200" style={{ width: `${pct(band)}%` }} />
        <div
          className="absolute inset-y-[-2px] w-0.5 bg-red-600"
          style={{ left: `calc(${pct(value)}% - 1px)` }}
          aria-hidden="true"
        />
      </div>
      <div className="flex justify-between text-[10px] text-slate-400">
        <span>0{unit}</span>
        <span className="text-emerald-600">band ±{band}{unit}</span>
        <span className="font-mono font-semibold text-red-600">
          observed {value}
          {unit}
        </span>
        <span>
          {max}
          {unit}
        </span>
      </div>
    </div>
  );
}

export function DriftPanel({ event }: { event: DriftEvent }) {
  const weight = event.method === "WEIGHT_SPACE_ITHETA";
  return (
    <section
      aria-label="Drift detection"
      className="rounded-lg border border-red-300 bg-white shadow-sm"
    >
      <header className="flex items-center justify-between gap-2 rounded-t-lg border-b border-red-200 bg-red-50 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" />
          <h2 className="text-sm font-semibold text-red-800">Drift detected → auto-quarantine</h2>
        </div>
        <span className="font-mono text-[11px] text-red-700">{event.agentCarId}</span>
      </header>

      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={
              "rounded px-2 py-0.5 text-[11px] font-semibold " +
              (weight ? "bg-indigo-100 text-indigo-800" : "bg-slate-100 text-slate-700")
            }
          >
            {weight ? "Weight-space I(θ) fingerprint" : "Canary-probe behavioral attestation"}
          </span>
          <span className="text-[11px] text-slate-500">
            {weight
              ? "self-hosted open weights — subspace rotation of the identity signature"
              : "API-backed — response-signature divergence on a fixed probe battery"}
          </span>
        </div>

        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5">
            <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Expected</dt>
            <dd className="mt-0.5 font-mono text-xs text-slate-700">{event.expectedSignature}</dd>
          </div>
          <div className="rounded-md border border-red-200 bg-red-50 p-2.5">
            <dt className="text-[10px] font-medium uppercase tracking-wide text-red-400">Observed</dt>
            <dd className="mt-0.5 font-mono text-xs text-red-700">{event.observedSignature}</dd>
          </div>
        </dl>

        {event.method === "WEIGHT_SPACE_ITHETA" ? (
          <DivergenceScale value={event.divergenceDeg} band={2.1} max={20} unit="°" />
        ) : (
          <div className="flex flex-col gap-1">
            <DivergenceScale value={Number(event.behavioralDistance.toFixed(2))} band={0.15} max={1} unit="" />
            <p className="text-[10px] text-slate-400">{event.probeCount} probes</p>
          </div>
        )}

        <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Action taken: <span className="font-semibold text-red-700">QUARANTINE</span>. The agent is
          isolated from the write path; its proposals no longer reach the fleet until cleared.{" "}
          <span className="font-mono text-slate-400">corr:{event.correlationId}</span>
        </p>
        <p className="text-[10px] text-slate-400">
          Synthetic signal. The divergence computation lives in the private plane and is not in this
          repo; the console consumes and renders the signal only.
        </p>
      </div>
    </section>
  );
}
