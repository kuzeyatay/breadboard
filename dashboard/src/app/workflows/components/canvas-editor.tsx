"use client";

// The canvas view for one workflow: ReactFlow + palette + config panel + run
// drawer, composed fresh (not sim's 5000-line workflow.tsx). Owns drag-from-
// palette, connect-to-add-edge, selection, delete/duplicate, inline rename,
// and debounced persistence.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeTypes,
} from "reactflow";
import "reactflow/dist/style.css";
import { BLOCK_DIMENSIONS } from "@/lib/sim/workflow-renderer";
import BreadboardLoader from "@/app/components/breadboard-loader";
import { BlockPalette, PALETTE_DRAG_MIME } from "./block-palette";
import { ConfigPanel } from "./config-panel";
import { RunDrawer } from "./run-drawer";
import { WorkflowEdge } from "./workflow-edge";
import { WorkflowNode, type WorkflowNodeData } from "./workflow-node";
import { useWorkflowPersistence } from "../hooks/use-workflow-persistence";
import type { WorkflowStateJson } from "../lib/types";
import { useWorkflowStore } from "../stores/workflow-store";

const nodeTypes: NodeTypes = { workflowBlock: WorkflowNode };
const edgeTypes: EdgeTypes = { workflowEdge: WorkflowEdge };

function useSaveStatusLabel(status: ReturnType<typeof useWorkflowPersistence>): string {
  switch (status) {
    case "pending":
      return "Unsaved changes";
    case "saving":
      return "Saving…";
    case "saved":
      return "Saved";
    case "error":
      return "Could not save";
    default:
      return "";
  }
}

function CanvasSurface({ workflowId }: { workflowId: string }) {
  const blocks = useWorkflowStore((state) => state.blocks);
  const edgesState = useWorkflowStore((state) => state.edges);
  const selectedBlockId = useWorkflowStore((state) => state.selectedBlockId);
  const setSelectedBlock = useWorkflowStore((state) => state.setSelectedBlock);
  const setSelectedEdge = useWorkflowStore((state) => state.setSelectedEdge);
  const addBlock = useWorkflowStore((state) => state.addBlock);
  const moveBlock = useWorkflowStore((state) => state.moveBlock);
  const addEdge = useWorkflowStore((state) => state.addEdge);
  const removeEdge = useWorkflowStore((state) => state.removeEdge);

  const { screenToFlowPosition } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);

  const nodes: Node<WorkflowNodeData>[] = useMemo(
    () =>
      Object.values(blocks).map((block) => ({
        id: block.id,
        type: "workflowBlock",
        position: block.position,
        data: { type: block.type },
        selected: block.id === selectedBlockId,
        width: BLOCK_DIMENSIONS.FIXED_WIDTH,
        style: { width: BLOCK_DIMENSIONS.FIXED_WIDTH },
        draggable: true,
      })),
    [blocks, selectedBlockId],
  );

  const edges: Edge[] = useMemo(
    () =>
      edgesState.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle ?? "source",
        targetHandle: edge.targetHandle ?? "target",
        type: "workflowEdge",
      })),
    [edgesState],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type === "position" && change.position) {
          moveBlock(change.id, change.position);
        }
      }
    },
    [moveBlock],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      addEdge({
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
      });
    },
    [addEdge],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData(PALETTE_DRAG_MIME);
      if (!type) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      addBlock(type, {
        x: position.x - BLOCK_DIMENSIONS.FIXED_WIDTH / 2,
        y: position.y - BLOCK_DIMENSIONS.MIN_PAINTED_HEIGHT / 2,
      });
    },
    [addBlock, screenToFlowPosition],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    if (event.dataTransfer.types.includes(PALETTE_DRAG_MIME)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    }
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.key === "Delete" || event.key === "Backspace") && selectedBlockId) {
        const target = event.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
        useWorkflowStore.getState().removeBlock(selectedBlockId);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedBlockId]);

  return (
    <div ref={wrapperRef} className="relative min-h-0 flex-1" onDrop={onDrop} onDragOver={onDragOver}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        onNodeClick={(_event, node) => setSelectedBlock(node.id)}
        onEdgeClick={(_event, edge) => setSelectedEdge(edge.id)}
        onPaneClick={() => {
          setSelectedBlock(null);
          setSelectedEdge(null);
        }}
        onEdgesDelete={(deleted) => deleted.forEach((edge) => removeEdge(edge.id))}
        deleteKeyCode={null}
        minZoom={0.15}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        fitView
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border-1)" />
        <Controls showInteractive={false} />
      </ReactFlow>
      {selectedBlockId && blocks[selectedBlockId] ? (
        <div className="absolute inset-y-0 right-0 z-20">
          <ConfigPanel blockId={selectedBlockId} onClose={() => setSelectedBlock(null)} />
        </div>
      ) : null}
      <RunDrawer workflowId={workflowId} />
    </div>
  );
}

export function CanvasEditor({
  workflowId,
  initialName,
  initialDescription,
  initialState,
  onBack,
}: {
  workflowId: string;
  initialName: string;
  initialDescription: string;
  initialState: WorkflowStateJson | null;
  onBack: () => void;
}) {
  const hydrate = useWorkflowStore((state) => state.hydrate);
  const reset = useWorkflowStore((state) => state.reset);
  const hydrated = useWorkflowStore((state) => state.hydrated);
  const currentId = useWorkflowStore((state) => state.workflowId);
  const name = useWorkflowStore((state) => state.name);
  const setName = useWorkflowStore((state) => state.setName);
  const [nameDraft, setNameDraft] = useState(initialName);
  const saveStatus = useWorkflowPersistence(workflowId);
  const saveLabel = useSaveStatusLabel(saveStatus);

  useEffect(() => {
    hydrate({ id: workflowId, name: initialName, description: initialDescription, state: initialState });
    setNameDraft(initialName);
    return () => reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId]);

  useEffect(() => {
    setNameDraft(name);
  }, [name]);

  if (!hydrated || currentId !== workflowId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <BreadboardLoader className="h-5 w-5 text-[var(--botanical)]" />
      </div>
    );
  }

  return (
    <div className="sim-canvas flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--paper-surface)] px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="flex shrink-0 items-center gap-1 text-xs text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
          >
            <BackIcon /> All workflows
          </button>
          <span className="text-[var(--ink-faint)]">/</span>
          <input
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            onBlur={() => setName(nameDraft.trim() || "Untitled workflow")}
            onKeyDown={(event) => {
              if (event.key === "Enter") (event.target as HTMLInputElement).blur();
            }}
            className="min-w-0 max-w-xs rounded-lg border border-transparent bg-transparent px-1.5 py-1 text-sm font-semibold text-[var(--ink-heading)] outline-none focus:border-[var(--line)] focus:bg-[var(--paper-raised)]"
          />
        </div>
        <span className="shrink-0 text-[11px] text-[var(--ink-faint)]">{saveLabel}</span>
      </div>
      <div className="flex min-h-0 flex-1">
        <BlockPalette />
        <ReactFlowProvider>
          <CanvasSurface workflowId={workflowId} />
        </ReactFlowProvider>
      </div>
    </div>
  );
}

function BackIcon() {
  return (
    <svg aria-hidden className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
    </svg>
  );
}
