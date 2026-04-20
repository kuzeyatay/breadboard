import type { ContentDetails } from "../../plugins/emitters/contentIndex"
import {
  SimulationNodeDatum,
  SimulationLinkDatum,
  Simulation,
  forceSimulation,
  forceManyBody,
  forceCenter,
  forceLink,
  forceCollide,
  forceRadial,
  forceX,
  forceY,
  zoomIdentity,
  select,
  drag,
  zoom,
} from "d3"
import { Text, Graphics, Application, Container, Circle } from "pixi.js"
import { Group as TweenGroup, Tween as Tweened } from "@tweenjs/tween.js"
import { removeAllChildren } from "./util"
import { FullSlug, SimpleSlug, getFullSlug, resolveRelative, simplifySlug } from "../../util/path"
import { D3Config } from "../Graph"

type GraphicsInfo = {
  color: string
  gfx: Graphics
  alpha: number
  active: boolean
}

type NodeData = {
  id: SimpleSlug
  text: string
  tags: string[]
  knowledgeType?: string
  sourceFile?: string
  locations?: string[]
} & SimulationNodeDatum

type SimpleLinkData = {
  source: SimpleSlug
  target: SimpleSlug
}

type LinkData = {
  source: NodeData
  target: NodeData
} & SimulationLinkDatum<NodeData>

type LinkRenderData = GraphicsInfo & {
  simulationData: LinkData
}

type NodeRenderData = GraphicsInfo & {
  simulationData: NodeData
  label: Text
  searchRing: Graphics
}

const localStorageKey = "graph-visited"
function getVisited(): Set<SimpleSlug> {
  return new Set(JSON.parse(localStorage.getItem(localStorageKey) ?? "[]"))
}

function addToVisited(slug: SimpleSlug) {
  const visited = getVisited()
  visited.add(slug)
  localStorage.setItem(localStorageKey, JSON.stringify([...visited]))
}

