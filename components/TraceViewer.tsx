"use client";

// components/TraceViewer.tsx
// Wires the trace stream to the canvas and the two inspector panels.
// P5 integration: the run buttons drive the LIVE streaming route (POST /api/run).
// A "Sample" mode still replays the hard-coded runs through the real NDJSON parser
// (chunked + mid-line split, optionally with malformed lines injected to show they
// are skipped) — useful offline and for demoing resilience.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTraceStream } from "@/lib/useTraceStream";
import type { TraceStreamSource } from "@/lib/useTraceStream";
import { Hero } from "@/components/Hero";
import { GuidedWalkthrough } from "@/components/GuidedWalkthrough";
import {
  buildTraceStream,
  INJECTED_MALFORMED_COUNT,
  sampleRuns,
  toNdjson,
  withMalformedLines,
} from "@/mocks/trace.sample";
import type { SampleRunId } from "@/mocks/trace.sample";
import {
  defaultSelectedId,
  gateForNode,
  provenanceForNode,
  stepForNode,
} from "@/lib/trace-model";
import type {
  GateNodeData,
  RunStatus,
  StepNodeData,
  TraceModel,
} from "@/lib/trace-model";
import { replayWithPolicy } from "@/lib/policy-replay";
import {
  DEFAULT_CONSENSUS_THRESHOLD,
  DEFAULT_SEND_THRESHOLD,
  type Decision,
} from "@/lib/governance";
import { TraceCanvas } from "@/components/TraceCanvas";
import { ProvenancePanel } from "@/components/panels/ProvenancePanel";
import { GateDecision } from "@/components/panels/GateDecision";
import { PoliciesPanel } from "@/components/panels/PoliciesPanel";
import { ConsensusPanel } from "@/components/panels/ConsensusPanel";
import { OversightPanel } from "@/components/panels/OversightPanel";
import { StepDetail } from "@/components/panels/StepDetail";
import { RawTraceDrawer } from "@/components/RawTraceDrawer";

const REPO_URL = "https://github.com/axiom-orion/governed-agents";
const ARCH_DOC_URL = `${REPO_URL}/blob/main/docs/ARCHITECTURE.md`;

type DataMode = "live" | "sample";

const keyOf = (mode: DataMode, runId: SampleRunId): string => `${mode}:${runId}`;

interface Scenario {
  readonly id: SampleRunId;
  readonly label: string;
  /** Seed task the live route understands; absent ⇒ recorded-only (Sample). */
  readonly liveTaskId?: string;
  readonly outcome: Decision;
  readonly tag: string;
}

// The scenario picker — a spread of governance behaviors so the system reads as a
// framework, not a one-trick demo. The first two have real Live backing (seed
// tasks); the rest are recorded demonstrations of policy types the loop can't
// produce deterministically offline (PII content, the third decision state).
const SCENARIOS: readonly Scenario[] = [
  {
    id: "allow",
    label: "Allowed — well-sourced internal record",
    liveTaskId: "allowed",
    outcome: "allow",
    tag: "confidence ok",
  },
  {
    id: "block",
    label: "Blocked — unverified external send",
    liveTaskId: "blocked",
    outcome: "block",
    tag: "confidence threshold",
  },
  { id: "pii", label: "Blocked — PII in an external email", outcome: "block", tag: "PII leak" },
  {
    id: "approval",
    label: "Needs approval — irreversible delete",
    outcome: "needs_approval",
    tag: "human approval",
  },
  {
    id: "approved",
    label: "Allowed — delete with approval attached",
    outcome: "allow",
    tag: "approval cleared",
  },
  {
    id: "consensus",
    label: "Allowed — model triad agrees",
    outcome: "allow",
    tag: "model consensus",
  },
  {
    id: "split",
    label: "Needs approval — model triad splits",
    outcome: "needs_approval",
    tag: "model consensus",
  },
  {
    id: "echo",
    label: "Needs approval — unanimous, but one voice echoed",
    outcome: "needs_approval",
    tag: "attested independence",
  },
  {
    id: "redcell",
    label: "Needs approval — the Red Cell objects",
    outcome: "needs_approval",
    tag: "adversarial oversight",
  },
];

function scenarioById(id: SampleRunId): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0]!;
}

