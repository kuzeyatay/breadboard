// Direct Breadboard port of Quartz 4.5.2's global graph core.
// Provenance and the intentional lifecycle/data patches live in
// dashboard/src/vendor/quartz-graph/.

import {
  drag,
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  select,
  zoom,
  zoomIdentity,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
  type ZoomBehavior,
  type ZoomTransform,
} from "d3";
import katex from "katex";
import {
  Application,
  Circle,
  Container,
  Graphics,
  Text,
} from "pixi.js";
import { graphSearchMatches, quartzFocusState, quartzLabelAlpha } from "./state.ts";
import { quartzBrainNodeStyle } from "./theme.ts";
import type {
  QuartzBrainGraph,
  QuartzBrainLink,
  QuartzBrainNode,
  QuartzBrainRendererController,
  QuartzBrainRendererOptions,
} from "./types.ts";

type SimNode = QuartzBrainNode & SimulationNodeDatum;
type SimLink = SimulationLinkDatum<SimNode> & {
  id: string;
  source: SimNode;
  target: SimNode;
  graphLink: QuartzBrainLink;
};

interface NodeRenderData {
  node: SimNode;
  graphic: Graphics;
  ring: Graphics;
  label: Text;
  targetAlpha: number;
  targetLabelAlpha: number;
  targetRingAlpha: number;
}

interface LinkRenderData {
  link: SimLink;
  graphic: Graphics;
  targetAlpha: number;
}

interface StoredLayout {
  permanentHomes?: Record<string, { x: number; y: number }>;
  viewport?: { x: number; y: number; k: number };
}

const QUARTZ_CHARGE = -230;
const QUARTZ_CENTER_STRENGTH = 0.04;
const QUARTZ_LINK_DISTANCE = 165;
const QUARTZ_ALPHA_DECAY = 0.018;
const QUARTZ_VELOCITY_DECAY = 0.5;

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stableUnit(value: string): number {
  return stableHash(value) / 4294967295;
}

function canUseWebGl(): boolean {
  let canvas: HTMLCanvasElement | null = null;
  try {
    canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!context) return false;
    // Capability probing must not itself consume one of the browser's small
    // pool of native WebGL contexts on every graph mount.
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  } finally {
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

function readLayout(key: string): StoredLayout {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value as StoredLayout;
  } catch {
    return {};
  }
}

function writeLayout(
  key: string,
  permanentHomes: ReadonlyMap<string, { x: number; y: number }>,
  transform: ZoomTransform,
): void {
  const serializedHomes: Record<string, { x: number; y: number }> = {};
  for (const [id, position] of permanentHomes) {
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) continue;
    serializedHomes[id] = position;
  }
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        permanentHomes: serializedHomes,
        viewport: { x: transform.x, y: transform.y, k: transform.k },
      } satisfies StoredLayout),
    );
  } catch {
    // Layout is an enhancement. A blocked/full store must not break the graph.
  }
}

function makeSimulation(
  nodes: SimNode[],
  links: SimLink[],
  width: number,
  height: number,
): Simulation<SimNode, SimLink> {
  const simulation = forceSimulation<SimNode>(nodes)
    .force("charge", forceManyBody<SimNode>().strength(QUARTZ_CHARGE))
    .force("center", forceCenter<SimNode>(0, 0).strength(QUARTZ_CENTER_STRENGTH))
    .force(
      "link",
      forceLink<SimNode, SimLink>(links)
        .id((node) => node.id)
        .distance((link) => {
          const adjustment = link.graphLink.origin === "gbrain-derived" || link.graphLink.origin === "thought-topology" ? 1.18 : 1;
          return QUARTZ_LINK_DISTANCE * adjustment;
        }),
    )
    .force(
      "collide",
      forceCollide<SimNode>((node) => quartzBrainNodeStyle(node.kind, node.weight).radius + 18)
        .iterations(6),
    )
    .force(
      "cluster-x",
      forceX<SimNode>((node) =>
        width * (stableUnit(`cluster-x:${node.cluster ?? node.kind}`) - 0.5) * 0.52,
      ).strength(0.085),
    )
    .force(
      "cluster-y",
      forceY<SimNode>((node) =>
        height * (stableUnit(`cluster-y:${node.cluster ?? node.kind}`) - 0.5) * 0.46,
      ).strength(0.05),
    )
    .alphaDecay(QUARTZ_ALPHA_DECAY)
    .velocityDecay(QUARTZ_VELOCITY_DECAY);
  return simulation as Simulation<SimNode, SimLink>;
}

