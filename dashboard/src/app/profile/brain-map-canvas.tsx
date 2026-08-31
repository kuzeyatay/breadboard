"use client";

import { useEffect, useMemo, useRef } from "react";

import { adaptBrainGraph } from "@/lib/quartz-brain-graph/adapter.ts";
import { createThoughtTopologyRenderer } from "@/lib/quartz-brain-graph/renderer.ts";
import { quartzLayoutStorageKey } from "@/lib/quartz-brain-graph/state.ts";
import type { QuartzBrainRendererController } from "@/lib/quartz-brain-graph/types.ts";
import type { BrainGraphResponse } from "@/lib/profile/brain-graph-types.ts";

export default function BrainMapCanvas({
  graph,
  scopeKey,
  query,
  selectedNodeIds,
  selectedEdgeIds,
  visibleNodeIds,
  evidenceNodeIds,
  evidenceEdgeIds,
  expansionParentId,
  focusRequest,
  onSelect,
  onSelectEdge,
  onOpen,
  onFailure,
}: {
  graph: BrainGraphResponse;
  scopeKey: string;
  query: string;
  selectedNodeIds: ReadonlySet<string>;
  selectedEdgeIds: ReadonlySet<string>;
  visibleNodeIds: ReadonlySet<string>;
  evidenceNodeIds: ReadonlySet<string>;
  evidenceEdgeIds: ReadonlySet<string>;
  expansionParentId?: string;
  focusRequest?: { id: string; nonce: number };
  onSelect: (nodeId: string, additive: boolean) => void;
  onSelectEdge: (edgeId: string) => void;
  onOpen: (nodeId: string, href?: string) => void;
  onFailure: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<QuartzBrainRendererController | null>(null);
  const latestGraphRef = useRef(graph);
  const latestCallbacksRef = useRef({ onSelect, onSelectEdge, onOpen, onFailure });
  const layoutStorageKey = useMemo(
    () => quartzLayoutStorageKey(graph.layoutKey, graph.revision, scopeKey),
    [graph.layoutKey, graph.revision, scopeKey],
  );

  latestGraphRef.current = graph;
  latestCallbacksRef.current = { onSelect, onSelectEdge, onOpen, onFailure };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    const normalizationStarted = performance.now();
    const adapted = adaptBrainGraph(latestGraphRef.current);
    const normalizationMs = Math.round((performance.now() - normalizationStarted) * 10) / 10;
    const rendererStarted = performance.now();
    void createThoughtTopologyRenderer(host, adapted, {
      layoutStorageKey,
      selectedNodeIds,
      selectedEdgeIds,
      visibleNodeIds,
      evidenceNodeIds,
      evidenceEdgeIds,
      onSelect: (nodeId, additive) => latestCallbacksRef.current.onSelect(nodeId, additive),
      onSelectEdge: (edgeId) => latestCallbacksRef.current.onSelectEdge(edgeId),
      onOpen: (nodeId, href) => latestCallbacksRef.current.onOpen(nodeId, href),
      onFailure: () => latestCallbacksRef.current.onFailure(),
      onSettled: (simulationSettleMs) => {
        console.info("[thought-topology-renderer]", JSON.stringify({ simulationSettleMs }));
      },
    })
      .then((controller) => {
        if (disposed) {
          controller.destroy();
          return;
        }
        controllerRef.current = controller;
        controller.setSearch(query);
        console.info("[thought-topology-renderer]", JSON.stringify({
          nodeCount: adapted.nodes.length,
          edgeCount: adapted.links.length,
          normalizationMs,
          rendererInitializationMs:
            Math.round((performance.now() - rendererStarted) * 10) / 10,
        }));
      })
      .catch(() => {
        if (!disposed) latestCallbacksRef.current.onFailure();
      });
    return () => {
      disposed = true;
      controllerRef.current?.destroy();
      controllerRef.current = null;
    };
    // A scope switch intentionally creates a fresh simulation and lifecycle.
    // Expansion and filtering use the update effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  useEffect(() => {
    const started = performance.now();
    const adapted = adaptBrainGraph(graph);
    controllerRef.current?.updateGraph(adapted, expansionParentId);
    console.info("[thought-topology-renderer]", JSON.stringify({
      nodeCount: adapted.nodes.length,
      edgeCount: adapted.links.length,
      normalizationMs: Math.round((performance.now() - started) * 10) / 10,
    }));
  }, [expansionParentId, graph]);

  useEffect(() => {
    controllerRef.current?.updateOptions({
      selectedNodeIds,
      selectedEdgeIds,
      visibleNodeIds,
      evidenceNodeIds,
      evidenceEdgeIds,
    });
  }, [evidenceEdgeIds, evidenceNodeIds, selectedEdgeIds, selectedNodeIds, visibleNodeIds]);

  useEffect(() => {
    controllerRef.current?.setSearch(query);
  }, [query]);

  useEffect(() => {
    if (focusRequest) controllerRef.current?.focusNode(focusRequest.id);
  }, [focusRequest]);

  return (
    <div className="relative h-full w-full">
      <div
        ref={hostRef}
        className="h-full w-full touch-none outline-none"
        aria-label={`Interactive Thought Topology with ${graph.nodes.length} nodes and ${graph.edges.length} weighted relationships`}
        role="img"
      />
      <div className="absolute bottom-3 left-3 flex items-center gap-1 rounded-lg border border-gray-800 bg-gray-950/85 p-1 shadow-lg backdrop-blur">
        <button
          type="button"
          onClick={() => controllerRef.current?.zoomBy(1.25)}
          className="rounded px-2 py-1 text-sm text-gray-300 hover:bg-gray-800 hover:text-white"
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => controllerRef.current?.zoomBy(0.8)}
          className="rounded px-2 py-1 text-sm text-gray-300 hover:bg-gray-800 hover:text-white"
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          onClick={() => controllerRef.current?.fitToView()}
          className="rounded px-2 py-1 text-[11px] text-gray-400 hover:bg-gray-800 hover:text-white"
        >
          Fit
        </button>
        <button
          type="button"
          onClick={() => controllerRef.current?.resetLayout()}
          className="rounded px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-800 hover:text-white"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
