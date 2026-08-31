"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { chatDraftKey, writeChatDraft } from "@/lib/conversations/drafts.ts";
import { mergeBrainGraphResponse } from "@/lib/profile/brain-graph-normalize.ts";
import type {
  BrainEdgeOrigin,
  BrainGraphResponse,
  BrainNode,
} from "@/lib/profile/brain-graph-types.ts";
import BrainMapSkeleton from "./brain-map-skeleton.tsx";

const BrainMapCanvas = dynamic(() => import("./brain-map-canvas.tsx"), {
  ssr: false,
  loading: () => <BrainMapSkeleton />,
});

function scopeQuery(scopeKey: string): URLSearchParams {
  const query = new URLSearchParams();
  if (scopeKey === "personal" || scopeKey === "all") {
    query.set("scope", scopeKey);
  } else {
    query.set("scope", "organization");
    query.set("organization", scopeKey);
  }
  return query;
}

function rememberScope(scopeKey: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("tab", "knowledge");
  if (scopeKey === "personal") {
    url.searchParams.delete("scope");
    url.searchParams.delete("organization");
  } else if (scopeKey === "all") {
    url.searchParams.set("scope", "all");
    url.searchParams.delete("organization");
  } else {
    url.searchParams.set("scope", "organization");
    url.searchParams.set("organization", scopeKey);
  }
  window.history.replaceState(window.history.state, "", url);
}

function evidencePath(
  graph: BrainGraphResponse,
  start: string,
  finish: string,
): { nodes: Set<string>; edges: Set<string> } | null {
  const adjacency = new Map<string, Array<{ node: string; edge: string }>>();
  for (const edge of graph.edges) {
    adjacency.set(edge.source, [
      ...(adjacency.get(edge.source) ?? []),
      { node: edge.target, edge: edge.id },
    ]);
    adjacency.set(edge.target, [
      ...(adjacency.get(edge.target) ?? []),
      { node: edge.source, edge: edge.id },
    ]);
  }
  const queue = [start];
  const previous = new Map<string, { node: string; edge: string }>();
  const seen = new Set([start]);
  while (queue.length) {
    const current = queue.shift()!;
    if (current === finish) break;
    for (const next of adjacency.get(current) ?? []) {
      if (seen.has(next.node)) continue;
      seen.add(next.node);
      previous.set(next.node, { node: current, edge: next.edge });
      queue.push(next.node);
    }
  }
  if (!seen.has(finish)) return null;
  const nodes = new Set([finish]);
  const edges = new Set<string>();
  let cursor = finish;
  while (cursor !== start) {
    const step = previous.get(cursor);
    if (!step) return null;
    nodes.add(step.node);
    edges.add(step.edge);
    cursor = step.node;
  }
  return { nodes, edges };
}

function formatKind(kind: string): string {
  return kind.replaceAll("_", " ").replace(/^./, (value) => value.toUpperCase());
}