export async function createThoughtTopologyRenderer(
  host: HTMLElement,
  initialGraph: QuartzBrainGraph,
  initialOptions: QuartzBrainRendererOptions,
): Promise<QuartzBrainRendererController> {
  if (!canUseWebGl()) {
    initialOptions.onFailure?.("webgl");
    throw new Error("webgl_unavailable");
  }

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let options = initialOptions;
  let graph = initialGraph;
  let width = Math.max(320, host.clientWidth);
  let height = Math.max(360, host.clientHeight);
  let destroyed = false;
  let hoveredId: string | null = null;
  let hoveredEdgeId: string | null = null;
  let searchQuery = "";
  let searchMatches = new Set<string>();
  let currentTransform = zoomIdentity;
  let animationFrame = 0;
  let settleStartedAt = performance.now();
  let draggingNodeId: string | null = null;
  let lastRightClick: { id: string; at: number } | null = null;
  const rootStyle = getComputedStyle(document.documentElement);
  const darkMode = document.documentElement.dataset.theme === "dark";
  const labelInk = rootStyle.getPropertyValue("--ink-heading").trim() ||
    (darkMode ? "#e2e7de" : "#0f1a16");
  const labelHalo = rootStyle.getPropertyValue("--paper-bg").trim() ||
    (darkMode ? "#0b0c0a" : "#e6f0e6");
  const edgePalette = darkMode
    ? {
        canonical: 0x9aa9a0,
        derived: 0x69756e,
        conversation: 0xb4a2d4,
        selected: 0x60a5fa,
        search: 0xfacc15,
      }
    : {
        canonical: 0x40544b,
        derived: 0x718078,
        conversation: 0x66538a,
        selected: 0x1d4ed8,
        search: 0xa16207,
      };

  const app = new Application();
  try {
    await app.init({
      width,
      height,
      antialias: true,
      autoStart: false,
      autoDensity: true,
      backgroundAlpha: 0,
      preference: "webgl",
      resolution: Math.min(2, window.devicePixelRatio || 1),
      eventMode: "static",
    });
  } catch (error) {
    options.onFailure?.("initialization");
    throw error;
  }
  if (destroyed) {
    app.destroy(true, { children: true });
    throw new Error("renderer_destroyed");
  }
  // React Strict Mode deliberately starts, cleans up, and restarts effects in
  // development. Initializing Pixi is asynchronous, so two renderer instances
  // can briefly overlap. Append this instance instead of replacing the host:
  // the stale controller can then remove only its own canvas without erasing
  // the live renderer's canvas.
  host.append(app.canvas);
  app.canvas.setAttribute("aria-hidden", "true");
  app.canvas.style.width = "100%";
  app.canvas.style.height = "100%";
  app.canvas.style.display = "block";

  const callout = document.createElement("div");
  callout.className = "profile-thought-topology-callout";
  callout.setAttribute("aria-hidden", "true");
  host.append(callout);

  const linkLayer = new Container<Graphics>({ zIndex: 1, isRenderGroup: true });
  const nodeLayer = new Container<Graphics>({ zIndex: 2, isRenderGroup: true });
  const labelLayer = new Container<Text>({ zIndex: 3, isRenderGroup: true });
  app.stage.addChild(linkLayer, nodeLayer, labelLayer);

  const nodes = new Map<string, SimNode>();
  const nodeRenders = new Map<string, NodeRenderData>();
  const linkRenders = new Map<string, LinkRenderData>();
  let links: SimLink[] = [];
  let priorityLabelIds = new Set<string>();
  const permanentHomes = new Map<string, { x: number; y: number }>();
  const returnTargets = new Map<string, { x: number; y: number; pin: boolean }>();
  let renderedCalloutKey: string | null = null;

  function updateLabelPriorities(nextGraph: QuartzBrainGraph): void {
    const budget = nextGraph.nodes.length > 700 ? 42 : nextGraph.nodes.length > 300 ? 64 : 90;
    const ranked = [...nextGraph.nodes].sort((left, right) =>
      right.weight - left.weight || left.label.localeCompare(right.label),
    );
    priorityLabelIds = new Set([
      ...ranked.slice(0, budget).map((node) => node.id),
      ...nextGraph.nodes
        .filter((node) => node.kind === "user" || node.kind === "organization" || node.kind === "garden")
        .map((node) => node.id),
    ]);
  }
  updateLabelPriorities(graph);

  const stored = readLayout(options.layoutStorageKey);
  for (const source of graph.nodes) {
    const node: SimNode = { ...source };
    const position = stored.permanentHomes?.[source.id];
    if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
      node.x = position.x;
      node.y = position.y;
      node.fx = position.x;
      node.fy = position.y;
      permanentHomes.set(source.id, position);
    } else {
      // Let d3's deterministic phyllotaxis seed provide the legacy map's
      // visible scatter before the nodes settle into their clusters.
      node.x = Number.NaN;
      node.y = Number.NaN;
    }
    nodes.set(node.id, node);
  }

  function rebuildLinks(next: QuartzBrainGraph): SimLink[] {
    return next.links.flatMap((link) => {
      const source = nodes.get(link.source);
      const target = nodes.get(link.target);
      return source && target
        ? [{ id: link.id, source, target, graphLink: link } satisfies SimLink]
        : [];
    });
  }

  function distanceToLink(link: SimLink, x: number, y: number): number {
    const x1 = (link.source.x ?? 0) + width / 2;
    const y1 = (link.source.y ?? 0) + height / 2;
    const x2 = (link.target.x ?? 0) + width / 2;
    const y2 = (link.target.y ?? 0) + height / 2;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;
    const unit = lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSquared));
    return Math.hypot(x - (x1 + unit * dx), y - (y1 + unit * dy));
  }
  links = rebuildLinks(graph);
  const simulation = makeSimulation([...nodes.values()], links, width, height);
  const returnForce = () => {
    for (const [id, target] of returnTargets) {
      const node = nodes.get(id);
      if (!node) {
        returnTargets.delete(id);
        continue;
      }
      const dx = target.x - (node.x ?? target.x);
      const dy = target.y - (node.y ?? target.y);
      node.vx = (node.vx ?? 0) + dx * 0.18;
      node.vy = (node.vy ?? 0) + dy * 0.18;
      if (Math.hypot(dx, dy) < 0.7 && Math.hypot(node.vx ?? 0, node.vy ?? 0) < 0.4) {
        node.x = target.x;
        node.y = target.y;
        node.vx = 0;
        node.vy = 0;
        node.fx = target.pin ? target.x : null;
        node.fy = target.pin ? target.y : null;
        returnTargets.delete(id);
      }
    }
  };
  simulation.force("return-home", returnForce);

  function drawStaticNode(render: NodeRenderData): void {
    const style = quartzBrainNodeStyle(render.node.kind, render.node.weight, darkMode);
    render.graphic
      .clear()
      .circle(0, 0, style.radius + style.halo)
      .fill({ color: style.color, alpha: 0.22 })
      .circle(0, 0, style.radius)
      .fill({ color: style.color, alpha: 0.98 })
      .stroke({ width: 1.5, color: style.color, alpha: 1 });
    render.ring
      .clear()
      .circle(0, 0, style.radius + style.halo + 3)
      .stroke({ width: 2.4, color: edgePalette.search, alpha: 1 });
  }

  function createNodeRender(node: SimNode): NodeRenderData {
    const style = quartzBrainNodeStyle(node.kind, node.weight, darkMode);
    const ring = new Graphics({ interactive: false, eventMode: "none" });
    ring.alpha = 0;
    const graphic = new Graphics({
      interactive: true,
      eventMode: "static",
      cursor: "pointer",
      label: node.id,
      hitArea: new Circle(0, 0, style.radius + 9),
    });
    const label = new Text({
      text: node.label,
      alpha: 0,
      anchor: { x: 0.5, y: 1.25 },
      eventMode: "none",
      style: {
        fontSize: 12,
        fill: labelInk,
        fontFamily: "Inter, system-ui, sans-serif",
        fontWeight: node.kind === "user" || node.kind === "organization" ? "600" : "400",
        stroke: { color: labelHalo, width: 2.5, join: "round" },
        dropShadow: {
          color: darkMode ? 0x000000 : 0xffffff,
          alpha: 0.5,
          blur: 2,
          distance: 0,
        },
      },
      resolution: Math.min(4, (window.devicePixelRatio || 1) * 2),
    });
    label.scale.set(0.92);
    const render: NodeRenderData = {
      node,
      graphic,
      ring,
      label,
      targetAlpha: 1,
      targetLabelAlpha: 0,
      targetRingAlpha: 0,
    };
    drawStaticNode(render);
    graphic
      .on("pointerover", () => {
        hoveredId = node.id;
        options.onHover?.(node.id);
        applyVisualState();
      })
      .on("pointerleave", () => {
        hoveredId = null;
        options.onHover?.(null);
        applyVisualState();
      });
    nodeLayer.addChild(ring, graphic);
    labelLayer.addChild(label);
    return render;
  }

  function syncRenderObjects(): void {
    for (const [id, render] of nodeRenders) {
      if (nodes.has(id)) continue;
      render.graphic.destroy();
      render.ring.destroy();
      render.label.destroy();
      nodeRenders.delete(id);
    }
    for (const node of nodes.values()) {
      const existing = nodeRenders.get(node.id);
      if (existing) {
        existing.node = node;
        existing.label.text = node.label;
        drawStaticNode(existing);
      } else {
        nodeRenders.set(node.id, createNodeRender(node));
      }
    }

    const linkIds = new Set(links.map((link) => link.id));
    for (const [id, render] of linkRenders) {
      if (linkIds.has(id)) continue;
      render.graphic.destroy();
      linkRenders.delete(id);
    }
    for (const link of links) {
      const existing = linkRenders.get(link.id);
      if (existing) {
        existing.link = link;
      } else {
        const graphic = new Graphics({
          interactive: true,
          eventMode: "static",
          cursor: "pointer",
          label: link.id,
        });
        graphic.on("pointerover", () => {
          hoveredEdgeId = link.id;
          applyVisualState();
        });
        graphic.on("pointerleave", () => {
          if (hoveredEdgeId === link.id) hoveredEdgeId = null;
          applyVisualState();
        });
        graphic.on("pointertap", (event) => {
          event.stopPropagation();
          const point = app.stage.toLocal(event.global);
          const closest = [...linkRenders.values()]
            .filter((candidate) => visible(candidate.link.source.id) && visible(candidate.link.target.id))
            .sort((left, right) =>
              distanceToLink(left.link, point.x, point.y) -
              distanceToLink(right.link, point.x, point.y),
            )[0];
          options.onSelectEdge?.(closest?.link.id ?? link.id);
        });
        linkLayer.addChild(graphic);
        linkRenders.set(link.id, { link, graphic, targetAlpha: 0.25 });
      }
    }
  }
  syncRenderObjects();

  function visible(id: string): boolean {
    return !options.visibleNodeIds || options.visibleNodeIds.has(id);
  }

  function applyVisualTargets(): void {
    const focus = quartzFocusState(graph, hoveredId);
    const selected = options.selectedNodeIds ?? new Set<string>();
    const selectedEdges = options.selectedEdgeIds ?? new Set<string>();
    const evidenceNodes = options.evidenceNodeIds ?? new Set<string>();
    const evidenceEdges = options.evidenceEdgeIds ?? new Set<string>();
    const searching = searchQuery.trim().length > 0;
    const evidenceMode = evidenceNodes.size > 0 || evidenceEdges.size > 0;
    const connectionMode = selectedEdges.size > 0;
    const selectedEndpoints = new Set<string>();
    for (const render of linkRenders.values()) {
      if (!selectedEdges.has(render.link.id) && hoveredEdgeId !== render.link.id) continue;
      selectedEndpoints.add(render.link.source.id);
      selectedEndpoints.add(render.link.target.id);
    }
    for (const render of nodeRenders.values()) {
      const id = render.node.id;
      const isVisible = visible(id);
      const isSearch = searchMatches.has(id);
      const isSelected = selected.has(id);
      const isEvidence = evidenceNodes.has(id);
      const isConnectionEndpoint = selectedEndpoints.has(id);
      const isFocused = focus.activeNodes.has(id);
      let alpha = isVisible ? 1 : 0;
      if (isVisible && searching) alpha = isSearch ? 1 : 0.12;
      else if (isVisible && hoveredId) alpha = isFocused ? 1 : 0.2;
      else if (isVisible && hoveredEdgeId) alpha = isConnectionEndpoint ? 1 : 0.22;
      else if (isVisible && evidenceMode) alpha = isEvidence ? 1 : 0.16;
      else if (isVisible && connectionMode) alpha = isConnectionEndpoint ? 1 : 0.24;
      render.targetAlpha = alpha;
      render.targetRingAlpha = isSearch || isSelected || isEvidence || isConnectionEndpoint ? 0.95 : 0;
      const anchor = render.node.kind === "user" || render.node.kind === "organization" || render.node.kind === "garden";
      const major = render.node.weight >= 0.35 || anchor;
      const priority = priorityLabelIds.has(id);
      const forcedLabel = hoveredId === id || draggingNodeId === id || isSelected || isEvidence || isConnectionEndpoint || isSearch;
      const labelAlpha = quartzLabelAlpha(currentTransform.k, {
        hovered: hoveredId === id,
        selected: isSelected || isEvidence || isConnectionEndpoint,
        searchMatch: isSearch,
      });
      render.targetLabelAlpha = !isVisible
        ? 0
        : forcedLabel
          ? labelAlpha
          : anchor
          ? Math.max(0.88, labelAlpha)
          : priority
            ? labelAlpha
            : currentTransform.k >= 1.55 && major
              ? labelAlpha * 0.78
              : currentTransform.k >= 2.15
                ? labelAlpha * 0.62
              : 0;
      render.graphic.eventMode = isVisible ? "static" : "none";
    }

    for (const render of linkRenders.values()) {
      const { link } = render;
      const isVisible = visible(link.source.id) && visible(link.target.id);
      const touchesSearch =
        searchMatches.has(link.source.id) || searchMatches.has(link.target.id);
      const isFocused = focus.activeLinks.has(link.id);
      const isEvidence = evidenceEdges.has(link.id);
      const isSelected = selectedEdges.has(link.id);
      const isHovered = hoveredEdgeId === link.id;
      let alpha = link.graphLink.origin === "gbrain-derived" || link.graphLink.origin === "thought-topology" ? 0.3 : 0.48;
      if (!isVisible) alpha = 0;
      else if (isSelected || isHovered) alpha = 1;
      else if (searching) alpha = touchesSearch ? 0.96 : 0.06;
      else if (hoveredId) alpha = isFocused ? 1 : 0.1;
      else if (hoveredEdgeId) alpha = 0.08;
      else if (evidenceMode) alpha = isEvidence ? 1 : 0.075;
      else if (connectionMode) alpha = 0.1;
      render.targetAlpha = alpha;
      render.graphic.eventMode = isVisible ? "static" : "none";
    }
  }

  function appendMathText(target: HTMLElement, value: string): void {
    const delimiter = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<!\\)\$((?:\\.|[^$\n])+?)(?<!\\)\$/g;
    let cursor = 0;
    for (const match of value.matchAll(delimiter)) {
      const index = match.index ?? 0;
      if (index > cursor) target.append(document.createTextNode(value.slice(cursor, index)));
      const displayMode = match[1] !== undefined || match[2] !== undefined;
      const formula = match[1] ?? match[2] ?? match[3] ?? match[4] ?? "";
      const math = document.createElement("span");
      math.className = displayMode
        ? "profile-thought-topology-math profile-thought-topology-math-display"
        : "profile-thought-topology-math";
      try {
        katex.render(formula, math, {
          displayMode,
          output: "htmlAndMathml",
          strict: "ignore",
          throwOnError: true,
          trust: false,
        });
      } catch {
        math.textContent = match[0];
      }
      target.append(math);
      cursor = index + match[0].length;
    }
    if (cursor < value.length) target.append(document.createTextNode(value.slice(cursor)));
  }

  function calloutLine(tag: "h3" | "p", className: string, value: string): HTMLElement {
    const line = document.createElement(tag);
    line.className = className;
    appendMathText(line, value);
    return line;
  }

  function displayRelation(value: string): string {
    return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
  }

  function affinityLabel(weight: number): string {
    const normalized = Math.max(0, Math.min(1, weight / 1.5));
    return normalized >= 0.72 ? "Strong" : normalized >= 0.42 ? "Moderate" : "Light";
  }

  function renderNodeCallout(node: SimNode): void {
    const metadata = node.metadata;
    const details = [
      displayRelation(node.kind),
      metadata.gardenSlug,
      `${metadata.metrics?.degree ?? 0} connections`,
    ].filter(Boolean).join(" · ");
    callout.replaceChildren(
      calloutLine("h3", "profile-thought-topology-callout-title", node.label),
      ...(metadata.subtitle
        ? [calloutLine("p", "profile-thought-topology-callout-summary", metadata.subtitle)]
        : []),
      calloutLine("p", "profile-thought-topology-callout-meta", details),
    );
  }

  function renderEdgeCallout(link: SimLink): void {
    const edge = link.graphLink;
    const normalized = edge.metadata.semanticRelation
      ? Math.max(0, Math.min(1, edge.weight))
      : Math.max(0, Math.min(1, edge.weight / 1.5));
    callout.replaceChildren(
      calloutLine(
        "h3",
        "profile-thought-topology-callout-title",
        `${link.source.label} ${edge.relation === "contains" || edge.relation === "owns" ? "→" : "↔"} ${link.target.label}`,
      ),
      calloutLine(
        "p",
        "profile-thought-topology-callout-meta",
        `${displayRelation(edge.metadata.semanticRelation ?? edge.relation)} · ${affinityLabel(normalized * 1.5)} affinity · ${normalized.toFixed(2)}`,
      ),
      calloutLine(
        "p",
        "profile-thought-topology-callout-summary",
        edge.metadata.explanation || (edge.explicit
          ? `This connection is authored in ${edge.origin}.`
          : `This connection is inferred from ${edge.origin}.`),
      ),
    );
  }

  function syncFloatingCallout(): void {
    const selectedNodes = [...(options.selectedNodeIds ?? [])];
    const selectedEdges = [...(options.selectedEdgeIds ?? [])];
    const node = hoveredId
      ? nodes.get(hoveredId)
      : selectedNodes.length
        ? nodes.get(selectedNodes[selectedNodes.length - 1])
        : undefined;
    const link = !node
      ? hoveredEdgeId
        ? linkRenders.get(hoveredEdgeId)?.link
        : selectedEdges.length
          ? linkRenders.get(selectedEdges[selectedEdges.length - 1])?.link
          : undefined
      : undefined;
    if (!node && !link) {
      callout.classList.remove("is-visible");
      callout.setAttribute("aria-hidden", "true");
      renderedCalloutKey = null;
      return;
    }
    const key = node ? `node:${node.id}` : `edge:${link!.id}`;
    if (renderedCalloutKey !== key) {
      renderedCalloutKey = key;
      if (node) renderNodeCallout(node);
      else renderEdgeCallout(link!);
    }
    const anchorX = node
      ? currentTransform.applyX((node.x ?? 0) + width / 2)
      : currentTransform.applyX(((link!.source.x ?? 0) + (link!.target.x ?? 0)) / 2 + width / 2);
    const anchorY = node
      ? currentTransform.applyY((node.y ?? 0) + height / 2)
      : currentTransform.applyY(((link!.source.y ?? 0) + (link!.target.y ?? 0)) / 2 + height / 2);
    callout.classList.add("is-visible");
    callout.setAttribute("aria-hidden", "false");
    const padding = 12;
    const calloutWidth = Math.min(callout.offsetWidth || 320, Math.max(180, width - padding * 2));
    const calloutHeight = callout.offsetHeight || 120;
    let left = anchorX + 20;
    if (left + calloutWidth > width - padding) left = anchorX - calloutWidth - 20;
    left = Math.max(padding, Math.min(width - calloutWidth - padding, left));
    const top = Math.max(
      padding,
      Math.min(height - calloutHeight - padding, anchorY - calloutHeight * 0.22),
    );
    callout.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  }

  function renderScene(): void {
    if (destroyed) return;
    for (const render of nodeRenders.values()) {
      const x = (render.node.x ?? 0) + width / 2;
      const y = (render.node.y ?? 0) + height / 2;
      render.graphic.position.set(x, y);
      render.ring.position.set(x, y);
      render.label.position.set(x, y);
    }
    for (const render of linkRenders.values()) {
      const { source, target, graphLink } = render.link;
      const selected = options.selectedEdgeIds?.has(render.link.id) ?? false;
      const evidence = options.evidenceEdgeIds?.has(render.link.id) ?? false;
      const color = selected || evidence
        ? edgePalette.selected
        : graphLink.origin === "gbrain-derived" || graphLink.origin === "thought-topology"
        ? edgePalette.derived
        : graphLink.origin === "buzz" || graphLink.origin === "conversation"
          ? edgePalette.conversation
          : edgePalette.canonical;
      const x1 = (source.x ?? 0) + width / 2;
      const y1 = (source.y ?? 0) + height / 2;
      const x2 = (target.x ?? 0) + width / 2;
      const y2 = (target.y ?? 0) + height / 2;
      const normalizedWeight = Math.max(0, Math.min(1, graphLink.weight / 1.5));
      const restingWidth = 0.8 + normalizedWeight * 4.4;
      const lineWidth = (selected || evidence ? restingWidth + 1.5 : restingWidth) /
        Math.max(0.25, currentTransform.k);
      render.graphic
        .clear()
        // A transparent wide stroke makes thin relationships practical to
        // select without visually turning the map into a set of cables.
        .moveTo(x1, y1)
        .lineTo(x2, y2)
        .stroke({ alpha: 0.001, width: 14 / Math.max(0.25, currentTransform.k), color })
        .moveTo(x1, y1)
        .lineTo(x2, y2)
        .stroke({
          alpha: 1,
          width: lineWidth,
          color,
        });
    }
    syncFloatingCallout();
    app.renderer.render(app.stage);
  }

  function applyVisualState(): void {
    applyVisualTargets();
    cancelAnimationFrame(animationFrame);
    const started = performance.now();
    const duration = reducedMotion ? 0 : 200;
    const starts = [...nodeRenders.values()].map((render) => ({
      render,
      alpha: render.graphic.alpha,
      label: render.label.alpha,
      ring: render.ring.alpha,
    }));
    const linkStarts = [...linkRenders.values()].map((render) => ({
      render,
      alpha: render.graphic.alpha,
    }));
    const tick = (time: number) => {
      if (destroyed) return;
      const progress = duration === 0 ? 1 : Math.min(1, (time - started) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      for (const item of starts) {
        item.render.graphic.alpha = item.alpha + (item.render.targetAlpha - item.alpha) * eased;
        item.render.label.alpha = item.label + (item.render.targetLabelAlpha - item.label) * eased;
        item.render.ring.alpha = item.ring + (item.render.targetRingAlpha - item.ring) * eased;
      }
      for (const item of linkStarts) {
        item.render.graphic.alpha = item.alpha + (item.render.targetAlpha - item.alpha) * eased;
      }
      renderScene();
      if (progress < 1) animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
  }

  simulation.on("tick", renderScene).on("end", () => {
    for (const [id, target] of returnTargets) {
      const node = nodes.get(id);
      if (!node) continue;
      node.x = target.x;
      node.y = target.y;
      node.vx = 0;
      node.vy = 0;
      node.fx = target.pin ? target.x : null;
      node.fy = target.pin ? target.y : null;
    }
    returnTargets.clear();
    renderScene();
    writeLayout(options.layoutStorageKey, permanentHomes, currentTransform);
    options.onSettled?.(Math.round(performance.now() - settleStartedAt));
  });
  if (reducedMotion) {
    simulation.stop();
    simulation.tick(240);
    renderScene();
  }

  const canvasSelection = select<HTMLCanvasElement, unknown>(app.canvas);
  let dragging = false;
  type DragState = {
    node: SimNode;
    moved: number;
    permanent: boolean;
    pointer: { x: number; y: number };
    start: { x: number; y: number };
  };
  let dragState: DragState | null = null;
  let nextDragIsPermanent = false;
  canvasSelection.call(
    drag<HTMLCanvasElement, unknown>()
      .filter((event) => {
        const accepted = !event.ctrlKey && (event.button === 0 || event.button === 2);
        if (accepted) nextDragIsPermanent = event.button === 2;
        return accepted;
      })
      .container(() => app.canvas)
      .subject((event) => {
        const node = hoveredId ? nodes.get(hoveredId) : undefined;
        return node ? { x: event.x, y: event.y, node } : (undefined as unknown as object);
      })
      .on("start", (event) => {
        const subject = event.subject as { node?: SimNode } | undefined;
        const node = subject?.node;
        if (!node) return;
        const source = event.sourceEvent as MouseEvent | undefined;
        const permanent = nextDragIsPermanent || source?.button === 2 || Boolean((source?.buttons ?? 0) & 2);
        nextDragIsPermanent = false;
        dragging = true;
        draggingNodeId = node.id;
        returnTargets.delete(node.id);
        if (!event.active && !reducedMotion) simulation.alphaTarget(0.8).restart();
        dragState = {
          node,
          moved: 0,
          permanent,
          pointer: { x: source?.clientX ?? event.x, y: source?.clientY ?? event.y },
          start: { x: node.x ?? 0, y: node.y ?? 0 },
        };
        node.fx = node.x;
        node.fy = node.y;
        applyVisualState();
      })
      .on("drag", (event) => {
        if (!dragState) return;
        const source = event.sourceEvent as PointerEvent | undefined;
        const clientX = source?.clientX ?? event.x;
        const clientY = source?.clientY ?? event.y;
        dragState.moved = Math.max(
          dragState.moved,
          Math.hypot(clientX - dragState.pointer.x, clientY - dragState.pointer.y),
        );
        if (dragState.moved <= 5) return;
        const subject = event.subject as { x: number; y: number };
        const x = dragState.start.x + (event.x - subject.x) / currentTransform.k;
        const y = dragState.start.y + (event.y - subject.y) / currentTransform.k;
        dragState.node.x = x;
        dragState.node.y = y;
        dragState.node.fx = x;
        dragState.node.fy = y;
      })
      .on("end", (event) => {
        if (!dragState) return;
        const state = dragState;
        dragState = null;
        dragging = false;
        draggingNodeId = null;
        if (!event.active && !reducedMotion) simulation.alphaTarget(0);
        if (state.moved <= 5) {
          const home = permanentHomes.get(state.node.id);
          state.node.fx = home?.x ?? null;
          state.node.fy = home?.y ?? null;
          if (state.permanent) {
            const now = performance.now();
            if (lastRightClick?.id === state.node.id && now - lastRightClick.at <= 500) {
              lastRightClick = null;
              options.onOpen?.(state.node.id, state.node.href);
            } else {
              lastRightClick = { id: state.node.id, at: now };
            }
          } else {
            lastRightClick = null;
            options.onSelect?.(
              state.node.id,
              Boolean(event.sourceEvent?.shiftKey || event.sourceEvent?.ctrlKey || event.sourceEvent?.metaKey),
            );
          }
          applyVisualState();
          return;
        }
        lastRightClick = null;
        if (state.permanent) {
          const home = { x: state.node.x ?? state.start.x, y: state.node.y ?? state.start.y };
          permanentHomes.set(state.node.id, home);
          state.node.fx = home.x;
          state.node.fy = home.y;
          writeLayout(options.layoutStorageKey, permanentHomes, currentTransform);
        } else if (reducedMotion) {
          state.node.x = state.start.x;
          state.node.y = state.start.y;
          const home = permanentHomes.get(state.node.id);
          state.node.fx = home?.x ?? null;
          state.node.fy = home?.y ?? null;
        } else {
          state.node.fx = null;
          state.node.fy = null;
          returnTargets.set(state.node.id, {
            ...state.start,
            pin: permanentHomes.has(state.node.id),
          });
          simulation.alpha(0.42).restart();
        }
        applyVisualState();
      }),
  );

  const preventNodeContextMenu = (event: MouseEvent) => {
    if (hoveredId) event.preventDefault();
  };
  app.canvas.addEventListener("contextmenu", preventNodeContextMenu);

  const zoomBehavior: ZoomBehavior<HTMLCanvasElement, unknown> =
    zoom<HTMLCanvasElement, unknown>()
      .extent([
        [0, 0],
        [width, height],
      ])
      .scaleExtent([0.25, 4])
      .filter((event) => !dragging && (!event.button || event.type === "wheel"))
      .on("zoom", ({ transform }) => {
        currentTransform = transform;
        app.stage.scale.set(transform.k);
        app.stage.position.set(transform.x, transform.y);
        applyVisualState();
      })
      .on("end", () => writeLayout(options.layoutStorageKey, permanentHomes, currentTransform));
  canvasSelection.call(zoomBehavior).on("dblclick.zoom", null);

  if (stored.viewport) {
    const restored = zoomIdentity
      .translate(stored.viewport.x, stored.viewport.y)
      .scale(Math.max(0.25, Math.min(4, stored.viewport.k)));
    canvasSelection.call(zoomBehavior.transform, restored);
  }

  function fitToView(): void {
    const visibleNodes = [...nodes.values()].filter((node) => visible(node.id));
    if (visibleNodes.length === 0) return;
    const minX = Math.min(...visibleNodes.map((node) => node.x ?? 0));
    const maxX = Math.max(...visibleNodes.map((node) => node.x ?? 0));
    const minY = Math.min(...visibleNodes.map((node) => node.y ?? 0));
    const maxY = Math.max(...visibleNodes.map((node) => node.y ?? 0));
    const graphWidth = Math.max(80, maxX - minX + 80);
    const graphHeight = Math.max(80, maxY - minY + 80);
    const k = Math.max(0.25, Math.min(2.2, 0.88 * Math.min(width / graphWidth, height / graphHeight)));
    const centerX = (minX + maxX) / 2 + width / 2;
    const centerY = (minY + maxY) / 2 + height / 2;
    const transform = zoomIdentity
      .translate(width / 2 - centerX * k, height / 2 - centerY * k)
      .scale(k);
    canvasSelection.call(zoomBehavior.transform, transform);
  }

  const resizeObserver = new ResizeObserver(() => {
    const nextWidth = Math.max(320, host.clientWidth);
    const nextHeight = Math.max(360, host.clientHeight);
    if (nextWidth === width && nextHeight === height) return;
    width = nextWidth;
    height = nextHeight;
    app.renderer.resize(width, height);
    zoomBehavior.extent([
      [0, 0],
      [width, height],
    ]);
    simulation
      .force("cluster-x", forceX<SimNode>((node) =>
        width * (stableUnit(`cluster-x:${node.cluster ?? node.kind}`) - 0.5) * 0.52,
      ).strength(0.085))
      .force("cluster-y", forceY<SimNode>((node) =>
        height * (stableUnit(`cluster-y:${node.cluster ?? node.kind}`) - 0.5) * 0.46,
      ).strength(0.05));
    renderScene();
  });
  resizeObserver.observe(host);

  const onContextLost = (event: Event) => {
    event.preventDefault();
    simulation.stop();
    options.onFailure?.("context-lost");
  };
  const onContextRestored = () => {
    renderScene();
    if (!reducedMotion) simulation.alpha(0.12).restart();
  };
  app.canvas.addEventListener("webglcontextlost", onContextLost);
  app.canvas.addEventListener("webglcontextrestored", onContextRestored);

  applyVisualState();

  return {
    updateGraph(nextGraph, selectedParentId) {
      graph = nextGraph;
      updateLabelPriorities(nextGraph);
      const nextIds = new Set(nextGraph.nodes.map((node) => node.id));
      for (const id of nodes.keys()) {
        if (!nextIds.has(id)) {
          nodes.delete(id);
          returnTargets.delete(id);
        }
      }
      for (const source of nextGraph.nodes) {
        const existing = nodes.get(source.id);
        if (existing) {
          Object.assign(existing, source);
          continue;
        }
        const node: SimNode = { ...source };
        const parent = selectedParentId ? nodes.get(selectedParentId) : undefined;
        if (parent && Number.isFinite(parent.x) && Number.isFinite(parent.y)) {
          node.x = parent.x! + (stableUnit(`expand-x:${node.id}`) - 0.5) * 64;
          node.y = parent.y! + (stableUnit(`expand-y:${node.id}`) - 0.5) * 64;
        } else {
          node.x = Number.NaN;
          node.y = Number.NaN;
        }
        nodes.set(node.id, node);
      }
      links = rebuildLinks(nextGraph);
      syncRenderObjects();
      renderedCalloutKey = null;
      searchMatches = graphSearchMatches(graph, searchQuery);
      simulation.nodes([...nodes.values()]);
      const linkForce = simulation.force("link") as ReturnType<typeof forceLink<SimNode, SimLink>>;
      linkForce.links(links);
      settleStartedAt = performance.now();
      if (reducedMotion) {
        simulation.stop();
        simulation.alpha(0.2).tick(80);
        renderScene();
      } else {
        simulation.alpha(0.28).restart();
      }
      applyVisualState();
    },
    updateOptions(nextOptions) {
      if (
        nextOptions.layoutStorageKey &&
        nextOptions.layoutStorageKey !== options.layoutStorageKey
      ) {
        writeLayout(options.layoutStorageKey, permanentHomes, currentTransform);
      }
      options = { ...options, ...nextOptions };
      applyVisualState();
    },
    setSearch(query) {
      searchQuery = query;
      searchMatches = graphSearchMatches(graph, query);
      applyVisualState();
    },
    focusNode(nodeId) {
      const node = nodes.get(nodeId);
      if (!node) return;
      const k = Math.max(1.25, currentTransform.k);
      const x = (node.x ?? 0) + width / 2;
      const y = (node.y ?? 0) + height / 2;
      canvasSelection.call(
        zoomBehavior.transform,
        zoomIdentity.translate(width / 2 - x * k, height / 2 - y * k).scale(k),
      );
    },
    fitToView,
    zoomBy(factor) {
      canvasSelection.call(zoomBehavior.scaleBy, Math.max(0.5, Math.min(2, factor)));
    },
    resetLayout() {
      try {
        localStorage.removeItem(options.layoutStorageKey);
      } catch {
        // See writeLayout.
      }
      permanentHomes.clear();
      returnTargets.clear();
      for (const node of nodes.values()) {
        node.fx = null;
        node.fy = null;
        node.x = Number.NaN;
        node.y = Number.NaN;
      }
      simulation.nodes([...nodes.values()]);
      canvasSelection.call(zoomBehavior.transform, zoomIdentity);
      settleStartedAt = performance.now();
      if (reducedMotion) {
        simulation.stop();
        simulation.alpha(1).tick(240);
        renderScene();
      } else {
        simulation.alpha(1).restart();
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      writeLayout(options.layoutStorageKey, permanentHomes, currentTransform);
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      simulation.stop();
      canvasSelection.on(".drag", null).on(".zoom", null);
      app.canvas.removeEventListener("webglcontextlost", onContextLost);
      app.canvas.removeEventListener("webglcontextrestored", onContextRestored);
      app.canvas.removeEventListener("contextmenu", preventNodeContextMenu);
      if (app.canvas.parentElement === host) app.canvas.remove();
      callout.remove();
      app.destroy(true, { children: true, texture: true, textureSource: true });
    },
  };
}