const OUTCOME_BADGE: Readonly<Record<Decision, { label: string; className: string }>> = {
  allow: { label: "✓ allow", className: "bg-emerald-100 text-emerald-700" },
  block: { label: "✕ block", className: "bg-red-100 text-red-700" },
  needs_approval: { label: "⏸ review", className: "bg-amber-100 text-amber-800" },
};

const STATUS_STYLES: Readonly<Record<RunStatus, { label: string; className: string }>> = {
  idle: { label: "Idle", className: "bg-slate-100 text-slate-600" },
  running: { label: "Running", className: "bg-blue-100 text-blue-700" },
  completed: { label: "Completed", className: "bg-emerald-100 text-emerald-700" },
  halted: { label: "Halted", className: "bg-red-100 text-red-700" },
  awaiting: { label: "Awaiting approval", className: "bg-amber-100 text-amber-800" },
  error: { label: "Error", className: "bg-red-100 text-red-700" },
};

const ROLE_LABEL: Readonly<Record<string, string>> = {
  researcher: "Researcher",
  reasoner: "Reasoner",
  executor: "Executor",
};

function selectedContextLabel(model: TraceModel, id: string | null): string | undefined {
  if (id === null) return undefined;
  const node = model.nodes.find((n) => n.id === id);
  if (!node) return undefined;
  if (node.kind === "step") return `${ROLE_LABEL[node.role] ?? node.role} · ${node.stepId}`;
  if (node.kind === "gate") return `Gate · ${node.stepId}`;
  if (node.kind === "approval") return `Approval · ${node.stepId}`;
  return `Halt · ${node.stepId}`;
}

