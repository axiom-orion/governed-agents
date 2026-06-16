// components/console/StatusChip.tsx
// Agent status as a single legible chip. Color carries meaning here, deliberately:
// green = healthy, amber = paused, red = quarantined. Same discipline as the gate's
// allow/block colors in the trace UI.

import type { AgentStatus } from "@/governance/types";

const STYLES: Readonly<Record<AgentStatus, { label: string; dot: string; box: string }>> = {
  ACTIVE: { label: "Active", dot: "bg-emerald-500", box: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  PAUSED: { label: "Paused", dot: "bg-amber-500", box: "bg-amber-50 text-amber-700 border-amber-200" },
  QUARANTINED: { label: "Quarantined", dot: "bg-red-500", box: "bg-red-50 text-red-700 border-red-300" },
};

export function StatusChip({ status }: { status: AgentStatus }) {
  const s = STYLES[status];
  return (
    <span
      className={"inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold " + s.box}
    >
      <span
        className={
          "inline-block h-1.5 w-1.5 rounded-full " +
          s.dot +
          (status === "QUARANTINED" ? " animate-pulse" : "")
        }
      />
      {s.label}
    </span>
  );
}
