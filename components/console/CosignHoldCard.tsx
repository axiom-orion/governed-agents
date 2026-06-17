"use client";

// components/console/CosignHoldCard.tsx
// One held action awaiting a human. For a RECORD_MERGE it lays out both records and the
// distinguishing evidence; Approve and Reject carry equal weight (the tool must not nudge
// the call). Deciding routes through the decideCosign Server Action — the client never
// touches the adapter or any key — and the two audit rows it writes are surfaced inline,
// so the operator sees the decision land in the Truth Chain.

import { useState } from "react";
import { decideCosign } from "@/app/_actions/cosign";
import type { CosignRequest } from "@/governance/types";
import { RecordMergeView } from "./RecordMergeView";
import { TtlCountdown } from "./TtlCountdown";

export interface AuditRow {
  readonly eventType: string;
  readonly actor: string;
  readonly hash?: string;
  readonly ts: string;
  readonly note?: string;
}

interface Outcome {
  readonly status: "APPROVED" | "REJECTED" | "TIMEOUT" | "ERROR";
  readonly effect?: string;
  readonly reason?: string;
  readonly audit?: ReadonlyArray<{ readonly eventType: string; readonly hash: string; readonly ts: string }>;
}

interface CosignHoldCardProps {
  readonly hold: CosignRequest;
  readonly onResolved: (
    holdId: string,
    status: "APPROVED" | "REJECTED" | "TIMEOUT",
    rows: readonly AuditRow[],
  ) => void;
}

const FRAME: Readonly<Record<string, string>> = {
  PENDING: "border-l-amber-400",
  APPROVED: "border-l-emerald-400",
  REJECTED: "border-l-red-400",
  TIMEOUT: "border-l-slate-400",
  ERROR: "border-l-red-400",
};

export function CosignHoldCard({ hold, onResolved }: CosignHoldCardProps) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const frameKey = outcome ? outcome.status : "PENDING";
  const settled = outcome !== null && outcome.status !== "ERROR";

  const decide = async (decision: "APPROVE" | "REJECT"): Promise<void> => {
    if (busy || settled) return;
    setBusy(true);
    try {
      const res = await decideCosign({ requestId: hold.id, decision });
      if (res.result.ok) {
        const status = decision === "APPROVE" ? "APPROVED" : "REJECTED";
        setOutcome({ status, effect: res.result.effect, audit: res.audit });
        onResolved(
          hold.id,
          status,
          res.audit.map((r) => ({ eventType: r.eventType, actor: r.eventType === "COSIGN_DECISION" ? "human:operator" : "system", hash: r.hash, ts: r.ts })),
        );
      } else {
        setOutcome({ status: "ERROR", reason: res.result.reason });
      }
    } catch {
      setOutcome({ status: "ERROR", reason: "decision-failed" });
    } finally {
      setBusy(false);
    }
  };

  const onExpire = (): void => {
    if (outcome) return;
    setOutcome({
      status: "TIMEOUT",
      effect: "No decision inside the window — auto-rejected (fail-closed). The agent proceeds without merging.",
    });
    onResolved(hold.id, "TIMEOUT", [
      {
        eventType: "COSIGN_TIMEOUT",
        actor: "system:ttl-sweeper",
        ts: new Date().toISOString(),
        note: "recorded server-side by the TTL sweeper",
      },
    ]);
  };

  return (
    <article
      className={
        "rounded-lg border border-l-4 border-slate-200 bg-white p-4 shadow-sm transition-colors " +
        (FRAME[frameKey] ?? "border-l-slate-300")
      }
    >
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white">
              {hold.actionType}
            </span>
            <span className="font-mono text-xs text-slate-400">{hold.agentCarId}</span>
          </div>
          <p className="mt-1.5 text-sm text-slate-600">{hold.context}</p>
          <p className="mt-1 text-[11px] font-medium text-amber-700">{hold.trigger}</p>
        </div>
        <div className="w-40 shrink-0">
          <TtlCountdown
            createdAt={hold.createdAt}
            ttlExpiresAt={hold.ttlExpiresAt}
            active={!settled && outcome?.status !== "TIMEOUT"}
            onExpire={onExpire}
          />
        </div>
      </header>

      {hold.actionType === "RECORD_MERGE" ? (
        <RecordMergeView payload={hold.actionPayload} />
      ) : (
        <pre className="overflow-x-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          {JSON.stringify(hold.actionPayload, null, 2)}
        </pre>
      )}

      {outcome ? (
        <ResolvedBanner outcome={outcome} />
      ) : (
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => decide("REJECT")}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1 disabled:opacity-50"
          >
            <span aria-hidden="true">✕</span> Reject merge
          </button>
          <button
            type="button"
            onClick={() => decide("APPROVE")}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 disabled:opacity-50"
          >
            <span aria-hidden="true">✓</span> Approve merge
          </button>
          {busy ? <span className="text-xs text-slate-400">recording decision…</span> : null}
        </div>
      )}
    </article>
  );
}

function ResolvedBanner({ outcome }: { outcome: Outcome }) {
  if (outcome.status === "ERROR") {
    return (
      <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
        <p className="font-semibold">Decision not applied</p>
        <p className="mt-0.5 text-red-700">
          The adapter returned <code className="font-mono">{outcome.reason}</code>. Nothing was
          released — no fabricated approval against a missing target.
        </p>
      </div>
    );
  }
  const tone =
    outcome.status === "APPROVED"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : outcome.status === "TIMEOUT"
        ? "border-slate-200 bg-slate-50 text-slate-700"
        : "border-red-200 bg-red-50 text-red-800";
  const label =
    outcome.status === "APPROVED" ? "Approved" : outcome.status === "TIMEOUT" ? "Timed out — auto-rejected" : "Rejected";
  return (
    <div className={"mt-4 rounded-md border p-3 " + tone}>
      <p className="text-sm font-semibold uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-sm">{outcome.effect}</p>
      {outcome.audit && outcome.audit.length > 0 ? (
        <div className="mt-2 border-t border-current/10 pt-2">
          <p className="text-[11px] font-medium uppercase tracking-wide opacity-70">Truth Chain</p>
          <ul className="mt-1 space-y-0.5">
            {outcome.audit.map((row) => (
              <li key={row.hash} className="flex items-center gap-2 text-[11px]">
                <span className="font-semibold">{row.eventType}</span>
                <span className="font-mono opacity-70">{row.hash.slice(0, 16)}…</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
