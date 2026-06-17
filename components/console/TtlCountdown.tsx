"use client";

// components/console/TtlCountdown.tsx
// The signature element: a hold's time-to-live, drawn as a bar that drains toward a red
// DENY end. This is fail-closed made visible — if the bar empties before a human acts, the
// action is auto-rejected. The countdown is the whole posture in one control.

import { useEffect, useState } from "react";

interface TtlCountdownProps {
  readonly createdAt: string;
  readonly ttlExpiresAt: string;
  readonly active: boolean; // false once decided/timed out — freeze the bar
  readonly onExpire?: () => void;
}

function fmt(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function TtlCountdown({ createdAt, ttlExpiresAt, active, onExpire }: TtlCountdownProps) {
  const start = new Date(createdAt).getTime();
  const end = new Date(ttlExpiresAt).getTime();
  const span = Math.max(1, end - start);
  const [now, setNow] = useState<number>(() => Date.now());
  const [fired, setFired] = useState(false);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  const remaining = Math.max(0, end - now);
  const fraction = Math.max(0, Math.min(1, remaining / span));
  const expired = remaining <= 0;

  useEffect(() => {
    if (active && expired && !fired) {
      setFired(true);
      onExpire?.();
    }
  }, [active, expired, fired, onExpire]);

  // The fill drains left→right toward the red DENY end. Tint shifts as it empties.
  const fillColor = fraction > 0.5 ? "bg-emerald-400" : fraction > 0.2 ? "bg-amber-400" : "bg-red-400";

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="font-medium uppercase tracking-wide text-slate-500">
          {active ? "Time to auto-reject (fail-closed)" : "Window closed"}
        </span>
        <span className={"font-mono font-semibold " + (active && fraction <= 0.2 ? "text-red-600" : "text-slate-600")}>
          {active ? fmt(remaining) : "—"}
        </span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        {/* a thin red "DENY" zone the bar drains into */}
        <div className="absolute inset-y-0 right-0 w-[8%] bg-red-100" />
        <div
          className={"h-full rounded-full transition-[width] duration-1000 ease-linear " + (active ? fillColor : "bg-slate-300")}
          style={{ width: `${active ? fraction * 100 : 0}%` }}
        />
      </div>
    </div>
  );
}