function stableHash(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function stableUnit(value: string): number {
  return stableHash(value) / 4294967295
}

function clusterPrefixForSlug(slug: SimpleSlug): string | null {
  if (slug === "/" || slug.startsWith("tags/")) return null
  const cleaned = slug.replace(/\/$/, "")
  const [cluster] = cleaned.split("/")
  return cluster || null
}

function belongsToCluster(slug: SimpleSlug, cluster: string): boolean {
  return slug === cluster || slug.startsWith(`${cluster}/`)
}

function isRootPageSlug(slug: SimpleSlug): boolean {
  return slug === "index" || slug === "/"
}

type TweenNode = {
  update: (time: number) => void
  stop: () => void
}

async function renderGraph(graph: HTMLElement, fullSlug: FullSlug) {
  const slug = simplifySlug(fullSlug)
  const visited = getVisited()
  const isGlobalGraph = graph.classList.contains("global-graph-container")
  removeAllChildren(graph)

  let {
    drag: enableDrag,
    zoom: enableZoom,
    depth,
    scope,
    clickToNavigate,
    scale,
    repelForce,
    centerForce,
    linkDistance,
    fontSize,
    opacityScale,
    removeTags,
    showTags,
    includeClusters,
    focusOnHover,
    enableRadial,
  } = JSON.parse(graph.dataset["cfg"]!) as D3Config
  const isOverviewGraph = depth < 0
  const hasExplicitClusterScope = Array.isArray(includeClusters)
  const scopeClusters = hasExplicitClusterScope
    ? includeClusters.filter((cluster) => typeof cluster === "string" && cluster.length > 0)
    : []

  const allEntries = Object.entries<ContentDetails>(await fetchData)
    .map(([k, v]) => [simplifySlug(k as FullSlug), v] as [SimpleSlug, ContentDetails])
    .filter(([nodeSlug]) => !isRootPageSlug(nodeSlug))
  const scopeCluster = scope === "all" ? null : clusterPrefixForSlug(slug)
  const data: Map<SimpleSlug, ContentDetails> = new Map(
    hasExplicitClusterScope
      ? allEntries.filter(([nodeSlug]) =>
          scopeClusters.some((cluster) => belongsToCluster(nodeSlug, cluster)),
        )
      : scopeCluster === null
        ? allEntries
        : allEntries.filter(([nodeSlug]) => belongsToCluster(nodeSlug, scopeCluster)),
  )
  const links: SimpleLinkData[] = []
  const tags: SimpleSlug[] = []
  const validLinks = new Set(data.keys())

  const tweens = new Map<string, TweenNode>()
  for (const [source, details] of data.entries()) {
    const outgoing = details.links ?? []

    for (const dest of outgoing) {
      if (validLinks.has(dest)) {
        links.push({ source: source, target: dest })
      }
    }

    if (showTags) {
      const localTags = details.tags
        .filter((tag) => !removeTags.includes(tag))
        .map((tag) => simplifySlug(("tags/" + tag) as FullSlug))

      tags.push(...localTags.filter((tag) => !tags.includes(tag)))

      for (const tag of localTags) {
        links.push({ source: source, target: tag })
      }
    }
  }

  const neighbourhood = new Set<SimpleSlug>()
  const wl: (SimpleSlug | "__SENTINEL")[] = [slug, "__SENTINEL"]
  if (depth >= 0) {
    while (depth >= 0 && wl.length > 0) {
      // compute neighbours
      const cur = wl.shift()!
      if (cur === "__SENTINEL") {
        depth--
        wl.push("__SENTINEL")
      } else {
        neighbourhood.add(cur)
        const outgoing = links.filter((l) => l.source === cur)
        const incoming = links.filter((l) => l.target === cur)
        wl.push(...outgoing.map((l) => l.target), ...incoming.map((l) => l.source))
      }
    }
  } else {
    validLinks.forEach((id) => neighbourhood.add(id))
    if (showTags) tags.forEach((tag) => neighbourhood.add(tag))
  }

  const nodes = [...neighbourhood].map((url) => {
    const details = data.get(url)
    const text = url.startsWith("tags/") ? "#" + url.substring(5) : (details?.title ?? url)
    return {
      id: url,
      text,
      tags: details?.tags ?? [],
      knowledgeType: details?.knowledgeType,
      sourceFile: details?.sourceFile,
      locations: details?.locations,
    }
  })
  const graphData: { nodes: NodeData[]; links: LinkData[] } = {
    nodes,
    links: links
      .filter((l) => neighbourhood.has(l.source) && neighbourhood.has(l.target))
      .map((l) => ({
        source: nodes.find((n) => n.id === l.source)!,
        target: nodes.find((n) => n.id === l.target)!,
      })),
  }

  const width = graph.offsetWidth
  const height = Math.max(graph.offsetHeight, 250)

  // we virtualize the simulation and use pixi to actually render it
  const overviewLinkDistance = isOverviewGraph
    ? Math.max(44, Math.min(linkDistance, Math.min(width, height) * 0.18))
    : linkDistance
  const linkDistanceFor = (link: LinkData) => {
    if (!isOverviewGraph) return linkDistance
    const sourceType = link.source.knowledgeType
    const targetType = link.target.knowledgeType
    if (link.source.id.startsWith("tags/") || link.target.id.startsWith("tags/")) {
      return overviewLinkDistance * 1.05
    }
    if (sourceType === "source-document" || targetType === "source-document") {
      return overviewLinkDistance * 1.28
    }
    if (sourceType === "generated-note" || targetType === "generated-note") {
      return overviewLinkDistance * 1.16
    }
    if (link.source.sourceFile && link.source.sourceFile === link.target.sourceFile) {
      return overviewLinkDistance * 0.9
    }
    return overviewLinkDistance
  }

  const collisionRadius = (node: NodeData) =>
    nodeRadius(node) + (isGlobalGraph ? 18 : isOverviewGraph ? 7 : 0)
  const simulation: Simulation<NodeData, LinkData> = forceSimulation<NodeData>(graphData.nodes)
    .force("charge", forceManyBody().strength(-100 * repelForce))
    .force("center", forceCenter().strength(centerForce))
    .force("link", forceLink<NodeData, LinkData>(graphData.links).distance(linkDistanceFor))
    .force("collide", forceCollide<NodeData>(collisionRadius).iterations(isGlobalGraph ? 6 : 3))

  const radius = (Math.min(width, height) / 2) * 0.8
  if (enableRadial) simulation.force("radial", forceRadial(radius).strength(0.2))
  if (isOverviewGraph) {
    const xForNode = (node: NodeData) => {
      if (node.id.startsWith("tags/")) {
        return width * (stableUnit(`tag-x:${node.id}`) - 0.5) * 0.86
      }
      if (node.knowledgeType === "source-document") return -width * 0.32
      if (node.knowledgeType === "generated-note") return width * 0.32
      if (node.id === slug) return 0
      return width * (stableUnit(node.sourceFile || node.id) - 0.5) * 0.32
    }
    const yForNode = (node: NodeData) => {
      if (node.id.startsWith("tags/")) {
        return height * (stableUnit(`tag-y:${node.id}`) - 0.5) * 0.86
      }
      const sourceSeed = node.sourceFile || node.id
      const localSeed = `${sourceSeed}:${node.id}`
      return height * (stableUnit(localSeed) - 0.5) * 0.72
    }

    simulation
      .force("cluster-x", forceX<NodeData>(xForNode).strength(isGlobalGraph ? 0.11 : 0.09))
      .force("cluster-y", forceY<NodeData>(yForNode).strength(isGlobalGraph ? 0.055 : 0.045))
      .alphaDecay(0.018)
      .velocityDecay(0.5)
  }

  // precompute style prop strings as pixi doesn't support css variables
  const cssVars = [
    "--secondary",
    "--tertiary",
    "--gray",
    "--light",
    "--lightgray",
    "--dark",
    "--darkgray",
    "--bodyFont",
  ] as const
  const computedStyleMap = cssVars.reduce(
    (acc, key) => {
      acc[key] = getComputedStyle(document.documentElement).getPropertyValue(key)
      return acc
    },
    {} as Record<(typeof cssVars)[number], string>,
  )
  const graphColors = {
    current: "#93c5fd",
    source: "#67e8f9",
    topic: "#86efac",
    generated: "#f9a8d4",
    tag: "#facc15",
    neutral: computedStyleMap["--gray"],
    edge: "#334155",
    edgeActive: "#cbd5e1",
    search: "#fde047",
  }

  // calculate color
  const color = (d: NodeData) => {
    const isCurrent = d.id === slug
    if (isCurrent) {
      return graphColors.current
    } else if (d.knowledgeType === "source-document") {
      return graphColors.source
    } else if (d.knowledgeType === "knowledge-topic") {
      return graphColors.topic
    } else if (d.knowledgeType === "generated-note") {
      return graphColors.generated
    } else if (d.id.startsWith("tags/")) {
      return graphColors.tag
    } else if (visited.has(d.id) || d.id.startsWith("tags/")) {
      return graphColors.topic
    } else {
      return graphColors.neutral
    }
  }

  function nodeRadius(d: NodeData) {
    const numLinks = graphData.links.filter(
      (l) => l.source.id === d.id || l.target.id === d.id,
    ).length
    const base = d.id.startsWith("tags/") ? 1.4 : d.knowledgeType === "source-document" ? 4.4 : 2.2
    return base + Math.sqrt(numLinks)
  }

  let hoveredNodeId: string | null = null
  let hoveredNeighbours: Set<string> = new Set()
  let searchQuery = ""
  let searchedNodeIds: Set<string> = new Set()
  let searchedNeighbours: Set<string> = new Set()
  let currentZoomLabelAlpha = 0
  const linkRenderData: LinkRenderData[] = []
  const nodeRenderData: NodeRenderData[] = []

  function fieldsForSearch(node: NodeData): string {
    return [node.text, node.id, node.sourceFile, ...(node.locations ?? []), ...(node.tags ?? [])]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
  }

  function updateSearchInfo(query: string) {
    searchQuery = query.trim().toLowerCase()
    searchedNodeIds = new Set()
    searchedNeighbours = new Set()

    if (searchQuery) {
      for (const n of nodeRenderData) {
        if (fieldsForSearch(n.simulationData).includes(searchQuery)) {
          searchedNodeIds.add(n.simulationData.id)
        }
      }

      for (const l of linkRenderData) {
        if (
          searchedNodeIds.has(l.simulationData.source.id) ||
          searchedNodeIds.has(l.simulationData.target.id)
        ) {
          searchedNeighbours.add(l.simulationData.source.id)
          searchedNeighbours.add(l.simulationData.target.id)
        }
      }
    }

    renderPixiFromD3()
    graph.dispatchEvent(
      new CustomEvent("graph-search-result", {
        detail: {
          query,
          matches: searchedNodeIds.size,
          total: nodeRenderData.length,
        },
      }),
    )
  }

  function updateHoverInfo(newHoveredId: string | null) {
    hoveredNodeId = newHoveredId

    if (newHoveredId === null) {
      hoveredNeighbours = new Set()
      for (const n of nodeRenderData) {
        n.active = false
      }

      for (const l of linkRenderData) {
        l.active = false
      }
    } else {
      hoveredNeighbours = new Set()
      for (const l of linkRenderData) {
        const linkData = l.simulationData
        if (linkData.source.id === newHoveredId || linkData.target.id === newHoveredId) {
          hoveredNeighbours.add(linkData.source.id)
          hoveredNeighbours.add(linkData.target.id)
        }

        l.active = linkData.source.id === newHoveredId || linkData.target.id === newHoveredId
      }

      for (const n of nodeRenderData) {
        n.active = hoveredNeighbours.has(n.simulationData.id)
      }
    }
  }

  let dragStartTime = 0
  let dragging = false

  function renderLinks() {
    tweens.get("link")?.stop()
    const tweenGroup = new TweenGroup()

    for (const l of linkRenderData) {
      const touchesSearch =
        searchedNodeIds.has(l.simulationData.source.id) ||
        searchedNodeIds.has(l.simulationData.target.id)
      const touchesTag =
        l.simulationData.source.id.startsWith("tags/") ||
        l.simulationData.target.id.startsWith("tags/")
      let alpha = isOverviewGraph ? (touchesTag ? 0.12 : 0.24) : 1

      if (searchQuery) {
        alpha = touchesSearch ? 0.95 : 0.035
      } else if (hoveredNodeId) {
        alpha = l.active ? 0.95 : 0.06
      }

      l.color =
        searchQuery && touchesSearch
          ? graphColors.search
          : l.active
            ? graphColors.edgeActive
            : isOverviewGraph
              ? graphColors.edge
              : computedStyleMap["--lightgray"]
      tweenGroup.add(new Tweened<LinkRenderData>(l).to({ alpha }, 200))
    }

    tweenGroup.getAll().forEach((tw) => tw.start())
    tweens.set("link", {
      update: tweenGroup.update.bind(tweenGroup),
      stop() {
        tweenGroup.getAll().forEach((tw) => tw.stop())
      },
    })
  }

  function renderLabels() {
    tweens.get("label")?.stop()
    const tweenGroup = new TweenGroup()

    const defaultScale = 1 / scale
    const activeScale = defaultScale * 1.1
    for (const n of nodeRenderData) {
      const nodeId = n.simulationData.id
      const isSearchHit = searchedNodeIds.has(nodeId)
      const isSearchNeighbour = searchedNeighbours.has(nodeId)

      if (searchQuery && isSearchHit) {
        tweenGroup.add(
          new Tweened<Text>(n.label).to(
            {
              alpha: 1,
              scale: { x: activeScale * 1.08, y: activeScale * 1.08 },
            },
            100,
          ),
        )
      } else if (searchQuery && isSearchNeighbour) {
        tweenGroup.add(
          new Tweened<Text>(n.label).to(
            {
              alpha: 0.58,
              scale: { x: defaultScale, y: defaultScale },
            },
            100,
          ),
        )
      } else if (searchQuery) {
        tweenGroup.add(
          new Tweened<Text>(n.label).to(
            {
              alpha: 0,
              scale: { x: defaultScale, y: defaultScale },
            },
            100,
          ),
        )
      } else if (hoveredNodeId === nodeId) {
        tweenGroup.add(
          new Tweened<Text>(n.label).to(
            {
              alpha: 1,
              scale: { x: activeScale, y: activeScale },
            },
            100,
          ),
        )
      } else {
        tweenGroup.add(
          new Tweened<Text>(n.label).to(
            {
              alpha: currentZoomLabelAlpha,
              scale: { x: defaultScale, y: defaultScale },
            },
            100,
          ),
        )
      }
    }

    tweenGroup.getAll().forEach((tw) => tw.start())
    tweens.set("label", {
      update: tweenGroup.update.bind(tweenGroup),
      stop() {
        tweenGroup.getAll().forEach((tw) => tw.stop())
      },
    })
  }

  function renderNodes() {
    tweens.get("hover")?.stop()

    const tweenGroup = new TweenGroup()
    for (const n of nodeRenderData) {
      const nodeId = n.simulationData.id
      const isSearchHit = searchedNodeIds.has(nodeId)
      const isSearchNeighbour = searchedNeighbours.has(nodeId)
      let alpha = 1

      if (searchQuery) {
        alpha = isSearchHit ? 1 : isSearchNeighbour ? 0.52 : 0.14
      } else if (hoveredNodeId !== null && focusOnHover) {
        alpha = n.active ? 1 : 0.2
      }

      n.searchRing.alpha = isSearchHit ? 0.95 : 0
      tweenGroup.add(new Tweened<Graphics>(n.gfx, tweenGroup).to({ alpha }, 200))
    }

    tweenGroup.getAll().forEach((tw) => tw.start())
    tweens.set("hover", {
      update: tweenGroup.update.bind(tweenGroup),
      stop() {
        tweenGroup.getAll().forEach((tw) => tw.stop())
      },
    })
  }

  function renderPixiFromD3() {
    renderNodes()
    renderLinks()
    renderLabels()
  }

  tweens.forEach((tween) => tween.stop())
  tweens.clear()

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
  stage.interactive = false

  const labelsContainer = new Container<Text>({ zIndex: 3, isRenderGroup: true })
  const nodesContainer = new Container<Graphics>({ zIndex: 2, isRenderGroup: true })
  const linkContainer = new Container<Graphics>({ zIndex: 1, isRenderGroup: true })
  stage.addChild(nodesContainer, labelsContainer, linkContainer)

  for (const n of graphData.nodes) {
    const nodeId = n.id

    const label = new Text({
      interactive: false,
      eventMode: "none",
      text: n.text,
      alpha: 0,
      anchor: { x: 0.5, y: 1.2 },
      style: {
        fontSize: fontSize * 15,
        fill: computedStyleMap["--dark"],
        fontFamily: computedStyleMap["--bodyFont"],
      },
      resolution: window.devicePixelRatio * 4,
    })
    label.scale.set(1 / scale)

    let oldLabelOpacity = 0
    const isTagNode = nodeId.startsWith("tags/")
    const radius = nodeRadius(n)
    const nodeColor = color(n)
    const searchRing = new Graphics({
      interactive: false,
      eventMode: "none",
    })
      .circle(0, 0, radius + 8)
      .stroke({ width: 2.5, color: graphColors.search, alpha: 0.95 })
    searchRing.alpha = 0

    const gfx = new Graphics({
      interactive: true,
      label: nodeId,
      eventMode: "static",
      hitArea: new Circle(0, 0, radius + 7),
      cursor: "pointer",
    })
      .circle(0, 0, radius + (isTagNode ? 2 : 5))
      .fill({ color: nodeColor, alpha: isTagNode ? 0.05 : 0.16 })
      .circle(0, 0, radius)
      .fill({
        color: isTagNode ? computedStyleMap["--light"] : nodeColor,
        alpha: isTagNode ? 0.22 : 0.92,
      })
      .stroke({ width: isTagNode ? 1.5 : 1, color: nodeColor, alpha: isTagNode ? 0.7 : 0.9 })
      .on("pointerover", (e) => {
        updateHoverInfo(e.target.label)
        oldLabelOpacity = label.alpha
        if (!dragging) {
          renderPixiFromD3()
        }
      })
      .on("pointerleave", () => {
        updateHoverInfo(null)
        label.alpha = oldLabelOpacity
        if (!dragging) {
          renderPixiFromD3()
        }
      })

    nodesContainer.addChild(searchRing)
    nodesContainer.addChild(gfx)
    labelsContainer.addChild(label)

    const nodeRenderDatum: NodeRenderData = {
      simulationData: n,
      gfx,
      label,
      searchRing,
      color: color(n),
      alpha: 1,
      active: false,
    }

    nodeRenderData.push(nodeRenderDatum)
  }

  for (const l of graphData.links) {
    const gfx = new Graphics({ interactive: false, eventMode: "none" })
    linkContainer.addChild(gfx)

    const linkRenderDatum: LinkRenderData = {
      simulationData: l,
      gfx,
      color: computedStyleMap["--lightgray"],
      alpha: 1,
      active: false,
    }

    linkRenderData.push(linkRenderDatum)
  }

  let currentTransform = zoomIdentity
  if (enableDrag) {
    select<HTMLCanvasElement, NodeData | undefined>(app.canvas).call(
      drag<HTMLCanvasElement, NodeData | undefined>()
        .container(() => app.canvas)
        .subject(() => graphData.nodes.find((n) => n.id === hoveredNodeId))
        .on("start", function dragstarted(event) {
          if (!event.active) simulation.alphaTarget(1).restart()
          event.subject.fx = event.subject.x
          event.subject.fy = event.subject.y
          event.subject.__initialDragPos = {
            x: event.subject.x,
            y: event.subject.y,
            fx: event.subject.fx,
            fy: event.subject.fy,
          }
          dragStartTime = Date.now()
          dragging = true
        })
        .on("drag", function dragged(event) {
          const initPos = event.subject.__initialDragPos
          event.subject.fx = initPos.x + (event.x - initPos.x) / currentTransform.k
          event.subject.fy = initPos.y + (event.y - initPos.y) / currentTransform.k
        })
        .on("end", function dragended(event) {
          if (!event.active) simulation.alphaTarget(0)
          event.subject.fx = null
          event.subject.fy = null
          dragging = false

          // if the time between mousedown and mouseup is short, we consider it a click
          if ((isGlobalGraph || clickToNavigate) && Date.now() - dragStartTime < 500) {
            const node = graphData.nodes.find((n) => n.id === event.subject.id) as NodeData
            const targ = resolveRelative(fullSlug, node.id)
            window.spaNavigate(new URL(targ, window.location.toString()))
          }
        }),
    )
  } else {
    for (const node of nodeRenderData) {
      node.gfx.on("click", () => {
        if (!isGlobalGraph && !clickToNavigate) return
        const targ = resolveRelative(fullSlug, node.simulationData.id)
        window.spaNavigate(new URL(targ, window.location.toString()))
      })
    }
  }

  if (enableZoom) {
    select<HTMLCanvasElement, NodeData>(app.canvas).call(
      zoom<HTMLCanvasElement, NodeData>()
        .extent([
          [0, 0],
          [width, height],
        ])
        .scaleExtent([0.25, 4])
        .on("zoom", ({ transform }) => {
          currentTransform = transform
          stage.scale.set(transform.k, transform.k)
          stage.position.set(transform.x, transform.y)

          // zoom adjusts opacity of labels too
          const scale = transform.k * opacityScale
          let scaleOpacity = Math.max((scale - 1) / 3.75, 0)
          currentZoomLabelAlpha = scaleOpacity
          const activeNodes = nodeRenderData
            .filter((n) => n.active || searchedNodeIds.has(n.simulationData.id))
            .flatMap((n) => n.label)

          for (const label of labelsContainer.children) {
            if (!activeNodes.includes(label)) {
              label.alpha = scaleOpacity
            }
          }
        }),
    )
  }

  let stopAnimation = false
  function animate(time: number) {
    if (stopAnimation) return
    for (const n of nodeRenderData) {
      const { x, y } = n.simulationData
      if (!x || !y) continue
      n.searchRing.position.set(x + width / 2, y + height / 2)
      n.gfx.position.set(x + width / 2, y + height / 2)
      if (n.label) {
        n.label.position.set(x + width / 2, y + height / 2)
      }
    }

    for (const l of linkRenderData) {
      const linkData = l.simulationData
      l.gfx.clear()
      l.gfx.moveTo(linkData.source.x! + width / 2, linkData.source.y! + height / 2)
      l.gfx
        .lineTo(linkData.target.x! + width / 2, linkData.target.y! + height / 2)
        .stroke({ alpha: l.alpha, width: 1, color: l.color })
    }

    tweens.forEach((t) => t.update(time))
    app.renderer.render(stage)
    requestAnimationFrame(animate)
  }

  const handleGraphSearch = (event: Event) => {
    const detail = (event as CustomEvent<{ query?: string }>).detail
    updateSearchInfo(detail?.query ?? "")
  }
  graph.addEventListener("graph-search", handleGraphSearch)
  if (graph.dataset.searchQuery) {
    updateSearchInfo(graph.dataset.searchQuery)
  }

  requestAnimationFrame(animate)
  return () => {
    stopAnimation = true
    graph.removeEventListener("graph-search", handleGraphSearch)
    app.destroy()
  }
}

let localGraphCleanups: (() => void)[] = []
let globalGraphCleanups: (() => void)[] = []

function cleanupLocalGraphs() {
  for (const cleanup of localGraphCleanups) {
    cleanup()
  }
  localGraphCleanups = []
}

function cleanupGlobalGraphs() {
  for (const cleanup of globalGraphCleanups) {
    cleanup()
  }
  globalGraphCleanups = []
}

document.addEventListener("nav", async (e: CustomEventMap["nav"]) => {
  const slug = e.detail.url
  addToVisited(simplifySlug(slug))

  async function renderLocalGraph() {
    cleanupLocalGraphs()
    const localGraphContainers = document.getElementsByClassName("graph-container")
    for (const container of localGraphContainers) {
      localGraphCleanups.push(await renderGraph(container as HTMLElement, slug))
    }
  }

  await renderLocalGraph()
  const handleThemeChange = () => {
    void renderLocalGraph()
  }

  document.addEventListener("themechange", handleThemeChange)
  window.addCleanup(() => {
    document.removeEventListener("themechange", handleThemeChange)
  })

  const containers = [...document.getElementsByClassName("global-graph-outer")] as HTMLElement[]
  async function renderGlobalGraph() {
    cleanupGlobalGraphs()
    const slug = getFullSlug(window)
    for (const container of containers) {
      container.classList.add("active")
      const sidebar = container.closest(".sidebar") as HTMLElement
      if (sidebar) {
        sidebar.style.zIndex = "1"
      }

      const graphContainer = container.querySelector(".global-graph-container") as HTMLElement
      if (graphContainer) {
        globalGraphCleanups.push(await renderGraph(graphContainer, slug))
        const input = container.querySelector(
          ".global-graph-search-input",
        ) as HTMLInputElement | null
        if (input?.value) {
          graphContainer.dispatchEvent(
            new CustomEvent("graph-search", { detail: { query: input.value } }),
          )
        }
      }
    }
  }

  function hideGlobalGraph() {
    cleanupGlobalGraphs()
    for (const container of containers) {
      container.classList.remove("active")
      const sidebar = container.closest(".sidebar") as HTMLElement
      if (sidebar) {
        sidebar.style.zIndex = ""
      }
    }
  }

  async function shortcutHandler(e: HTMLElementEventMap["keydown"]) {
    if (e.key === "g" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      e.preventDefault()
      const anyGlobalGraphOpen = containers.some((container) =>
        container.classList.contains("active"),
      )
      if (!anyGlobalGraphOpen) await renderGlobalGraph()
    }
  }

  const containerIcons = document.getElementsByClassName("global-graph-icon")
  Array.from(containerIcons).forEach((icon) => {
    const openGraph = () => void renderGlobalGraph()
    icon.addEventListener("click", openGraph)
    window.addCleanup(() => icon.removeEventListener("click", openGraph))
  })

  const localGraphOuters = [...document.getElementsByClassName("graph-outer")] as HTMLElement[]
  localGraphOuters.forEach((outer) => {
    let pointerStart: { x: number; y: number } | null = null

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest(".global-graph-icon")) return
      pointerStart = { x: event.clientX, y: event.clientY }
    }

    const handlePointerUp = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (!pointerStart || target?.closest(".global-graph-icon")) {
        pointerStart = null
        return
      }

      const distance = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y)
      pointerStart = null
      if (distance > 6) return
      void renderGlobalGraph()
    }

    outer.addEventListener("pointerdown", handlePointerDown)
    outer.addEventListener("pointerup", handlePointerUp)
    window.addCleanup(() => {
      outer.removeEventListener("pointerdown", handlePointerDown)
      outer.removeEventListener("pointerup", handlePointerUp)
    })
  })

  const closeButtons = [...document.getElementsByClassName("global-graph-close")] as HTMLElement[]
  closeButtons.forEach((button) => {
    button.addEventListener("click", hideGlobalGraph)
    window.addCleanup(() => button.removeEventListener("click", hideGlobalGraph))
  })

  const searchPanels = [...document.getElementsByClassName("global-graph-search")] as HTMLElement[]
  searchPanels.forEach((panel) => {
    const overlay = panel.closest(".global-graph-outer") as HTMLElement | null
    const input = panel.querySelector(".global-graph-search-input") as HTMLInputElement | null
    const searchButton = panel.querySelector(
      ".global-graph-search-button",
    ) as HTMLButtonElement | null
    const clearButton = panel.querySelector(
      ".global-graph-search-clear",
    ) as HTMLButtonElement | null
    const status = panel.querySelector(".global-graph-search-status") as HTMLElement | null
    if (!overlay || !input) return

    const graphContainer = () =>
      overlay.querySelector(".global-graph-container") as HTMLElement | null

    const runSearch = () => {
      const container = graphContainer()
      if (!container) return
      container.dataset.searchQuery = input.value
      container.dispatchEvent(new CustomEvent("graph-search", { detail: { query: input.value } }))
    }

    const handleResult = (event: Event) => {
      const detail = (event as CustomEvent<{ query?: string; matches?: number; total?: number }>)
        .detail
      if (!status) return
      const query = detail?.query?.trim() ?? ""
      const matches = detail?.matches ?? 0
      const total = detail?.total ?? 0
      status.textContent = query ? `${matches}/${total}` : ""
    }

    const handleSearchButton = () => {
      input.focus()
      runSearch()
    }

    const handleClearButton = () => {
      input.value = ""
      input.focus()
      runSearch()
    }

    input.addEventListener("input", runSearch)
    searchButton?.addEventListener("click", handleSearchButton)
    clearButton?.addEventListener("click", handleClearButton)
    graphContainer()?.addEventListener("graph-search-result", handleResult)

    window.addCleanup(() => {
      input.removeEventListener("input", runSearch)
      searchButton?.removeEventListener("click", handleSearchButton)
      clearButton?.removeEventListener("click", handleClearButton)
      graphContainer()?.removeEventListener("graph-search-result", handleResult)
    })
  })

  document.addEventListener("keydown", shortcutHandler)
  window.addCleanup(() => {
    document.removeEventListener("keydown", shortcutHandler)
    cleanupLocalGraphs()
    cleanupGlobalGraphs()
  })
})
