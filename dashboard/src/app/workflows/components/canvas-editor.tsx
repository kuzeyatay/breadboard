"use client";

// The canvas view for one workflow: ReactFlow + palette + config panel + run
// drawer, composed fresh (not sim's 5000-line workflow.tsx). Owns drag-from-
// palette, connect-to-add-edge, selection, delete/duplicate, inline rename,
// and debounced persistence.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import SpacesShell, { type SpacesGarden } from "@/app/spaces/spaces-shell";
import { BlockPalette, PALETTE_DRAG_MIME } from "./block-palette";
import { ConfigPanel } from "./config-panel";
import { RunDrawer } from "./run-drawer";
import { WorkflowEdge } from "./workflow-edge";
import { WorkflowNode, type WorkflowNodeData } from "./workflow-node";
import { lastSentVersion, useWorkflowPersistence, workflowVersionKey } from "../hooks/use-workflow-persistence";
import type { WorkflowStateJson } from "../lib/types";
import { useWorkflowStore } from "../stores/workflow-store";

const nodeTypes: NodeTypes = { workflowBlock: WorkflowNode };
const edgeTypes: EdgeTypes = { workflowEdge: WorkflowEdge };
const CANVAS_REFIT_DELAY_MS = 120;
/** How often the open canvas looks for a version Bread saved from the assistant. */
const REMOTE_CHECK_MS = 2500;

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

/**
 * React Flow updates its viewport dimensions when the host window changes size,
 * but `fitView` is otherwise a one-time mount operation. That leaves a workflow
 * at the laptop-sized zoom after Breadboard is maximized on a larger monitor.
 *
 * Observe the canvas rather than `window`: sidebars and future shell layout
 * changes can resize the usable surface without changing the browser window.
 * The debounce waits until a native resize has settled, then the animation
 * frame lets React Flow consume the new dimensions before it calculates zoom.
 */
function CanvasViewportResizeSync({
  containerRef,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { fitView } = useReactFlow();

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    let fitTimer: number | null = null;
    let fitFrame: number | null = null;
    let measuredWidth = 0;
    let measuredHeight = 0;

    const queueFit = () => {
      if (fitTimer !== null) window.clearTimeout(fitTimer);
      if (fitFrame !== null) window.cancelAnimationFrame(fitFrame);
      fitTimer = window.setTimeout(() => {
        fitTimer = null;
        fitFrame = window.requestAnimationFrame(() => {
          fitFrame = null;
          void fitView({ padding: 0.15 });
        });
      }, CANVAS_REFIT_DELAY_MS);
    };

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = Math.round(entry.contentRect.width);
        const height = Math.round(entry.contentRect.height);
        if (width <= 0 || height <= 0) continue;
        if (width === measuredWidth && height === measuredHeight) continue;
        measuredWidth = width;
        measuredHeight = height;
        queueFit();
      }
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      if (fitTimer !== null) window.clearTimeout(fitTimer);
      if (fitFrame !== null) window.cancelAnimationFrame(fitFrame);
    };
  }, [containerRef, fitView]);

  return null;
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
        <CanvasViewportResizeSync containerRef={wrapperRef} />
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

/**
 * A workflow opens like any Spaces file: under the Spaces header (Spaces /
 * Workflows / its name, renamed in place) with Bread in the corner, the same
 * assistant the Garden reader uses, holding this workflow's own chats.
 */
export function CanvasEditor({
  workflowId,
  initialName,
  initialDescription,
  initialState,
  showFlowers,
  garden,
  notice,
}: {
  workflowId: string;
  initialName: string;
  initialDescription: string;
  initialState: WorkflowStateJson | null;
  showFlowers: boolean;
  garden: SpacesGarden | null;
  notice?: ReactNode;
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

  // Bread can change this workflow from the assistant beside it. Pick up a saved
  // version that differs from the canvas, but only while the canvas has nothing
  // of its own waiting to save; otherwise the next autosave would quietly undo
  // Bread's change, or Bread's change would undo the user's.
  const saveStatusRef = useRef(saveStatus);
  saveStatusRef.current = saveStatus;
  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    // The version on the server the canvas is in step with: what it opened, then
    // whatever it saved or reloaded since.
    let synced = workflowVersionKey(initialName, initialState ?? null);
    const busySaving = () => saveStatusRef.current === "pending" || saveStatusRef.current === "saving";
    const check = async () => {
      if (inFlight || document.visibilityState !== "visible") return;
      const store = useWorkflowStore.getState();
      if (!store.hydrated || store.workflowId !== workflowId) return;
      if (busySaving()) return;
      inFlight = true;
      try {
        const response = await fetch(`/api/workflows/${encodeURIComponent(workflowId)}`, { cache: "no-store" });
        if (!response.ok || stopped) return;
        const remote = (await response.json()) as { name?: string; description?: string; state?: WorkflowStateJson | null };
        const latest = useWorkflowStore.getState();
        if (busySaving() || latest.workflowId !== workflowId) return;
        const version = workflowVersionKey(remote.name, remote.state ?? null);
        if (version === synced) return;
        if (version === lastSentVersion.get(workflowId)) {
          synced = version;
          return;
        }
        synced = version;
        latest.hydrate({
          id: workflowId,
          name: remote.name ?? latest.name,
          description: remote.description ?? latest.description,
          state: remote.state ?? null,
        });
      } catch {
        // Offline for a moment: the next check tries again.
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(() => void check(), REMOTE_CHECK_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
    // initialName/initialState are the opening version only; a reload must not restart the watch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId]);

  const ready = hydrated && currentId === workflowId;

  return (
    <SpacesShell
      showFlowers={showFlowers}
      garden={garden}
      pageKey={`workflow:${workflowId}`}
      trail={["Workflows"]}
      title={
        <input
          value={nameDraft}
          aria-label="Workflow name"
          onChange={(event) => setNameDraft(event.target.value)}
          onBlur={() => setName(nameDraft.trim() || "Untitled workflow")}
          onKeyDown={(event) => {
            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
          }}
          disabled={!ready}
          className="min-w-0 max-w-xs rounded-lg border border-transparent bg-transparent px-1.5 py-1 text-sm text-[var(--ink-muted)] outline-none focus:border-[var(--line)] focus:bg-[var(--paper-raised)] focus:text-[var(--ink-heading)]"
        />
      }
      actions={<span className="text-[11px] text-[var(--ink-faint)]">{saveLabel}</span>}
    >
      {notice}
      {ready ? (
        <div className="sim-canvas flex min-h-0 flex-1">
          <BlockPalette />
          <ReactFlowProvider>
            <CanvasSurface workflowId={workflowId} />
          </ReactFlowProvider>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <BreadboardLoader className="h-5 w-5 text-[var(--botanical)]" />
        </div>
      )}
    </SpacesShell>
  );
}
