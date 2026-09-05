// Pure layout and text helpers for the Thought Topology map. Nothing in this
// module touches the DOM, Pixi, or d3, so the dashboard test-suite can drive it
// under node:test and the renderer stays a thin interaction layer.
//
// Coordinates: the map is planned in "world" units with the Garden at (0, 0).
// The renderer maps world to screen with a single zoom transform.

// @ts-expect-error The direct Node test loader requires the explicit extension;
// Quartz's bundler resolves the same TypeScript module at build time.
import { topologySourceKind, type TopologySourceKind } from "./sourceNodeVisual.ts"

// @ts-expect-error See the import above.
export { topologySourceKind, type TopologySourceKind } from "./sourceNodeVisual.ts"

export type TopologyEnrichmentText = { state: string; text: string }

export type TopologyPayloadFolder = {
  id: string
  path: string
  parentId: string | null
  title: string
  depth: number
  nodeCount: number
  summary: TopologyEnrichmentText
  pageSlug?: string
  x?: number
  y?: number
}

export type TopologyPayloadNode = {
  id: string
  slug: string
  relPath: string
  folderId: string
  title: string
  kind?: "markdown" | "source" | "internal-concept"
  knowledgeType: string
  sourceType?: string
  summary: TopologyEnrichmentText
  primaryConcepts: string[]
  supportingConcepts: string[]
  wordCount?: number
  x?: number
  y?: number
}

export type TopologyPayloadEdge = {
  id: string
  source: string
  target: string
  structural?: boolean
  origin?: "inferred" | "authored" | "provenance"
  score?: number
  previousScore?: number
  threshold?: number
  components?: { embedding: number; concept: number; lexical: number }
  relationType?: string
  direction?: string
  explanation?: TopologyEnrichmentText
  evidence?: Array<{ kind: string; label: string }>
  visual?: { width: number; opacity: number; distance: number; strength: number }
}

export type TopologyPayload = {
  sourceRevision?: string
  garden: { id: number; slug: string; title: string; summary: TopologyEnrichmentText }
  folders: TopologyPayloadFolder[]
  nodes: TopologyPayloadNode[]
  edges: TopologyPayloadEdge[]
  build: {
    state: string
    threshold: number
    retrievalMode?: "semantic-vector" | "concept-lexical"
    embeddingModel?: string
  }
  runtimeStatus?: {
    state: "building" | "failed" | "stale"
    message: string
    progress?: number
  }
}

export type AggregateTopologyEntry = {
  clusterSlug: string
  topology: TopologyPayload
}

/**
 * Join several independently-authorized Garden topologies beneath one library
 * root. IDs and folder paths are namespaced so two Gardens can safely contain
 * the same relative filenames. Each Garden becomes a first-level folder,
 * which preserves the visible hierarchy as library -> Garden -> folder/page.
 */
export function aggregateThoughtTopologies(
  aggregateSlug: string,
  aggregateTitle: string,
  requestedGardenCount: number,
  entries: AggregateTopologyEntry[],
): TopologyPayload {
  const folders: TopologyPayloadFolder[] = [
    {
      id: "aggregate:root",
      path: "",
      parentId: null,
      title: aggregateTitle,
      depth: 0,
      nodeCount: entries.reduce((sum, entry) => sum + entry.topology.nodes.length, 0),
      summary: {
        state: "ready",
        text: `${aggregateTitle} contains ${entries.length} ${entries.length === 1 ? "garden" : "gardens"}.`,
      },
    },
  ]
  const nodes: TopologyPayloadNode[] = []
  const edges: TopologyPayloadEdge[] = []
  const namespace = (clusterSlug: string, id: string) =>
    `aggregate:${encodeURIComponent(clusterSlug)}:${id}`

  for (const { clusterSlug, topology } of entries) {
    const sourceRoot = topology.folders.find((folder) => folder.depth === 0) ?? null
    const gardenFolderId = namespace(clusterSlug, "garden")
    folders.push({
      id: gardenFolderId,
      path: clusterSlug,
      parentId: "aggregate:root",
      title: topology.garden.title,
      depth: 1,
      nodeCount: topology.nodes.length,
      summary: topology.garden.summary,
      pageSlug: topology.garden.slug,
    })

    const folderId = (id: string) =>
      !sourceRoot || id === sourceRoot.id ? gardenFolderId : namespace(clusterSlug, id)
    for (const folder of topology.folders) {
      if (sourceRoot && folder.id === sourceRoot.id) continue
      folders.push({
        ...folder,
        id: namespace(clusterSlug, folder.id),
        path: [clusterSlug, folder.path].filter(Boolean).join("/"),
        parentId: folder.parentId ? folderId(folder.parentId) : gardenFolderId,
        depth: Math.max(2, folder.depth + 1),
        x: undefined,
        y: undefined,
      })
    }

    const pageId = (id: string) => namespace(clusterSlug, id)
    for (const node of topology.nodes) {
      nodes.push({
        ...node,
        id: pageId(node.id),
        folderId: folderId(node.folderId),
        x: undefined,
        y: undefined,
      })
    }
    for (const edge of topology.edges) {
      // Hierarchy lines are rebuilt from the merged folder tree by the planner.
      // Carrying source structural edges would leave them pointing at the old
      // Garden root and can also confuse page IDs with folder IDs.
      if (edge.structural) continue
      edges.push({
        ...edge,
        id: namespace(clusterSlug, edge.id),
        source: pageId(edge.source),
        target: pageId(edge.target),
      })
    }
  }

  const partial = entries.length < requestedGardenCount
  const building = entries.some(
    ({ topology }) =>
      topology.build.state === "building" || topology.runtimeStatus?.state === "building",
  )
  const buildingProgress = entries
    .filter(
      ({ topology }) =>
        topology.build.state === "building" || topology.runtimeStatus?.state === "building",
    )
    .map(({ topology }) => topology.runtimeStatus?.progress ?? 0)
  const degraded = entries.some(
    ({ topology }) =>
      topology.build.state !== "ready" ||
      topology.build.retrievalMode === "concept-lexical" ||
      Boolean(topology.runtimeStatus),
  )
  const semanticVector = entries.every(
    ({ topology }) => topology.build.retrievalMode === "semantic-vector",
  )
  const thresholds = entries.map(({ topology }) => topology.build.threshold).filter(Number.isFinite)

  return {
    garden: {
      id: 0,
      slug: aggregateSlug,
      title: aggregateTitle,
      summary: {
        state: partial || degraded ? "degraded" : "ready",
        text: `${aggregateTitle} contains ${entries.length} ${entries.length === 1 ? "garden" : "gardens"} and ${nodes.length} ${nodes.length === 1 ? "page" : "pages"}.`,
      },
    },
    folders,
    nodes,
    edges,
    build: {
      state: building ? "building" : partial || degraded ? "degraded" : "ready",
      threshold: thresholds.length > 0 ? Math.min(...thresholds) : 0.68,
      retrievalMode: semanticVector ? "semantic-vector" : "concept-lexical",
    },
    ...(building
      ? {
          runtimeStatus: {
            state: "building" as const,
            progress:
              buildingProgress.length > 0
                ? Math.floor(
                    buildingProgress.reduce((sum, progress) => sum + progress, 0) /
                      buildingProgress.length,
                  )
                : 0,
            message: "Updating Thought Topology",
          },
        }
      : partial
        ? {
            runtimeStatus: {
              state: "stale" as const,
              message: `${entries.length} of ${requestedGardenCount} gardens loaded into Thought Topology.`,
            },
          }
        : {}),
  }
}

export type PlannedNodeKind = "garden" | "folder" | "page"

