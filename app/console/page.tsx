// app/console/page.tsx
// The intervention console route. A React Server Component does the first read — fleet
// snapshot + any already-pending holds — straight from the governance source on the server,
// then hands off to the client console which subscribes to the realtime stream for live
// arrivals and drives the decision write path. Keeping the first paint in an RSC keeps the
// client bundle small and the data fetch off the browser.

import type { Metadata } from "next";
import { getSource } from "@/governance/registry";
import { ConsoleClient } from "@/components/console/ConsoleClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Cosign — Intervention Console",
  description:
    "Runtime human-in-the-loop control surface for the genealogy fleet: a cosign queue for held actions, a read-only fleet view, and drift → quarantine — rendered from a governance event stream.",
};

export default async function ConsolePage() {
  const source = getSource();
  const [fleet, holds] = await Promise.all([source.getFleet(), source.listPendingHolds()]);
  return <ConsoleClient initialFleet={fleet} initialHolds={holds} />;
}
