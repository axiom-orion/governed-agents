"use client";

// components/TraceCanvas.tsx
// React Flow rendering of the run: one node per step, the gate as its own node
// (green = allow, red = block), a halt node on the block path, and handoff
// edges in stream order. Layout is left-to-right; nodes are not draggable
// because their position is derived from the trace, not authored.
//
// The graph is derived from the trace model and pushed into React Flow via
// useNodesState/useEdgesState. Because the node set grows as the stream
// arrives, after every change we force a handle re-measure with
// updateNodeInternals (a synchronous DOM read — deterministic, unlike waiting
// on a ResizeObserver tick) and refit, so edges always route correctly.

import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useUpdateNodeInternals,
} from "@xyflow/react";
import type { Edge, Node, NodeProps, NodeTypes } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { TraceModel, TraceNode } from "@/lib/trace-model";

type TraceNodeData = { node: TraceNode; selected: boolean };
type FlowNode = Node<TraceNodeData, "trace">;

const ROLE_LABEL: Readonly<Record<string, string>> = {
  researcher: "Researcher",
  reasoner: "Reasoner",
  executor: "Executor",
};

function nodeLabel(node: TraceNode): string {
  if (node.kind === "step") return ROLE_LABEL[node.role] ?? node.role;
  if (node.kind === "gate") return "Gate";
  return "Halt";
}

function nodeBody(node: TraceNode): string {
  if (node.kind === "step") return node.summary ?? node.result ?? "In progress…";
  if (node.kind === "gate") return node.decision.decision === "allow" ? "Allow" : "Block";
  return node.reason;
}

function clockFromIso(iso: string | undefined): string | null {
  if (!iso) return null;
  const t = iso.indexOf("T");
  if (t === -1) return null;
  return iso.slice(t + 1, t + 9); // HH:MM:SS, verbatim from the stream
}

function nodeTime(node: TraceNode): string | null {
  if (node.kind === "step") return clockFromIso(node.completedAt ?? node.startedAt);
  return clockFromIso(node.at);
}

function chipClasses(node: TraceNode): string {
  if (node.kind === "gate") {
    return node.decision.decision === "allow"
      ? "bg-emerald-100 text-emerald-700"
      : "bg-red-100 text-red-700";
  }
  if (node.kind === "halt") return "bg-red-100 text-red-700";
  return "bg-slate-100 text-slate-600";
}

function cardClasses(node: TraceNode, selected: boolean): string {
  const base =
    "flex h-full w-full flex-col justify-center overflow-hidden rounded-lg border bg-white px-3 py-2.5 shadow-sm transition-colors";
  const ring = selected ? " ring-2 ring-blue-500 ring-offset-1" : "";
  if (node.kind === "gate") {
    const tone = node.decision.decision === "allow" ? " border-emerald-400" : " border-red-400";
    return base + tone + ring;
  }
  if (node.kind === "halt") return base + " border-red-300 bg-red-50" + ring;
  return base + " border-slate-300" + ring;
}

function TraceFlowNode({ data }: NodeProps<FlowNode>) {
  const { node, selected } = data;
  const time = nodeTime(node);
  const isGate = node.kind === "gate";
  const allowed = isGate && node.decision.decision === "allow";
  return (
    <div className={cardClasses(node, selected)}>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-slate-300" />
      <div className="flex items-center justify-between gap-2">
        <span
          className={
            "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
            chipClasses(node)
          }
        >
          {nodeLabel(node)}
        </span>
        {time ? <span className="font-mono text-[10px] text-slate-400">{time}</span> : null}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        {isGate ? (
          <span
            className={
              "inline-block h-2 w-2 shrink-0 rounded-full " +
              (allowed ? "bg-emerald-500" : "bg-red-500")
            }
            aria-hidden="true"
          />
        ) : null}
        <p
          className={
            "line-clamp-2 text-sm leading-snug " +
            (isGate ? "font-semibold text-slate-900" : "text-slate-700")
          }
        >
          {nodeBody(node)}
        </p>
      </div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-slate-300" />
    </div>
  );
}

const nodeTypes: NodeTypes = { trace: TraceFlowNode };

// Explicit node dimensions so React Flow has sizes without a ResizeObserver
// tick; handle positions are then forced via updateNodeInternals.
const NODE_WIDTH = 208;
const NODE_HEIGHT = 96;
const COLUMN_GAP = 280;

interface TraceCanvasProps {
  model: TraceModel;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

function TraceFlow({ model, selectedId, onSelect }: TraceCanvasProps) {
  const derivedNodes = useMemo<FlowNode[]>(
    () =>
      model.nodes.map((node, index) => ({
        id: node.id,
        type: "trace",
        position: { x: index * COLUMN_GAP, y: 0 },
        data: { node, selected: node.id === selectedId },
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      })),
    [model.nodes, selectedId],
  );

  const derivedEdges = useMemo<Edge[]>(
    () =>
      model.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "#94a3b8" },
        style: { stroke: "#94a3b8" },
      })),
    [model.edges],
  );

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<FlowNode>(derivedNodes);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>(derivedEdges);
  const { fitView } = useReactFlow<FlowNode, Edge>();
  const updateNodeInternals = useUpdateNodeInternals();

  useEffect(() => {
    setRfNodes(derivedNodes);
  }, [derivedNodes, setRfNodes]);

  useEffect(() => {
    setRfEdges(derivedEdges);
  }, [derivedEdges, setRfEdges]);

  // After the node set changes, force React Flow to re-read handle positions
  // (so edges route) and refit the viewport to keep the whole chain visible.
  useEffect(() => {
    const ids = derivedNodes.map((n) => n.id);
    if (ids.length === 0) return;
    const timer = window.setTimeout(() => {
      for (const id of ids) updateNodeInternals(id);
      void fitView({ padding: 0.25, duration: 200 });
    }, 40);
    return () => window.clearTimeout(timer);
  }, [derivedNodes, updateNodeInternals, fitView]);

  const handleNodeClick = useCallback(
    (_event: ReactMouseEvent, node: Node) => onSelect(node.id),
    [onSelect],
  );
  const handlePaneClick = useCallback(() => onSelect(null), [onSelect]);

  return (
    <ReactFlow<FlowNode, Edge>
      nodes={rfNodes}
      edges={rfEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      onNodeClick={handleNodeClick}
      onPaneClick={handlePaneClick}
      nodesDraggable={false}
      nodesConnectable={false}
      edgesFocusable={false}
      fitView
      fitViewOptions={{ padding: 0.25 }}
      minZoom={0.4}
      maxZoom={1.5}
      proOptions={{ hideAttribution: false }}
      className="bg-slate-50"
    >
      <Background color="#cbd5e1" gap={20} />
      <Controls showInteractive={false} position="bottom-right" />
    </ReactFlow>
  );
}

export function TraceCanvas(props: TraceCanvasProps) {
  // The wrapper is absolutely positioned to fill its relatively-positioned
  // parent so React Flow always has a definite width/height to measure —
  // otherwise edges silently fail to render (React Flow error #004).
  return (
    <div className="absolute inset-0">
      <ReactFlowProvider>
        <TraceFlow {...props} />
      </ReactFlowProvider>
    </div>
  );
}
