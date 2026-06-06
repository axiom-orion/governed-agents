// components/panels/StepDetail.tsx
// The full, untruncated detail for the selected node. Graph cards clamp their text
// to two lines; clicking a node surfaces the complete summary, the proposed action
// (kind + justification + payload), and the executor result here. All text comes
// straight from the stream.

import type { ReactNode } from "react";
import type { ProposedAction } from "@/lib/governance";
import type { StepNodeData, TraceNode } from "@/lib/trace-model";

const ROLE_LABEL: Readonly<Record<string, string>> = {
  researcher: "Researcher",
  reasoner: "Reasoner",
  executor: "Executor",
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</h3>
      <div className="mt-1 text-sm leading-snug text-slate-700">{children}</div>
    </div>
  );
}

function ActionDetail({ action }: { action: ProposedAction }) {
  return (
    <div className="rounded-md border border-violet-200 bg-violet-50/60 p-3">
      <div className="flex items-center gap-2">
        <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
          proposed action
        </span>
        <code className="font-mono text-xs text-slate-700">{action.kind}</code>
      </div>
      <p className="mt-2 text-sm leading-snug text-slate-700">{action.justification}</p>
      {Object.keys(action.payload).length > 0 ? (
        <pre className="mt-2 overflow-x-auto rounded bg-white/70 p-2 text-[11px] leading-relaxed text-slate-600">
          {JSON.stringify(action.payload, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

export function StepDetail({
  selectedNode,
  step,
}: {
  selectedNode?: TraceNode;
  step?: StepNodeData;
}) {
  if (!selectedNode) {
    return (
      <section aria-label="Step detail" className="flex flex-col">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Step detail</h2>
        <p className="rounded-md border border-dashed border-slate-200 bg-white p-3 text-sm text-slate-400">
          Select a node in the graph to read its full detail.
        </p>
      </section>
    );
  }

  const roleLabel =
    step !== undefined
      ? (ROLE_LABEL[step.role] ?? step.role)
      : selectedNode.kind === "gate"
        ? "Gate"
        : "Halt";

  return (
    <section aria-label="Step detail" className="flex flex-col gap-3">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{roleLabel} detail</h2>
        <span className="font-mono text-xs text-slate-400">
          {step?.stepId ?? selectedNode.stepId}
        </span>
      </header>

      {selectedNode.kind === "halt" ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <span className="font-semibold">Halted:</span> {selectedNode.reason}
        </div>
      ) : null}

      {step?.summary ? <Field label="Summary">{step.summary}</Field> : null}
      {step?.proposedAction ? (
        <Field label="Action">
          <ActionDetail action={step.proposedAction} />
        </Field>
      ) : null}
      {step?.result ? <Field label="Result">{step.result}</Field> : null}

      {!step?.summary && !step?.proposedAction && !step?.result && selectedNode.kind !== "halt" ? (
        <p className="text-sm text-slate-400">In progress…</p>
      ) : null}
    </section>
  );
}
