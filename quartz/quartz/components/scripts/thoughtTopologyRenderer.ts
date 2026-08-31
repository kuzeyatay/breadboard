// Thought Topology renderer: Garden → folders → pages as a direct node-link map
// with sparse, weighted semantic lines on top. Layout math lives in
// thoughtTopologyLayout.ts; this file owns Pixi drawing, d3 zoom/drag, the
// floating callout DOM, and the search wiring. The links-mode graph in
// graph.inline.ts is untouched by anything here.
import {
  select,
  zoom,
  zoomIdentity,
  drag,
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
  type ZoomTransform,
} from "d3"
import katex from "katex"
import { Application, Circle, Container, Graphics, Text } from "pixi.js"
import { FullSlug, SimpleSlug, resolveRelative } from "../../util/path"
import type { D3Config } from "../Graph"
import {
  affinityLabel,
  boundsOf,
  displayFolderTitle,
  fitTransform,
  folderLabelSides,
  gardenOverview,
  naturalCompare,
  pageLabelBudget,
  pageLabelSides,
  placeLabels,
  planThoughtTopology,
  readableSummary,
  relationLabel,
  truncateLabel,
  type ClipRect,
  type Insets,
  type LabelCandidate,
  type LabelObstacle,
  type LabelPlacement,
  type LabelSide,
  type PlannedEdge,
  type PlannedNode,
  type TopologyPayload,
  type ViewTransform,
} from "./thoughtTopologyLayout"

export interface ThoughtTopologyRenderContext {
  scopeCluster: string
  scopeFolderPath: string | null
  configuredDepth: number
}

type NodeStyle = "rest" | "related" | "hovered" | "selected"

type SimNode = PlannedNode & SimulationNodeDatum

type SimLink = SimulationLinkDatum<SimNode> & {
  source: SimNode
  target: SimNode
  distance: number
}

type NodeView = {
  node: SimNode
  gfx: Graphics
  label: Text
  placement: LabelPlacement | null
  labelAlpha: number
  labelTarget: number
  alpha: number
  alphaTarget: number
  style: NodeStyle
}

type EdgeView = {
  kind: "semantic" | "hierarchy"
  edge: PlannedEdge
  gfx: Graphics
  source: NodeView
  target: NodeView
  alpha: number
  alphaTarget: number
  color: string
  widthBoost: number
  selected: boolean
}

type HierarchyView = EdgeView & { kind: "hierarchy" }

type FloatingCalloutTarget = { kind: "node"; view: NodeView } | { kind: "edge"; view: EdgeView }

const CLICK_SLOP_PX = 5
const RIGHT_DOUBLE_CLICK_MS = 500
const PAGE_LABEL_LENGTH = 34
const FOLDER_LABEL_LENGTH = 44
// v2 intentionally ignores positions saved by the old left-drag behavior.
const POSITION_STORAGE_PREFIX = "thought-topology-home-positions:v2:"