function GraphList({
  nodes,
  selected,
  onSelect,
  onOpen,
}: {
  nodes: BrainNode[];
  selected: ReadonlySet<string>;
  onSelect: (nodeId: string, additive: boolean) => void;
  onOpen: (node: BrainNode) => void;
}) {
  const lastRightClickRef = useRef<{ id: string; at: number } | null>(null);
  return (
    <div className="h-full overflow-y-auto p-3" aria-label="Thought Topology node list">
      {nodes.length === 0 ? (
        <p className="px-2 py-10 text-center text-sm text-gray-500">
          No nodes match these filters.
        </p>
      ) : (
        <ul className="space-y-1">
          {nodes.map((node) => (
            <li
              key={node.id}
              className={
                selected.has(node.id)
                  ? "rounded-lg border border-blue-400/50 bg-blue-400/10"
                  : "rounded-lg border border-transparent hover:border-gray-800 hover:bg-gray-900"
              }
            >
              <button
                type="button"
                onClick={(event) => onSelect(node.id, event.shiftKey || event.ctrlKey || event.metaKey)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  const now = performance.now();
                  if (
                    lastRightClickRef.current?.id === node.id &&
                    now - lastRightClickRef.current.at <= 500
                  ) {
                    lastRightClickRef.current = null;
                    onOpen(node);
                  } else {
                    lastRightClickRef.current = { id: node.id, at: now };
                  }
                }}
                className="flex w-full items-start gap-3 px-3 py-2.5 text-left"
                aria-pressed={selected.has(node.id)}
              >
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-sky-300" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-gray-100">{node.label}</span>
                  <span className="block truncate text-[11px] text-gray-500">
                    {formatKind(node.kind)}
                    {node.gardenSlug ? ` · ${node.gardenSlug}` : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function BrainMapClient({
  initialScope,
  onScopeChange,
}: {
  initialScope: string;
  onScopeChange?: (scope: string) => void;
}) {
  const router = useRouter();
  const [scopeKey, setScopeKey] = useState(initialScope || "personal");
  const [graph, setGraph] = useState<BrainGraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"overview" | "full">("overview");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [origin, setOrigin] = useState<"all" | BrainEdgeOrigin>("all");
  const [garden, setGarden] = useState("all");
  const [organization, setOrganization] = useState("all");
  const [dateWindow, setDateWindow] = useState("all");
  const [explicitOnly, setExplicitOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [evidenceNodes, setEvidenceNodes] = useState<Set<string>>(new Set());
  const [evidenceEdges, setEvidenceEdges] = useState<Set<string>>(new Set());
  const [pathMessage, setPathMessage] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);
  const [expanding, setExpanding] = useState(false);
  const [expansionParentId, setExpansionParentId] = useState<string>();
  const [focusRequest, setFocusRequest] = useState<{ id: string; nonce: number }>();
  const fetchRef = useRef<AbortController | null>(null);
  const expansionRef = useRef<AbortController | null>(null);

  const load = useCallback(async (nextScope: string, nextMode: "overview" | "full") => {
    fetchRef.current?.abort();
    const controller = new AbortController();
    fetchRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const queryParams = scopeQuery(nextScope);
      queryParams.set("mode", nextMode);
      const response = await fetch(`/api/profile/brain-graph?${queryParams}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as BrainGraphResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Thought Topology could not be loaded.");
      if (!controller.signal.aborted) setGraph(payload);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Thought Topology could not be loaded.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(scopeKey, mode);
    return () => fetchRef.current?.abort();
  }, [load, mode, scopeKey]);

  useEffect(() => {
    const clear = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSelectedIds([]);
      setSelectedEdgeId(null);
      setEvidenceNodes(new Set());
      setEvidenceEdges(new Set());
      setPathMessage(null);
    };
    window.addEventListener("keydown", clear);
    return () => window.removeEventListener("keydown", clear);
  }, []);

  useEffect(() => () => expansionRef.current?.abort(), []);

  const changeScope = useCallback((nextScope: string) => {
    rememberScope(nextScope);
    onScopeChange?.(nextScope);
    setGraph(null);
    setFallback(false);
    setScopeKey(nextScope);
    setMode("overview");
    setSelectedIds([]);
    setSelectedEdgeId(null);
    setEvidenceNodes(new Set());
    setEvidenceEdges(new Set());
    setPathMessage(null);
    setExpansionParentId(undefined);
  }, [onScopeChange]);

  const selectNode = useCallback((nodeId: string, additive: boolean) => {
    setSelectedEdgeId(null);
    setEvidenceNodes(new Set());
    setEvidenceEdges(new Set());
    setPathMessage(null);
    setSelectedIds((current) => {
      if (!additive) return current.length === 1 && current[0] === nodeId ? [] : [nodeId];
      if (current.includes(nodeId)) return current.filter((id) => id !== nodeId);
      return [...current.slice(-1), nodeId];
    });
  }, []);

  const selectEdge = useCallback((edgeId: string) => {
    setSelectedIds([]);
    setEvidenceNodes(new Set());
    setEvidenceEdges(new Set());
    setPathMessage(null);
    setSelectedEdgeId((current) => current === edgeId ? null : edgeId);
  }, []);

  const openNode = useCallback((nodeOrId: BrainNode | string, href?: string) => {
    const target = typeof nodeOrId === "string" ? href : nodeOrId.href;
    if (target) router.push(target);
  }, [router]);

  const expandNode = useCallback(async (node: BrainNode) => {
    if (!graph) return;
    expansionRef.current?.abort();
    const controller = new AbortController();
    expansionRef.current = controller;
    setExpanding(true);
    try {
      const queryParams = scopeQuery(scopeKey);
      queryParams.set("node", node.id);
      queryParams.set("depth", "1");
      const response = await fetch(`/api/profile/brain-graph/expand?${queryParams}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as BrainGraphResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "That node could not be expanded.");
      if (!controller.signal.aborted) {
        setGraph((current) => current ? mergeBrainGraphResponse(current, payload) : payload);
        setExpansionParentId(node.id);
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "That node could not be expanded.");
      }
    } finally {
      if (!controller.signal.aborted) setExpanding(false);
    }
  }, [graph, scopeKey]);

  const kinds = useMemo(() => [...new Set(graph?.nodes.map((node) => node.kind) ?? [])].sort(), [graph]);
  const origins = useMemo(() => [...new Set(graph?.nodes.flatMap((node) => node.origins) ?? [])].sort(), [graph]);
  const gardens = useMemo(() => [...new Set(graph?.nodes.map((node) => node.gardenSlug).filter((value): value is string => Boolean(value)) ?? [])].sort(), [graph]);
  const organizations = useMemo(() => [...new Set(graph?.nodes.map((node) => node.organizationId).filter((value): value is string => Boolean(value)) ?? [])].sort(), [graph]);

  const displayGraph = useMemo(() => {
    if (!graph) return null;
    const cutoff = dateWindow === "all" ? null : Date.now() - Number(dateWindow) * 86_400_000;
    const explicitIds = explicitOnly
      ? new Set(graph.edges.filter((edge) => edge.explicit).flatMap((edge) => [edge.source, edge.target]))
      : null;
    const nodes = graph.nodes.filter((node) => {
      if (kind !== "all" && node.kind !== kind) return false;
      if (origin !== "all" && !node.origins.includes(origin)) return false;
      if (garden !== "all" && node.gardenSlug !== garden) return false;
      if (organization !== "all" && node.organizationId !== organization) return false;
      if (explicitIds && !explicitIds.has(node.id)) return false;
      if (cutoff !== null) {
        const timestamp = Date.parse(node.updatedAt ?? node.createdAt ?? "");
        if (!Number.isFinite(timestamp) || timestamp < cutoff) return false;
      }
      return true;
    });
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = graph.edges.filter((edge) =>
      nodeIds.has(edge.source) && nodeIds.has(edge.target) &&
      (!explicitOnly || edge.explicit) &&
      (origin === "all" || edge.origin === origin),
    );
    return { ...graph, nodes, edges } satisfies BrainGraphResponse;
  }, [dateWindow, explicitOnly, garden, graph, kind, organization, origin]);

  // Filtering changes visibility and edge provenance without deleting nodes
  // from the simulation. Their positions are therefore still present when a
  // filter is removed, and no authorization data is involved in that state.
  const rendererGraph = useMemo(() =>
    graph && displayGraph
      ? { ...graph, edges: displayGraph.edges }
      : null,
  [displayGraph, graph]);

  const sortedNodes = useMemo(() => [...(displayGraph?.nodes ?? [])].sort((left, right) =>
    (right.metrics?.importance ?? 0) - (left.metrics?.importance ?? 0) || left.label.localeCompare(right.label),
  ), [displayGraph]);
  const listedNodes = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return sortedNodes;
    return sortedNodes.filter((node) =>
      [node.label, node.subtitle, node.kind, node.gardenSlug]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }, [query, sortedNodes]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedEdgeSet = useMemo(
    () => new Set(selectedEdgeId ? [selectedEdgeId] : []),
    [selectedEdgeId],
  );
  const selectedNodes = useMemo(
    () => selectedIds.flatMap((id) => graph?.nodes.find((node) => node.id === id) ?? []),
    [graph, selectedIds],
  );
  const visibleNodeIds = useMemo(() => new Set(displayGraph?.nodes.map((node) => node.id) ?? []), [displayGraph]);

  const findPath = useCallback(() => {
    if (!graph || selectedIds.length !== 2) return;
    const path = evidencePath(graph, selectedIds[0], selectedIds[1]);
    setEvidenceNodes(path?.nodes ?? new Set());
    setEvidenceEdges(path?.edges ?? new Set());
    setPathMessage(path
      ? `${path.edges.size} relationship${path.edges.size === 1 ? "" : "s"} in the shortest visible evidence path.`
      : "No path exists in the loaded graph.");
  }, [graph, selectedIds]);

  const askHermes = useCallback((askMode: "ask" | "synthesize") => {
    if (selectedIds.length === 0) return;
    const stableIds = selectedIds.map((id) => `- ${id}`).join("\n");
    const prompt = askMode === "synthesize"
      ? `Synthesize the relationship between these authorized Thought Topology node IDs. Resolve them server-side and cite the evidence you use:\n${stableIds}`
      : `Help me understand this authorized Thought Topology node. Resolve it server-side and cite the evidence you use:\n${stableIds}`;
    writeChatDraft(window.localStorage, chatDraftKey("dashboard_terminal", null), prompt);
    router.push("/dashboard");
  }, [router, selectedIds]);

  if (loading && !graph) return <BrainMapSkeleton />;
  if (error && !graph) {
    return (
      <div className="rounded-2xl border border-red-900/50 bg-red-950/20 p-8 text-center">
        <p className="text-sm text-red-300">{error}</p>
        <button type="button" onClick={() => void load(scopeKey, mode)} className="mt-4 rounded-lg border border-red-800 px-3 py-2 text-xs text-red-200 hover:bg-red-950">Try again</button>
      </div>
    );
  }
  if (!graph || !displayGraph || !rendererGraph) return null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2 px-1">
        <div>
          <h2 className="text-lg font-semibold text-white">Thought Topology</h2>
          <p className="text-xs text-gray-500">How your knowledge, work, and gardens are connected.</p>
        </div>
        <p className="text-xs text-gray-500" role="status">
          {loading ? "Updating Thought Topology…" : `${displayGraph.nodes.length} nodes · ${displayGraph.edges.length} weighted lines`}
        </p>
      </div>
    <section aria-label="Private Thought Topology" className="overflow-hidden rounded-2xl border border-gray-800 bg-gray-950/70 shadow-2xl">
      <header className="border-b border-gray-800 bg-gray-950/85 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="brain-search">Search Thought Topology</label>
          <input id="brain-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search nodes" className="neu-control min-w-48 flex-1 rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-gray-600" />
          <label className="sr-only" htmlFor="brain-scope">Thought Topology scope</label>
          <select id="brain-scope" value={scopeKey} onChange={(event) => changeScope(event.target.value)} className="neu-control rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-xs text-gray-200 outline-none focus:border-gray-600">
            {graph.scopeOptions.map((option) => <option key={option.id} value={option.organizationId ?? option.id}>{option.label}</option>)}
          </select>
          <button type="button" onClick={() => setMode((current) => current === "overview" ? "full" : "overview")} className="rounded-lg border border-gray-800 px-3 py-2 text-xs text-gray-400 hover:border-gray-600 hover:text-white">
            {mode === "overview" ? "Show everything" : "Overview"}
          </button>
          <span className="text-[11px] text-gray-600">{displayGraph.nodes.length} nodes · {displayGraph.edges.length} weighted lines</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select value={kind} onChange={(event) => setKind(event.target.value)} aria-label="Filter by node type" className="rounded-md border border-gray-800 bg-gray-950 px-2 py-1.5 text-[11px] text-gray-400"><option value="all">All types</option>{kinds.map((value) => <option key={value} value={value}>{formatKind(value)}</option>)}</select>
          <select value={origin} onChange={(event) => setOrigin(event.target.value as "all" | BrainEdgeOrigin)} aria-label="Filter by origin" className="rounded-md border border-gray-800 bg-gray-950 px-2 py-1.5 text-[11px] text-gray-400"><option value="all">All origins</option>{origins.map((value) => <option key={value} value={value}>{formatKind(value)}</option>)}</select>
          <select value={garden} onChange={(event) => setGarden(event.target.value)} aria-label="Filter by Garden" className="rounded-md border border-gray-800 bg-gray-950 px-2 py-1.5 text-[11px] text-gray-400"><option value="all">All Gardens</option>{gardens.map((value) => <option key={value} value={value}>{value}</option>)}</select>
          {organizations.length > 0 && <select value={organization} onChange={(event) => setOrganization(event.target.value)} aria-label="Filter by organization" className="rounded-md border border-gray-800 bg-gray-950 px-2 py-1.5 text-[11px] text-gray-400"><option value="all">All organizations</option>{organizations.map((value) => <option key={value} value={value}>{graph.scopeOptions.find((option) => option.organizationId === value)?.label ?? "Organization"}</option>)}</select>}
          <select value={dateWindow} onChange={(event) => setDateWindow(event.target.value)} aria-label="Filter by date" className="rounded-md border border-gray-800 bg-gray-950 px-2 py-1.5 text-[11px] text-gray-400"><option value="all">Any date</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last year</option></select>
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500"><input type="checkbox" checked={explicitOnly} onChange={(event) => setExplicitOnly(event.target.checked)} /> Explicit only</label>
        </div>
      </header>

      {(graph.truncated || graph.warnings.length > 0 || error || pathMessage) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-gray-800 bg-gray-900/45 px-4 py-2 text-[11px] font-medium text-amber-400" role="status">
          {graph.truncated && <span>Overview limits applied; use “Show everything” or expand a node.</span>}
          {graph.warnings.map((warning) => <span key={`${warning.source}:${warning.code}`}>{warning.message}</span>)}
          {error && <span className="text-red-300">{error}</span>}
          {pathMessage && <span className="text-violet-200">{pathMessage}</span>}
        </div>
      )}

      {graph.nodes.length === 0 ? (
        <div className="flex h-[60vh] min-h-[26rem] items-center justify-center p-8 text-center"><div><p className="text-sm text-gray-300">Your accessible Thought Topology is empty.</p><p className="mt-2 text-xs text-gray-600">Create a Garden, conversation, memory, artifact, or Buzz thread to add the first connection.</p></div></div>
      ) : (
        <div className="min-h-[31rem] xl:h-[72vh]">
          <div className="relative hidden h-[65vh] min-h-[28rem] min-w-0 md:block xl:h-full xl:min-h-0">
            {!fallback ? (
              <>
              <BrainMapCanvas
                key={scopeKey}
                graph={rendererGraph}
                scopeKey={scopeKey}
                query={query}
                selectedNodeIds={selectedSet}
                selectedEdgeIds={selectedEdgeSet}
                visibleNodeIds={visibleNodeIds}
                evidenceNodeIds={evidenceNodes}
                evidenceEdgeIds={evidenceEdges}
                expansionParentId={expansionParentId}
                focusRequest={focusRequest}
                onSelect={selectNode}
                onSelectEdge={selectEdge}
                onOpen={openNode}
                onFailure={() => setFallback(true)}
              />
              {selectedNodes.length > 0 && (
                <div className="absolute bottom-3 right-3 z-30 flex max-w-[calc(100%-1.5rem)] flex-wrap justify-end gap-1.5 rounded-lg border border-gray-800 bg-gray-950/85 p-1.5 shadow-lg backdrop-blur">
                  {selectedNodes[selectedNodes.length - 1].href && (
                    <button type="button" onClick={() => openNode(selectedNodes[selectedNodes.length - 1])} className="rounded-md bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-950 hover:bg-gray-200">Open</button>
                  )}
                  <button type="button" onClick={() => setFocusRequest({ id: selectedNodes[selectedNodes.length - 1].id, nonce: Date.now() })} className="rounded-md border border-gray-700 px-2.5 py-1.5 text-[11px] text-gray-300 hover:text-white">Focus</button>
                  {selectedNodes[selectedNodes.length - 1].expandable && (
                    <button type="button" disabled={expanding} onClick={() => void expandNode(selectedNodes[selectedNodes.length - 1])} className="rounded-md border border-gray-700 px-2.5 py-1.5 text-[11px] text-gray-300 hover:text-white disabled:opacity-50">{expanding ? "Expanding…" : "Expand"}</button>
                  )}
                  <button type="button" onClick={() => askHermes("ask")} className="rounded-md border border-gray-700 px-2.5 py-1.5 text-[11px] text-gray-300 hover:text-white">Ask Hermes</button>
                  {selectedNodes.length === 2 && (
                    <>
                      <button type="button" onClick={findPath} className="rounded-md border border-violet-400/40 px-2.5 py-1.5 text-[11px] text-violet-200 hover:bg-violet-400/10">Find path</button>
                      <button type="button" onClick={() => askHermes("synthesize")} className="rounded-md border border-gray-700 px-2.5 py-1.5 text-[11px] text-gray-300 hover:text-white">Synthesize</button>
                    </>
                  )}
                </div>
              )}
              </>
            ) : (
              <GraphList nodes={listedNodes} selected={selectedSet} onSelect={selectNode} onOpen={openNode} />
            )}
          </div>
          <div className="h-[60vh] min-h-[28rem] md:hidden"><GraphList nodes={listedNodes} selected={selectedSet} onSelect={selectNode} onOpen={openNode} /></div>
        </div>
      )}
      <footer className="flex flex-wrap justify-between gap-2 border-t border-gray-800 px-4 py-2 text-[10px] text-gray-700">
        <span>Private · authorized sources only · hierarchy and weighted semantic lines stay distinct</span>
        <span>{loading ? "Refreshing…" : `Built in ${graph.diagnostics.buildMs} ms`}</span>
      </footer>
    </section>
    </div>
  );
}