export function TraceViewer() {
  const [mode, setMode] = useState<DataMode>("live");
  const [runId, setRunId] = useState<SampleRunId>("allow");
  const [started, setStarted] = useState(false);
  const [injectNoise, setInjectNoise] = useState(true);
  const [replayNonce, setReplayNonce] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [guided, setGuided] = useState(false);
  // Editable policy: `sendThreshold` is what the slider shows; `appliedThreshold`
  // is what the currently-playing run actually used. They diverge while editing
  // and re-converge on re-run, so the UI can prompt "re-run to apply".
  const [sendThreshold, setSendThreshold] = useState(DEFAULT_SEND_THRESHOLD);
  const [appliedThreshold, setAppliedThreshold] = useState(DEFAULT_SEND_THRESHOLD);
  const [consensusThreshold, setConsensusThreshold] = useState(DEFAULT_CONSENSUS_THRESHOLD);
  const [appliedConsensusThreshold, setAppliedConsensusThreshold] =
    useState(DEFAULT_CONSENSUS_THRESHOLD);
  const toolRef = useRef<HTMLElement>(null);
  // Decision-flip tracking: the last decision recorded per scenario, and the
  // baseline captured at the moment a re-run starts (so we can show BLOCK → ALLOW).
  const lastDecisionRef = useRef<Record<string, Decision>>({});
  const baselineRef = useRef<Decision | undefined>(undefined);

  // Pre-warm the serverless function on mount with a cheap GET so the reviewer's
  // first Live click hits a warm lambda. Fire-and-forget; failures are harmless.
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/run", { method: "GET", signal: controller.signal }).catch(() => {});
    return () => controller.abort();
  }, []);

  const scrollToTool = (): void => {
    requestAnimationFrame(() => toolRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const source = useMemo<TraceStreamSource | null>(() => {
    if (!started) return null;
    // `replayNonce` participates so "Replay" rebuilds a fresh single-use stream.
    void replayNonce;
    const scenario = SCENARIOS.find((s) => s.id === runId);
    if (mode === "live" && scenario?.liveTaskId) {
      return {
        kind: "url",
        url: "/api/run",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          // The edited policy flows to the real backend, so a Live re-run flips too.
          body: JSON.stringify({
            taskId: scenario.liveTaskId,
            policy: {
              externalSendThreshold: appliedThreshold,
              consensusThreshold: appliedConsensusThreshold,
            },
          }),
        },
      };
    }
    // Sample: recompute the gate over the recorded action under the active policy,
    // so the decision is real (not the fixture's baked-in one) and flips on edit.
    const events = replayWithPolicy(sampleRuns[runId], {
      externalSendThreshold: appliedThreshold,
      consensusThreshold: appliedConsensusThreshold,
    });
    const ndjson = injectNoise ? withMalformedLines(toNdjson(events)) : toNdjson(events);
    return {
      kind: "stream",
      open: () => buildTraceStream(ndjson, { chunkSize: 256, delayMs: 60 }),
    };
  }, [started, mode, runId, injectNoise, replayNonce, appliedThreshold, appliedConsensusThreshold]);

  const { model, events, malformedCount, connection, warmupAttempt, streamError } =
    useTraceStream(source);

  // Prefer the user's selection when it still exists in the current run;
  // otherwise fall back to the most informative node (the gate).
  const effectiveSelectedId = useMemo<string | null>(() => {
    if (selectedId && model.nodes.some((n) => n.id === selectedId)) return selectedId;
    return defaultSelectedId(model);
  }, [selectedId, model]);

  const sources = useMemo(
    () => provenanceForNode(model, effectiveSelectedId),
    [model, effectiveSelectedId],
  );
  const gate = useMemo(() => gateForNode(model, effectiveSelectedId), [model, effectiveSelectedId]);
  const contextLabel = selectedContextLabel(model, effectiveSelectedId);
  const selectedNode = useMemo(
    () => model.nodes.find((n) => n.id === effectiveSelectedId),
    [model, effectiveSelectedId],
  );
  const detailStep = useMemo(
    () => stepForNode(model, effectiveSelectedId),
    [model, effectiveSelectedId],
  );

  const status = STATUS_STYLES[model.status];
  const selectedScenario = scenarioById(runId);
  const liveAvailable = selectedScenario.liveTaskId !== undefined;
  const selectedBadge = OUTCOME_BADGE[selectedScenario.outcome];

  // The current run's gate decision + the action it gated (for the Policies panel).
  const currentDecision = useMemo<Decision | undefined>(() => {
    const node = model.nodes.find((n): n is GateNodeData => n.kind === "gate");
    return node?.decision.decision;
  }, [model]);

  const gatedAction = useMemo(() => {
    const reasoner = model.nodes.find(
      (n): n is StepNodeData => n.kind === "step" && n.role === "reasoner",
    );
    return reasoner?.proposedAction;
  }, [model]);

  const sendRuleApplies = gatedAction?.kind === "send_email";
  const bestSendScore = useMemo<number | undefined>(() => {
    const provenance = gatedAction?.provenance ?? [];
    return provenance.length > 0 ? Math.max(...provenance.map((p) => p.score)) : undefined;
  }, [gatedAction]);

  // Consensus from the gated action (present on triad runs + the recorded scenarios).
  const gatedConsensus = gatedAction?.consensus;
  const consensusApplies =
    (gatedConsensus?.votes.filter((v) => v.abstained !== true).length ?? 0) >= 2;
  const currentAgreement = gatedConsensus?.agreementRatio;

  // Record the decision for this scenario so the next re-run can compare against it.
  useEffect(() => {
    if (currentDecision) lastDecisionRef.current[keyOf(mode, runId)] = currentDecision;
  }, [currentDecision, mode, runId]);

  // Flip = the baseline captured at re-run time differs from the current decision.
  const flip = useMemo<{ from: Decision; to: Decision } | null>(() => {
    const from = baselineRef.current;
    if (from && currentDecision && from !== currentDecision) return { from, to: currentDecision };
    return null;
  }, [currentDecision]);

  const dirty =
    Math.abs(sendThreshold - appliedThreshold) > 1e-9 ||
    Math.abs(consensusThreshold - appliedConsensusThreshold) > 1e-9;

  // Start a run, snapshotting the scenario's previous decision as the flip baseline.
  const startRun = (
    nextMode: DataMode,
    id: SampleRunId,
    sendT: number,
    consT: number,
  ): void => {
    baselineRef.current = lastDecisionRef.current[keyOf(nextMode, id)];
    setMode(nextMode);
    setRunId(id);
    setSendThreshold(sendT);
    setAppliedThreshold(sendT);
    setConsensusThreshold(consT);
    setAppliedConsensusThreshold(consT);
    setStarted(true);
    setReplayNonce((n) => n + 1);
  };

  // Pick a scenario without running it; recorded-only scenarios force Sample mode.
  const selectScenario = (id: SampleRunId): void => {
    setRunId(id);
    if (scenarioById(id).liveTaskId === undefined) setMode("sample");
  };

  // Run the selected scenario in the current mode.
  const runScenario = (id: SampleRunId): void => {
    startRun(mode, id, appliedThreshold, appliedConsensusThreshold); // keep the active policy
    setGuided(false); // manual runs drop into the raw tool
  };

  // Apply the edited thresholds and re-run the current scenario.
  const rerunWithPolicy = (): void => {
    baselineRef.current = lastDecisionRef.current[keyOf(mode, runId)];
    setAppliedThreshold(sendThreshold);
    setAppliedConsensusThreshold(consensusThreshold);
    setStarted(true);
    setReplayNonce((n) => n + 1);
  };

  const resetPolicy = (): void => {
    baselineRef.current = lastDecisionRef.current[keyOf(mode, runId)];
    setSendThreshold(DEFAULT_SEND_THRESHOLD);
    setAppliedThreshold(DEFAULT_SEND_THRESHOLD);
    setConsensusThreshold(DEFAULT_CONSENSUS_THRESHOLD);
    setAppliedConsensusThreshold(DEFAULT_CONSENSUS_THRESHOLD);
    setStarted(true);
    setReplayNonce((n) => n + 1);
  };

  // Hero CTA: Sample + the blocked task at the DEFAULT thresholds (so it really
  // blocks), guided narration on, then bring the tool into view.
  const watchBlocked = (): void => {
    startRun("sample", "block", DEFAULT_SEND_THRESHOLD, DEFAULT_CONSENSUS_THRESHOLD);
    setGuided(true);
    scrollToTool();
  };

  // Hero secondary: drop straight into the raw tool, no narration.
  const exploreFreely = (): void => {
    setGuided(false);
    scrollToTool();
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <Hero onWatchBlock={watchBlocked} onExplore={exploreFreely} />
      <section ref={toolRef} className="flex flex-col lg:h-[92vh] lg:min-h-[620px]">
      <header className="border-b border-slate-200 bg-white px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold text-slate-900">
              Governed Agents · Run Trace
            </h1>
            <p className="mt-0.5 max-w-2xl text-sm text-slate-500">
              Every action an agent proposes is checked against an explicit policy before it runs.
              This view is rendered entirely from the run&rsquo;s trace event stream.
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
              <span className="font-mono">
                Next.js · server-side agent loop · streaming NDJSON trace · policy gate before execution
              </span>
              <a
                href={ARCH_DOC_URL}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-blue-600 underline-offset-2 hover:underline"
              >
                Architecture &amp; schema →
              </a>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-blue-600 underline-offset-2 hover:underline"
              >
                Repo →
              </a>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="inline-flex overflow-hidden rounded-md border border-slate-300"
              role="group"
              aria-label="Data source"
            >
              {(["live", "sample"] as const).map((m) => {
                const active = m === mode;
                const disabled = m === "live" && !liveAvailable;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    aria-pressed={active}
                    disabled={disabled}
                    title={
                      disabled
                        ? "This scenario is a recorded demonstration — Sample only"
                        : m === "live"
                          ? "Stream from POST /api/run"
                          : "Replay a recorded sample run"
                    }
                    className={
                      "px-3 py-1.5 text-sm font-medium transition-colors " +
                      (active
                        ? "bg-slate-900 text-white"
                        : "bg-white text-slate-600 hover:bg-slate-50") +
                      (disabled ? " cursor-not-allowed opacity-40" : "")
                    }
                  >
                    {m === "live" ? "Live" : "Sample"}
                  </button>
                );
              })}
            </div>
            <label htmlFor="scenario-picker" className="sr-only">
              Scenario
            </label>
            <select
              id="scenario-picker"
              value={runId}
              onChange={(e) => selectScenario(e.target.value as SampleRunId)}
              className="max-w-[16rem] rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700"
            >
              {SCENARIOS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <span
              className={"rounded-full px-2 py-0.5 text-[11px] font-semibold " + selectedBadge.className}
              title={`policy type: ${selectedScenario.tag}`}
            >
              {selectedBadge.label}
            </span>
            <button
              type="button"
              onClick={() => runScenario(runId)}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
            >
              <span aria-hidden="true">▶</span> Run
            </button>
            <button
              type="button"
              onClick={() => setReplayNonce((n) => n + 1)}
              disabled={!started}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Replay
            </button>
            <button
              type="button"
              onClick={() => setShowRaw(true)}
              disabled={events.length === 0}
              title="Inspect the raw streamed TraceEvents (NDJSON)"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              View raw trace{events.length > 0 ? ` (${events.length})` : ""}
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <span
            className={"rounded-full px-2 py-0.5 font-semibold " + status.className}
            aria-label={`run status: ${status.label}`}
          >
            {status.label}
          </span>
          {connection === "connecting" ? (
            <span className="text-slate-500">connecting…</span>
          ) : null}
          {connection === "warming" ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800"
              role="status"
            >
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
              Warming up the agent…{warmupAttempt > 1 ? ` (retry ${warmupAttempt})` : ""}
            </span>
          ) : null}
          {connection === "streaming" ? (
            <span className="inline-flex items-center gap-1.5 text-slate-500">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
              streaming
            </span>
          ) : null}
          {mode === "live" && !started ? (
            <span className="text-slate-400">
              Live calls a Claude model server-side and may cold-start on the first run; Sample is
              instant.
            </span>
          ) : null}
          {!liveAvailable ? (
            <span className="text-slate-400">Recorded scenario — Sample only.</span>
          ) : null}
          {model.task ? (
            <span className="text-slate-500">
              <span className="text-slate-400">Task:</span> {model.task}
            </span>
          ) : null}
          {model.runId ? (
            <span className="font-mono text-slate-400">{model.runId}</span>
          ) : null}
          {mode === "sample" ? (
            <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-slate-500">
              <input
                type="checkbox"
                checked={injectNoise}
                onChange={(e) => setInjectNoise(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300"
              />
              Inject malformed lines
            </label>
          ) : null}
          {mode === "sample" && injectNoise ? (
            <span className="text-amber-700" role="status">
              Skipped {malformedCount} of {INJECTED_MALFORMED_COUNT} malformed line
              {malformedCount === 1 ? "" : "s"}
            </span>
          ) : null}
          {model.status === "error" && streamError ? (
            <span className="text-red-700">Stream error: {streamError}</span>
          ) : null}
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative h-[55vh] w-full shrink-0 border-b border-slate-200 lg:h-full lg:flex-1 lg:shrink lg:border-b-0 lg:border-r lg:border-slate-200">
          <TraceCanvas model={model} selectedId={effectiveSelectedId} onSelect={setSelectedId} />
          {!started ? (
            <div className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center">
              <p className="max-w-sm text-sm text-slate-400">
                {mode === "live"
                  ? "Run a task to watch the three agents coordinate and the governance gate allow or block the proposed action — streamed live from /api/run."
                  : "Run a sample task to replay a recorded trace through the live NDJSON parser."}
              </p>
            </div>
          ) : null}
        </div>
        <aside className="flex flex-1 flex-col gap-5 bg-white p-5 lg:min-h-0 lg:flex-none lg:basis-[380px] lg:overflow-y-auto">
          {guided ? (
            <GuidedWalkthrough model={model} threshold={appliedThreshold} onExplore={exploreFreely} />
          ) : (
            <>
              <StepDetail selectedNode={selectedNode} step={detailStep} />
              <div className="border-t border-slate-100" />
              <GateDecision gate={gate} />
              {gatedConsensus ? (
                <>
                  <div className="border-t border-slate-100" />
                  <ConsensusPanel
                    consensus={gatedConsensus}
                    threshold={appliedConsensusThreshold}
                  />
                </>
              ) : null}
              {gatedAction?.redCell ? (
                <>
                  <div className="border-t border-slate-100" />
                  <OversightPanel action={gatedAction} />
                </>
              ) : null}
              <div className="border-t border-slate-100" />
              <ProvenancePanel
                sources={sources}
                contextLabel={contextLabel}
                threshold={appliedThreshold}
                showThreshold={sendRuleApplies}
              />
              <div className="border-t border-slate-100" />
              <PoliciesPanel
                threshold={sendThreshold}
                appliedThreshold={appliedThreshold}
                defaultThreshold={DEFAULT_SEND_THRESHOLD}
                consensusThreshold={consensusThreshold}
                defaultConsensusThreshold={DEFAULT_CONSENSUS_THRESHOLD}
                onConsensusChange={setConsensusThreshold}
                consensusApplies={consensusApplies}
                currentAgreement={currentAgreement}
                dirty={dirty}
                onThresholdChange={setSendThreshold}
                onRerun={rerunWithPolicy}
                onReset={resetPolicy}
                flip={flip}
                sendRuleApplies={sendRuleApplies}
                bestSendScore={bestSendScore}
              />
            </>
          )}
        </aside>
      </main>
      </section>

      <RawTraceDrawer events={events} open={showRaw} onClose={() => setShowRaw(false)} />
    </div>
  );
}