function readStoredPositions(slug: string): Record<string, { x: number; y: number }> {
  try {
    const raw = window.localStorage.getItem(`${POSITION_STORAGE_PREFIX}${slug}`)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function writeStoredPositions(slug: string, positions: Record<string, { x: number; y: number }>) {
  try {
    window.localStorage.setItem(`${POSITION_STORAGE_PREFIX}${slug}`, JSON.stringify(positions))
  } catch {
    // Layout customization is optional; storage failure must not break dragging.
  }
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export async function renderThoughtTopology(
  graph: HTMLElement,
  fullSlug: FullSlug,
  config: D3Config,
  payload: TopologyPayload,
  context: ThoughtTopologyRenderContext,
): Promise<() => void> {
  const preview =
    Boolean(config.preview) || document.documentElement.classList.contains("quartz-graph-preview")
  const interactive = !preview
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  const gardenSlug = payload.garden.slug
  const positionScope = context.scopeFolderPath
    ? `${gardenSlug}:folder:${context.scopeFolderPath}`
    : `${gardenSlug}:root`
  const storedPositions = interactive ? readStoredPositions(positionScope) : {}
  const plan = planThoughtTopology(payload, {
    preview,
    positionOverrides: storedPositions,
    scopeFolderPath: context.scopeFolderPath,
  })
  const homePositions = new Map(plan.nodes.map((node) => [node.id, { x: node.x, y: node.y }]))
  const debugEnabled = new URLSearchParams(window.location.search).get("topologyTest") === "1"

  // --- Surrounding DOM -----------------------------------------------------
  // The canvas' surface (.graph-outer or .global-graph-outer) owns the
  // heading/search column, floating callout, and, in the overlay, the close button.
  const outer = graph.parentElement
  const sibling = <T extends Element>(selector: string): T | null =>
    (outer?.querySelector(
      `:scope > ${selector}, :scope > .thought-topology-controls > ${selector}`,
    ) as T | null) ?? null
  const heading = sibling<HTMLElement>(".thought-topology-heading")
  const headingDescription = heading?.querySelector(
    ":scope > p:not(.thought-topology-analysis)",
  ) as HTMLElement | null
  const analysisLine = heading?.querySelector(".thought-topology-analysis") as HTMLElement | null
  const searchPanel = sibling<HTMLElement>(".global-graph-search")
  const calloutRoot = interactive ? sibling<HTMLElement>(".thought-callout") : null
  // Keep the content-builder helpers independent from the callout's position.
  const calloutContent = calloutRoot
  const overlayClose = sibling<HTMLElement>(".global-graph-close")
  if (heading) {
    heading.hidden = preview
    if (headingDescription) {
      headingDescription.textContent = plan.scopeFolder
        ? `Connections inside ${displayFolderTitle(plan.scopeFolder.title)}.`
        : "How the ideas in this garden are organized and connected."
    }
    if (analysisLine) {
      analysisLine.textContent = plan.analysis.notice
      analysisLine.hidden = !plan.analysis.notice
    }
  }
  // Thought Topology is an explorable map, not a page-search surface. Keep
  // node search available to the legacy links graph only.
  if (searchPanel) searchPanel.hidden = true
  const graphRoot = graph.closest(".graph") as HTMLElement | null
  if (graphRoot) graphRoot.dataset.activeMode = "thought-topology"

  let width = Math.max(graph.offsetWidth, 1)
  let height = Math.max(graph.offsetHeight, 1)

  // --- Palette -------------------------------------------------------------
  const cssVar = (name: string) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const isDark = document.documentElement.getAttribute("saved-theme") === "dark"
  const colors = isDark
    ? {
        garden: "#60a5fa",
        folder: "#22d3ee",
        page: "#4ade80",
        pageStrong: "#a3e635",
        edge: "#92a198",
        edgeActive: "#e8ede7",
        edgeSelected: "#60a5fa",
        search: "#facc15",
        text: cssVar("--dark") || "#f4f1e8",
        textMuted: cssVar("--darkgray") || "#e6ebe5",
        paper: cssVar("--light") || "#18181a",
      }
    : {
        garden: "#2563eb",
        folder: "#0e7490",
        page: "#15803d",
        pageStrong: "#4d7c0f",
        edge: "#40544b",
        edgeActive: "#0f1a16",
        edgeSelected: "#1d4ed8",
        search: "#a16207",
        text: cssVar("--dark") || "#0f1a16",
        textMuted: cssVar("--darkgray") || "#13201b",
        paper: cssVar("--light") || "#e6f0e6",
      }
  const fontFamily = cssVar("--bodyFont") || "system-ui, sans-serif"

  // --- Pixi ----------------------------------------------------------------
  const app = new Application()
  await app.init({
    width,
    height,
    antialias: true,
    autoStart: false,
    autoDensity: true,
    backgroundAlpha: 0,
    preference: "webgpu",
    resolution: window.devicePixelRatio,
    eventMode: "static",
  })
  graph.appendChild(app.canvas)

  const stage = app.stage
  stage.sortableChildren = true
  const world = new Container({ isRenderGroup: true, zIndex: 0 })
  world.sortableChildren = true
  const hierarchyLayer = new Container<Graphics>({ zIndex: 0 })
  const linkLayer = new Container<Graphics>({ zIndex: 1 })
  const nodeLayer = new Container<Graphics>({ zIndex: 2, sortableChildren: true })
  const labelLayer = new Container<Text>({ zIndex: 5, isRenderGroup: true })
  world.addChild(hierarchyLayer, linkLayer, nodeLayer)
  stage.addChild(world, labelLayer)

  // --- State ---------------------------------------------------------------
  let transform: ZoomTransform = zoomIdentity
  let fitK = 1
  // Who last placed the view: the fitted overview, a programmatic focus
  // (folder, connections, search), or the user panning/zooming. Closing the
  // a focus never undoes the user's own navigation.
  let viewState: "fit" | "focus" | "user" = "fit"
  let transitioning = false
  let selectedNodeId: string | null = null
  let selectedEdgeId: string | null = null
  let hoveredNodeId: string | null = null
  let hoveredEdgeId: string | null = null
  let searchQuery = ""
  let searchHits = new Set<string>()
  let calloutVisible = false
  let floatingCalloutTarget: FloatingCalloutTarget | null = null
  let renderedCalloutKey: string | null = null
  let labelsDirty = true
  let stopAnimation = false
  const cleanups: Array<() => void> = []

  const views: NodeView[] = []
  const viewById = new Map<string, NodeView>()
  const hierarchyViews: HierarchyView[] = []
  const edgeViews: EdgeView[] = []
  const neighbours = new Map<string, Set<string>>()
  for (const edge of plan.edges) {
    if (!neighbours.has(edge.source)) neighbours.set(edge.source, new Set())
    if (!neighbours.has(edge.target)) neighbours.set(edge.target, new Set())
    neighbours.get(edge.source)!.add(edge.target)
    neighbours.get(edge.target)!.add(edge.source)
  }
  const sectorAngle = new Map(plan.sectors.map((sector) => [sector.folderId, sector.angle]))
  const pageRank = new Map(
    plan.nodes
      .filter((node) => node.kind === "page")
      .sort(
        (left, right) =>
          right.importance - left.importance || naturalCompare(left.title, right.title),
      )
      .map((node, index) => [node.id, index]),
  )

  // --- Drawing helpers -----------------------------------------------------
  function drawNode(view: NodeView) {
    const { node, gfx, style } = view
    const radius = node.radius
    gfx.clear()
    const nodeColor =
      node.kind === "garden"
        ? colors.garden
        : node.kind === "folder"
          ? colors.folder
          : style === "related" || node.radius >= 3.5
            ? colors.pageStrong
            : colors.page
    gfx
      .circle(0, 0, radius + 5)
      .fill({ color: nodeColor, alpha: style === "selected" ? 0.32 : 0.24 })
    if (node.kind === "garden") {
      gfx
        .circle(0, 0, radius)
        .fill({ color: nodeColor, alpha: 0.98 })
        .stroke({ width: 1.2, color: nodeColor, alpha: 1 })
      return
    }
    if (node.kind === "folder") {
      if (style === "selected" || style === "hovered") {
        gfx
          .circle(0, 0, radius + 4)
          .stroke({ width: 1.5, color: colors.garden, alpha: style === "selected" ? 0.75 : 0.45 })
      }
      gfx
        .circle(0, 0, radius)
        .fill({ color: nodeColor, alpha: 0.98 })
        .stroke({ width: 1.1, color: nodeColor, alpha: 1 })
      return
    }
    if (style === "selected") {
      gfx.circle(0, 0, radius).fill({ color: colors.garden, alpha: 1 })
      return
    }
    if (style === "hovered") {
      gfx.circle(0, 0, radius + 3.5).stroke({ width: 1.2, color: colors.garden, alpha: 0.55 })
    }
    gfx
      .circle(0, 0, radius)
      .fill({ color: nodeColor, alpha: 0.98 })
      .stroke({ width: 1, color: nodeColor, alpha: 1 })
  }

  function makeLabel(node: PlannedNode): Text {
    const size = node.kind === "garden" ? 13 : node.kind === "folder" ? 12.5 : 11.5
    const label = new Text({
      interactive: false,
      eventMode: "none",
      text:
        node.kind === "page"
          ? truncateLabel(node.label, PAGE_LABEL_LENGTH)
          : truncateLabel(node.label, FOLDER_LABEL_LENGTH),
      alpha: 0,
      visible: false,
      style: {
        fontSize: size,
        fill: node.kind === "page" ? colors.textMuted : colors.text,
        fontFamily,
        fontWeight: node.kind === "garden" ? "600" : node.kind === "folder" ? "500" : "400",
        stroke: { color: colors.paper, width: 3, join: "round" },
      },
      resolution: window.devicePixelRatio * 2,
    })
    return label
  }

  for (const node of plan.nodes) {
    const gfx = new Graphics({
      interactive: interactive,
      label: node.id,
      eventMode: interactive ? "static" : "none",
      hitArea: new Circle(0, 0, node.radius + 7),
      cursor: interactive && config.drag ? "grab" : "pointer",
    })
    const view: NodeView = {
      node,
      gfx,
      label: makeLabel(node),
      placement: null,
      labelAlpha: 0,
      labelTarget: 0,
      alpha: 1,
      alphaTarget: 1,
      style: "rest",
    }
    drawNode(view)
    gfx.zIndex = node.kind === "garden" ? 3 : node.kind === "folder" ? 2 : 1
    nodeLayer.addChild(gfx)
    labelLayer.addChild(view.label)
    views.push(view)
    viewById.set(node.id, view)
  }

  for (const edge of plan.hierarchyEdges) {
    const source = viewById.get(edge.source)
    const target = viewById.get(edge.target)
    if (!source || !target) continue
    const gfx = new Graphics({
      interactive,
      eventMode: interactive ? "static" : "none",
      cursor: "pointer",
      label: edge.id,
    })
    hierarchyViews.push({
      kind: "hierarchy",
      edge: {
        ...edge,
        origin: "provenance",
        score: 1,
        relationType: "contains",
        direction: "source-to-target",
        explanation: {
          state: "ready",
          text: `${target.node.title} is organized under ${source.node.title} in this garden.`,
        },
        evidence: [],
        crossFolder: false,
        strength: 0,
        width: 1,
        opacity: 0.38,
      },
      gfx,
      source,
      target,
      alpha: 0,
      alphaTarget: 0.38,
      color: colors.edge,
      widthBoost: 0,
      selected: false,
    })
    hierarchyLayer.addChild(gfx)
  }

  for (const edge of plan.edges) {
    const source = viewById.get(edge.source)
    const target = viewById.get(edge.target)
    if (!source || !target) continue
    const gfx = new Graphics({
      interactive: interactive,
      eventMode: interactive ? "static" : "none",
      cursor: "pointer",
      label: edge.id,
    })
    edgeViews.push({
      kind: "semantic",
      edge,
      gfx,
      source,
      target,
      alpha: 0,
      alphaTarget: edge.opacity,
      color: colors.edge,
      widthBoost: 0,
      selected: false,
    })
    linkLayer.addChild(gfx)
  }
  const connectionViews: EdgeView[] = [...hierarchyViews, ...edgeViews]
  const edgeById = new Map(connectionViews.map((view) => [view.edge.id, view]))

  // --- Legacy Knowledge Map motion ----------------------------------------
  // Keep Thought Topology's authored home layout, but let the same d3 force
  // system used by the legacy Knowledge Map animate nodes into it. Invalid
  // initial coordinates deliberately invoke d3's deterministic phyllotaxis
  // seed, which creates the familiar slow scatter on first load.
  const simNodes = plan.nodes as SimNode[]
  const simNodeById = new Map(simNodes.map((node) => [node.id, node]))
  const permanentHomeIds = new Set(Object.keys(storedPositions))
  const returnTargets = new Map<string, { x: number; y: number; pin: boolean }>()
  const returningNodeIds = new Set<string>()
  let activeDragNodeId: string | null = null
  if (!reducedMotion) {
    for (const node of simNodes) {
      if (permanentHomeIds.has(node.id)) {
        const home = homePositions.get(node.id)
        node.fx = home?.x ?? node.x
        node.fy = home?.y ?? node.y
      } else {
        node.x = Number.NaN
        node.y = Number.NaN
      }
    }
  }
  const links: SimLink[] = [...plan.hierarchyEdges, ...plan.edges].flatMap((edge) => {
    const source = simNodeById.get(edge.source)
    const target = simNodeById.get(edge.target)
    const sourceHome = homePositions.get(edge.source)
    const targetHome = homePositions.get(edge.target)
    if (!source || !target || !sourceHome || !targetHome) return []
    return [
      {
        source,
        target,
        distance: Math.max(
          44,
          Math.hypot(targetHome.x - sourceHome.x, targetHome.y - sourceHome.y),
        ),
      },
    ]
  })
  const isGlobalGraph = graph.classList.contains("global-graph-container")
  const homeXForNode = (node: SimNode) => homePositions.get(node.id)?.x ?? node.x ?? 0
  const homeYForNode = (node: SimNode) => homePositions.get(node.id)?.y ?? node.y ?? 0
  const homeXForce = forceX<SimNode>(homeXForNode).strength(isGlobalGraph ? 0.11 : 0.09)
  const homeYForce = forceY<SimNode>(homeYForNode).strength(isGlobalGraph ? 0.055 : 0.045)
  let simulationSettled = reducedMotion
  let draggingNode = false
  const simulation = forceSimulation<SimNode>(simNodes)
    .force("charge", forceManyBody<SimNode>().strength(-100 * config.repelForce))
    .force("center", forceCenter<SimNode>(0, 0).strength(config.centerForce))
    .force(
      "collide",
      forceCollide<SimNode>((node) => node.radius + (isGlobalGraph ? 18 : 7)).iterations(
        isGlobalGraph ? 6 : 3,
      ),
    )
    .force(
      "link",
      forceLink<SimNode, SimLink>(links).distance((link) => link.distance),
    )
    .force("home-x", homeXForce)
    .force("home-y", homeYForce)
    .alphaDecay(0.018)
    .velocityDecay(0.5)
    .on("tick", () => {
      simulationSettled = false
      labelsDirty = true
    })
    .on("end", () => {
      for (const [nodeId, target] of returnTargets) {
        const node = simNodeById.get(nodeId)
        if (!node) continue
        node.x = target.x
        node.y = target.y
        node.fx = target.pin ? target.x : null
        node.fy = target.pin ? target.y : null
      }
      returnTargets.clear()
      returningNodeIds.clear()
      simulationSettled = true
      labelsDirty = true
    })
  if (reducedMotion) simulation.stop()

  // --- Geometry ------------------------------------------------------------
  const worldX = (node: PlannedNode) => node.x + width / 2
  const worldY = (node: PlannedNode) => node.y + height / 2
  const screenOf = (node: PlannedNode) => ({
    x: transform.applyX(worldX(node)),
    y: transform.applyY(worldY(node)),
  })
  const screenRadius = (node: PlannedNode) => node.radius * Math.sqrt(transform.k)

  function edgeGeometry(view: EdgeView) {
    const x1 = worldX(view.source.node)
    const y1 = worldY(view.source.node)
    const x2 = worldX(view.target.node)
    const y2 = worldY(view.target.node)
    return { x1, y1, x2, y2 }
  }

  function edgePoint(view: EdgeView, t: number): { x: number; y: number } {
    const g = edgeGeometry(view)
    return {
      x: g.x1 + (g.x2 - g.x1) * t,
      y: g.y1 + (g.y2 - g.y1) * t,
    }
  }

  function distanceToEdge(view: EdgeView, point: { x: number; y: number }): number {
    let best = Infinity
    let previous = edgePoint(view, 0)
    for (let step = 1; step <= 12; step += 1) {
      const next = edgePoint(view, step / 12)
      const dx = next.x - previous.x
      const dy = next.y - previous.y
      const denominator = dx * dx + dy * dy
      const unit =
        denominator === 0
          ? 0
          : Math.max(
              0,
              Math.min(
                1,
                ((point.x - previous.x) * dx + (point.y - previous.y) * dy) / denominator,
              ),
            )
      best = Math.min(
        best,
        Math.hypot(point.x - (previous.x + unit * dx), point.y - (previous.y + unit * dy)),
      )
      previous = next
    }
    return best
  }

  function drawEdge(view: EdgeView) {
    const g = edgeGeometry(view)
    const k = transform.k
    const restWidth = view.edge.width + view.widthBoost
    const strokeWidth = (view.selected ? restWidth + 1.2 : restWidth) / k
    const gfx = view.gfx
    gfx.clear()
    const path = () => {
      gfx.moveTo(g.x1, g.y1)
      gfx.lineTo(g.x2, g.y2)
    }
    if (interactive) {
      path()
      gfx.stroke({ alpha: 0.001, width: 14 / k, color: view.color })
    }
    path()
    gfx.stroke({ alpha: view.alpha, width: strokeWidth, color: view.color })
  }

  // --- View transform ------------------------------------------------------
  const canvasSelection = select<HTMLCanvasElement, unknown>(app.canvas)
  const zoomBehavior = zoom<HTMLCanvasElement, unknown>()
    .scaleExtent([0.2, 5])
    .on("zoom", (event) => {
      transform = event.transform
      world.scale.set(transform.k, transform.k)
      world.position.set(transform.x, transform.y)
      if (event.sourceEvent) viewState = "user"
      labelsDirty = true
      emitGraphContext()
    })
  // NOTE: the zoom behavior is attached after the drag behavior (below).
  // d3-zoom stops immediate propagation of mousedown, so attaching it first
  // would starve d3-drag of every click on a node.

  function applyTransform(next: ViewTransform, animate: boolean) {
    const target = zoomIdentity.translate(next.x, next.y).scale(next.k)
    if (!interactive || !config.zoom) {
      transform = target
      world.scale.set(target.k, target.k)
      world.position.set(target.x, target.y)
      labelsDirty = true
      return
    }
    if (animate && !reducedMotion) {
      transitioning = true
      canvasSelection
        .transition()
        .duration(420)
        .call(zoomBehavior.transform, target)
        .on("end interrupt", () => {
          transitioning = false
        })
    } else {
      canvasSelection.call(zoomBehavior.transform, target)
    }
  }

  function currentInsets(): Insets {
    if (preview) return { top: 10, right: 10, bottom: 10, left: 10 }
    return { top: 14, right: 14, bottom: 14, left: 14 }
  }

  function blockedRects(): ClipRect[] {
    if (preview) return []
    const canvasRect = graph.getBoundingClientRect()
    const rects: ClipRect[] = []
    for (const blocker of [heading, searchPanel, overlayClose, calloutRoot]) {
      if (blocker === calloutRoot && !calloutVisible) continue
      if (!blocker || blocker.hidden || blocker.offsetParent === null) continue
      const rect = blocker.getBoundingClientRect()
      rects.push({
        left: rect.left - canvasRect.left - 6,
        top: rect.top - canvasRect.top - 6,
        right: rect.right - canvasRect.left + 6,
        bottom: rect.bottom - canvasRect.top + 6,
      })
    }
    return rects
  }

  function fitView(animate: boolean, useHomeLayout = false) {
    const fitNodes = useHomeLayout
      ? plan.nodes.map((node) => ({ ...node, ...(homePositions.get(node.id) ?? {}) }))
      : plan.nodes
    const gardenAnchor = useHomeLayout
      ? { ...plan.garden, ...(homePositions.get(plan.garden.id) ?? {}) }
      : plan.garden
    const bounds = boundsOf(fitNodes, preview ? 18 : 44)
    const next = fitTransform(
      bounds,
      { width, height },
      currentInsets(),
      {
        minScale: 0.3,
        maxScale: preview ? 1.25 : 1.35,
      },
      { x: gardenAnchor.x, y: gardenAnchor.y },
    )
    fitK = next.k
    viewState = "fit"
    applyTransform(next, animate)
  }

  function centerOn(node: PlannedNode, animate: boolean) {
    const insets = currentInsets()
    const centerX = insets.left + (width - insets.left - insets.right) / 2
    const centerY = insets.top + (height - insets.top - insets.bottom) / 2
    const k = Math.max(transform.k, Math.min(1.6, fitK * 1.3))
    viewState = "focus"
    applyTransform({ k, x: centerX - k * worldX(node), y: centerY - k * worldY(node) }, animate)
  }

  // --- Styles (selection, hover, search) ----------------------------------
  function sectorMembers(folderId: string): Set<string> {
    return new Set(
      plan.nodes
        .filter((node) => node.sectorId === folderId || node.id === folderId)
        .map((node) => node.id),
    )
  }

  function emphasisFor(nodeId: string): Set<string> {
    const node = viewById.get(nodeId)?.node
    if (!node) return new Set()
    if (node.kind === "folder") {
      const members = node.sectorId ? sectorMembers(node.sectorId) : new Set<string>([node.id])
      members.add(node.id)
      return members
    }
    const set = new Set<string>([node.id])
    for (const neighbour of neighbours.get(node.id) ?? []) set.add(neighbour)
    return set
  }

  function refreshStyles() {
    let emphasis: Set<string> | null = null
    const selectedEdge = selectedEdgeId ? edgeById.get(selectedEdgeId) : undefined
    const hoveredEdge = hoveredEdgeId ? edgeById.get(hoveredEdgeId) : undefined
    const focusedEdge = hoveredEdge ?? selectedEdge
    if (focusedEdge) {
      emphasis = new Set([focusedEdge.edge.source, focusedEdge.edge.target])
    } else if (selectedNodeId) {
      const selected = viewById.get(selectedNodeId)?.node
      emphasis = selected && selected.kind !== "garden" ? emphasisFor(selectedNodeId) : null
    }
    if (hoveredNodeId && viewById.get(hoveredNodeId)?.node.kind !== "garden") {
      const hovered = emphasisFor(hoveredNodeId)
      emphasis = emphasis ? new Set([...emphasis, ...hovered]) : hovered
    }
    if (searchQuery) {
      emphasis = emphasis ? new Set([...emphasis, ...searchHits]) : new Set(searchHits)
    }

    for (const view of views) {
      const id = view.node.id
      const highlighted = !emphasis || emphasis.has(id)
      const style: NodeStyle =
        selectedNodeId === id
          ? "selected"
          : hoveredNodeId === id
            ? "hovered"
            : emphasis && highlighted
              ? "related"
              : "rest"
      if (style !== view.style) {
        view.style = style
        drawNode(view)
      }
      view.alphaTarget = highlighted ? 1 : view.node.kind === "page" ? 0.42 : 0.62
    }

    for (const view of connectionViews) {
      const { source, target } = view.edge
      const selected = view.edge.id === selectedEdgeId
      const hovered = view.edge.id === hoveredEdgeId
      const touchesFocus =
        (selectedNodeId !== null && (source === selectedNodeId || target === selectedNodeId)) ||
        (hoveredNodeId !== null && (source === hoveredNodeId || target === hoveredNodeId)) ||
        (searchQuery !== "" && (searchHits.has(source) || searchHits.has(target)))
      const withinEmphasis = emphasis ? emphasis.has(source) && emphasis.has(target) : true
      const active =
        selected || hovered || touchesFocus || (emphasis === null ? true : withinEmphasis)
      view.selected = selected
      view.alphaTarget = selected
        ? 1
        : hovered
          ? Math.min(1, view.edge.opacity + 0.42)
          : active
            ? emphasis
              ? Math.min(1, view.edge.opacity + 0.3)
              : view.edge.opacity
            : 0.08
      view.color = selected
        ? colors.edgeSelected
        : hovered
          ? colors.edgeActive
          : active && emphasis
            ? colors.edgeActive
            : colors.edge
      view.widthBoost = selected ? 1.25 : hovered ? 0.9 : active && emphasis ? 0.5 : 0
    }
    labelsDirty = true
  }

  // --- Labels --------------------------------------------------------------
  function labelMustStayAttached(nodeId: string): boolean {
    return (
      nodeId === activeDragNodeId ||
      nodeId === selectedNodeId ||
      nodeId === hoveredNodeId ||
      returningNodeIds.has(nodeId) ||
      permanentHomeIds.has(nodeId)
    )
  }

  function attachedLabelPlacement(view: NodeView): LabelPlacement {
    const position = screenOf(view.node)
    const radius = screenRadius(view.node)
    const labelWidth = view.label.width
    const labelHeight = view.label.height
    const gap = 5
    const horizontal = radius + gap
    const vertical = radius + gap
    const options: LabelPlacement[] = [
      {
        side: "right",
        dx: horizontal,
        dy: 0,
        anchorX: 0,
        anchorY: 0.5,
        rect: {
          left: position.x + horizontal,
          top: position.y - labelHeight / 2,
          right: position.x + horizontal + labelWidth,
          bottom: position.y + labelHeight / 2,
        },
      },
      {
        side: "left",
        dx: -horizontal,
        dy: 0,
        anchorX: 1,
        anchorY: 0.5,
        rect: {
          left: position.x - horizontal - labelWidth,
          top: position.y - labelHeight / 2,
          right: position.x - horizontal,
          bottom: position.y + labelHeight / 2,
        },
      },
      {
        side: "below",
        dx: 0,
        dy: vertical,
        anchorX: 0.5,
        anchorY: 0,
        rect: {
          left: position.x - labelWidth / 2,
          top: position.y + vertical,
          right: position.x + labelWidth / 2,
          bottom: position.y + vertical + labelHeight,
        },
      },
      {
        side: "above",
        dx: 0,
        dy: -vertical,
        anchorX: 0.5,
        anchorY: 1,
        rect: {
          left: position.x - labelWidth / 2,
          top: position.y - vertical - labelHeight,
          right: position.x + labelWidth / 2,
          bottom: position.y - vertical,
        },
      },
    ]
    const overflow = (placement: LabelPlacement) =>
      Math.max(0, 4 - placement.rect.left) +
      Math.max(0, 4 - placement.rect.top) +
      Math.max(0, placement.rect.right - (width - 4)) +
      Math.max(0, placement.rect.bottom - (height - 4))
    return options.sort((left, right) => overflow(left) - overflow(right))[0]
  }

  function updateLabels() {
    labelsDirty = false
    const ratio = transform.k / (fitK || 1)
    const budget = pageLabelBudget(ratio)
    const selectedEdge = selectedEdgeId ? edgeById.get(selectedEdgeId) : undefined
    const selectedNode = selectedNodeId ? viewById.get(selectedNodeId)?.node : undefined
    const selectedNeighbours = selectedNodeId
      ? (neighbours.get(selectedNodeId) ?? new Set<string>())
      : new Set<string>()
    const focusedSector = selectedNode?.kind === "folder" ? selectedNode.sectorId : null
    const candidates: LabelCandidate[] = []
    const obstacles: LabelObstacle[] = []

    const BUDGET_TIER = 100
    for (const view of views) {
      const { node } = view
      const position = screenOf(node)
      const radius = screenRadius(node)
      obstacles.push({
        id: node.id,
        x: position.x,
        y: position.y,
        radius: radius + 2,
        soft: node.kind === "page",
      })
      let priority: number | null = null
      let sides: LabelSide[] = ["below", "right", "left", "above"]
      if (node.kind === "page") {
        const anchor = node.sectorId ? viewById.get(node.sectorId)?.node : undefined
        if (anchor) sides = pageLabelSides(node.x - anchor.x, node.y - anchor.y)
      }
      if (node.kind === "garden") {
        priority = 1000
      } else if (node.kind === "folder") {
        priority = node.sectorId === node.id ? 900 + node.subtreeCount * 0.01 : 880
        const angle = sectorAngle.get(node.sectorId ?? "")
        if (angle !== undefined && node.sectorId === node.id) sides = folderLabelSides(angle)
      } else if (selectedNodeId === node.id) {
        priority = 800
      } else if (hoveredNodeId === node.id) {
        priority = 850
      } else if (
        selectedEdge &&
        (selectedEdge.edge.source === node.id || selectedEdge.edge.target === node.id)
      ) {
        priority = 800
      } else if (searchQuery) {
        priority = searchHits.has(node.id) ? 750 : null
      } else if (selectedNeighbours.has(node.id)) {
        priority = 700
      } else if (focusedSector && node.sectorId === focusedSector) {
        priority = 600 + node.importance
      } else {
        // Every remaining page competes for the zoom-dependent budget; the
        // ones that fit cleanly win, in importance order.
        priority = BUDGET_TIER + node.importance - (pageRank.get(node.id) ?? 0) * 0.001
      }
      if (priority === null) {
        view.placement = null
        view.labelTarget = 0
        continue
      }
      const text =
        hoveredNodeId === node.id || selectedNodeId === node.id
          ? node.kind === "page"
            ? node.title
            : node.label
          : truncateLabel(
              node.label,
              node.kind === "page" ? PAGE_LABEL_LENGTH : FOLDER_LABEL_LENGTH,
            )
      if (view.label.text !== text) view.label.text = text
      candidates.push({
        id: node.id,
        priority,
        x: position.x,
        y: position.y,
        radius,
        width: view.label.width,
        height: view.label.height,
        sides,
        overlapSoft: node.kind !== "page",
      })
    }

    // Labels may use the canvas edge-to-edge; active callout text participates
    // in blockedRects above so labels do not pile underneath it.
    const clip: ClipRect = {
      left: 4,
      top: 4,
      right: width - 4,
      bottom: height - 4,
    }
    const placements = placeLabels(candidates, obstacles, clip, blockedRects())
    // Trim the budget tier to what the zoom level deserves. Placement was
    // greedy by priority, so dropping the lowest winners frees nothing else.
    const budgetWinners = candidates
      .filter((candidate) => candidate.priority < 600 && placements.has(candidate.id))
      .sort((left, right) => right.priority - left.priority)
    for (const loser of budgetWinners.slice(budget)) placements.delete(loser.id)
    for (const view of views) {
      const placement =
        placements.get(view.node.id) ??
        (labelMustStayAttached(view.node.id) ? attachedLabelPlacement(view) : null)
      view.placement = placement
      view.labelTarget = placement ? (view.alphaTarget < 1 ? 0.6 : 1) : 0
    }
  }

  // --- Floating object text ------------------------------------------------
  function showCallout() {
    if (!calloutRoot) return
    calloutVisible = true
    calloutRoot.classList.add("visible")
    calloutRoot.setAttribute("aria-hidden", "false")
    labelsDirty = true
  }

  function hideCallout() {
    if (!calloutRoot) return
    calloutVisible = false
    floatingCalloutTarget = null
    renderedCalloutKey = null
    calloutRoot.classList.remove("visible")
    calloutRoot.setAttribute("aria-hidden", "true")
    labelsDirty = true
  }

  function calloutText(className: string, text: string) {
    if (!calloutContent) return
    const paragraph = element("p", className)
    appendMathText(paragraph, text)
    calloutContent.appendChild(paragraph)
  }

  function appendMathText(target: HTMLElement, text: string) {
    const delimiter =
      /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<!\\)\$((?:\\.|[^$\n])+?)(?<!\\)\$/g
    let cursor = 0

    for (const match of text.matchAll(delimiter)) {
      const index = match.index ?? 0
      if (index > cursor) target.appendChild(document.createTextNode(text.slice(cursor, index)))

      const displayMode = match[1] !== undefined || match[2] !== undefined
      const formula = match[1] ?? match[2] ?? match[3] ?? match[4] ?? ""
      const math = element(
        "span",
        displayMode ? "thought-callout-math thought-callout-math-display" : "thought-callout-math",
      )
      try {
        katex.render(formula, math, {
          displayMode,
          output: "htmlAndMathml",
          strict: "ignore",
          throwOnError: true,
          trust: false,
        })
      } catch {
        math.classList.add("thought-callout-math-fallback")
        math.textContent = match[0]
      }
      target.appendChild(math)
      cursor = index + match[0].length
    }

    if (cursor < text.length) target.appendChild(document.createTextNode(text.slice(cursor)))
  }

  function calloutTitle(text: string) {
    const title = element("h2", "thought-callout-title")
    appendMathText(title, text)
    return title
  }

  function renderNodeCallout(view: NodeView) {
    if (!calloutContent) return
    const { node } = view
    calloutContent.replaceChildren()
    calloutContent.appendChild(calloutTitle(node.title))
    if (node.kind !== "garden") {
      calloutText(
        "thought-callout-path",
        [plan.garden.title, node.folderTitle].filter(Boolean).join(" › "),
      )
    }

    if (node.kind === "garden") {
      calloutText(
        "thought-callout-summary",
        gardenOverview(plan, plan.garden.title, payload.garden.summary),
      )
      calloutText(
        "thought-callout-meta",
        `${plan.meaningfulFolderIds.length} folders · ${plan.totalPageCount} pages · ${plan.edges.length} semantic connections`,
      )
    } else if (node.kind === "folder") {
      calloutText(
        "thought-callout-summary",
        readableSummary(node.summary, {
          title: node.title,
          folderTitle: node.folderTitle || plan.garden.title,
        }),
      )
      calloutText(
        "thought-callout-meta",
        `${node.subtreeCount} ${node.subtreeCount === 1 ? "page" : "pages"}`,
      )
    } else {
      calloutText(
        "thought-callout-summary",
        readableSummary(node.summary, {
          title: node.title,
          folderTitle: node.folderTitle || plan.garden.title,
        }),
      )
      const touching = plan.edges.filter(
        (edge) => edge.source === node.id || edge.target === node.id,
      )
      const concepts = node.concepts.slice(0, 4).join(" · ")
      calloutText(
        "thought-callout-meta",
        [concepts, `${touching.length} ${touching.length === 1 ? "connection" : "connections"}`]
          .filter(Boolean)
          .join(" · "),
      )
    }
  }

  function renderEdgeCallout(view: EdgeView) {
    if (!calloutContent) return
    const { edge } = view
    calloutContent.replaceChildren()
    calloutContent.appendChild(
      calloutTitle(
        `${view.source.node.title} ${view.kind === "hierarchy" ? "→" : "↔"} ${view.target.node.title}`,
      ),
    )
    calloutText(
      "thought-callout-meta",
      [
        relationLabel(edge.relationType),
        view.kind === "semantic"
          ? `${affinityLabel(edge.score)} affinity · ${edge.score.toFixed(2)}`
          : "",
        edge.crossFolder ? "Bridges folders" : "",
      ]
        .filter(Boolean)
        .join(" · "),
    )
    calloutText(
      "thought-callout-summary",
      edge.explanation.state === "ready" && edge.explanation.text.trim()
        ? edge.explanation.text
        : edge.origin === "inferred"
          ? "This semantic connection is waiting for its short explanation."
          : "This connection comes from the garden's authored structure.",
    )
  }

  function positionFloatingCallout() {
    if (!calloutRoot || !floatingCalloutTarget || !calloutVisible) return
    const padding = 12
    let anchorX = 0
    let anchorY = 0
    let offsetX = 18
    let offsetY = -12

    if (floatingCalloutTarget.kind === "node") {
      const position = screenOf(floatingCalloutTarget.view.node)
      anchorX = position.x
      anchorY = position.y
      offsetX = screenRadius(floatingCalloutTarget.view.node) + 14
    } else {
      const geometry = edgeGeometry(floatingCalloutTarget.view)
      const midpoint = edgePoint(floatingCalloutTarget.view, 0.5)
      anchorX = transform.applyX(midpoint.x)
      anchorY = transform.applyY(midpoint.y)
      const dx = geometry.x2 - geometry.x1
      const dy = geometry.y2 - geometry.y1
      const length = Math.max(1, Math.hypot(dx, dy))
      let normalX = -dy / length
      let normalY = dx / length
      if (normalY > 0) {
        normalX *= -1
        normalY *= -1
      }
      offsetX = normalX * 22
      offsetY = normalY * 22
    }

    const calloutWidth = Math.min(
      calloutRoot.offsetWidth || 320,
      Math.max(180, width - 2 * padding),
    )
    const calloutHeight = calloutRoot.offsetHeight || 120
    let left = anchorX + offsetX
    if (offsetX < 0) left -= calloutWidth
    if (left + calloutWidth > width - padding) left = anchorX - calloutWidth - 18
    if (left < padding) left = Math.min(width - calloutWidth - padding, anchorX + 18)
    let top = anchorY + offsetY - calloutHeight * 0.22
    top = Math.max(padding, Math.min(height - calloutHeight - padding, top))
    calloutRoot.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`
  }

  function syncFloatingCallout() {
    if (!calloutRoot) return
    const hoveredNode = hoveredNodeId ? viewById.get(hoveredNodeId) : undefined
    const hoveredEdge = hoveredEdgeId ? edgeById.get(hoveredEdgeId) : undefined
    const selectedNode = selectedNodeId ? viewById.get(selectedNodeId) : undefined
    const selectedEdge = selectedEdgeId ? edgeById.get(selectedEdgeId) : undefined
    const target: FloatingCalloutTarget | null = hoveredNode
      ? { kind: "node", view: hoveredNode }
      : hoveredEdge
        ? { kind: "edge", view: hoveredEdge }
        : selectedNode
          ? { kind: "node", view: selectedNode }
          : selectedEdge
            ? { kind: "edge", view: selectedEdge }
            : null

    if (!target) {
      hideCallout()
      return
    }

    const id = target.kind === "node" ? target.view.node.id : target.view.edge.id
    const key = `${target.kind}:${id}`
    const pinned = !hoveredNode && !hoveredEdge
    floatingCalloutTarget = target
    calloutRoot.dataset.pinned = String(pinned)
    calloutRoot.dataset.kind = target.kind
    if (renderedCalloutKey !== key) {
      renderedCalloutKey = key
      if (target.kind === "node") renderNodeCallout(target.view)
      else renderEdgeCallout(target.view)
    }
    showCallout()
    positionFloatingCallout()
  }

  // --- Selection -----------------------------------------------------------
  function selectNode(view: NodeView) {
    if (selectedNodeId === view.node.id) {
      selectedNodeId = null
      refreshStyles()
      syncFloatingCallout()
      emitGraphContext()
      return
    }
    selectedNodeId = view.node.id
    selectedEdgeId = null
    refreshStyles()
    syncFloatingCallout()
    emitGraphContext()
  }

  function selectEdge(view: EdgeView) {
    selectedEdgeId = view.edge.id
    selectedNodeId = null
    refreshStyles()
    syncFloatingCallout()
    emitGraphContext()
  }

  function clearSelection() {
    if (selectedNodeId === null && selectedEdgeId === null && !calloutVisible) return
    selectedNodeId = null
    selectedEdgeId = null
    refreshStyles()
    syncFloatingCallout()
    emitGraphContext()
  }

  let lastRightClick: { nodeId: string; at: number } | null = null

  function openNode(view: NodeView) {
    const targetSlug =
      view.node.navigateSlug ??
      (view.node.kind === "garden" || view.node.folderPath === ""
        ? gardenSlug
        : view.node.kind === "folder"
          ? `${gardenSlug}/${view.node.folderPath}`
          : undefined)
    if (!targetSlug) return
    const target = resolveRelative(fullSlug, targetSlug as SimpleSlug)
    window.spaNavigate(new URL(target, window.location.toString()))
  }

  function handleRightNodeClick(view: NodeView) {
    const now = performance.now()
    if (
      lastRightClick?.nodeId === view.node.id &&
      now - lastRightClick.at <= RIGHT_DOUBLE_CLICK_MS
    ) {
      lastRightClick = null
      openNode(view)
      return
    }
    lastRightClick = { nodeId: view.node.id, at: now }
  }

  // --- Pointer interactions ------------------------------------------------
  if (interactive) {
    for (const view of views) {
      view.gfx
        .on("pointerover", () => {
          hoveredNodeId = view.node.id
          refreshStyles()
          syncFloatingCallout()
        })
        .on("pointerleave", () => {
          if (hoveredNodeId === view.node.id) hoveredNodeId = null
          refreshStyles()
          syncFloatingCallout()
        })
    }
    for (const view of connectionViews) {
      view.gfx
        .on("pointerover", () => {
          hoveredEdgeId = view.edge.id
          refreshStyles()
          syncFloatingCallout()
        })
        .on("pointerleave", () => {
          if (hoveredEdgeId === view.edge.id) hoveredEdgeId = null
          refreshStyles()
          syncFloatingCallout()
        })
        .on("pointertap", (event) => {
          event.stopPropagation()
          const point = world.toLocal(event.global)
          const closest = [...connectionViews].sort(
            (left, right) => distanceToEdge(left, point) - distanceToEdge(right, point),
          )[0]
          selectEdge(closest ?? view)
        })
    }

    const handleContextMenu = (event: MouseEvent) => {
      if (hoveredNodeId) event.preventDefault()
    }
    app.canvas.addEventListener("contextmenu", handleContextMenu)
    cleanups.push(() => app.canvas.removeEventListener("contextmenu", handleContextMenu))

    if (config.drag) {
      type DragState = {
        view: NodeView
        moved: number
        permanent: boolean
        pointer: { x: number; y: number }
        members: Array<{
          view: NodeView
          x: number
          y: number
          fx: number | null | undefined
          fy: number | null | undefined
        }>
      }
      let dragState: DragState | null = null
      let nextDragIsPermanent = false
      canvasSelection.call(
        drag<HTMLCanvasElement, unknown>()
          .filter((event) => {
            const accepted = !event.ctrlKey && (event.button === 0 || event.button === 2)
            if (accepted) nextDragIsPermanent = event.button === 2
            return accepted
          })
          .container(() => app.canvas)
          .subject((event) => {
            const view = hoveredNodeId ? viewById.get(hoveredNodeId) : undefined
            return view ? { x: event.x, y: event.y, view } : (undefined as unknown as object)
          })
          .on("start", (event) => {
            const view = (event.subject as { view: NodeView }).view
            const source = event.sourceEvent as MouseEvent | undefined
            const permanent =
              nextDragIsPermanent || source?.button === 2 || Boolean((source?.buttons ?? 0) & 2)
            nextDragIsPermanent = false
            if (!event.active && !reducedMotion) simulation.alphaTarget(1).restart()
            simulationSettled = false
            draggingNode = true
            activeDragNodeId = view.node.id
            returnTargets.delete(view.node.id)
            returningNodeIds.delete(view.node.id)
            dragState = {
              view,
              moved: 0,
              permanent,
              pointer: { x: source?.clientX ?? event.x, y: source?.clientY ?? event.y },
              members: [
                {
                  view,
                  x: view.node.x,
                  y: view.node.y,
                  fx: view.node.fx,
                  fy: view.node.fy,
                },
              ],
            }
            view.node.fx = view.node.x
            view.node.fy = view.node.y
          })
          .on("drag", (event) => {
            if (!dragState) return
            const source = event.sourceEvent as PointerEvent | undefined
            const clientX = source?.clientX ?? event.x
            const clientY = source?.clientY ?? event.y
            dragState.moved = Math.max(
              dragState.moved,
              Math.hypot(clientX - dragState.pointer.x, clientY - dragState.pointer.y),
            )
            if (dragState.moved <= CLICK_SLOP_PX || dragState.members.length === 0) return
            const dx = (event.x - (event.subject as { x: number }).x) / transform.k
            const dy = (event.y - (event.subject as { y: number }).y) / transform.k
            for (const member of dragState.members) {
              const x = member.x + dx
              const y = member.y + dy
              member.view.node.x = x
              member.view.node.y = y
              member.view.node.fx = x
              member.view.node.fy = y
            }
            labelsDirty = true
          })
          .on("end", (event) => {
            if (!dragState) return
            const state = dragState
            dragState = null
            draggingNode = false
            activeDragNodeId = null
            if (!event.active && !reducedMotion) simulation.alphaTarget(0)
            if (reducedMotion) simulationSettled = true
            if (state.moved <= CLICK_SLOP_PX) {
              for (const member of state.members) {
                const home = homePositions.get(member.view.node.id)
                if (permanentHomeIds.has(member.view.node.id) && home) {
                  member.view.node.fx = home.x
                  member.view.node.fy = home.y
                } else {
                  member.view.node.fx = member.fx
                  member.view.node.fy = member.fy
                }
              }
              if (state.permanent) handleRightNodeClick(state.view)
              else selectNode(state.view)
              return
            }
            lastRightClick = null
            if (state.members.length === 0) return
            if (state.permanent) {
              const positions = readStoredPositions(positionScope)
              for (const member of state.members) {
                const position = { x: member.view.node.x, y: member.view.node.y }
                homePositions.set(member.view.node.id, position)
                positions[member.view.node.id] = position
                permanentHomeIds.add(member.view.node.id)
                returnTargets.delete(member.view.node.id)
                returningNodeIds.delete(member.view.node.id)
                member.view.node.fx = position.x
                member.view.node.fy = position.y
              }
              homeXForce.x(homeXForNode)
              homeYForce.y(homeYForNode)
              writeStoredPositions(positionScope, positions)
              labelsDirty = true
              emitGraphContext()
              return
            }
            let homeForceChanged = false
            for (const member of state.members) {
              const home = homePositions.get(member.view.node.id)
              if (!home) continue
              if (reducedMotion) {
                member.view.node.x = home.x
                member.view.node.y = home.y
                member.view.node.fx = permanentHomeIds.has(member.view.node.id) ? home.x : null
                member.view.node.fy = permanentHomeIds.has(member.view.node.id) ? home.y : null
              } else {
                member.view.node.fx = null
                member.view.node.fy = null
                const pin = permanentHomeIds.has(member.view.node.id)
                const target = pin ? home : { x: member.x, y: member.y }
                returnTargets.set(member.view.node.id, { ...target, pin })
                returningNodeIds.add(member.view.node.id)
                if (!pin) {
                  homePositions.set(member.view.node.id, target)
                  homeForceChanged = true
                }
              }
            }
            if (homeForceChanged) {
              homeXForce.x(homeXForNode)
              homeYForce.y(homeYForNode)
            }
            labelsDirty = true
            emitGraphContext()
            void event
          }),
      )
    } else {
      for (const view of views) view.gfx.on("pointertap", () => selectNode(view))
    }

    if (config.zoom) {
      canvasSelection.call(zoomBehavior).on("dblclick.zoom", null)
    }

    // A quiet click on empty canvas clears the selection. Drags and pans do not.
    let backgroundPress: { x: number; y: number; onTarget: boolean } | null = null
    const onPointerDown = (event: PointerEvent) => {
      backgroundPress = {
        x: event.clientX,
        y: event.clientY,
        onTarget: hoveredNodeId !== null || hoveredEdgeId !== null,
      }
    }
    const onPointerUp = (event: PointerEvent) => {
      const press = backgroundPress
      backgroundPress = null
      if (!press || press.onTarget || hoveredNodeId !== null || hoveredEdgeId !== null) return
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4) return
      clearSelection()
    }
    app.canvas.addEventListener("pointerdown", onPointerDown)
    app.canvas.addEventListener("pointerup", onPointerUp)
    cleanups.push(() => {
      app.canvas.removeEventListener("pointerdown", onPointerDown)
      app.canvas.removeEventListener("pointerup", onPointerUp)
    })
  }

  // --- Search --------------------------------------------------------------
  function searchable(node: PlannedNode): string {
    return [node.title, node.label, node.folderTitle, ...node.concepts].join(" ").toLowerCase()
  }

  function updateSearch(query: string) {
    searchQuery = query.trim().toLowerCase()
    searchHits = new Set()
    if (searchQuery) {
      for (const view of views) {
        if (view.node.kind !== "garden" && searchable(view.node).includes(searchQuery))
          searchHits.add(view.node.id)
      }
    }
    refreshStyles()
    emitGraphContext()
    graph.dispatchEvent(
      new CustomEvent("graph-search-result", {
        detail: { query, matches: searchHits.size, total: views.length },
      }),
    )
  }

  function commitSearch() {
    if (!searchQuery || searchHits.size === 0) return
    const best = [...searchHits]
      .map((id) => viewById.get(id)!)
      .sort((left, right) => {
        const leftStarts = left.node.title.toLowerCase().startsWith(searchQuery) ? 0 : 1
        const rightStarts = right.node.title.toLowerCase().startsWith(searchQuery) ? 0 : 1
        return leftStarts - rightStarts || naturalCompare(left.node.title, right.node.title)
      })[0]
    if (!best) return
    if (selectedNodeId !== best.node.id) selectNode(best)
    if (best.node.kind === "page") centerOn(best.node, true)
  }

  const handleGraphSearch = (event: Event) => {
    const detail = (event as CustomEvent<{ query?: string }>).detail
    updateSearch(detail?.query ?? "")
  }
  const handleGraphSearchCommit = () => commitSearch()
  graph.addEventListener("graph-search", handleGraphSearch)
  graph.addEventListener("graph-search-commit", handleGraphSearchCommit)
  if (graph.dataset.searchQuery) updateSearch(graph.dataset.searchQuery)

  // --- Context for the dashboard assistant ---------------------------------
  function emitGraphContext() {
    const selectedEdge = selectedEdgeId ? edgeById.get(selectedEdgeId) : undefined
    const selectedNode = selectedNodeId ? viewById.get(selectedNodeId)?.node : undefined
    const directNeighborSlugs = selectedNode
      ? [...(neighbours.get(selectedNode.id) ?? [])]
          .map((id) => viewById.get(id)?.node)
          .filter((node): node is PlannedNode => Boolean(node))
          .map((node) => node.navigateSlug ?? node.id)
          .slice(0, 12)
      : []
    const detail = {
      selectedNodeSlug: selectedNode ? (selectedNode.navigateSlug ?? selectedNode.id) : null,
      selectedConnection: selectedEdge
        ? {
            edgeId: selectedEdge.edge.id,
            sourceSlug: selectedEdge.source.node.navigateSlug ?? selectedEdge.source.node.id,
            targetSlug: selectedEdge.target.node.navigateSlug ?? selectedEdge.target.node.id,
            type: selectedEdge.kind === "hierarchy" ? "hierarchy" : "link",
            origin: selectedEdge.edge.origin,
            relationType: selectedEdge.edge.relationType,
            score: selectedEdge.edge.score,
            explanation: selectedEdge.edge.explanation.text,
          }
        : null,
      visibleNodeSlugs: plan.nodes.map((node) => node.navigateSlug ?? node.id).slice(0, 24),
      directNeighborSlugs,
      activeCluster: context.scopeCluster,
      filters: searchQuery ? [searchQuery] : [],
      depth: context.configuredDepth < 0 ? 3 : context.configuredDepth,
      relationshipTypes: selectedEdge ? [selectedEdge.edge.relationType] : ["semantic-affinity"],
      viewport: { x: transform.x, y: transform.y, width, height, scale: transform.k },
    }
    const graphWindow = window as Window & { __breadboardGraphContext?: unknown }
    graphWindow.__breadboardGraphContext = detail
    window.dispatchEvent(new CustomEvent("breadboard:graph-context", { detail }))
  }

  // --- Resize --------------------------------------------------------------
  const resizeObserver =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          const nextWidth = graph.offsetWidth
          const nextHeight = graph.offsetHeight
          if (!nextWidth || !nextHeight || (nextWidth === width && nextHeight === height)) return
          const deltaWidth = nextWidth - width
          const deltaHeight = nextHeight - height
          width = nextWidth
          height = nextHeight
          app.renderer.resize(width, height)
          if (viewState === "fit") fitView(false)
          else
            applyTransform(
              {
                k: transform.k,
                x: transform.x - (transform.k * deltaWidth) / 2,
                y: transform.y - (transform.k * deltaHeight) / 2,
              },
              false,
            )
          labelsDirty = true
        })
  resizeObserver?.observe(graph)

  // --- Frame loop ----------------------------------------------------------
  const lerp = (current: number, target: number) =>
    Math.abs(target - current) < 0.01 ? target : current + (target - current) * 0.22

  function animate() {
    if (stopAnimation) return
    if (labelsDirty) updateLabels()
    const inverseScale = 1 / Math.sqrt(transform.k)
    for (const view of views) {
      const { node } = view
      view.gfx.position.set(worldX(node), worldY(node))
      view.gfx.scale.set(inverseScale, inverseScale)
      view.alpha = lerp(view.alpha, view.alphaTarget)
      view.gfx.alpha = view.alpha
      view.labelAlpha = lerp(view.labelAlpha, view.labelTarget)
      const placement = view.placement
      if (placement && view.labelAlpha > 0.02) {
        const position = screenOf(node)
        view.label.visible = true
        view.label.alpha = view.labelAlpha
        view.label.anchor.set(placement.anchorX, placement.anchorY)
        view.label.position.set(position.x + placement.dx, position.y + placement.dy)
      } else {
        view.label.visible = false
      }
    }
    for (const view of connectionViews) {
      view.alpha = lerp(view.alpha, view.alphaTarget)
      drawEdge(view)
    }
    positionFloatingCallout()
    if (debugEnabled) {
      const debugWindow = window as Window & { __breadboardThoughtTopologyDebug?: unknown }
      debugWindow.__breadboardThoughtTopologyDebug = {
        selectedConnectionId: selectedEdgeId,
        selectedNodeId,
        hoveredNodeId,
        activeDragNodeId,
        returningNodeIds: [...returningNodeIds],
        permanentNodeIds: [...permanentHomeIds],
        viewState,
        viewSettled: !transitioning && (simulationSettled || draggingNode),
        simulationSettled,
        calloutVisible,
        transform: { k: transform.k, x: transform.x, y: transform.y },
        labels: Object.fromEntries(
          views.filter((view) => view.label.visible).map((view) => [view.node.id, view.label.text]),
        ),
        nodes: Object.fromEntries(views.map((view) => [view.node.id, screenOf(view.node)])),
        worldNodes: Object.fromEntries(
          views.map((view) => [view.node.id, { x: view.node.x, y: view.node.y }]),
        ),
        hierarchyEdges: Object.fromEntries(
          hierarchyViews.map((view) => {
            const mid = edgePoint(view, 0.5)
            return [
              view.edge.id,
              {
                source: view.source.node.id,
                target: view.target.node.id,
                x: transform.applyX(mid.x),
                y: transform.applyY(mid.y),
                baseWidth: view.edge.width,
                renderedWidth: view.selected
                  ? view.edge.width + view.widthBoost + 1.2
                  : view.edge.width + view.widthBoost,
              },
            ]
          }),
        ),
        edges: Object.fromEntries(
          edgeViews.map((view) => {
            const mid = edgePoint(view, 0.5)
            return [
              view.edge.id,
              {
                x: transform.applyX(mid.x),
                y: transform.applyY(mid.y),
                baseWidth: view.edge.width,
                renderedWidth: view.selected
                  ? view.edge.width + view.widthBoost + 1.2
                  : view.edge.width + view.widthBoost,
              },
            ]
          }),
        ),
      }
    }
    app.renderer.render(stage)
    requestAnimationFrame(animate)
  }

  refreshStyles()
  fitView(false, true)
  emitGraphContext()
  requestAnimationFrame(animate)

  return () => {
    stopAnimation = true
    simulation.stop()
    resizeObserver?.disconnect()
    graph.removeEventListener("graph-search", handleGraphSearch)
    graph.removeEventListener("graph-search-commit", handleGraphSearchCommit)
    for (const cleanup of cleanups) cleanup()
    if (graphRoot && graphRoot.dataset.activeMode === "thought-topology")
      delete graphRoot.dataset.activeMode
    if (heading) heading.hidden = true
    app.destroy()
  }
}
