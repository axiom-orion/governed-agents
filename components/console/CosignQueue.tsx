// components/console/CosignQueue.tsx
// The load-bearing surface: REQUIRE_COSIGN-held actions awaiting a human. Renders each as
// a hold card; an empty queue is an honest "watching" state, not a blank panel.

import type { CosignRequest } from "@/governance/types";
import type { StreamConnection } from "@/lib/governance-stream";
import { CosignHoldCard } from "./CosignHoldCard";
import type { AuditRow } from "./CosignHoldCard";

interface CosignQueueProps {
  readonly holds: readonly CosignRequest[];
  readonly connection: StreamConnection;
  readonly onResolved: (
    holdId: string,
    status: "APPROVED" | "REJECTED" | "TIMEOUT",
    rows: readonly AuditRow[],
  ) => void;
}

export function CosignQueue({ holds, connection, onResolved }: CosignQueueProps) {
  return (
    <section aria-label="Cosign queue" className="flex flex-col gap-3">
      <header className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-slate-900">Cosign queue</h2>
        <span className="text-xs text-slate-400">{holds.length} held</span>
      </header>

      {holds.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center">
          <p className="text-sm font-medium text-slate-600">
            {connection === "error"
              ? "Lost the governance stream."
              : connection === "connecting"
                ? "Connecting to the governance stream…"
                : "Watching for held actions…"}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            When an agent proposes an action the policy can&rsquo;t auto-clear, it surfaces here with
            full context for a decision.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {holds.map((hold) => (
            <CosignHoldCard key={hold.id} hold={hold} onResolved={onResolved} />
          ))}
        </div>
      )}
    </section>
  );
}