export interface PlannedNode {
  id: string
  kind: PlannedNodeKind
  /** Underlying page identity; used for medium-specific display policies. */
  contentKind: NonNullable<TopologyPayloadNode["kind"]> | null
  /** Medium-specific identity for pages beneath Sources. */
  sourceKind: TopologySourceKind | null
  title: string
  /** Title as shown beside the node; folder names get natural casing. */
  label: string
  x: number
  y: number
  /** Display radius in screen pixels at zoom 1. */
  radius: number
  folderId: string | null
  /** The top-level folder this node belongs to (itself for top-level folders). */
  sectorId: string | null
  folderPath: string
  folderTitle: string
  navigateSlug?: string
  summary: TopologyEnrichmentText
  concepts: string[]
  degree: number
  bridgeDegree: number
  importance: number
  /** Direct page count for folders (subtree count in `subtreeCount`). */
  nodeCount: number
  subtreeCount: number
}

export interface PlannedEdge {
  id: string
  source: string
  target: string
  origin: "inferred" | "authored" | "provenance"
  score: number
  previousScore?: number
  threshold?: number
  components?: { embedding: number; concept: number; lexical: number }
  relationType: string
  direction: string
  explanation: TopologyEnrichmentText
  evidence: Array<{ kind: string; label: string }>
  crossFolder: boolean
  /** 0..1, how far above the Garden threshold the affinity sits. */
  strength: number
  /** Screen-pixel stroke width at rest. Every connection is drawn as the
   * same thin hairline; only its colour weight (opacity) carries strength. */
  width: number
  opacity: number
}

/** Rest stroke width shared by every semantic connection, in screen pixels. */
export const CONNECTION_STROKE_WIDTH = 1
/** Rest stroke width of the Garden/folder/page hierarchy lines. */
export const HIERARCHY_STROKE_WIDTH = 0.7
/** Opacity range a connection's strength maps onto at rest. */
export const CONNECTION_MIN_OPACITY = 0.14
export const CONNECTION_MAX_OPACITY = 0.82
/** Score span above the threshold over which strength ramps 0->1. Centred
 * cosine Gardens (threshold < 0.6) top out around 0.35 above it; raw cosine
 * Gardens keep the historical "up to 1" span, but never wider than 0.35. */
export const CONNECTION_STRENGTH_SPAN = 0.35

/** How far above its threshold a connection's score sits, 0..1. */
export function connectionStrength(score: number, threshold: number): number {
  const base = Number.isFinite(threshold) ? threshold : 0
  const span = Math.max(0.000001, Math.min(CONNECTION_STRENGTH_SPAN, 1 - base))
  return Math.min(1, Math.max(0, (score - base) / span))
}

/** Rest opacity for a connection of the given strength. */
export function connectionOpacity(strength: number): number {
  const unit = Math.min(1, Math.max(0, Number.isFinite(strength) ? strength : 0))
  return CONNECTION_MIN_OPACITY + (CONNECTION_MAX_OPACITY - CONNECTION_MIN_OPACITY) * unit
}

/**
 * The URL slug Quartz publishes for a Garden-relative path. Mirrors
 * `slugifyFilePath` for the parts that matter to navigation: page and folder
 * names keep their spaces in the topology payload, but Quartz writes them
 * with dashes, and the static server answers the raw path with its
 * "garden is being prepared" 404.
 */
export function topologyNavigationSlug(value: string): string {
  const slug = value
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.md$/i, "")
    .split("/")
    .filter(Boolean)
    .map((segment) =>
      segment
        .replace(/\s/g, "-")
        .replace(/&/g, "-and-")
        .replace(/%/g, "-percent")
        .replace(/\?/g, "")
        .replace(/#/g, ""),
    )
    .join("/")
  return slug.endsWith("_index") ? slug.replace(/_index$/, "index") : slug
}

/** Markdown pages stay visible and interactive as dots, but their persistent
 * names are omitted to keep dense topology views legible. */
export function shouldShowTopologyNodeLabel(
  node: Pick<PlannedNode, "kind" | "contentKind">,
): boolean {
  return node.kind !== "page" || node.contentKind !== "markdown"
}

/** A visible Garden/folder/page hierarchy line. These are deliberately kept
 * separate from affinity edges because they do not carry a semantic score. */
export interface PlannedHierarchyEdge {
  id: string
  source: string
  target: string
}

