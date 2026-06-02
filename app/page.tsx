// app/page.tsx
// P5: the interactive runner is promoted to the root route — a cold visitor lands here,
// runs the allowed and blocked tasks, and watches the agents coordinate while the
// governance gate allows one action and blocks the other. (Also reachable at /trace.)

import { TraceViewer } from "@/components/TraceViewer";

export default function HomePage() {
  return <TraceViewer />;
}
