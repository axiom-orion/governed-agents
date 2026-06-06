// lib/trace-model.ts
// Pure projection of a TraceEvent stream into a render model: one node per
// step, a node per gate decision, a node per halt, and handoff edges in the
// order events first appear. No React, no policy logic, no fabricated values —
// every field on the model traces directly to an event in the stream.

import type { AgentRole, Provenance, PolicyDecision, ProposedAction } from "./governance";
import type { TraceEvent } from "./trace-events";

export type RunStatus = "idle" | "running" | "completed" | "halted" | "error";

export interface StepNodeData {
  readonly kind: "step";
  readonly id: string; // node id, e.g. "step:s1"
  readonly stepId: string;
  readonly role: AgentRole;
  readonly summary?: string; // from step_completed
  readonly provenance: readonly Provenance[]; // from step_completed
  readonly proposedAction?: ProposedAction; // from action_proposed
  readonly result?: string; // from executed
  readonly startedAt?: string;
  readonly completedAt?: string;
}

export interface GateNodeData {
  readonly kind: "gate";
  readonly id: string; // e.g. "gate:s2"
  readonly stepId: string; // the step whose proposed action was gated
  readonly decision: PolicyDecision;
  readonly at: string;
}

export interface HaltNodeData {
  readonly kind: "halt";
  readonly id: string; // e.g. "halt:s2"
  readonly stepId: string;
  readonly reason: string;
  readonly at: string;
}

export type TraceNode = StepNodeData | GateNodeData | HaltNodeData;

export interface TraceEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
}

export interface TraceModel {
  readonly runId?: string;
  readonly task?: string;
  readonly status: RunStatus;
  readonly error?: string;
  readonly nodes: readonly TraceNode[];
  readonly edges: readonly TraceEdge[];
}

export const EMPTY_TRACE_MODEL: TraceModel = {
  status: "idle",
  nodes: [],
  edges: [],
};

// Mutable accumulator used only inside the fold.
interface StepAccum {
  stepId: string;
  role: AgentRole;
  summary?: string;
  provenance: readonly Provenance[];
  proposedAction?: ProposedAction;
  result?: string;
  startedAt?: string;
  completedAt?: string;
}

const stepNodeId = (stepId: string): string => `step:${stepId}`;
const gateNodeId = (stepId: string): string => `gate:${stepId}`;
const haltNodeId = (stepId: string): string => `halt:${stepId}`;