export interface PlannedSector {
  folderId: string
  angle: number
  clusterRadius: number
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface TopologyPlan {
  garden: PlannedNode
  /** The folder whose subtree is being shown, or null for the whole Garden. */
  scopeFolder: { id: string; path: string; title: string } | null
  nodes: PlannedNode[]
  hierarchyEdges: PlannedHierarchyEdge[]
  edges: PlannedEdge[]
  sectors: PlannedSector[]
  /** Folders that exist but are not part of the default topology. */
  hiddenFolders: Array<{ id: string; title: string; reason: "empty" | "sources" | "excluded" }>
  /** Folders a person can include or exclude from this view, parents first.
   * Every candidate is listed, including the ones currently excluded. */
  folderOptions: PlannedFolderOption[]
  /** Top-level folders drawn on the map. */
  meaningfulFolderIds: string[]
  visiblePageCount: number
  totalPageCount: number
  bounds: Bounds
  analysis: AnalysisStatus
}

/** One folder in the include/exclude settings list. */
export interface PlannedFolderOption {
  id: string
  title: string
  path: string
  /** 1 for a top-level folder of this view, 2 for its direct sub-folders. */
  depth: number
  parentId: string | null
  /** Pages in the folder's whole subtree. */
  pageCount: number
  /** Excluded by the person, directly or through an excluded parent. */
  excluded: boolean
  /** True when one of its ancestors is excluded, so its own choice is moot. */
  inheritedExclusion: boolean
}

export interface AnalysisStatus {
  mode: "semantic-vector" | "concept-lexical" | "building"
  /** Short honest sentence for the canvas; empty when nothing needs saying. */
  notice: string
  /** Inspector-friendly phrasing of the same state. */
  detail: string
}

export interface PlanOptions {
  /** Compact sidebar preview: Garden, folders, and a handful of pages only. */
  preview?: boolean
  /** Maximum pages kept in preview mode. */
  previewPageBudget?: number
  /** Maximum cross-folder bridges kept in preview mode. */
  previewBridgeBudget?: number
  /** User-authored home positions, created by a deliberate right-button drag. */
  positionOverrides?: Record<string, { x: number; y: number }>
  /** Folder path relative to the Garden root. Only this subtree is planned. */
  scopeFolderPath?: string | null
  /** Folders (by id) the person switched off. Their whole subtree, its pages
   * and every connection touching those pages leave the map. */
  excludedFolderIds?: Iterable<string>
  /** Connections weaker than this strength (0..1) are left out. */
  minConnectionStrength?: number
  /** Keep only each page's strongest N connections (0 = keep all). A line
   * survives when it is among the top N of either endpoint. */
  maxConnectionsPerNode?: number
}

/** Rest strength of an authored (wikilink) connection. Ingest scaffolding
 * links every sibling concept page, so these stay light rather than mid-weight. */
export const AUTHORED_CONNECTION_STRENGTH = 0.4

/**
 * Keep each node's strongest `limit` connections: an edge survives when it
 * ranks in the top `limit` for either endpoint, so hubs do not lose their
 * spokes' only line. `limit` <= 0 keeps everything.
 */
export function capConnectionsPerNode<
  T extends { source: string; target: string; strength: number; score: number },
>(edges: T[], limit: number): T[] {
  const cap = Number.isFinite(limit) ? Math.floor(limit) : 0
  if (cap <= 0) return edges
  const byNode = new Map<string, T[]>()
  for (const edge of edges) {
    for (const id of [edge.source, edge.target]) {
      const list = byNode.get(id) ?? []
      list.push(edge)
      byNode.set(id, list)
    }
  }
  const kept = new Set<T>()
  for (const list of byNode.values()) {
    list
      .slice()
      .sort((left, right) => right.strength - left.strength || right.score - left.score)
      .slice(0, cap)
      .forEach((edge) => kept.add(edge))
  }
  return edges.filter((edge) => kept.has(edge))
}

const GOLDEN_SMALL_WORDS = new Set(["of", "and", "the", "for", "to", "in", "on", "a", "an", "with"])
const ROMAN = /^(?=[ivx]+$)(x{0,3})(ix|iv|v?i{0,3})$/i

/** "Module Vi Propagation Of Light" → "Module VI Propagation of Light". */
export function displayFolderTitle(title: string): string {
  const words = title.trim().split(/\s+/)
  return words
    .map((word, index) => {
      if (ROMAN.test(word) && index > 0) return word.toUpperCase()
      const lower = word.toLowerCase()
      if (index > 0 && GOLDEN_SMALL_WORDS.has(lower)) return lower
      return word
    })
    .join(" ")
}

/** Numeric-aware ordering so "2) …" sorts before "10) …". */
export function naturalCompare(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" })
}

/** Ellipsis truncation that keeps a file extension when one is present. */
export function truncateLabel(value: string, maxLength: number): string {
  const text = value.trim()
  if (text.length <= maxLength) return text
  const extension = text.match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? ""
  const keep = Math.max(8, maxLength - extension.length - 1)
  let head = text.slice(0, keep)
  // Prefer a word boundary when it keeps most of the budget.
  const boundary = head.lastIndexOf(" ")
  if (boundary >= keep * 0.6) head = head.slice(0, boundary)
  head = head.replace(/[\s,;:–—-]+$/, "")
  return `${head}…${extension}`
}

/** Affinity in words, relative to the threshold the edge cleared: scores are
 * corpus-centred, so what counts as strong depends on where the Garden's
 * threshold sits rather than on a fixed cosine. */
export function affinityLabel(
  score: number,
  threshold = 0.3,
): "Moderate" | "Strong" | "Very strong" {
  const base = Number.isFinite(threshold) ? threshold : 0.3
  return score >= base + 0.28 ? "Very strong" : score >= base + 0.12 ? "Strong" : "Moderate"
}

export function relationLabel(relationType: string | undefined): string {
  const value = (relationType ?? "related").replace(/[-_]+/g, " ").trim()
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "Related"
}

export function originLabel(origin: PlannedEdge["origin"]): string {
  if (origin === "inferred") return "Inferred connection"
  if (origin === "provenance") return "Provenance connection"
  return "Authored connection"
}

function stripMarkup(text: string): string {
  const delimiter =
    /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<!\\)\$((?:\\.|[^$\n])+?)(?<!\\)\$/g
  const parts: string[] = []
  let cursor = 0
  for (const match of text.matchAll(delimiter)) {
    const index = match.index ?? 0
    parts.push(
      text
        .slice(cursor, index)
        .replace(/[|]+/g, " ")
        .replace(/[*`#>]+/g, ""),
    )
    parts.push(match[0])
    cursor = index + match[0].length
  }
  parts.push(
    text
      .slice(cursor)
      .replace(/[|]+/g, " ")
      .replace(/[*`#>]+/g, ""),
  )
  return parts.join("").replace(/\s+/g, " ").trim()
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

/**
 * Two or three readable sentences for the inspector. Degraded server summaries
 * may be extractive projections with pipe separators; this keeps readable
 * prose and preserves formula delimiters so the callout can render the math.
 */
export function readableSummary(
  summary: TopologyEnrichmentText | undefined,
  fallback: { title: string; folderTitle: string },
): string {
  const raw = (summary?.text ?? "").replace(/\s+/g, " ").trim()
  // Extractive projections repeat the title before the first fragment; a
  // real sentence that merely begins with the title ("Gauss law relates…")
  // continues in lowercase and is kept whole.
  const afterTitle = raw.toLowerCase().startsWith(fallback.title.toLowerCase())
    ? raw.slice(fallback.title.length).trimStart()
    : null
  const withoutTitle =
    afterTitle !== null && !/^[a-z]/.test(afterTitle) ? afterTitle.replace(/^[\s:.\-–—]+/, "") : raw
  // Extractive projections are pipe-separated fragments. Formula-bearing
  // sentences remain intact because the floating callout renders their math.
  const parts = withoutTitle
    .split(/\s*\|\s*/)
    .flatMap((fragment) => sentences(fragment))
    .map((sentence) => stripMarkup(sentence))
    .filter(
      (sentence) =>
        /[a-zA-Z]{3,}/.test(sentence) && sentence.length >= 24 && sentence.split(" ").length >= 4,
    )
  const kept: string[] = []
  let length = 0
  for (const sentence of parts) {
    if (kept.length >= 3 || (kept.length > 0 && length + sentence.length > 320)) break
    kept.push(sentence.length > 220 ? `${sentence.slice(0, 217).trimEnd()}…` : sentence)
    length += sentence.length
  }
  const joined = kept.join(" ")
  if (joined.length >= 40) return joined
  return `“${fallback.title}” is a page in ${fallback.folderTitle}. Its summary will be written once the Garden’s semantic analysis runs.`
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ""
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`
}

/** A genuine overview of the Garden built from its structure, never a title list. */
export function gardenOverview(
  plan: TopologyPlan,
  gardenTitle: string,
  serverSummary?: TopologyEnrichmentText,
): string {
  const ready = serverSummary?.state === "ready" ? stripMarkup(serverSummary.text) : ""
  // A Garden-wide server summary is misleading while inspecting one folder.
  if (!plan.scopeFolder && ready && ready.length >= 60 && !/^Folders:/i.test(ready)) return ready
  const folders = plan.nodes.filter(
    (node) => node.kind === "folder" && plan.meaningfulFolderIds.includes(node.id),
  )
  const sorted = [...folders].sort(
    (left, right) =>
      right.subtreeCount - left.subtreeCount || naturalCompare(left.label, right.label),
  )
  const bridges = plan.edges.filter((edge) => edge.crossFolder).length
  const pages = plan.totalPageCount
  if (folders.length === 0) {
    return `${gardenTitle} holds ${pages} ${pages === 1 ? "page" : "pages"} at its root. Semantic connections between pages appear here as they are found.`
  }
  const first = `${gardenTitle} is organized into ${folders.length} ${folders.length === 1 ? "folder" : "folders"} — ${joinNames(sorted.map((folder) => folder.label))} — holding ${pages} ${pages === 1 ? "page" : "pages"} in total.`
  const largest = sorted[0]
  const second =
    folders.length > 1
      ? `${largest.label} is the largest with ${largest.subtreeCount} ${largest.subtreeCount === 1 ? "page" : "pages"}.`
      : ""
  const third =
    plan.edges.length === 0
      ? "No semantic connections have been confirmed between its pages yet."
      : bridges === 0
        ? `${plan.edges.length} semantic ${plan.edges.length === 1 ? "connection links" : "connections link"} pages inside their folders; none cross between folders yet.`
        : `${plan.edges.length} semantic ${plan.edges.length === 1 ? "connection" : "connections"} link its pages, ${bridges} of them ${bridges === 1 ? "bridges" : "bridging"} between folders.`
  return [first, second, third].filter(Boolean).join(" ")
}

export function analysisStatus(payload: TopologyPayload): AnalysisStatus {
  if (payload.build.state === "building" && payload.nodes.length === 0) {
    return {
      mode: "building",
      notice: "Preparing Thought Topology…",
      detail: "The first analysis of this Garden is still running.",
    }
  }
  if (
    payload.build.retrievalMode === "concept-lexical" ||
    payload.build.embeddingModel === "unavailable"
  ) {
    return {
      mode: "concept-lexical",
      notice: "",
      detail:
        "Concept and lexical mode. Semantic bridges will appear after vector analysis runs for this Garden.",
    }
  }
  return {
    mode: "semantic-vector",
    notice: "",
    detail: `Vector analysis complete${payload.build.embeddingModel ? ` · ${payload.build.embeddingModel}` : ""}.`,
  }
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const GARDEN_RADIUS = 11
const FOLDER_RADIUS = 6.5
const SUBFOLDER_RADIUS = 5
const PAGE_RADIUS = 2.9
const IMPORTANT_PAGE_RADIUS = 3.7

/** Distance between neighbouring pages along an arc, in world units. Wide
 * enough that every page label has room once the view is zoomed a little. */
const ITEM_SPACING = 46
const FIRST_RING_RADIUS = 52
const RING_GAP = 42
/** Half-angle of each ring's arc, widening slightly on outer rings. */
const RING_HALF_ANGLES = [1.22, 1.36, 1.44, 1.5, 1.52]
const MIN_ANCHOR_DISTANCE = 210
const SECTOR_MARGIN = 64

/** Whitespace kept between two neighbouring footprints on a ring, and
 * between one ring's footprints and the next ring's. */
const FOOTPRINT_GAP = 24
/** Room reserved around a sub-folder that holds no page of its own: its dot
 * is small, but its name is as wide as any folder's. */
const EMPTY_SUBFOLDER_FOOTPRINT = 18

type ClusterItem = {
  id: string
  radius: number
  /** Half-extent of everything the item carries with it (a sub-folder's own
   * page ring), in world units. Pages have none. */
  footprint?: number
}

/** Arc length one item needs along its ring. */
function arcLengthOf(item: ClusterItem): number {
  const footprint = item.footprint ?? 0
  return footprint > 0 ? Math.max(ITEM_SPACING, 2 * footprint + FOOTPRINT_GAP) : ITEM_SPACING
}

/**
 * Sequential arc packing: rings of items facing outward. Pages are spaced
 * evenly; an item with a footprint (a sub-folder carrying its own mini
 * cluster) takes an arc proportional to it and pushes its ring, and the
 * next one, outward by it, so neighbouring mini clusters never overlap. A
 * cluster of pages alone packs exactly as before.
 */
export function packCluster(
  items: ClusterItem[],
  anchor: { x: number; y: number },
  outwardAngle: number,
): { positions: Map<string, { x: number; y: number }>; clusterRadius: number } {
  const positions = new Map<string, { x: number; y: number }>()
  if (items.length === 0) return { positions, clusterRadius: 0 }
  let index = 0
  let ring = 0
  let clusterRadius = 0
  let previousRadius = 0
  let previousReach = 0
  while (index < items.length) {
    const halfAngle = RING_HALF_ANGLES[Math.min(ring, RING_HALF_ANGLES.length - 1)]
    const baseRadius = ring === 0 ? FIRST_RING_RADIUS : previousRadius + RING_GAP + previousReach
    // Fill the ring greedily by arc length. The ring radius depends on the
    // largest footprint it holds, which is only known once it is filled, so
    // measure with the first item's footprint and then widen the ring.
    let radius = baseRadius + (items[index].footprint ?? 0)
    let count = 0
    let used = 0
    let reach = 0
    for (let pass = 0; pass < 2; pass += 1) {
      count = 0
      used = 0
      reach = 0
      const available = 2 * halfAngle * radius
      while (index + count < items.length) {
        const item = items[index + count]
        const need = arcLengthOf(item)
        if (count >= 3 && used + need > available) break
        used += need
        reach = Math.max(reach, item.footprint ?? 0)
        count += 1
      }
      radius = baseRadius + reach
    }
    // Slots are proportional to each item's need and spread over the whole
    // arc, so a ring that is not full still uses its width.
    let cursor = outwardAngle - halfAngle
    for (let slot = 0; slot < count; slot += 1) {
      const item = items[index + slot]
      const share = (arcLengthOf(item) / used) * 2 * halfAngle
      const angle = cursor + share / 2
      cursor += share
      positions.set(item.id, {
        x: anchor.x + Math.cos(angle) * radius,
        y: anchor.y + Math.sin(angle) * radius,
      })
    }
    clusterRadius = radius + reach + 6
    previousRadius = radius
    previousReach = reach
    index += count
    ring += 1
  }
  return { positions, clusterRadius }
}

function normalizeAngle(angle: number): number {
  const twoPi = Math.PI * 2
  return ((angle % twoPi) + twoPi) % twoPi
}

export function planThoughtTopology(
  payload: TopologyPayload,
  options: PlanOptions = {},
): TopologyPlan {
  const preview = Boolean(options.preview)
  const normalizeFolderPath = (value: string) => {
    const trimmed = value
      .replace(/\\/g, "/")
      .replace(/^\/+|\/+$/g, "")
      .replace(/\/index$/i, "")
    try {
      return decodeURIComponent(trimmed).toLocaleLowerCase()
    } catch {
      return trimmed.toLocaleLowerCase()
    }
  }
  const requestedScope = options.scopeFolderPath ? normalizeFolderPath(options.scopeFolderPath) : ""
  const sourceRoot = payload.folders.find((folder) => folder.depth === 0) ?? null
  const sourceScope = requestedScope
    ? (payload.folders.find((folder) => normalizeFolderPath(folder.path) === requestedScope) ??
      null)
    : null

  // Treat the selected folder as the one top-level sector in this view. This
  // keeps Garden -> current folder -> descendants intact without leaking
  // sibling folders or their semantic connections into the page.
  const scopedFolders: TopologyPayloadFolder[] = requestedScope
    ? sourceScope && sourceRoot
      ? [
          sourceRoot,
          ...payload.folders
            .filter(
              (folder) =>
                folder.id === sourceScope.id ||
                normalizeFolderPath(folder.path).startsWith(`${requestedScope}/`),
            )
            .map((folder) => {
              if (folder.id === sourceScope.id) {
                return { ...folder, parentId: sourceRoot.id, depth: 1 }
              }
              const relativePath = normalizeFolderPath(folder.path).slice(requestedScope.length + 1)
              const relativeDepth = relativePath.split("/").filter(Boolean).length
              return { ...folder, depth: relativeDepth + 1 }
            }),
        ]
      : sourceRoot
        ? [sourceRoot]
        : []
    : payload.folders

  // People can switch folders off. An excluded folder takes its whole
  // subtree with it; the candidates list keeps every folder so the settings
  // panel can offer the excluded ones back.
  const requestedExclusions = new Set(options.excludedFolderIds ?? [])
  const scopedById = new Map(scopedFolders.map((folder) => [folder.id, folder]))
  const exclusionOf = new Map<string, "own" | "inherited" | null>()
  const resolveExclusion = (folderId: string): "own" | "inherited" | null => {
    if (exclusionOf.has(folderId)) return exclusionOf.get(folderId)!
    const folder = scopedById.get(folderId)
    let result: "own" | "inherited" | null = null
    if (folder && folder.depth > 0) {
      if (requestedExclusions.has(folder.id)) result = "own"
      else if (folder.parentId && resolveExclusion(folder.parentId)) result = "inherited"
    }
    exclusionOf.set(folderId, result)
    return result
  }
  for (const folder of scopedFolders) resolveExclusion(folder.id)
  const folders = scopedFolders.filter((folder) => !exclusionOf.get(folder.id))
  const folderById = new Map(folders.map((folder) => [folder.id, folder]))
  const subtreePageCount = (folderId: string): number => {
    const own = payload.nodes.filter((node) => node.folderId === folderId).length
    return (
      own +
      scopedFolders
        .filter((folder) => folder.parentId === folderId)
        .reduce((sum, child) => sum + subtreePageCount(child.id), 0)
    )
  }
  const folderOptions: PlannedFolderOption[] = scopedFolders
    .filter((folder) => folder.depth === 1 || folder.depth === 2)
    .sort((left, right) => left.depth - right.depth || naturalCompare(left.path, right.path))
    .map((folder) => ({
      id: folder.id,
      title: folder.title,
      path: folder.path,
      depth: folder.depth,
      parentId: folder.depth === 1 ? null : folder.parentId,
      pageCount: subtreePageCount(folder.id),
      excluded: Boolean(exclusionOf.get(folder.id)),
      inheritedExclusion: exclusionOf.get(folder.id) === "inherited",
    }))
  const pages = payload.nodes.filter(
    (node) =>
      folderById.has(node.folderId) &&
      (!requestedScope || !sourceRoot || node.folderId !== sourceRoot.id),
  )
  const directPages = new Map<string, TopologyPayloadNode[]>()
  for (const page of pages) {
    const list = directPages.get(page.folderId) ?? []
    list.push(page)
    directPages.set(page.folderId, list)
  }
  const subtreeCount = new Map<string, number>()
  const countSubtree = (folderId: string): number => {
    if (subtreeCount.has(folderId)) return subtreeCount.get(folderId)!
    const own = directPages.get(folderId)?.length ?? 0
    const children = folders.filter((folder) => folder.parentId === folderId)
    const total = own + children.reduce((sum, child) => sum + countSubtree(child.id), 0)
    subtreeCount.set(folderId, total)
    return total
  }
  for (const folder of folders) countSubtree(folder.id)

  // Every folder the payload carries is drawn, including Sources and folders
  // that hold no page yet: the builder already limits the payload to what the
  // Garden publishes, and a map that silently drops folders reads as broken.
  // Only the person's own exclusions take folders off the map.
  const hiddenFolders: TopologyPlan["hiddenFolders"] = scopedFolders
    .filter((folder) => exclusionOf.get(folder.id))
    .map((folder) => ({ id: folder.id, title: folder.title, reason: "excluded" as const }))

  const root = folders.find((folder) => folder.depth === 0) ?? null
  const rootPages = root ? (directPages.get(root.id) ?? []) : []
  const topFolders = folders
    .filter((folder) => folder.depth === 1)
    .sort((left, right) => naturalCompare(left.path, right.path))
  // The Garden root only becomes a sector when pages actually live there.
  const sectorFolders: TopologyPayloadFolder[] =
    rootPages.length > 0 && root ? [...topFolders, root] : topFolders

  // Semantic edges and degrees. The visible hierarchy is synthesized from the
  // folder tree below instead of trusting optional structural payload edges.
  const semanticEdges = payload.edges.filter(
    (edge) => !edge.structural && edge.source !== edge.target,
  )
  const pageById = new Map(pages.map((page) => [page.id, page]))
  const degree = new Map<string, number>()
  const bridgeDegree = new Map<string, number>()
  const topLevelOf = (folderId: string): string | null => {
    let current = folderById.get(folderId)
    while (current && current.depth > 1)
      current = current.parentId ? folderById.get(current.parentId) : undefined
    return current?.id ?? null
  }
  for (const edge of semanticEdges) {
    const source = pageById.get(edge.source)
    const target = pageById.get(edge.target)
    if (!source || !target) continue
    degree.set(source.id, (degree.get(source.id) ?? 0) + 1)
    degree.set(target.id, (degree.get(target.id) ?? 0) + 1)
    if (topLevelOf(source.folderId) !== topLevelOf(target.folderId)) {
      bridgeDegree.set(source.id, (bridgeDegree.get(source.id) ?? 0) + 1)
      bridgeDegree.set(target.id, (bridgeDegree.get(target.id) ?? 0) + 1)
    }
  }
  const maxWords = Math.max(1, ...pages.map((page) => page.wordCount ?? 0))
  const importanceOf = (page: TopologyPayloadNode): number =>
    (degree.get(page.id) ?? 0) * 3 +
    (bridgeDegree.get(page.id) ?? 0) * 2 +
    ((page.wordCount ?? 0) / maxWords) * 1.5

  // Preview keeps the strongest bridges and a handful of high-value pages.
  let keptPageIds: Set<string> | null = null
  let keptEdgeIds: Set<string> | null = null
  if (preview) {
    const pageBudget = options.previewPageBudget ?? 10
    const bridgeBudget = options.previewBridgeBudget ?? 6
    const bridges = semanticEdges
      .filter((edge) => {
        const source = pageById.get(edge.source)
        const target = pageById.get(edge.target)
        return source && target && topLevelOf(source.folderId) !== topLevelOf(target.folderId)
      })
      .sort(
        (left, right) => (right.score ?? 0) - (left.score ?? 0) || left.id.localeCompare(right.id),
      )
      .slice(0, bridgeBudget)
    keptEdgeIds = new Set(bridges.map((edge) => edge.id))
    keptPageIds = new Set(bridges.flatMap((edge) => [edge.source, edge.target]))
    const ranked = [...pages].sort(
      (left, right) =>
        importanceOf(right) - importanceOf(left) || naturalCompare(left.title, right.title),
    )
    if (keptPageIds.size === 0) {
      // Without bridges, keep the highest-value page or two from every folder.
      const perFolder = new Map<string, number>()
      for (const page of ranked) {
        const key = topLevelOf(page.folderId) ?? "root"
        const seen = perFolder.get(key) ?? 0
        if (seen >= 2 || keptPageIds.size >= pageBudget) continue
        perFolder.set(key, seen + 1)
        keptPageIds.add(page.id)
      }
    }
    for (const page of ranked) {
      if (keptPageIds.size >= pageBudget) break
      keptPageIds.add(page.id)
    }
  }

  const visiblePages = pages.filter((page) => {
    if (!folderById.has(page.folderId)) return false
    return keptPageIds ? keptPageIds.has(page.id) : true
  })
  const visiblePagesByFolder = new Map<string, TopologyPayloadNode[]>()
  for (const page of visiblePages) {
    const list = visiblePagesByFolder.get(page.folderId) ?? []
    list.push(page)
    visiblePagesByFolder.set(page.folderId, list)
  }

  // Sector angles: proportional to sqrt(page count), stable by folder path.
  const weights = sectorFolders.map((folder) => Math.sqrt((subtreeCount.get(folder.id) ?? 0) + 1))
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1
  const sectorAngles: number[] = []
  let cursor = -Math.PI / 2
  sectorFolders.forEach((_, index) => {
    const arc = (Math.PI * 2 * weights[index]) / totalWeight
    sectorAngles.push(sectorFolders.length === 1 ? -Math.PI / 2 : cursor + arc / 2)
    cursor += arc
  })

  // Cluster contents for every visible folder: pages in natural order, then
  // meaningful sub-folders as small anchors carrying their own mini clusters.
  const childFolders = (folderId: string) =>
    folders
      .filter((folder) => folder.parentId === folderId && folder.depth > 1)
      .sort((left, right) => naturalCompare(left.path, right.path))
  const orderedPages = (folderId: string) =>
    [...(visiblePagesByFolder.get(folderId) ?? [])].sort(
      (left, right) => naturalCompare(left.title, right.title) || left.id.localeCompare(right.id),
    )

  const nodes: PlannedNode[] = []
  const sectors: PlannedSector[] = []
  const clusterRadii: number[] = []
  const pendingSectorAnchors: Array<{
    folder: TopologyPayloadFolder
    angle: number
    items: ClusterItem[]
  }> = []

  const folderNode = (
    folder: TopologyPayloadFolder,
    sectorId: string,
    x: number,
    y: number,
    radius: number,
  ): PlannedNode => ({
    id: folder.id,
    kind: "folder",
    contentKind: null,
    sourceKind: null,
    title: folder.title,
    label: displayFolderTitle(folder.title),
    x,
    y,
    radius,
    folderId: folder.parentId,
    sectorId,
    folderPath: folder.path,
    folderTitle: (() => {
      const parent = folder.parentId ? folderById.get(folder.parentId) : undefined
      return parent && parent.depth > 0 ? displayFolderTitle(parent.title) : ""
    })(),
    navigateSlug: folder.pageSlug,
    summary: folder.summary,
    concepts: [],
    degree: 0,
    bridgeDegree: 0,
    importance: 100,
    nodeCount: directPages.get(folder.id)?.length ?? 0,
    subtreeCount: subtreeCount.get(folder.id) ?? 0,
  })
  const pageNode = (
    page: TopologyPayloadNode,
    sectorId: string,
    x: number,
    y: number,
  ): PlannedNode => {
    const folder = folderById.get(page.folderId)
    const importance = importanceOf(page)
    return {
      id: page.id,
      kind: "page",
      contentKind: page.kind ?? null,
      sourceKind: topologySourceKind(page, folder?.path),
      title: page.title,
      label: page.title,
      x,
      y,
      radius: importance >= 3 ? IMPORTANT_PAGE_RADIUS : PAGE_RADIUS,
      folderId: page.folderId,
      sectorId,
      folderPath: folder?.path ?? "",
      folderTitle: folder
        ? folder.depth === 0
          ? "Garden root"
          : displayFolderTitle(folder.title)
        : "",
      navigateSlug: page.slug,
      summary: page.summary,
      concepts: [...new Set([...page.primaryConcepts, ...page.supportingConcepts])],
      degree: degree.get(page.id) ?? 0,
      bridgeDegree: bridgeDegree.get(page.id) ?? 0,
      importance,
      nodeCount: 0,
      subtreeCount: 0,
    }
  }

  // A sub-folder's own ring: its pages plus, folded in, any deeper pages.
  const childItems = (childId: string): ClusterItem[] => [
    ...orderedPages(childId).map((page) => ({ id: page.id, radius: PAGE_RADIUS })),
    ...childFolders(childId).flatMap((grandchild) =>
      orderedPages(grandchild.id).map((page) => ({ id: page.id, radius: PAGE_RADIUS })),
    ),
  ]
  // The room a sub-folder needs on its parent's ring: the radius of its own
  // mini cluster, or a small allowance for its name when it holds nothing.
  const childFootprint = (childId: string): number => {
    const items = childItems(childId)
    if (items.length === 0) return EMPTY_SUBFOLDER_FOOTPRINT
    return packCluster(items, { x: 0, y: 0 }, 0).clusterRadius
  }

  // First pass: measure each sector's cluster so the anchor ring can be sized.
  for (let index = 0; index < sectorFolders.length; index += 1) {
    const folder = sectorFolders[index]
    const items: ClusterItem[] = [
      ...orderedPages(folder.id).map((page) => ({ id: page.id, radius: PAGE_RADIUS })),
      ...childFolders(folder.id).map((child) => ({
        id: child.id,
        radius: SUBFOLDER_RADIUS,
        footprint: childFootprint(child.id),
      })),
    ]
    const measured = packCluster(items, { x: 0, y: 0 }, 0)
    clusterRadii.push(measured.clusterRadius)
    pendingSectorAnchors.push({ folder, angle: sectorAngles[index], items })
  }
  let anchorDistance = MIN_ANCHOR_DISTANCE
  for (let index = 0; index < sectorFolders.length && sectorFolders.length > 1; index += 1) {
    const next = (index + 1) % sectorFolders.length
    const gap = normalizeAngle(sectorAngles[next] - sectorAngles[index]) || Math.PI * 2
    const needed =
      (clusterRadii[index] + clusterRadii[next] + SECTOR_MARGIN) /
      (2 * Math.sin(Math.min(Math.PI, gap) / 2))
    anchorDistance = Math.max(anchorDistance, needed)
  }
  anchorDistance = Math.max(anchorDistance, Math.max(0, ...clusterRadii) * 0.45 + 90)

  const garden: PlannedNode = {
    id: `garden:${payload.garden.slug}`,
    kind: "garden",
    contentKind: null,
    sourceKind: null,
    title: payload.garden.title,
    label: payload.garden.title,
    x: 0,
    y: 0,
    radius: GARDEN_RADIUS,
    folderId: null,
    sectorId: null,
    folderPath: "",
    folderTitle: "",
    summary: payload.garden.summary,
    concepts: [],
    degree: 0,
    bridgeDegree: 0,
    importance: 1000,
    nodeCount: rootPages.length,
    subtreeCount: pages.length,
  }
  nodes.push(garden)

  // Second pass: place anchors, then their clusters.
  pendingSectorAnchors.forEach(({ folder, angle, items }, index) => {
    const anchor = { x: Math.cos(angle) * anchorDistance, y: Math.sin(angle) * anchorDistance }
    const packed = packCluster(items, anchor, angle)
    sectors.push({ folderId: folder.id, angle, clusterRadius: clusterRadii[index] })
    nodes.push(folderNode(folder, folder.id, anchor.x, anchor.y, FOLDER_RADIUS))
    for (const page of orderedPages(folder.id)) {
      const position = packed.positions.get(page.id)!
      nodes.push(pageNode(page, folder.id, position.x, position.y))
    }
    for (const child of childFolders(folder.id)) {
      const position = packed.positions.get(child.id)!
      const outward = Math.atan2(position.y - anchor.y, position.x - anchor.x)
      const childNode = folderNode(child, folder.id, position.x, position.y, SUBFOLDER_RADIUS)
      nodes.push(childNode)
      // The sub-folder's own ring, sized in the first pass so its neighbours
      // on the parent ring already leave room for it. Deeper nesting is
      // rare; its pages are folded into this ring.
      const childPacked = packCluster(childItems(child.id), position, outward)
      for (const page of orderedPages(child.id)) {
        const childPosition = childPacked.positions.get(page.id)!
        nodes.push(pageNode(page, folder.id, childPosition.x, childPosition.y))
      }
      for (const grandchild of childFolders(child.id)) {
        for (const page of orderedPages(grandchild.id)) {
          const slot = childPacked.positions.get(page.id) ?? position
          nodes.push(pageNode(page, folder.id, slot.x, slot.y))
        }
      }
    }
  })

  // The worker owns the durable incremental layout. Its cached coordinates
  // keep every existing page and folder fixed when a new Markdown page is
  // inserted; the packing above remains the fallback for older artifacts.
  const payloadNodes = new Map(payload.nodes.map((node) => [node.id, node]))
  const payloadFolders = new Map(payload.folders.map((folder) => [folder.id, folder]))
  for (const node of nodes) {
    const durable =
      node.kind === "page"
        ? payloadNodes.get(node.id)
        : node.kind === "folder"
          ? payloadFolders.get(node.id)
          : null
    if (durable && Number.isFinite(durable.x) && Number.isFinite(durable.y)) {
      node.x = durable.x!
      node.y = durable.y!
    }
  }

  if (options.positionOverrides) {
    for (const node of nodes) {
      const override = options.positionOverrides[node.id]
      if (override && Number.isFinite(override.x) && Number.isFinite(override.y)) {
        node.x = override.x
        node.y = override.y
      }
    }
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const hierarchyEdges: PlannedHierarchyEdge[] = nodes
    .filter((node) => node.kind !== "garden")
    .map((node) => {
      let folderId = node.folderId
      let parentId = garden.id
      while (folderId) {
        const parentFolder = folderById.get(folderId)
        // Top-level folder names always branch directly from the Garden. The
        // optional root anchor only collects pages stored at the Garden root.
        if (node.kind === "folder" && parentFolder?.depth === 0) break
        const visibleFolder = nodeById.get(folderId)
        if (visibleFolder?.kind === "folder" && visibleFolder.id !== node.id) {
          parentId = visibleFolder.id
          break
        }
        folderId = parentFolder?.parentId ?? null
      }
      return {
        id: `hierarchy:${parentId}:${node.id}`,
        source: parentId,
        target: node.id,
      }
    })
  const threshold = payload.build.threshold
  const requestedMinStrength = options.minConnectionStrength ?? 0
  const minStrength = Number.isFinite(requestedMinStrength)
    ? Math.min(1, Math.max(0, requestedMinStrength))
    : 0
  const edges: PlannedEdge[] = semanticEdges
    .filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target))
    .filter((edge) => (keptEdgeIds ? keptEdgeIds.has(edge.id) : true))
    .map((edge) => {
      const origin = edge.origin ?? "inferred"
      const score = edge.score ?? 0
      const edgeThreshold = edge.threshold ?? threshold
      const strength =
        origin === "inferred"
          ? connectionStrength(score, edgeThreshold)
          : AUTHORED_CONNECTION_STRENGTH
      const source = nodeById.get(edge.source)!
      const target = nodeById.get(edge.target)!
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        origin,
        score,
        previousScore: edge.previousScore,
        threshold: edge.threshold,
        components: edge.components,
        relationType: edge.relationType ?? "related",
        direction: edge.direction ?? "undirected",
        explanation: edge.explanation ?? { state: "pending", text: "" },
        evidence: edge.evidence ?? [],
        crossFolder: source.sectorId !== target.sectorId,
        strength,
        // Every line is the same hairline; strength shows as colour weight.
        width: CONNECTION_STROKE_WIDTH,
        opacity: connectionOpacity(strength),
      }
    })
    .filter((edge) => minStrength <= 0 || edge.strength >= minStrength)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
  const cappedEdges = capConnectionsPerNode(edges, options.maxConnectionsPerNode ?? 0)

  const bounds = boundsOf(nodes, 28)
  return {
    garden,
    scopeFolder: sourceScope
      ? { id: sourceScope.id, path: sourceScope.path, title: sourceScope.title }
      : null,
    nodes,
    hierarchyEdges,
    edges: cappedEdges,
    sectors,
    hiddenFolders,
    folderOptions,
    meaningfulFolderIds: topFolders.map((folder) => folder.id),
    visiblePageCount: visiblePages.length,
    totalPageCount: pages.length,
    bounds,
    analysis: analysisStatus(payload),
  }
}

export function boundsOf(
  nodes: ReadonlyArray<{ x: number; y: number; radius?: number }>,
  padding = 0,
): Bounds {
  if (nodes.length === 0) return { minX: -padding, minY: -padding, maxX: padding, maxY: padding }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of nodes) {
    const radius = node.radius ?? 0
    minX = Math.min(minX, node.x - radius)
    minY = Math.min(minY, node.y - radius)
    maxX = Math.max(maxX, node.x + radius)
    maxY = Math.max(maxY, node.y + radius)
  }
  return { minX: minX - padding, minY: minY - padding, maxX: maxX + padding, maxY: maxY + padding }
}

const LABEL_PROXIMITY_GAP = 10

/**
 * Approximate the node's visual footprint from the label Pixi actually
 * measured. The force simulation uses circles, so half of the label diagonal
 * is the conservative radius that keeps differently sized names from being
 * treated like identical dots.
 *
 * `layoutScale` lets compact previews reserve less world space for labels that
 * they intentionally hide, while the full map uses the complete footprint.
 */
export function labelClearanceRadius(
  nodeRadius: number,
  labelWidth: number,
  labelHeight: number,
  layoutScale = 1,
): number {
  const radius = Number.isFinite(nodeRadius) ? Math.max(0, nodeRadius) : 0
  const width = Number.isFinite(labelWidth) ? Math.max(0, labelWidth) : 0
  const height = Number.isFinite(labelHeight) ? Math.max(0, labelHeight) : 0
  const scale = Number.isFinite(layoutScale) ? Math.max(1, layoutScale) : 1
  return Math.max(
    radius + LABEL_PROXIMITY_GAP,
    Math.hypot(width, height) / (2 * scale) + LABEL_PROXIMITY_GAP,
  )
}

/** Keep connected nodes at least one combined label footprint apart. */
export function labelAwareLinkDistance(
  homeDistance: number,
  sourceClearance: number,
  targetClearance: number,
): number {
  const authoredDistance = Number.isFinite(homeDistance) ? Math.max(0, homeDistance) : 0
  const source = Number.isFinite(sourceClearance) ? Math.max(0, sourceClearance) : 0
  const target = Number.isFinite(targetClearance) ? Math.max(0, targetClearance) : 0
  return Math.max(44, authoredDistance, source + target + 12)
}

export interface Insets {
  top: number
  right: number
  bottom: number
  left: number
}

export interface ViewTransform {
  k: number
  x: number
  y: number
}

/**
 * Zoom transform that fits `bounds` (world units, Garden-centred) into the
 * viewport minus insets. The renderer draws world point (wx, wy) at
 * (wx + width / 2, wy + height / 2) before applying the transform, so the
 * translation below accounts for that centring.
 */
export function fitTransform(
  bounds: Bounds,
  viewport: { width: number; height: number },
  insets: Insets,
  limits: { minScale: number; maxScale: number } = { minScale: 0.35, maxScale: 1.4 },
  /**
   * World point pinned to the centre of the usable area. The Garden view
   * passes the Garden itself so it is always the visual centre, even when
   * one neighbourhood is larger than the others; focused views omit it.
   */
  focus?: { x: number; y: number },
): ViewTransform {
  const usableWidth = Math.max(80, viewport.width - insets.left - insets.right)
  const usableHeight = Math.max(80, viewport.height - insets.top - insets.bottom)
  const centerX = insets.left + usableWidth / 2
  const centerY = insets.top + usableHeight / 2
  const boundsWidth = Math.max(1, bounds.maxX - bounds.minX)
  const boundsHeight = Math.max(1, bounds.maxY - bounds.minY)
  const unpinnedScale = Math.min(usableWidth / boundsWidth, usableHeight / boundsHeight)
  if (focus) {
    const halfWidth = Math.max(1, Math.abs(bounds.minX - focus.x), Math.abs(bounds.maxX - focus.x))
    const halfHeight = Math.max(1, Math.abs(bounds.minY - focus.y), Math.abs(bounds.maxY - focus.y))
    const pinnedScale = Math.min(usableWidth / (2 * halfWidth), usableHeight / (2 * halfHeight))
    // Pinning the Garden to the centre is worth it while the map is roughly
    // balanced around it. When one neighbourhood dwarfs the rest (a Concepts
    // fan of forty sections against two small folders), centring on the
    // Garden leaves half the viewport empty and clips the fan, so the frame
    // centres on the map instead.
    if (pinnedScale >= unpinnedScale * 0.8) {
      const k = Math.min(limits.maxScale, Math.max(limits.minScale, pinnedScale))
      return {
        k,
        x: centerX - k * (focus.x + viewport.width / 2),
        y: centerY - k * (focus.y + viewport.height / 2),
      }
    }
  }
  const k = Math.min(limits.maxScale, Math.max(limits.minScale, unpinnedScale))
  const boundsCenterX = (bounds.minX + bounds.maxX) / 2 + viewport.width / 2
  const boundsCenterY = (bounds.minY + bounds.maxY) / 2 + viewport.height / 2
  return { k, x: centerX - k * boundsCenterX, y: centerY - k * boundsCenterY }
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export type LabelSide = "below" | "right" | "left" | "above"

export interface LabelCandidate {
  id: string
  priority: number
  /** Screen-space node centre and radius. */
  x: number
  y: number
  radius: number
  width: number
  height: number
  sides: LabelSide[]
  /**
   * Essential labels (Garden, folders) may sit over small page dots when no
   * clean side exists; they still never cover other labels or anchors.
   */
  overlapSoft?: boolean
}

export interface LabelObstacle {
  id: string
  x: number
  y: number
  radius: number
  /** Small page dots; hard obstacles are anchors and the Garden. */
  soft?: boolean
}

export interface LabelPlacement {
  side: LabelSide
  /** Offset from the node centre to the label's anchor point, in screen px. */
  dx: number
  dy: number
  anchorX: number
  anchorY: number
  rect: { left: number; top: number; right: number; bottom: number }
}

export interface ClipRect {
  left: number
  top: number
  right: number
  bottom: number
}

const LABEL_GAP = 5
const LABEL_PADDING = 3

function rectForSide(candidate: LabelCandidate, side: LabelSide): LabelPlacement {
  const { x, y, radius, width, height } = candidate
  switch (side) {
    case "right": {
      const left = x + radius + LABEL_GAP
      return {
        side,
        dx: radius + LABEL_GAP,
        dy: 0,
        anchorX: 0,
        anchorY: 0.5,
        rect: { left, top: y - height / 2, right: left + width, bottom: y + height / 2 },
      }
    }
    case "left": {
      const right = x - radius - LABEL_GAP
      return {
        side,
        dx: -(radius + LABEL_GAP),
        dy: 0,
        anchorX: 1,
        anchorY: 0.5,
        rect: { left: right - width, top: y - height / 2, right, bottom: y + height / 2 },
      }
    }
    case "above": {
      const bottom = y - radius - LABEL_GAP
      return {
        side,
        dx: 0,
        dy: -(radius + LABEL_GAP),
        anchorX: 0.5,
        anchorY: 1,
        rect: { left: x - width / 2, top: bottom - height, right: x + width / 2, bottom },
      }
    }
    default: {
      const top = y + radius + LABEL_GAP
      return {
        side: "below",
        dx: 0,
        dy: radius + LABEL_GAP,
        anchorX: 0.5,
        anchorY: 0,
        rect: { left: x - width / 2, top, right: x + width / 2, bottom: top + height },
      }
    }
  }
}

function rectsOverlap(
  left: LabelPlacement["rect"],
  right: LabelPlacement["rect"],
  padding: number,
): boolean {
  return !(
    left.right + padding <= right.left ||
    right.right + padding <= left.left ||
    left.bottom + padding <= right.top ||
    right.bottom + padding <= left.top
  )
}

function circleHitsRect(
  circle: LabelObstacle,
  rect: LabelPlacement["rect"],
  padding: number,
): boolean {
  const nearestX = Math.max(rect.left - padding, Math.min(circle.x, rect.right + padding))
  const nearestY = Math.max(rect.top - padding, Math.min(circle.y, rect.bottom + padding))
  const dx = circle.x - nearestX
  const dy = circle.y - nearestY
  return dx * dx + dy * dy < circle.radius * circle.radius
}

/**
 * Greedy collision-aware placement. Candidates are processed by descending
 * priority; each takes the first side that stays inside `clip`, avoids every
 * placed label, and avoids every obstacle circle except its own node.
 */
export function placeLabels(
  candidates: LabelCandidate[],
  obstacles: LabelObstacle[],
  clip: ClipRect,
  blocked: ClipRect[] = [],
): Map<string, LabelPlacement> {
  const placed = new Map<string, LabelPlacement>()
  const rects: LabelPlacement["rect"][] = [...blocked]
  const ordered = [...candidates].sort(
    (left, right) => right.priority - left.priority || left.id.localeCompare(right.id),
  )
  const attempt = (candidate: LabelCandidate, ignoreSoft: boolean): LabelPlacement | null => {
    for (const side of candidate.sides) {
      const placement = rectForSide(candidate, side)
      const rect = placement.rect
      if (
        rect.left < clip.left ||
        rect.top < clip.top ||
        rect.right > clip.right ||
        rect.bottom > clip.bottom
      )
        continue
      if (rects.some((existing) => rectsOverlap(existing, rect, LABEL_PADDING))) continue
      if (
        obstacles.some(
          (obstacle) =>
            obstacle.id !== candidate.id &&
            !(ignoreSoft && obstacle.soft) &&
            circleHitsRect(obstacle, rect, 1),
        )
      )
        continue
      return placement
    }
    return null
  }
  for (const candidate of ordered) {
    const placement =
      attempt(candidate, false) ?? (candidate.overlapSoft ? attempt(candidate, true) : null)
    if (!placement) continue
    placed.set(candidate.id, placement)
    rects.push(placement.rect)
  }
  return placed
}

/** Preferred label sides for a page: away from its folder anchor first. */
export function pageLabelSides(dx: number, dy: number): LabelSide[] {
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx >= 0 ? ["right", "below", "above", "left"] : ["left", "below", "above", "right"]
  }
  return dy >= 0 ? ["below", "right", "left", "above"] : ["above", "right", "left", "below"]
}

type Point = { x: number; y: number }

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

/** Andrew's monotone chain; returns the hull counter-clockwise. */
export function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((left, right) => left.x - right.x || left.y - right.y)
  if (sorted.length < 3) return sorted
  const lower: Point[] = []
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0)
      lower.pop()
    lower.push(point)
  }
  const upper: Point[] = []
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0)
      upper.pop()
    upper.push(point)
  }
  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

/**
 * Soft, irregular region behind a folder's pages: the convex hull of the
 * points, rounded outward by `padding`. Used only as a faint tint — never as
 * an outline or a fixed-radius circle.
 */
export function paddedHull(points: Point[], padding: number, samples = 10): Point[] {
  if (points.length === 0) return []
  const expanded: Point[] = []
  for (const point of points) {
    for (let index = 0; index < samples; index += 1) {
      const angle = (index / samples) * Math.PI * 2
      expanded.push({
        x: point.x + Math.cos(angle) * padding,
        y: point.y + Math.sin(angle) * padding,
      })
    }
  }
  return convexHull(expanded)
}

/** Preferred label sides for a folder anchor: the side facing the Garden. */
export function folderLabelSides(angle: number): LabelSide[] {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  if (cos > 0.35) return ["left", "below", "above", "right"]
  if (cos < -0.35) return ["right", "below", "above", "left"]
  return sin < 0 ? ["below", "left", "right", "above"] : ["above", "left", "right", "below"]
}

/**
 * How many page labels the current zoom deserves. The fitted view shows a
 * handful; zooming in progressively reveals the rest.
 */
export function pageLabelBudget(zoomRatio: number, base = 8): number {
  if (!Number.isFinite(zoomRatio) || zoomRatio <= 1.12) return base
  return base + Math.floor((zoomRatio - 1.12) * 30)
}
