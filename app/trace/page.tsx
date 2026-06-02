// app/trace/page.tsx
// P4 trace UI entry point. It lives at /trace (not /) so it does not clobber the
// P3 landing page while both pieces are built in parallel in the same repo. At
// P5 integration the team can promote this to the root route.

import { TraceViewer } from "@/components/TraceViewer";

export default function TracePage() {
  return <TraceViewer />;
}