export function projectTrace(events: readonly TraceEvent[]): TraceModel {
  let runId: string | undefined;
  let task: string | undefined;
  let status: RunStatus = events.length === 0 ? "idle" : "running";
  let error: string | undefined;

  const order: string[] = []; // node ids in first-seen (handoff) order
  const stepAccum = new Map<string, StepAccum>();
  const gateById = new Map<string, GateNodeData>();
  const haltById = new Map<string, HaltNodeData>();
  // action_proposed / executed can (in a partial stream) arrive before the
  // step that carries their role; hold them until the step node exists.
  const pendingAction = new Map<string, ProposedAction>();
  const pendingResult = new Map<string, string>();

  const ensureStep = (stepId: string, role: AgentRole): StepAccum => {
    const id = stepNodeId(stepId);
    const existing = stepAccum.get(id);
    if (existing) return existing;
    const created: StepAccum = { stepId, role, provenance: [] };
    const heldAction = pendingAction.get(stepId);
    if (heldAction) {
      created.proposedAction = heldAction;
      pendingAction.delete(stepId);
    }
    const heldResult = pendingResult.get(stepId);
    if (heldResult !== undefined) {
      created.result = heldResult;
      pendingResult.delete(stepId);
    }
    stepAccum.set(id, created);
    order.push(id);
    return created;
  };

  for (const event of events) {
    switch (event.type) {
      case "run_started":
        runId = event.runId;
        task = event.task;
        status = "running";
        break;
      case "step_started": {
        const step = ensureStep(event.stepId, event.role);
        step.startedAt = event.at;
        break;
      }
      case "step_completed": {
        const step = ensureStep(event.stepId, event.role);
        step.role = event.role;
        step.summary = event.summary;
        step.provenance = event.provenance;
        step.completedAt = event.at;
        break;
      }
      case "action_proposed": {
        const step = stepAccum.get(stepNodeId(event.stepId));
        if (step) step.proposedAction = event.action;
        else pendingAction.set(event.stepId, event.action);
        break;
      }
      case "gate_decision": {
        const id = gateNodeId(event.stepId);
        if (!gateById.has(id)) {
          gateById.set(id, {
            kind: "gate",
            id,
            stepId: event.stepId,
            decision: event.decision,
            at: event.at,
          });
          order.push(id);
        }
        break;
      }
      case "executed": {
        const step = stepAccum.get(stepNodeId(event.stepId));
        if (step) step.result = event.result;
        else pendingResult.set(event.stepId, event.result);
        break;
      }
      case "halted": {
        const id = haltNodeId(event.stepId);
        if (!haltById.has(id)) {
          haltById.set(id, {
            kind: "halt",
            id,
            stepId: event.stepId,
            reason: event.reason,
            at: event.at,
          });
          order.push(id);
        }
        status = "halted";
        break;
      }
      case "run_completed":
        status = status === "halted" ? "halted" : "completed";
        break;
      case "error":
        status = "error";
        error = event.message;
        break;
      default: {
        // Exhaustiveness: every TraceEvent variant is handled above.
        const unreachable: never = event;
        return unreachable;
      }
    }
  }

  const nodes: TraceNode[] = order.flatMap<TraceNode>((id) => {
    const step = stepAccum.get(id);
    if (step) {
      const data: StepNodeData = {
        kind: "step",
        id,
        stepId: step.stepId,
        role: step.role,
        summary: step.summary,
        provenance: step.provenance,
        proposedAction: step.proposedAction,
        result: step.result,
        startedAt: step.startedAt,
        completedAt: step.completedAt,
      };
      return [data];
    }
    const gate = gateById.get(id);
    if (gate) return [gate];
    const halt = haltById.get(id);
    if (halt) return [halt];
    return [];
  });

  const edges: TraceEdge[] = [];
  for (let i = 0; i + 1 < nodes.length; i += 1) {
    const source = nodes[i];
    const target = nodes[i + 1];
    if (source && target) {
      edges.push({ id: `${source.id}->${target.id}`, source: source.id, target: target.id });
    }
  }

  return { runId, task, status, error, nodes, edges };
}

// --- selection helpers (used by the panels; pure) --------------------------

function findStepByStepId(model: TraceModel, stepId: string): StepNodeData | undefined {
  return model.nodes.find(
    (n): n is StepNodeData => n.kind === "step" && n.stepId === stepId,
  );
}

/** Sources to show for the selected node. Prefer the gated action's
 * provenance when present, otherwise the step's own provenance. */
export function provenanceForNode(
  model: TraceModel,
  nodeId: string | null,
): readonly Provenance[] {
  if (nodeId === null) return [];
  const node = model.nodes.find((n) => n.id === nodeId);
  if (!node) return [];
  if (node.kind === "step") {
    if (node.proposedAction && node.proposedAction.provenance.length > 0) {
      return node.proposedAction.provenance;
    }
    return node.provenance;
  }
  // gate / halt → fall back to the step they reference
  const step = findStepByStepId(model, node.stepId);
  if (!step) return [];
  if (step.proposedAction && step.proposedAction.provenance.length > 0) {
    return step.proposedAction.provenance;
  }
  return step.provenance;
}

/** The step whose detail the selected node represents: the node itself if it is a
 * step, otherwise the step a gate/halt node references. */
export function stepForNode(
  model: TraceModel,
  nodeId: string | null,
): StepNodeData | undefined {
  if (nodeId === null) return undefined;
  const node = model.nodes.find((n) => n.id === nodeId);
  if (!node) return undefined;
  if (node.kind === "step") return node;
  return findStepByStepId(model, node.stepId);
}

/** The gate decision relevant to the selected node, if any. */
export function gateForNode(
  model: TraceModel,
  nodeId: string | null,
): GateNodeData | undefined {
  if (nodeId === null) return undefined;
  const node = model.nodes.find((n) => n.id === nodeId);
  if (!node) return undefined;
  if (node.kind === "gate") return node;
  return model.nodes.find(
    (n): n is GateNodeData => n.kind === "gate" && n.stepId === node.stepId,
  );
}

/** Default selection: the gate node (most informative) else the first node. */
export function defaultSelectedId(model: TraceModel): string | null {
  const gate = model.nodes.find((n) => n.kind === "gate");
  if (gate) return gate.id;
  const first = model.nodes[0];
  return first ? first.id : null;
}
