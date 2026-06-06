"use client";

// components/GuidedWalkthrough.tsx
// The annotated "aha" narration for the blocked scenario. As the run streams in,
// each callout lights up and explicitly connects cause → effect, so a first-time
// visitor understands *why* the action was blocked without reading any docs.
// Every number it cites (source score, threshold, the violated rule) is read from
// the live trace model — nothing is hard-coded to a specific fixture.

import type { ReactNode } from "react";
import type { Provenance } from "@/lib/governance";
import type { TraceModel, TraceNode, StepNodeData, GateNodeData } from "@/lib/trace-model";

function stepByRole(model: TraceModel, role: StepNodeData["role"]): StepNodeData | undefined {
  return model.nodes.find((n): n is StepNodeData => n.kind === "step" && n.role === role);
}
function gateNode(model: TraceModel): GateNodeData | undefined {
  return model.nodes.find((n): n is GateNodeData => n.kind === "gate");
}
function haltNode(model: TraceModel): TraceNode | undefined {
  return model.nodes.find((n) => n.kind === "halt");
}

function topSource(provenance: readonly Provenance[]): Provenance | undefined {
  return provenance.reduce<Provenance | undefined>(
    (best, p) => (best === undefined || p.score > best.score ? p : best),
    undefined,
  );
}

type StepState = "pending" | "active" | "done";

interface Callout {
  readonly key: string;
  readonly title: string;
  readonly body: ReactNode;
}

export function GuidedWalkthrough({
  model,
  threshold,
  onExplore,
}: {
  model: TraceModel;
  threshold: number;
  onExplore: () => void;
}) {
  const researcher = stepByRole(model, "researcher");
  const reasoner = stepByRole(model, "reasoner");
  const gate = gateNode(model);
  const halt = haltNode(model);

  const gatedProvenance =
    reasoner?.proposedAction?.provenance ?? reasoner?.provenance ?? researcher?.provenance ?? [];
  const best = topSource(gatedProvenance.length > 0 ? gatedProvenance : researcher?.provenance ?? []);
  const action = reasoner?.proposedAction;
  const violation = gate?.decision.violations[0];
  const blocked = gate?.decision.decision === "block" || halt !== undefined;
  const allowed = gate?.decision.decision === "allow";

  // Progress: how many callouts have been "reached" by the stream so far.
  const reached = halt
    ? 4
    : gate
      ? 3
      : action
        ? 2
        : researcher?.provenance && researcher.provenance.length > 0
          ? 1
          : model.task
            ? 0
            : -1;

  const thr = threshold.toFixed(2);
  const bestScore = best ? best.score.toFixed(2) : "—";

  const callouts: Callout[] = [
    {
      key: "task",
      title: "1 · The agent gets a risky task",
      body: model.task ? (
        <>
          It was asked to{" "}
          <span className="font-medium text-slate-800">&ldquo;{model.task}&rdquo;</span> — an
          outbound action with real consequences.
        </>
      ) : (
        "Waiting for the run to start…"
      ),
    },
    {
      key: "sources",
      title: "2 · The evidence is weak",
      body: best ? (
        <>
          Retrieval&rsquo;s strongest supporting source is{" "}
          <code className="font-mono text-xs text-slate-600">{best.sourceId}</code> at only{" "}
          <span className="font-semibold text-amber-700">{bestScore}</span> confidence
          {best.snippet ? (
            <> — &ldquo;{best.snippet}&rdquo;</>
          ) : (
            "."
          )}
        </>
      ) : (
        "Retrieving sources…"
      ),
    },
    {
      key: "propose",
      title: "3 · The agent proposes it anyway",
      body: action ? (
        <>
          The Reasoner still drafted a{" "}
          <code className="font-mono text-xs text-slate-600">{action.kind}</code>. Agents propose
          actions; they don&rsquo;t police themselves — that&rsquo;s the gate&rsquo;s job.
        </>
      ) : (
        "Reasoning over the task…"
      ),
    },
    {
      key: "gate",
      title: "4 · The gate checks policy first",
      body: violation ? (
        <>
          Rule <code className="font-mono text-xs text-red-700">{violation.rule}</code> requires a
          source scoring <span className="font-semibold">≥ {thr}</span> for an external send. The
          best available is <span className="font-semibold text-amber-700">{bestScore}</span> —{" "}
          <span className="font-semibold">below the bar.</span>
        </>
      ) : gate ? (
        <>The gate evaluated the proposed action against the active policy.</>
      ) : (
        "Awaiting the gate decision…"
      ),
    },
    {
      key: "aha",
      title: blocked ? "✕ Blocked — nothing was sent" : allowed ? "✓ Allowed" : "5 · The outcome",
      body: blocked ? (
        <>
          The run <span className="font-semibold text-red-700">halted before the email left the
          system.</span> No irreversible action happened — and the whole decision, with its reason
          and sources, is on the trace to the left for audit.
        </>
      ) : allowed ? (
        <>This action cleared every policy, so the executor ran it.</>
      ) : (
        "…"
      ),
    },
  ];

  return (
    <section aria-label="Guided walkthrough" className="flex min-h-0 flex-col">
      <header className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Guided walkthrough</h2>
          <p className="text-xs text-slate-500">Why this action was blocked, step by step.</p>
        </div>
        <button
          type="button"
          onClick={onExplore}
          className="shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          Explore freely →
        </button>
      </header>

      <ol className="flex flex-col gap-2.5">
        {callouts.map((c, i) => {
          const state: StepState = i < reached ? "done" : i === reached ? "active" : "pending";
          const isAha = c.key === "aha";
          return (
            <li
              key={c.key}
              aria-current={state === "active" ? "step" : undefined}
              className={[
                "rounded-lg border px-3 py-2.5 transition-all",
                isAha && blocked && state !== "pending"
                  ? "border-red-300 bg-red-50"
                  : isAha && allowed && state !== "pending"
                    ? "border-emerald-300 bg-emerald-50"
                    : state === "active"
                      ? "border-blue-300 bg-blue-50 shadow-sm"
                      : state === "done"
                        ? "border-slate-200 bg-white"
                        : "border-dashed border-slate-200 bg-white opacity-55",
              ].join(" ")}
            >
              <p
                className={[
                  "text-xs font-semibold uppercase tracking-wide",
                  isAha && blocked && state !== "pending"
                    ? "text-red-700"
                    : isAha && allowed && state !== "pending"
                      ? "text-emerald-700"
                      : state === "pending"
                        ? "text-slate-400"
                        : "text-slate-700",
                ].join(" ")}
              >
                {c.title}
              </p>
              <p className="mt-1 text-sm leading-snug text-slate-600">{c.body}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
