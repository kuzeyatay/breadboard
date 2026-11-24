import { mapTone, mapThreadOpacity, mapPointSize } from "./topologyPaint.mjs"
import { answerMapQuestion } from "./topologyAssistant"
import { createMapShaders } from "./topologyShaders.mjs"
import { detectTopics } from "./topologyCommunities"
import {
  TopologyCamera3D,
  sphericalTopologyPositions,
  type Point3D,
} from "./thoughtTopology3DGeometry"
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
import { Application, Circle, Container, Graphics, Sprite, Text } from "pixi.js"
import { FullSlug, SimpleSlug, resolveRelative } from "../../util/path"
import type { D3Config } from "../Graph"
import { openTopologyChat, TOPOLOGY_SOURCE_COLORS, topologySourceLabel } from "./sourceNodeVisual"
import { RenderSlot } from "./renderSlot"
import { GraphRenderLoop } from "./graphRenderLoop"
import {
  affinityLabel,
  boundsOf,
  displayFolderTitle,
  fitTransform,
  folderLabelSides,
  gardenOverview,
  labelAwareLinkDistance,
  labelClearanceRadius,
  naturalCompare,
  pageLabelBudget,
  pageLabelSides,
  placeLabels,
  planThoughtTopology,
  placeChatsBesidePages,
  readableSummary,
  relationLabel,
  shouldShowTopologyNodeLabel,
  type ClipRect,
  type Insets,
  type LabelCandidate,
  type LabelObstacle,
  type LabelPlacement,
  type LabelSide,
  type PlannedEdge,
  type PlannedFolderOption,
  type PlannedNode,
  type TopologyPayload,
  type ViewTransform,
  HIERARCHY_STROKE_WIDTH,
  topologyNavigationSlug,
} from "./thoughtTopologyLayout"

export interface ThoughtTopologyRenderContext {
  scopeCluster: string
  scopeFolderPath: string | null
  configuredDepth: number
  /** Host surfaces outside Quartz can preserve the renderer's navigation gesture. */
  onNavigate?: (nodeId: string, targetSlug: string) => void
  /** Hand a visible topology focus to Bread without trusting the renderer to answer it. */
  onInvestigate?: (request: ThoughtTopologyInvestigationRequest) => void
}

export interface ThoughtTopologyInvestigationRequest {
  nodeSlug: string
  nodeTitle: string
  prompt: string
}

type NodeStyle = "rest" | "related" | "hovered" | "selected"

type SimNode = PlannedNode & SimulationNodeDatum & { z: number; vz?: number; fz?: number | null }

type SimLink = SimulationLinkDatum<SimNode> & {
  source: SimNode
  target: SimNode
  distance: number
}

type NodeView = {
  node: SimNode
  gfx: Sprite
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
  source: NodeView
  target: NodeView
  alpha: number
  alphaTarget: number
  color: string
  /** Colour at rest: connections mix from faint to strong by their strength. */
  restColor: string
  widthBoost: number
  selected: boolean
  drawn?: { x1: number; y1: number; x2: number; y2: number; k: number; width: number; color: string }
}

type HierarchyView = EdgeView & { kind: "hierarchy" }

type FloatingCalloutTarget = { kind: "node"; view: NodeView } | { kind: "edge"; view: EdgeView }

const CLICK_SLOP_PX = 5
const NODE_CLICK_TARGET_RADIUS_PX = 14
const RIGHT_DOUBLE_CLICK_MS = 500
const EMPTY_LESSON_PAGES_NOTICE = /No lesson pages have been generated yet\.?/gi
// Labels show the full title. Long ones wrap instead of being cut, so the
// widths below bound how far a label extends beside its dot.
const PAGE_LABEL_WRAP_PX = 128
const FOLDER_LABEL_WRAP_PX = 180
const GARDEN_LABEL_WRAP_PX = 230
// Large maps already have deterministic spherical homes. Re-running hundreds
// of collision passes on opening is costly and adds no navigation capability.
const ENTRANCE_SIMULATION_NODE_LIMIT = 300
const INITIAL_NODE_BATCH = 200
const INITIAL_EDGE_BATCH = 400
// v2 intentionally ignores positions saved by the old left-drag behavior.
const POSITION_STORAGE_PREFIX = "thought-topology-3d-home-positions:v1:"

function readStoredPositions(slug: string): Record<string, Point3D> {
  try {
    const raw = window.localStorage.getItem(`${POSITION_STORAGE_PREFIX}${slug}`)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function writeStoredPositions(slug: string, positions: Record<string, Point3D>) {
  try {
    window.localStorage.setItem(`${POSITION_STORAGE_PREFIX}${slug}`, JSON.stringify(positions))
  } catch {
    // Layout customization is optional; storage failure must not break dragging.
  }
}

/** Empty Learn scaffolding is operational state, not useful inspector copy. */
function withoutEmptyLessonPagesNotice(value: string): string {
  return value
    .replace(EMPTY_LESSON_PAGES_NOTICE, "")
    .replace(/\s*[|:\-–—]\s*$/, "")
    .trim()
}

/** Per-view display settings a person can change from the Filters panel. */
export type ThoughtTopologySettings = {
  /** Folder ids switched off; their subtrees and connections leave the map. */
  excludedFolderIds: string[]
  /** Repack visible folders into a sphere, or retain the full map's positions. */
  grouping: "garden" | "community"
  activity: "off" | "today" | "week"
  /** Connections weaker than this strength (0..1) are hidden. */
  minConnectionStrength: number
  /** Whether the Garden -> folder -> page hierarchy lines are drawn. */
  showHierarchy: boolean
  /** Keep only each page's strongest N connections; 0 keeps them all. */
  maxConnectionsPerNode: number
}

const CONNECTION_CAP_CHOICES: Array<{ value: number; label: string }> = [
  { value: 0, label: "All connections" },
  { value: 5, label: "Strongest 5 per page" },
  { value: 3, label: "Strongest 3 per page" },
  { value: 1, label: "Strongest 1 per page" },
]

const SETTINGS_STORAGE_PREFIX = "thought-topology-settings:v1:"
const DEFAULT_SETTINGS: ThoughtTopologySettings = {
  excludedFolderIds: [],
  grouping: "garden",
  activity: "off",
  minConnectionStrength: 0,
  showHierarchy: true,
  // A large Garden draws thousands of links; each page keeping its five
  // strongest reads far better by default, and "All connections" is one
  // click away in the Filters panel.
  maxConnectionsPerNode: 5,
}

function readStoredSettings(scope: string, defaults: ThoughtTopologySettings): ThoughtTopologySettings {
  try {
    const raw = window.localStorage.getItem(`${SETTINGS_STORAGE_PREFIX}${scope}`)
    const parsed = raw ? (JSON.parse(raw) as Partial<ThoughtTopologySettings>) : null
    if (!parsed || typeof parsed !== "object") return { ...defaults }
    const strength = Number(parsed.minConnectionStrength)
    const cap = Number(parsed.maxConnectionsPerNode)
    return {
      excludedFolderIds: Array.isArray(parsed.excludedFolderIds)
        ? parsed.excludedFolderIds.filter((id): id is string => typeof id === "string")
        : [],
      grouping: parsed.grouping === "community" ? "community" : "garden",
      activity: parsed.activity === "week" || parsed.activity === "today" ? parsed.activity : "off",
      minConnectionStrength: Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : defaults.minConnectionStrength,
      showHierarchy: parsed.showHierarchy !== false,
      maxConnectionsPerNode:
        typeof parsed.maxConnectionsPerNode === "number" && Number.isFinite(cap)
          ? Math.max(0, Math.floor(cap))
          : defaults.maxConnectionsPerNode,
    }
  } catch {
    return { ...defaults }
  }
}

function writeStoredSettings(scope: string, settings: ThoughtTopologySettings) {
  try {
    window.localStorage.setItem(`${SETTINGS_STORAGE_PREFIX}${scope}`, JSON.stringify(settings))
  } catch {
    // Display settings are a convenience; storage failure must not break the map.
  }
}

/** Mix two `#rrggbb` colours; `t` = 0 gives `from`, 1 gives `to`. */
function mixHex(from: string, to: string, t: number): string {
  const unit = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0))
  const parse = (value: string) => {
    const hex = value.replace("#", "")
    const full =
      hex.length === 3
        ? hex
            .split("")
            .map((c) => c + c)
            .join("")
        : hex
    const n = Number.parseInt(full, 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const a = parse(from)
  const b = parse(to)
  const channel = (index: number) => Math.round(a[index] + (b[index] - a[index]) * unit)
  return `#${[channel(0), channel(1), channel(2)].map((v) => v.toString(16).padStart(2, "0")).join("")}`
}

type MountResult = {
  cleanup: () => void
  folderOptions: PlannedFolderOption[]
  visiblePageCount: number
  totalPageCount: number
  connectionCount: number
}

function isPreviewSurface(config: D3Config): boolean {
  return (
    Boolean(config.preview) || document.documentElement.classList.contains("quartz-graph-preview")
  )
}

/** Payload ids of the page Quartz is showing, so a compact plan keeps it.
 * Payload slugs are `<garden>/<raw path>`; Quartz publishes the slugified
 * form, optionally under a site prefix, so compare published tails. */
function currentPageIds(payload: TopologyPayload, fullSlug: FullSlug): string[] {
  const current = topologyNavigationSlug(fullSlug).toLocaleLowerCase()
  if (!current) return []
  return payload.nodes
    .filter((node) => {
      const published = topologyNavigationSlug(node.slug).toLocaleLowerCase()
      return published && (current === published || current.endsWith(`/${published}`))
    })
    .map((node) => node.id)
}

const activitySeenByHost = new WeakMap<HTMLElement, { slug: string; seen: Map<string, number> }>()

/**
 * Render the Thought Topology map with a Filters panel. The panel lives
 * outside the Pixi scene and survives re-mounts: every settings change tears
 * the scene down and mounts it again with the new plan, which is simpler and
 * more reliable than mutating a live force layout.
 */
export async function renderThoughtTopology3D(
  graph: HTMLElement,
  fullSlug: FullSlug,
  config: D3Config,
  payload: TopologyPayload,
  context: ThoughtTopologyRenderContext,
): Promise<() => void> {
  const preview = isPreviewSurface(config)
  const isGlobalGraph = graph.classList.contains("global-graph-container")
  const compactSidebar = !isGlobalGraph && Boolean(graph.closest(".right.sidebar"))
  const interactive = !compactSidebar && (!preview || document.documentElement.classList.contains("quartz-graph-preview"))
  const settingsScope = context.scopeFolderPath
    ? `${payload.garden.slug}:folder:${context.scopeFolderPath}`
    : `${payload.garden.slug}:root`
  const defaults = { ...DEFAULT_SETTINGS,
    minConnectionStrength: (payload.sourceConnectionCount ?? 0) > 5000 ? 0.6 : DEFAULT_SETTINGS.minConnectionStrength,
  }
  let settings = interactive ? readStoredSettings(settingsScope, defaults) : { ...defaults }
  let disposed = false
  const renderer = new RenderSlot<MountResult>()
  let active: MountResult | null = null
  let recoveryTimer: number | null = null
  let stableTimer: number | null = null
  let recoveryAttempts = 0
  let recoveryNotice: HTMLButtonElement | null = null
  let renderPanel = () => {}
  if (!payload.nodes.some(node => node.topic)) {
    const topics = detectTopics(payload.nodes.filter(n => n.kind !== "chat").map(n => ({
      id: n.id, title: n.title, concepts: n.primaryConcepts ?? [],
    })), payload.edges.map(e => ({ source: e.source, target: e.target, weight: e.score ?? 1 })))
    const byId = new Map(topics.flatMap(t => t.memberIds.map(id => [id, { index: t.index, label: t.label }] as const)))
    payload = { ...payload, nodes: payload.nodes.map(n => ({ ...n, topic: byId.get(n.id) })) }
  }

  const scheduleRecovery = () => {
    if (disposed || recoveryTimer !== null) return
    if (stableTimer !== null) window.clearTimeout(stableTimer)
    stableTimer = null
    // A new context can immediately evict another one. Successful allocation
    // is not evidence of stability, so cap this entire burst of recoveries.
    if (recoveryAttempts >= 3) {
      renderer.clear()
      active = null
      if (!recoveryNotice) {
        recoveryNotice = element(
          "button",
          "thought-topology-retry thought-topology-recovery",
          "Reload map",
        )
        recoveryNotice.type = "button"
        recoveryNotice.title = "The map could not restore its graphics. Reload to try again."
        recoveryNotice.addEventListener("click", () => {
          recoveryAttempts = 0
          void remount()
        })
        graph.append(recoveryNotice)
      }
      return
    }
    const delay = 250 * 2 ** recoveryAttempts
    recoveryAttempts += 1
    recoveryTimer = window.setTimeout(() => {
      recoveryTimer = null
      void remount()
    }, delay)
  }

  const remount = async () => {
    if (disposed) return
    if (recoveryTimer !== null) window.clearTimeout(recoveryTimer)
    recoveryTimer = null
    if (stableTimer !== null) window.clearTimeout(stableTimer)
    stableTimer = null
    recoveryNotice?.remove()
    recoveryNotice = null
    try {
      const replacement = await renderer.replace(() =>
        mountThoughtTopology(
          graph,
          fullSlug,
          config,
          payload,
          context,
          settings,
          scheduleRecovery,
        ),
      )
      if (replacement && !disposed) {
        active = replacement
        stableTimer = window.setTimeout(() => {
          stableTimer = null
          recoveryAttempts = 0
        }, 30_000)
        renderPanel()
      }
    } catch {
      active = null
      scheduleRecovery()
    }
  }

  active =
    (await renderer.replace(() =>
      mountThoughtTopology(
        graph,
        fullSlug,
        config,
        payload,
        context,
        settings,
        scheduleRecovery,
      ),
    )) ?? null

  // --- Filters panel -------------------------------------------------------
  const outer = graph.parentElement
  const panelHost = outer
  let panel: HTMLElement | null = null
  if (interactive && !preview && panelHost) {
    panel = element("div", "thought-topology-filter")
    panel.dataset.placement = "surface"
    const toggle = element("button", "thought-topology-filter-toggle")
    toggle.type = "button"
    toggle.setAttribute("aria-label","Filters")
    toggle.setAttribute("aria-expanded", "false")
    toggle.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h18"/><path d="M6 12h12"/><path d="M10 19h4"/></svg>'
    const toggleText = element("span", "thought-topology-filter-toggle-text", "Filters")
    const badge = element("span", "thought-topology-filter-badge")
    toggle.append(toggleText, badge)
    const body = element("div", "thought-topology-filter-panel")
    body.hidden = true
    const summary = element("p", "thought-topology-filter-summary")
    const foldersSection = element("section", "thought-topology-filter-section")
    const foldersTitle = element("div", "thought-topology-filter-title")
    foldersTitle.append(element("span", undefined, "Folders"))
    const showAll = element("button", "thought-topology-filter-link", "Show all")
    showAll.type = "button"
    foldersTitle.append(showAll)
    const folderList = element("ul", "thought-topology-filter-folders")
    foldersSection.append(foldersTitle, folderList)
    const display = element("section", "thought-topology-filter-section")
    const picker = (title: string, choices: string[][]) => {
      const row = element("label", "thought-topology-filter-row thought-topology-filter-select")
      const input = element("select")
      input.setAttribute("aria-label", title)
      for (const [value, label] of choices) input.add(new Option(label, value))
      row.append(element("span", undefined, title), input)
      display.append(row)
      return input
    }
    const grouping = picker("Group by", [["garden", "Gardens and folders"], ["community", "Leiden communities"]])
    const activity = picker("Activity", [["off", "Off"], ["today", "Today"], ["week", "Last 7 days"]])
    const searchFolders = element("input", "map-folder-search")
    searchFolders.type = "search"
    searchFolders.placeholder = "Search Gardens and folders"
    searchFolders.setAttribute("aria-label", searchFolders.placeholder)
    foldersSection.insertBefore(searchFolders, folderList)
    const linesSection = element("section", "thought-topology-filter-section")
    const linesTitle = element("div", "thought-topology-filter-title")
    linesTitle.append(element("span", undefined, "Connections"))
    const hierarchyRow = element("label", "thought-topology-filter-row")
    const hierarchyInput = element("input")
    hierarchyInput.type = "checkbox"
    hierarchyRow.append(hierarchyInput, element("span", undefined, "Show folder lines"))
    const strengthRow = element("div", "thought-topology-filter-row thought-topology-filter-range")
    const strengthLabel = element("label")
    const strengthId = `thought-topology-strength-${Math.random().toString(36).slice(2, 8)}`
    strengthLabel.htmlFor = strengthId
    strengthLabel.textContent = "Hide weaker connections"
    const strengthInput = element("input")
    strengthInput.type = "range"
    strengthInput.id = strengthId
    strengthInput.min = "0"
    strengthInput.max = "90"
    strengthInput.step = "10"
    const strengthValue = element("span", "thought-topology-filter-range-value")
    strengthRow.append(strengthLabel, strengthInput, strengthValue)
    const capRow = element("label", "thought-topology-filter-row thought-topology-filter-select")
    capRow.append(element("span", undefined, "Per page"))
    const capSelect = element("select")
    for (const choice of CONNECTION_CAP_CHOICES) {
      const option = element("option", undefined, choice.label)
      option.value = String(choice.value)
      capSelect.append(option)
    }
    capRow.append(capSelect)
    linesSection.append(linesTitle, hierarchyRow, strengthRow, capRow)
    const reset = element("button", "thought-topology-filter-link", "Reset filters")
    reset.type = "button"
    const close = element("button", "thought-topology-filter-link", "Close")
    close.type = "button"
    const header = element("header", "map-filter-header")
    header.append(element("strong", undefined, "Filters"), close)
    body.append(header, summary, linesSection, display, foldersSection, reset)
    body.setAttribute("aria-label", "Knowledge map filters")
    panel.append(toggle, body)
    const expandedFolders = new Set<string>()

    const describeStrength = (value: number) =>
      value <= 0 ? "showing all" : `below ${Math.round(value * 100)}%`

    renderPanel = () => {
      if (!active) return
      const excluded = new Set(settings.excludedFolderIds)
      const activeCount =
        excluded.size +
        (settings.grouping === "garden" ? 0 : 1) + (settings.activity === "off" ? 0 : 1) +
        (settings.minConnectionStrength !== defaults.minConnectionStrength ? 1 : 0) +
        (settings.showHierarchy ? 0 : 1) +
        (settings.maxConnectionsPerNode !== DEFAULT_SETTINGS.maxConnectionsPerNode ? 1 : 0)
      badge.textContent = activeCount > 0 ? String(activeCount) : ""
      badge.hidden = activeCount === 0
      summary.textContent = `${active.visiblePageCount} of ${active.totalPageCount} pages, ${active.connectionCount} connections shown.`
      hierarchyInput.checked = settings.showHierarchy
      grouping.value = settings.grouping
      activity.value = settings.activity
      reset.disabled = activeCount === 0
      strengthInput.value = String(Math.round(settings.minConnectionStrength * 100))
      strengthValue.textContent = describeStrength(settings.minConnectionStrength)
      capSelect.value = String(
        CONNECTION_CAP_CHOICES.some((choice) => choice.value === settings.maxConnectionsPerNode)
          ? settings.maxConnectionsPerNode
          : 0,
      )
      showAll.hidden = excluded.size === 0
      folderList.replaceChildren()
      const options = active.folderOptions
      const children = new Map<string, PlannedFolderOption[]>()
      for (const option of options) {
        if (option.depth !== 2 || !option.parentId) continue
        const list = children.get(option.parentId) ?? []
        list.push(option)
        children.set(option.parentId, list)
      }
      const row = (option: PlannedFolderOption, nested: boolean) => {
        const item = element("li", nested ? "nested" : undefined)
        const label = element("label", "thought-topology-filter-row")
        const input = element("input")
        input.type = "checkbox"
        input.checked = !option.excluded
        input.disabled = option.inheritedExclusion
        input.addEventListener("change", () => {
          const next = new Set(settings.excludedFolderIds)
          if (input.checked) next.delete(option.id)
          else next.add(option.id)
          void applySettings({ ...settings, excludedFolderIds: [...next] })
        })
        const name = element(
          "span",
          "thought-topology-filter-name",
          displayFolderTitle(option.title),
        )
        const count = element(
          "span",
          "thought-topology-filter-count",
          option.pageCount === 1 ? "1 page" : `${option.pageCount} pages`,
        )
        label.append(input, name, count)
        item.append(label)
        return item
      }
      for (const option of options) {
        if (option.depth !== 1) continue
        const query = searchFolders.value.trim().toLowerCase()
        const allKids = children.get(option.id) ?? []
        const kids = !query || option.title.toLowerCase().includes(query) ? allKids : allKids.filter(k => k.title.toLowerCase().includes(query))
        if (query && !option.title.toLowerCase().includes(query) && !kids.length) continue
        const item = row(option, false)
        const only = element("button", "thought-topology-filter-link map-only", "Only")
        only.setAttribute("aria-label", "Show only " + displayFolderTitle(option.title))
        only.onclick = () => void applySettings({ ...settings, excludedFolderIds: options.filter(o => o.depth === 1 && o.id !== option.id).map(o => o.id) })
        item.append(only)
        if (kids.length > 0) {
          const disclose = element("button", "thought-topology-filter-disclose")
          disclose.type = "button"
          const open = Boolean(query) || expandedFolders.has(option.id)
          disclose.setAttribute("aria-expanded", open ? "true" : "false")
          disclose.textContent = open
            ? "Hide sub-folders"
            : kids.length === 1
              ? "1 sub-folder"
              : `${kids.length} sub-folders`
          disclose.addEventListener("click", () => {
            if (expandedFolders.has(option.id)) expandedFolders.delete(option.id)
            else expandedFolders.add(option.id)
            renderPanel()
          })
          item.append(disclose)
          if (open) {
            const nestedList = element("ul", "thought-topology-filter-folders nested")
            for (const kid of kids) nestedList.append(row(kid, true))
            item.append(nestedList)
          }
        }
        folderList.append(item)
      }
      if (folderList.childElementCount === 0) {
        folderList.append(
          element("li", "thought-topology-filter-empty", searchFolders.value.trim() ? "No matching folders." : "No folders in this view."),
        )
      }
    }

    const applySettings = async (next: ThoughtTopologySettings) => {
      if (disposed) return
      settings = next
      writeStoredSettings(settingsScope, settings)
      await remount()
      const canvas = graph.querySelector("canvas")
      if (canvas && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        canvas.animate([{ opacity: 0.72 }, { opacity: 1 }], { duration: 180, easing: "ease-out" })
      }
    }

    toggle.addEventListener("click", (e) => {
      body.toggleAttribute("data-instant", e.detail === 0)
      body.hidden = !body.hidden
      toggle.setAttribute("aria-expanded", body.hidden ? "false" : "true")
      panel?.classList.toggle("open", !body.hidden)
    })
    showAll.addEventListener("click", () => {
      void applySettings({ ...settings, excludedFolderIds: [] })
    })
    close.onclick = () => { toggle.click(); toggle.focus() }
    body.onkeydown = e => { if (e.key === "Escape") { e.stopPropagation(); close.click() } }
    searchFolders.oninput = () => renderPanel()
    reset.onclick = () => { searchFolders.value = ""; void applySettings({ ...defaults }) }
    grouping.onchange = () => void applySettings({ ...settings, grouping: grouping.value === "community" ? "community" : "garden" })
    activity.onchange = () => void applySettings({ ...settings, activity: activity.value as ThoughtTopologySettings["activity"] })
    hierarchyInput.addEventListener("change", () => {
      void applySettings({ ...settings, showHierarchy: hierarchyInput.checked })
    })
    strengthInput.addEventListener("input", () => {
      strengthValue.textContent = describeStrength(Number(strengthInput.value) / 100)
    })
    capSelect.addEventListener("change", () => {
      void applySettings({ ...settings, maxConnectionsPerNode: Number(capSelect.value) || 0 })
    })
    strengthInput.addEventListener("change", () => {
      void applySettings({ ...settings, minConnectionStrength: Number(strengthInput.value) / 100 })
    })
    // Keep the map's own pointer handling out of the panel.
    for (const type of ["pointerdown", "pointerup", "click", "wheel"] as const) {
      panel.addEventListener(type, (event) => event.stopPropagation())
    }
    renderPanel()
    panelHost.append(panel)
  }

  return () => {
    disposed = true
    if (recoveryTimer !== null) window.clearTimeout(recoveryTimer)
    if (stableTimer !== null) window.clearTimeout(stableTimer)
    renderer.clear()
    active = null
    recoveryNotice?.remove()
    panel?.remove()
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

async function mountThoughtTopology(
  graph: HTMLElement,
  fullSlug: FullSlug,
  config: D3Config,
  payload: TopologyPayload,
  context: ThoughtTopologyRenderContext,
  settings: ThoughtTopologySettings,
  onRendererInvalidated?: () => void,
): Promise<MountResult> {
  const resources: Array<() => void> = []
  const cleanup = () => {
    // Also release partially initialized scenes when mounting throws.
    for (const release of resources.splice(0).reverse()) {
      try {
        release()
      } catch (error) {
        console.error(error)
      }
    }
  }
  try {
    const mounted = await mountThoughtTopologyScene(
      graph,
      fullSlug,
      config,
      payload,
      context,
      settings,
      (release) => resources.push(release),
      onRendererInvalidated,
    )
    return { ...mounted, cleanup }
  } catch (error) {
    cleanup()
    throw error
  }
}

async function mountThoughtTopologyScene(
  graph: HTMLElement,
  fullSlug: FullSlug,
  config: D3Config,
  payload: TopologyPayload,
  context: ThoughtTopologyRenderContext,
  settings: ThoughtTopologySettings,
  onCleanup: (release: () => void) => void,
  onRendererInvalidated?: () => void,
): Promise<MountResult> {
  const preview = isPreviewSurface(config)
  const isGlobalGraph = graph.classList.contains("global-graph-container")
  const compactSidebar = !isGlobalGraph && Boolean(graph.closest(".right.sidebar"))
  const interactive = !compactSidebar && (!preview || document.documentElement.classList.contains("quartz-graph-preview"))
  // Passive cards get a small representative plan. The interactive Garden
  // workspace uses the same graph and filter semantics as its full viewer.
  const compact = !interactive && (preview || compactSidebar)
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  // Return to the browser between bounded batches so loading a large map
  // cannot monopolize input/painting while creating labels and GPU objects.
  let batchStarted = performance.now()
  const yieldIfNeeded = (): Promise<void> | undefined => {
    if (performance.now() - batchStarted < 6) return
    return new Promise(resolve => window.setTimeout(() => {
      batchStarted = performance.now()
      resolve()
    }, 0))
  }
  const gardenSlug = payload.garden.slug
  // A library of several Gardens (Quartz aggregate or the profile map) draws
  // one sphere per Garden. Pins from the old shared sphere do not carry over.
  const gardenSpheres =
    !context.scopeFolderPath &&
    payload.folders.some(
      (folder) => folder.id === "aggregate:root" || folder.id === "profile-thought-topology:root",
    )
  const positionScope = context.scopeFolderPath
    ? `${gardenSlug}:folder:${context.scopeFolderPath}`
    : gardenSpheres
      ? `${gardenSlug}:gardens`
      : `${gardenSlug}:root`
  const storedPositions = interactive ? readStoredPositions(positionScope) : {}
  const planOptions = {
    preview: compact,
    previewKeepPageIds: compactSidebar ? currentPageIds(payload, fullSlug) : [],
    scopeFolderPath: context.scopeFolderPath,
    // An explicitly requested route must include every hop, even when the
    // overview's density or folder filters would hide an intermediate page.
    excludedFolderIds: payload.isPagePath ? [] : settings.excludedFolderIds,
    minConnectionStrength: payload.isPagePath ? 0 : settings.minConnectionStrength,
    maxConnectionsPerNode: payload.isPagePath ? 0 : settings.maxConnectionsPerNode,
  }
  const plan = planThoughtTopology(payload, planOptions)
  if (gardenSpheres) {
    plan.nodes = plan.nodes.filter(n => n.id !== plan.garden.id)
    plan.hierarchyEdges = plan.hierarchyEdges.filter(e => e.source !== plan.garden.id && e.target !== plan.garden.id)
  }
  const largeMap = plan.nodes.length > ENTRANCE_SIMULATION_NODE_LIMIT
  const animateEntrance = !compact && !reducedMotion && plan.nodes.length <= ENTRANCE_SIMULATION_NODE_LIMIT
  await yieldIfNeeded()
  const camera = new TopologyCamera3D()
  // The preview retains the full Garden as its frame of reference.
  const basis = compact && !gardenSpheres ? planThoughtTopology(payload, { scopeFolderPath: context.scopeFolderPath }).nodes : plan.nodes
  const cluster = settings.grouping === "community"
  const plannedHomes = sphericalTopologyPositions(cluster ? basis.map(n => ({
    ...n, sectorId: n.topic ? "community:" + n.topic.index : n.sectorId,
  })) : basis, cluster || gardenSpheres)
  // Chats join the sphere beside the pages they cited or asked about.
  const sourcePageOrder = new Map(payload.nodes.map((node, index) => [node.id, index]))
  const orderedNodes = payload.sourceHierarchy ? [...plan.nodes].sort((a, b) =>
    (sourcePageOrder.get(a.id) ?? -1) - (sourcePageOrder.get(b.id) ?? -1)) : plan.nodes
  placeChatsBesidePages(orderedNodes, payload.edges, plannedHomes)
  await yieldIfNeeded()
  const depthSpread = [...plannedHomes.values()].reduce(
    (extent, point) => Math.max(extent, Math.hypot(point.x, point.y, point.z)),
    180,
  )
  for (const planned of plan.nodes) {
    const node = planned as SimNode
    const home = plannedHomes.get(node.id)!
    const saved = storedPositions[node.id]
    node.x = Number.isFinite(saved?.x) ? saved.x : home.x
    node.y = Number.isFinite(saved?.y) ? saved.y : home.y
    node.z = Number.isFinite(saved?.z) ? saved.z : home.z
  }
  const homePositions = new Map(
    plan.nodes.map((node) => [
      node.id,
      {
        x: node.x,
        y: node.y,
        z: (node as SimNode).z,
      },
    ]),
  )
  /** Nodes whose home a person pinned with a right-click or right-drag. */
  const permanentHomeIds = new Set(Object.keys(storedPositions))
  // The Garden is the centre of rotation; it can still be dragged and pinned.
  const isHomeFixed = (node: PlannedNode) => node.kind === "garden" || permanentHomeIds.has(node.id)
  const plannedHome = (nodeId: string): Point3D | undefined => plannedHomes.get(nodeId)
  const debugEnabled = new URLSearchParams(window.location.search).get("topologyTest") === "1"

  // --- Surrounding DOM -----------------------------------------------------
  // Inline canvases keep their heading and status in the graph metadata row
  // immediately above the bordered surface. The full-screen surface still owns
  // its overlay controls, floating callout, and close button.
  const outer = graph.parentElement
  const graphRoot = graph.closest(".graph") as HTMLElement | null
  const sibling = <T extends Element>(selector: string): T | null => {
    const surfaceElement = outer?.querySelector(
      `:scope > ${selector}, :scope > .thought-topology-controls > ${selector}`,
    ) as T | null
    if (surfaceElement) return surfaceElement
    if (!outer?.classList.contains("graph-outer")) return null
    return graphRoot?.querySelector(`:scope > .thought-topology-meta > ${selector}`) as T | null
  }
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
  const overlayCloseVisibility = overlayClose?.style.visibility ?? ""
  const overlayClosePointerEvents = overlayClose?.style.pointerEvents ?? ""
  const obscureOverlayClose = (obscured: boolean) => {
    if (!overlayClose) return
    overlayClose.style.visibility = obscured ? "hidden" : overlayCloseVisibility
    overlayClose.style.pointerEvents = obscured ? "none" : overlayClosePointerEvents
  }
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
  if (graphRoot) graphRoot.dataset.activeMode = "thought-topology"

  let width = Math.max(graph.offsetWidth, 1)
  let height = Math.max(graph.offsetHeight, 1)

  // --- Palette -------------------------------------------------------------
  const isDark =
    document.documentElement.getAttribute("saved-theme") === "dark" ||
    document.documentElement.dataset.theme === "dark"
  const palette = getComputedStyle(graph)
  const topics = Array.from({length: 8}, (_, i) =>
    palette.getPropertyValue("--topology-topic-" + i).trim() || (isDark ? "#b8bfcc" : "#627287"))
  const colors = isDark
    ? {
        garden: "#60a5fa",
        folder: "#22d3ee",
        page: "#4ade80",
        pageStrong: "#a3e635",
        source: TOPOLOGY_SOURCE_COLORS.dark,
        edge: "#92a198",
        edgeWeak: "#6b7a72",
        edgeStrong: "#dfe7e1",
        hierarchy: "#55635c",
        edgeActive: "#e8ede7",
        edgeSelected: "#60a5fa",
        search: "#facc15",
        topics,
        text: "#ffffff",
        textMuted: "#e0e0e0",
        paper: "#000000",
      }
    : {
        garden: "#2563eb",
        folder: "#0e7490",
        page: "#15803d",
        pageStrong: "#4d7c0f",
        source: TOPOLOGY_SOURCE_COLORS.light,
        edge: "#40544b",
        edgeWeak: "#93a59b",
        edgeStrong: "#1f3028",
        hierarchy: "#a7b6ad",
        edgeActive: "#0f1a16",
        edgeSelected: "#1d4ed8",
        search: "#a16207",
        topics,
        text: "#233139",
        textMuted: "#45555e",
        paper: "#fffefb",
      }
  const fontFamily = !isDark && palette.getPropertyValue("--bodyFont").trim() ||
    '"Alte Haas Map", "Helvetica Neue", Helvetica, Arial, sans-serif'
  await document.fonts.load("11px " + fontFamily)

  // --- Pixi ----------------------------------------------------------------
  const app = new Application()
  onCleanup(() => {
    if (app.renderer) app.destroy({ removeView: true }, { children: true })
    else app.stage?.destroy({ children: true })
  })
  await app.init({
    width,
    height,
    antialias: true,
    autoStart: false,
    autoDensity: true,
    backgroundAlpha: 0,
    // WebGL is substantially more stable for this long-lived, repeatedly
    // remounted scene. Some Chromium/WebGPU devices leave a live but blank
    // canvas after tab suspension or repeated filter/theme remounts.
    preference: "webgl",
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    eventMode: "static",
  })
  graph.appendChild(app.canvas)

  const stage = app.stage
  stage.sortableChildren = true
  const world = new Container({ isRenderGroup: true, zIndex: 0 })
  world.sortableChildren = true
  const hierarchyLayer = new Container({ zIndex: 0 })
  const linkLayer = new Container({ zIndex: 1 })
  const nodeLayer = new Container<Sprite>({ zIndex: 2, sortableChildren: true })
  const plates = new Graphics({ zIndex: 4.5, eventMode: "none" })
  stage.addChild(plates)
  const labelLayer = new Container<Text>({ zIndex: 5, isRenderGroup: true })
  // The sidebar limits labels and controls, but still draws the complete map.
  hierarchyLayer.visible = settings.showHierarchy
  world.addChild(hierarchyLayer, linkLayer, nodeLayer)
  stage.addChild(world, labelLayer)

  // --- State ---------------------------------------------------------------
  let transform: ZoomTransform = zoomIdentity
  let fitK = 1
  // Who last placed the view: the fitted overview, a programmatic focus
  // (folder, connections, search), or the user panning/zooming. Closing the
  // a focus never undoes the user's own navigation.
  let viewState: "fit" | "focus" | "user" = "fit"
  /** Set once a person pans or zooms; automatic re-fits stop after that. */
  let userMovedView = false
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
  let inspectedNodeId: string | null = null
  let labelsDirty = true
  let stopAnimation = false
  let renderLoop: GraphRenderLoop | null = null
  let stopSimulation = () => {}
  const invalidate = () => { labelsDirty = true; renderLoop?.invalidate() }
  const cleanups: Array<() => void> = []
  onCleanup(() => {
    stopAnimation = true
    renderLoop?.dispose()
    for (const cleanup of cleanups.splice(0)) cleanup()
  })
  const overview = !compactSidebar && outer ? element("div","map-overview") : null
  if (overview) {
    overview.append(element("strong",undefined, gardenSpheres && payload.garden.id === 0 ? "Knowledge" : plan.scopeFolder?.title || payload.garden.title),
      element("span",undefined,(gardenSpheres ? plan.nodes.filter(n => n.kind === "folder" && n.id === n.sectorId).length + " Gardens · " : "") +
        plan.nodes.length.toLocaleString()+" nodes · "+
        (plan.edges.length+(settings.showHierarchy ? plan.hierarchyEdges.length : 0)).toLocaleString()+
        (payload.sourceConnectionCount === undefined ? "" : " of " + payload.sourceConnectionCount.toLocaleString())+" connections"))
    outer!.append(overview); onCleanup(() => overview.remove())
  }
  const inspectorRoot = interactive && outer ? element("aside", "thought-inspector") : null
  const inspectorContent = inspectorRoot ? element("div", "thought-inspector-content") : null
  const inspectorClose = inspectorRoot ? element("button", "thought-inspector-close", "×") : null
  if (inspectorRoot && inspectorContent && inspectorClose) {
    inspectorRoot.setAttribute("role", "complementary")
    inspectorRoot.setAttribute("aria-label", "Map selection")
    inspectorRoot.setAttribute("aria-hidden", "true")
    inspectorClose.type = "button"
    inspectorClose.setAttribute("aria-label", "Close node connections")
    inspectorRoot.append(inspectorClose, inspectorContent)
    outer?.append(inspectorRoot)
    onCleanup(() => inspectorRoot.remove())
  }
  let rendererInvalidated = false
  const invalidateRenderer = () => {
    if (rendererInvalidated || stopAnimation) return
    rendererInvalidated = true
    stopAnimation = true
    renderLoop?.dispose()
    stopSimulation()
    onRendererInvalidated?.()
  }
  const handleContextLost = (event: Event) => {
    event.preventDefault()
    invalidateRenderer()
  }
  app.canvas.addEventListener("webglcontextlost", handleContextLost)
  cleanups.push(() => app.canvas.removeEventListener("webglcontextlost", handleContextLost))

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
  const paletteOrder = new Map(payload.folders.filter(folder => folder.depth === 1)
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .map((folder, index) => [folder.id, folder.gardenTone ?? index]))
  const toneOf = (node: PlannedNode) => mapTone(node.topic?.index, paletteOrder.get(node.sectorId ?? ""))
  const tone = (node: PlannedNode) => colors.topics[toneOf(node)]
  const labelBorders = topics.map(color => mixHex(color, "#c3d1c4", .82))
  const rawNodes = new Map(payload.nodes.map(n => [n.id,n]))
  const activityStart = settings.activity === "today" ? new Date().setHours(0,0,0,0) : Date.now()-7*86400000
  const counts = new Map<string,number>()
  for (const n of plan.nodes) {
    const count = (rawNodes.get(n.id)?.activityTimes ?? []).filter(t => t >= activityStart && t <= Date.now()).length
    if (count) counts.set(n.id,count)
  }
  function activityText(n: PlannedNode) {
    const count = counts.get(n.id)
    if (!count || settings.activity === "off") return ""
    return count + (n.contentKind === "chat" ? (count === 1 ? " chat session" : " chat sessions") : (count === 1 ? " document update" : " document updates")) +
      (settings.activity === "today" ? " today" : " in the last 7 days")
  }
  /** The complete name of a node; pages keep their full page title. */
  function labelText(node: PlannedNode): string {
    return node.kind === "page" ? node.title : node.label
  }

  function makeLabel(node: PlannedNode): Text {
    const size = 11
    const label = new Text({
      interactive: false,
      eventMode: "none",
      text: labelText(node),
      alpha: 0,
      visible: false,
      style: {
        fontSize: size,
        fill: node.kind === "page" ? colors.textMuted : colors.text,
        fontFamily,
        fontWeight: !isDark && (node.kind === "garden" || node.id === node.sectorId) ? "700" : "400",
        wordWrap: false,
        wordWrapWidth:
          node.kind === "garden"
            ? GARDEN_LABEL_WRAP_PX
            : node.kind === "folder"
              ? FOLDER_LABEL_WRAP_PX
              : PAGE_LABEL_WRAP_PX,
        lineHeight: size * 1.2,
      },
      resolution: Math.min((window.devicePixelRatio || 1) * 2, 3),
    })
    return label
  }

  for (const node of plan.nodes) {
    const gfx = new Sprite({
      anchor: 0.5,
      interactive: interactive,
      visible: !largeMap,
      label: node.id,
      eventMode: interactive ? "static" : "none",
      hitArea: new Circle(0, 0, node.radius + 7),
      cursor: interactive && config.drag ? "grab" : "pointer",
    })
    const view: NodeView = {
      node: node as SimNode,
      gfx,
      label: makeLabel(node),
      placement: null,
      labelAlpha: 0,
      labelTarget: 0,
      alpha: 1,
      alphaTarget: 1,
      style: "rest",
    }
    gfx.zIndex = node.kind === "garden" ? 3 : node.kind === "folder" ? 2 : 1
    gfx.renderable = false
    nodeLayer.addChild(gfx)
    labelLayer.addChild(view.label)
    views.push(view)
    viewById.set(node.id, view)
    const pause = yieldIfNeeded()
    if (pause) await pause
  }

  for (const edge of plan.hierarchyEdges) {
    const source = viewById.get(edge.source)
    const target = viewById.get(edge.target)
    if (!source || !target) continue
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
          text: target.node.kind === "folder" ? "The second folder sits inside the first." : "The page is filed in this folder.",
        },
        evidence: [],
        crossFolder: false,
        strength: 0,
        width: HIERARCHY_STROKE_WIDTH,
        opacity: mapThreadOpacity(true, 0),
      },
      source,
      target,
      alpha: 0,
      alphaTarget: mapThreadOpacity(true, 0),
      color: colors.hierarchy,
      restColor: mixHex(tone(source.node), colors.hierarchy, .4),
      widthBoost: 0,
      selected: false,
    })
    const pause = yieldIfNeeded()
    if (pause) await pause
  }

  for (const edge of plan.edges) {
    const source = viewById.get(edge.source)
    const target = viewById.get(edge.target)
    if (!source || !target) continue
    const restColor = mixHex(tone(source.node), tone(target.node), .5)
    edgeViews.push({
      kind: "semantic",
      edge,
      source,
      target,
      alpha: 0,
      alphaTarget: edge.opacity,
      color: restColor,
      restColor,
      widthBoost: 0,
      selected: false,
    })
    const pause = yieldIfNeeded()
    if (pause) await pause
  }
  const connectionViews: EdgeView[] = [...hierarchyViews, ...edgeViews]
  const edgeById = new Map(connectionViews.map((view) => [view.edge.id, view]))
  const shaders = createMapShaders<SimNode>(app.canvas, app.canvas.getContext("webgl2")!, !isDark)
  const shaderNodes = views.map(view => view.node)
  const shaderEdges = (settings.showHierarchy ? connectionViews : edgeViews).map(view => ({
    ...view.edge, structural: view.kind === "hierarchy",
    opacity: isDark ? view.edge.opacity : view.edge.opacity * (
      view.kind === "hierarchy" ? .85 : view.edge.crossFolder ? 1.45 : .85),
  }))
  const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const shaderColors = topics.map(rgb), shaderInk = rgb(colors.text)
  shaders.setNodes(shaderNodes, toneOf)
  shaders.setLines(shaderNodes, shaderEdges, toneOf, null)
  shaders.resize(width, height)
  onCleanup(() => shaders.dispose())

  // --- Legacy Knowledge Map motion ----------------------------------------
  // Keep the same d3 springs and settling, starting from a smaller copy of
  // the spherical homes so the entrance scatters naturally in every axis.
  const simNodes = plan.nodes as SimNode[]
  const simNodeById = new Map(simNodes.map((node) => [node.id, node]))
  // Node proximity follows the rendered name, not just the dot. Full maps
  // reserve every label's complete footprint; the small preview stays compact
  // because it intentionally displays only a label budget.
  const labelLayoutScale = compact ? 1.8 : isGlobalGraph ? 1 : 1.15
  const clearanceById = new Map<string, number>()
  for (const view of views) {
    clearanceById.set(view.node.id, labelClearanceRadius(
        view.node.radius,
        (compactSidebar && view.node.kind !== "folder") || !shouldShowTopologyNodeLabel(view.node)
          ? 0
          : view.label.width,
        (compactSidebar && view.node.kind !== "folder") || !shouldShowTopologyNodeLabel(view.node)
          ? 0
          : view.label.height,
        labelLayoutScale,
    ))
    const pause = yieldIfNeeded()
    if (pause) await pause
  }
  const returnTargets = new Map<string, Point3D & { pin: boolean }>()
  const returningNodeIds = new Set<string>()
  let activeDragNodeId: string | null = null
  for (const node of simNodes) {
    if (isHomeFixed(node)) {
      const home = homePositions.get(node.id)
      node.fx = home?.x ?? node.x
      node.fy = home?.y ?? node.y
      node.fz = home?.z ?? node.z
    } else if (animateEntrance) {
      node.x *= 0.12
      node.y *= 0.12
      node.z *= 0.12
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
        distance: labelAwareLinkDistance(
          Math.hypot(targetHome.x - sourceHome.x, targetHome.y - sourceHome.y),
          clearanceById.get(source.id) ?? source.radius,
          clearanceById.get(target.id) ?? target.radius,
        ),
      },
    ]
  })
  const homeXForNode = (node: SimNode) => homePositions.get(node.id)?.x ?? node.x ?? 0
  const homeYForNode = (node: SimNode) => homePositions.get(node.id)?.y ?? node.y ?? 0
  const homeXForce = forceX<SimNode>(homeXForNode).strength(isGlobalGraph ? 0.11 : 0.09)
  const homeYForce = forceY<SimNode>(homeYForNode).strength(isGlobalGraph ? 0.055 : 0.045)
  let simulationSettled = !animateEntrance
  let positionsDirty = true
  let draggingNode = false
  const simulation = forceSimulation<SimNode>(simNodes)
    .stop()
    .force("charge", forceManyBody<SimNode>().strength(-125 * config.repelForce))
    .force("center", forceCenter<SimNode>(0, 0).strength(config.centerForce))
    .force(
      "collide",
      forceCollide<SimNode>((node) => clearanceById.get(node.id) ?? node.radius + 7).iterations(
        isGlobalGraph ? 6 : 3,
      ),
    )
    .force(
      "link",
      forceLink<SimNode, SimLink>(links).distance((link) => link.distance),
    )
    .force("home-x", homeXForce)
    .force("home-y", homeYForce)
    .force("home-z", (alpha: number) => {
      for (const node of simNodes) {
        if (node.fz != null) {
          node.z = node.fz
          node.vz = 0
          continue
        }
        const target = returnTargets.get(node.id)?.z ?? homePositions.get(node.id)?.z ?? 0
        node.vz = ((node.vz ?? 0) + (target - node.z) * 0.1 * alpha) * 0.5
        node.z += node.vz
      }
    })
    .alphaDecay(0.018)
    .velocityDecay(0.5)
    .on("tick", () => {
      simulationSettled = false
      invalidate()
    })
    .on("end", () => {
      for (const [nodeId, target] of returnTargets) {
        const node = simNodeById.get(nodeId)
        if (!node) continue
        node.x = target.x
        node.y = target.y
        node.z = target.z
        node.fx = target.pin ? target.x : null
        node.fy = target.pin ? target.y : null
        node.fz = target.pin ? target.z : null
      }
      returnTargets.clear()
      returningNodeIds.clear()
      simulationSettled = true
      positionsDirty = true
      invalidate()
      // The relaxed layout spreads past the frame fitted around the planned
      // positions, which cut off the outer sectors. Re-frame once the first
      // settle finishes, but never over a view the person has already moved.
      if (viewState === "fit" && !userMovedView && !activeDragNodeId) fitView(true)
    })
  onCleanup(() => simulation.stop())
  stopSimulation = () => { simulation.stop() }
  if (reducedMotion && !compact && simNodes.length <= ENTRANCE_SIMULATION_NODE_LIMIT) {
    // Reduced motion removes the entrance animation, not the label-aware
    // layout. Settle in short batches so accessibility mode cannot turn
    // opening the map into one long blocking task.
    for (let tick = 0; tick < 360; tick++) {
      simulation.tick()
      const pause = yieldIfNeeded()
      if (pause) await pause
    }
  }

  // --- Geometry ------------------------------------------------------------
  const projections = new WeakMap<PlannedNode, { x: number; y: number; z: number; px: number; py: number; pz: number; yaw: number; pitch: number }>()
  const projected = (node: PlannedNode) => {
    const z = (node as SimNode).z ?? 0
    let p = projections.get(node)
    if (p && p.px === node.x && p.py === node.y && p.pz === z && p.yaw === camera.yaw && p.pitch === camera.pitch) return p
    const next = camera.project({ x: node.x, y: node.y, z })
    if (!p) { p = { ...next, px: 0, py: 0, pz: 0, yaw: 0, pitch: 0 }; projections.set(node, p) }
    p.x = next.x; p.y = next.y; p.z = next.z
    p.px = node.x; p.py = node.y; p.pz = z; p.yaw = camera.yaw; p.pitch = camera.pitch
    return p
  }
  const worldX = (node: PlannedNode) => projected(node).x + width / 2
  const worldY = (node: PlannedNode) => projected(node).y + height / 2
  const screenOf = (node: PlannedNode) => ({
    x: transform.applyX(worldX(node)),
    y: transform.applyY(worldY(node)),
  })
  const screenRadius = (node: PlannedNode) => .25 * mapPointSize(node.kind !== "page", false) * Math.min(2.2, Math.max(.85, Math.sqrt(transform.k / fitK)))

  /** Pick from the current rendered coordinates instead of relying on a prior
   * hover event. Nodes can move beneath a stationary pointer while the force
   * layout settles, and clicks must remain reliable during that motion. */
  function nodeAtScreenPoint(x: number, y: number): NodeView | undefined {
    let match: { view: NodeView; depth: number } | undefined
    for (const view of views) {
      const position = screenOf(view.node)
      const distance = Math.hypot(x - position.x, y - position.y)
      const hitRadius = Math.max(
        largeMap ? 5 : NODE_CLICK_TARGET_RADIUS_PX,
        (view.node.radius + 7) * Math.sqrt(transform.k),
      )
      const depth = projected(view.node).z
      if (distance > hitRadius || (match && depth <= match.depth)) continue
      match = { view, depth }
    }
    return match?.view
  }

  function canvasPoint(event: MouseEvent | PointerEvent): { x: number; y: number } {
    const bounds = app.canvas.getBoundingClientRect()
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
  }

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

  function edgeAt(x: number, y: number) {
    const px = transform.invertX(x) - width / 2, py = transform.invertY(y) - height / 2
    const reach = 4 / transform.k
    let best = reach * reach, hit: EdgeView | undefined
    for (const edge of connectionViews) {
      if (!canHoverConnection(edge)) continue
      const a = projected(edge.source.node), b = projected(edge.target.node)
      if (px < Math.min(a.x,b.x)-reach || px > Math.max(a.x,b.x)+reach || py < Math.min(a.y,b.y)-reach || py > Math.max(a.y,b.y)+reach) continue
      const dx = b.x-a.x, dy = b.y-a.y
      const t = Math.max(0,Math.min(1, ((px-a.x)*dx+(py-a.y)*dy)/(dx*dx+dy*dy || 1)))
      const distance = (px-a.x-t*dx)**2+(py-a.y-t*dy)**2
      if (distance < best) { best = distance; hit = edge }
    }
    return hit
  }

  // --- View transform ------------------------------------------------------
  const canvasSelection = select<HTMLCanvasElement, unknown>(app.canvas)
  const zoomBehavior = zoom<HTMLCanvasElement, unknown>()
    .scaleExtent([0.01, 5])
    .on("zoom", (event) => {
      transform = event.transform
      world.scale.set(transform.k, transform.k)
      world.position.set(transform.x, transform.y)
      if (event.sourceEvent) {
        viewState = "user"
        userMovedView = true
      }
      invalidate()
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
      invalidate()
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
    if (compact) return { top: 10, right: 10, bottom: 10, left: 10 }
    return { top: 14, right: 14, bottom: 14, left: 14 }
  }

  function blockedRects(): ClipRect[] {
    if (compact) return []
    const canvasRect = graph.getBoundingClientRect()
    const rects: ClipRect[] = []
    for (const blocker of [heading, searchPanel, overlayClose, calloutRoot, inspectorRoot]) {
      if (blocker === calloutRoot && !calloutVisible) continue
      if (blocker === inspectorRoot && !inspectorRoot?.classList.contains("open")) continue
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
    const bounds = boundsOf(
      fitNodes.map((node) => ({ ...projected(node), radius: gardenSpheres ? 0 : node.radius })),
      gardenSpheres ? 0 : compact ? 18 : 44,
    )
    // Keep the Garden name centred even in sparse or filtered clouds. Mirror
    // the bounds about its anchor so fitting still includes every outer node.
    const focus = projected(gardenAnchor)
    const halfWidth = Math.max(focus.x - bounds.minX, bounds.maxX - focus.x)
    const halfHeight = Math.max(focus.y - bounds.minY, bounds.maxY - focus.y)
    const next = fitTransform(
      gardenSpheres ? bounds : {
        minX: focus.x - halfWidth,
        maxX: focus.x + halfWidth,
        minY: focus.y - halfHeight,
        maxY: focus.y + halfHeight,
      },
      { width, height },
      gardenSpheres ? { left: width * .08, right: width * .08, top: height * .07, bottom: height * .07 } : currentInsets(),
      {
        minScale: 0.01,
        maxScale: compact ? 1.25 : 1.35,
      },
      gardenSpheres ? undefined : focus,
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
    if (hoveredEdgeId && !canHoverConnection(edgeById.get(hoveredEdgeId))) hoveredEdgeId = null
    let emphasis: Set<string> | null = null
    const selectedEdge = selectedEdgeId ? edgeById.get(selectedEdgeId) : undefined
    const hoveredEdge = hoveredEdgeId ? edgeById.get(hoveredEdgeId) : undefined
    const focusedEdge = hoveredEdge ?? selectedEdge
    if (inspectedNodeId) {
      emphasis = emphasisFor(inspectedNodeId)
    } else if (focusedEdge) {
      emphasis = new Set([focusedEdge.edge.source, focusedEdge.edge.target])
    } else if (selectedNodeId) {
      const selected = viewById.get(selectedNodeId)?.node
      emphasis = selected && selected.kind !== "garden" ? emphasisFor(selectedNodeId) : null
    }
    if (!inspectedNodeId && hoveredNodeId && viewById.get(hoveredNodeId)?.node.kind !== "garden") {
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
      view.style = style
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
      const active = inspectedNodeId
        ? source === inspectedNodeId || target === inspectedNodeId
        : selected || hovered || touchesFocus || (emphasis === null ? true : withinEmphasis)
      // Dimmed connections must not intercept the highlighted links at crossings.
      view.selected = selected
      const base = view.edge.opacity
      view.alphaTarget = active ? base : base * .32
      view.color = selected
        ? colors.edgeSelected
        : hovered
          ? colors.edgeActive
          : active && emphasis
            ? colors.edgeActive
            : view.restColor
      view.widthBoost = selected ? 1.2 : hovered ? 0.8 : active && emphasis ? 0.4 : 0
    }
    invalidate()
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

  /**
   * Names grow with the zoom the way the dots do (both ∝ √k), relative to
   * the fitted view. A name that stayed 10.5 px while its dot doubled read as
   * a mismatch, and zooming into a dense cluster never separated the names
   * even though it separated the dots.
   */


  /** Zoom (relative to fit) from which quiet names — Markdown pages, whose
   * names are otherwise shown on demand — join the label budget. */
  const QUIET_NAME_ZOOM = 1.5

  const gardenCaptions = views.filter(v => v.node.kind === "folder")
  const isGarden = (n: PlannedNode) => n.id === n.sectorId
  const degreeById = new Map<string, number>()
  for (const edge of [...(payload.sourceHierarchy ?? plan.hierarchyEdges), ...payload.edges]) {
    degreeById.set(edge.source, (degreeById.get(edge.source) ?? 0) + 1)
    degreeById.set(edge.target, (degreeById.get(edge.target) ?? 0) + 1)
  }
  gardenCaptions.sort(({node: a}, {node: b}) =>
    Number(isGarden(b)) - Number(isGarden(a)) ||
    Number(b.folderId === b.sectorId) - Number(a.folderId === a.sectorId) ||
    (degreeById.get(b.id) ?? 0) - (degreeById.get(a.id) ?? 0) || a.title.localeCompare(b.title))

  function placeGardenCaptions(ratio: number) {
    const boxes: ClipRect[] = []
    const folderGardens = new Set<string | null>()
    const overview = ratio < 1.8
    const budget = Math.max(6, Math.min(overview ? 21 : 38, Math.round(width * height / (overview ? 30000 : 23000))))
    for (const view of views) {
      view.placement = null
      view.labelTarget = 0
    }
    for (const view of gardenCaptions) {
      if (boxes.length >= budget) break
      const {node, label} = view
      const folder = !isGarden(node)
      if (overview && folder && (node.folderId !== node.sectorId || folderGardens.has(node.sectorId) || folderGardens.size >= 4)) continue
      const {x, y} = screenOf(node)
      if (x < 0 || x > width || y < 8 || y > height - 8) continue
      const w = label.width + 10, h = label.height + 4
      const left = x + 7 + w <= width ? x + 7 : x - 7 - w
      const top = y - h / 2
      if (left < 0 || top < 0 || top + h > height) continue
      if (boxes.some(b => left < b.right + 5 && left + w > b.left - 5 && top < b.bottom + 4 && top + h > b.top - 4)) continue
      const rect = { left, top, right: left + w, bottom: top + h }
      boxes.push(rect)
      view.placement = {side: left > x ? "right" : "left", dx: left + 5 - x, dy: 0, anchorX: 0, anchorY: .5, rect}
      view.labelTarget = calloutVisible ? .3 : 1
      if (folder) folderGardens.add(node.sectorId)
    }
  }

  function updateLabels() {
    labelsDirty = false
    const ratio = transform.k / (fitK || 1)
    if (gardenSpheres && !compact && !payload.isPagePath && !selectedNodeId && !selectedEdgeId && !searchQuery) {
      placeGardenCaptions(ratio)
      return
    }
    const budget = pageLabelBudget(ratio)
    const scale = 1
    for (const view of views) {
      if (view.label.scale.x !== scale) view.label.scale.set(scale, scale)
    }
    const selectedEdge = selectedEdgeId ? edgeById.get(selectedEdgeId) : undefined
    const selectedNode = selectedNodeId ? viewById.get(selectedNodeId)?.node : undefined
    const selectedNeighbours = selectedNodeId
      ? (neighbours.get(selectedNodeId) ?? new Set<string>())
      : new Set<string>()
    const focusedSector = selectedNode?.kind === "folder" ? selectedNode.sectorId : null
    const candidates: LabelCandidate[] = []
    const obstacles: LabelObstacle[] = []
    const wanted = new Set<string>()

    const BUDGET_TIER = 100
    // Budget-tier names that find no free spot are hidden at this zoom (they
    // appear as the view zooms in); every higher tier stays attached.
    const budgetTier = new Set<string>()
    for (const view of views) {
      const { node } = view
      // Markdown pages carry quiet names: shown when the page is selected,
      // hovered, a neighbour of the selection, a search hit, or once the
      // view is zoomed in enough for names to have room.
      const quietName = !shouldShowTopologyNodeLabel(node)
      const inFocus =
        payload.isPagePath || selectedNodeId === node.id ||
        (hoveredNodeId === node.id && !draggingNode) ||
        selectedNeighbours.has(node.id) ||
        Boolean(
          selectedEdge &&
          (selectedEdge.edge.source === node.id || selectedEdge.edge.target === node.id),
        ) ||
        Boolean(searchQuery && searchHits.has(node.id))
      if (
        (!inFocus && node.kind === "page") ||
        (compactSidebar && node.kind !== "folder") ||
        (quietName && !inFocus && ratio < QUIET_NAME_ZOOM)
      ) {
        view.placement = null
        view.labelTarget = 0
        continue
      }
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
      wanted.add(node.id)
      // Sub-folders (880) count too: thirty-six section names on one ring
      // cannot all be read at the fitted zoom; their sector anchor can.
      if (priority < 900 && !labelMustStayAttached(node.id)) budgetTier.add(node.id)
      const text = labelText(node)
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
    candidates.sort((a,b) => b.priority-a.priority)
    const overview = ratio < 1.8 && !selectedNodeId
    const gardenFolders = new Set<string | null>()
    const labelBudget = Math.max(6, Math.min(overview ? 21 : 38, Math.round(width*height/(overview ? 30000 : 23000))))
    for (let i = 0; i < candidates.length;) {
      const node = viewById.get(candidates[i].id)!.node
      if (gardenSpheres && overview && node.kind === "folder" && node.id !== node.sectorId) {
        if (node.folderId !== node.sectorId || gardenFolders.has(node.sectorId) || gardenFolders.size >= 4) {
          candidates.splice(i,1)
          continue
        }
        gardenFolders.add(node.sectorId)
      }
      i++
    }
    candidates.splice(labelBudget)
    const placements = placeLabels(candidates, obstacles, clip, blockedRects())
    if (compact) {
      // The sidebar card is too small for every name. Trim the budget tier to
      // what the zoom level deserves; placement was greedy by priority, so
      // dropping the lowest winners frees nothing else.
      const budgetWinners = candidates
        .filter((candidate) => candidate.priority < 600 && placements.has(candidate.id))
        .sort((left, right) => right.priority - left.priority)
      for (const loser of budgetWinners.slice(budget)) placements.delete(loser.id)
    }
    for (const view of views) {
      // In the full map a wanted label gets a collision-free spot when one
      // exists, otherwise the least-clipped side next to its dot — except
      // for the budget tier, whose names wait for a zoom with room rather
      // than pile onto each other; the dot itself is always drawn.
      const placement =
        placements.get(view.node.id) ??
        ((
          compact
            ? labelMustStayAttached(view.node.id)
            : labelMustStayAttached(view.node.id) && wanted.has(view.node.id) && !budgetTier.has(view.node.id)
        )
          ? attachedLabelPlacement(view)
          : null)
      view.placement = placement
      view.labelTarget = placement ? (calloutVisible ? 0.3 : view.alphaTarget < 1 ? 0.6 : 1) : 0
    }
  }

  // --- Floating object text ------------------------------------------------
  function showCallout() {
    if (!calloutRoot) return
    calloutVisible = true
    calloutRoot.classList.add("visible")
    calloutRoot.setAttribute("aria-hidden", "false")
    invalidate()
  }

  function hideCallout() {
    if (!calloutRoot) return
    calloutVisible = false
    floatingCalloutTarget = null
    renderedCalloutKey = null
    calloutRoot.classList.remove("visible")
    calloutRoot.setAttribute("aria-hidden", "true")
    invalidate()
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
      const sourceType = node.sourceKind
        ? topologySourceLabel(node.sourceKind)
        : ""
      calloutText(
        "thought-callout-meta",
        [
          node.topic ? `Topic: ${node.topic.label}` : "",
          sourceType,
          activityText(node),
          concepts,
          `${touching.length} ${touching.length === 1 ? "connection" : "connections"}`,
        ]
          .filter(Boolean)
          .join(" · "),
      )
    }
  }

  function renderEdgeCallout(view: EdgeView) {
    if (!calloutContent) return
    calloutContent.replaceChildren()
    calloutContent.appendChild(
      calloutTitle(
        `${view.source.node.title} ${view.kind === "hierarchy" ? "→" : "↔"} ${view.target.node.title}`,
      ),
    )
    calloutText("thought-callout-meta", connectionMeta(view))
    calloutText("thought-callout-summary", inspectorConnectionExplanation(view))
  }

  function visibleConnectionsFor(nodeId: string): EdgeView[] {
    const visibleConnections = settings.showHierarchy ? connectionViews : edgeViews
    return visibleConnections
      .filter((view) => view.edge.source === nodeId || view.edge.target === nodeId)
      .sort((left, right) => {
        if (left.kind !== right.kind) return left.kind === "semantic" ? -1 : 1
        return right.edge.score - left.edge.score || left.edge.id.localeCompare(right.edge.id)
      })
  }

  function canHoverConnection(view: EdgeView | undefined): boolean {
    return Boolean(
      view &&
      (view.kind !== "hierarchy" || settings.showHierarchy) &&
      (!inspectedNodeId ||
        view.edge.source === inspectedNodeId ||
        view.edge.target === inspectedNodeId),
    )
  }

  function inspectorNodeSummary(node: PlannedNode): string {
    if (node.kind === "garden") {
      return gardenOverview(plan, plan.garden.title, payload.garden.summary)
    }
    return readableSummary(node.summary, {
      title: node.title,
      folderTitle: node.folderTitle || plan.garden.title,
    })
  }

  function inspectorConnectionExplanation(view: EdgeView): string {
    const text = view.edge.explanation.text.trim()
    // Preserve the stored question for retrieval and show the reader just its evidence.
    const question = /^You asked "(.*)"(?: and the answer cited |; | in .+?; )/.exec(text)?.[1]
    if (question) {
      const cited = text.includes(" and the answer cited ")
      return (cited ? "The answer cited this page when you asked “" : "This page matches your question “") + question + "”"
    }
    if (view.kind === "hierarchy") return view.target.node.kind === "folder"
      ? "The second folder sits inside the first." : "The page is filed in this folder."
    if (/through its recorded source references/.test(text)) return "The first page lists the second as a source."
    const oldCross = /form a cross-Garden semantic match|latest Thought Topology builds/i.test(text)
    const oldRelated = /are connected(?: because|\.$)/.test(text) || text.includes("This connection is preserved from authored Markdown")
    if (text && !oldCross && !oldRelated) return text
    const shared = view.edge.evidence
      .filter(item => item.kind === "concept" || /^Shared (concept|term):/i.test(item.label))
      .map(item => item.label.replace(/^Shared (concept|term):\s*/i, "").trim()).filter(Boolean)
    if (shared.length) return "Both pages cover " + new Intl.ListFormat("en").format([...new Set(shared)].slice(0, 3)) + "."
    if (view.edge.origin !== "inferred") return "One page references the other in the Garden."
    return "Breadboard found similar wording or ideas in the two pages."
  }

  function connectionMeta(view: EdgeView) {
    const edge = view.edge
    const cross = edge.relationType === "cross-garden-related" || edge.evidence.some(e => /^Cross-Garden match:/i.test(e.label))
    const gardenOf = (node: SimNode) => node.sectorId && gardenSpheres ? viewById.get(node.sectorId)?.node.title : payload.garden.title
    const recordedPair = edge.evidence.find(e => /^Cross-Garden match:/i.test(e.label))
      ?.label.replace(/^Cross-Garden match:\s*/i, "").trim()
    const sourceGarden = gardenOf(view.source.node)
    const targetGarden = gardenOf(view.target.node)
    const pair = cross ? (sourceGarden && targetGarden && sourceGarden !== targetGarden
      ? sourceGarden + " ↔ " + targetGarden : recordedPair) : ""
    return [relationLabel(edge.relationType), pair, view.kind === "semantic" ?
      affinityLabel(edge.score, edge.threshold) + " affinity · " + edge.score.toFixed(2) : ""].filter(Boolean).join(" · ")
  }

  function syncInspectorConnectionSelection() {
    if (!inspectorRoot) return
    for (const card of inspectorRoot.querySelectorAll<HTMLElement>(".thought-connection")) {
      const selected = card.dataset.edgeId === selectedEdgeId
      card.classList.toggle("selected", selected)
      card.setAttribute("aria-pressed", String(selected))
    }
  }

  function investigateNode(view: NodeView) {
    if (!context.onInvestigate) return
    const aggregate =
      context.scopeCluster === "private-library" || context.scopeCluster === "public-library"
    const nodeSlug =
      view.node.navigateSlug ??
      (view.node.kind === "garden"
        ? `garden:${context.scopeCluster}`
        : view.node.kind === "folder"
          ? aggregate
            ? view.node.folderPath
            : [context.scopeCluster, view.node.folderPath].filter(Boolean).join("/")
          : view.node.id)
    const selectedConnection = selectedEdgeId ? edgeById.get(selectedEdgeId) : undefined
    const connection =
      selectedConnection &&
      (selectedConnection.edge.source === view.node.id ||
        selectedConnection.edge.target === view.node.id)
        ? selectedConnection
        : undefined
    const prompt = connection
      ? [
          `Investigate the selected Thought Topology connection between “${connection.source.node.title}” (${connection.source.node.navigateSlug ?? connection.source.node.id}) and “${connection.target.node.title}” (${connection.target.node.navigateSlug ?? connection.target.node.id}).`,
          `Test the “${relationLabel(connection.edge.relationType)}” relationship against the relevant Garden notes and source evidence, explain what the connection means, and identify the most useful adjacent ideas to follow next.`,
        ].join(" ")
      : [
          `Investigate “${view.node.title}” (${nodeSlug}) through this Garden’s Thought Topology.`,
          "Traverse its strongest useful semantic and structural connections, open the relevant notes and source evidence, then explain what it connects to, why those connections matter, and which path is worth following next.",
        ].join(" ")
    context.onInvestigate({
      nodeSlug,
      nodeTitle: view.node.title,
      prompt,
    })
  }

  function renderNodeInspector(view: NodeView) {
    if (!inspectorContent) return
    const { node } = view
    const connections = visibleConnectionsFor(node.id)
    const semanticCount = connections.filter((connection) => connection.kind === "semantic").length
    const structuralCount = connections.length - semanticCount
    const header = element("header", "thought-inspector-header")
    header.append(element("p", "thought-kicker", "Node connections"))
    const title = element("h2")
    appendMathText(title, withoutEmptyLessonPagesNotice(node.title))
    header.append(title)
    if (node.kind !== "garden") {
      header.append(
        element(
          "p",
          "thought-breadcrumb",
          [plan.garden.title, node.folderTitle].filter(Boolean).join(" › "),
        ),
      )
    }
    if (activityText(node)) header.append(element("p","thought-breadcrumb",activityText(node)))
    const summaryText = withoutEmptyLessonPagesNotice(inspectorNodeSummary(node))
    if (summaryText) {
      const summary = element("p", "thought-summary")
      appendMathText(summary, summaryText)
      header.append(summary)
    }

    const connectionsSection = element("section", "thought-connections")
    connectionsSection.append(element("h3", undefined, "Visible connections"))
    connectionsSection.append(
      element(
        "p",
        "thought-note thought-connection-count",
        `${connections.length} under the current filters · ${semanticCount} semantic${
          settings.showHierarchy ? ` · ${structuralCount} structural` : ""
        }`,
      ),
    )
    const connectionList = element("div", "thought-connection-list")
    if (connections.length === 0) {
      connectionList.append(
        element(
          "p",
          "thought-connection-empty",
          "No connections are visible for this node with the current filters.",
        ),
      )
    } else {
      for (const connection of connections) {
        const other =
          connection.edge.source === node.id ? connection.target.node : connection.source.node
        const card = element("button", "thought-connection")
        card.type = "button"
        card.dataset.edgeId = connection.edge.id
        card.setAttribute("aria-pressed", String(selectedEdgeId === connection.edge.id))
        const cardHeading = element("span", "thought-connection-heading")
        const port = element("span", "thought-connection-port")
        port.dataset.kind = connection.kind
        const otherTitle = element("span", "thought-connection-title")
        appendMathText(otherTitle, other.title)
        cardHeading.append(port, otherTitle)
        const relation = element(
          "span",
          "thought-connection-relation",
          connectionMeta(connection),
        )
        const explanation = element("span", "thought-connection-explanation")
        appendMathText(explanation, inspectorConnectionExplanation(connection))
        card.append(cardHeading, relation, explanation)
        card.addEventListener("click", () => {
          selectedNodeId = node.id
          selectedEdgeId = connection.edge.id
          refreshStyles()
          syncFloatingCallout()
          syncInspectorConnectionSelection()
          emitGraphContext()
        })
        connectionList.append(card)
      }
    }
    connectionsSection.append(connectionList)

    const actions = element("div", "thought-inspector-actions")
    const aggregateRoot =
      node.kind === "garden" &&
      (context.scopeCluster === "private-library" || context.scopeCluster === "public-library")
    if (context.onInvestigate && !aggregateRoot) {
      const investigate = element(
        "button",
        "thought-action thought-action-primary",
        "Investigate with Bread",
      )
      investigate.type = "button"
      investigate.addEventListener("click", () => investigateNode(view))
      actions.append(investigate)
    }
    const open = element(
      "button",
      `thought-action${context.onInvestigate && !aggregateRoot ? "" : " thought-action-primary"}`,
      `Open ${node.kind === "page" ? "note" : node.kind}`,
    )
    open.type = "button"
    open.addEventListener("click", () => openNode(view))
    actions.append(open)

    inspectorContent.replaceChildren(header, connectionsSection, actions)
    syncInspectorConnectionSelection()
  }

  function hideNodeInspector() {
    inspectedNodeId = null
    inspectorRoot?.classList.remove("open")
    inspectorRoot?.setAttribute("aria-hidden", "true")
    obscureOverlayClose(false)
    invalidate()
  }

  function openNodeInspector(view: NodeView) {
    if (!inspectorRoot) return
    inspectedNodeId = view.node.id
    selectedNodeId = view.node.id
    selectedEdgeId = null
    renderNodeInspector(view)
    inspectorRoot.classList.add("open")
    inspectorRoot.setAttribute("aria-hidden", "false")
    obscureOverlayClose(true)
    refreshStyles()
    syncFloatingCallout()
    emitGraphContext()
    invalidate()
  }

  function refreshNodeInspector() {
    const inspected = inspectedNodeId ? viewById.get(inspectedNodeId) : undefined
    if (inspected) renderNodeInspector(inspected)
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

    let availableWidth = width
    let availableHeight = height
    if (inspectedNodeId && inspectorRoot) {
      if (inspectorRoot.offsetWidth < width - 1) availableWidth -= inspectorRoot.offsetWidth
      else availableHeight -= inspectorRoot.offsetHeight
    }
    calloutRoot.style.maxWidth = `${Math.max(0, availableWidth - 2 * padding)}px`
    const calloutWidth = calloutRoot.offsetWidth || 320
    const calloutHeight = calloutRoot.offsetHeight || 120
    let left = anchorX + offsetX
    if (offsetX < 0) left -= calloutWidth
    if (left + calloutWidth > availableWidth - padding) left = anchorX - calloutWidth - 18
    if (left < padding) left = anchorX + 18
    left = Math.max(padding, Math.min(availableWidth - calloutWidth - padding, left))
    let top = anchorY + offsetY - calloutHeight * 0.22
    top = Math.max(padding, Math.min(availableHeight - calloutHeight - padding, top))
    const target = floatingCalloutTarget
    const depth =
      target.kind === "node"
        ? projected(target.view.node).z
        : (projected(target.view.source.node).z + projected(target.view.target.node).z) / 2
    // The text belongs to the connection in space. Keep its plane facing the
    // reader enough to remain legible even after orbiting behind the graph.
    const tiltX = Math.sin(camera.pitch) * -18
    const tiltY = Math.sin(camera.yaw) * 24
    const scale = 1 + Math.max(-0.08, Math.min(0.08, depth / (depthSpread * 12)))
    // Reserve the projected corners too, so tilted text cannot leave the frame.
    const inset = Math.min(28, Math.max(0, (availableWidth - calloutWidth) / 2))
    left = Math.max(inset, Math.min(availableWidth - calloutWidth - inset, left))
    top = Math.max(20, Math.min(availableHeight - calloutHeight - 20, top))
    calloutRoot.style.transformOrigin = "50% 50%"
    calloutRoot.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0) perspective(900px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale(${scale})`
  }

  function syncFloatingCallout() {
    if (!calloutRoot) return
    // The right-side inspector owns the inspected node's persistent detail.
    // Its highlighted connections still expose their floating text on hover.
    const hoveredNode =
      hoveredNodeId && hoveredNodeId !== inspectedNodeId ? viewById.get(hoveredNodeId) : undefined
    const hoveredEdge = hoveredEdgeId && !(hoveredEdgeId === selectedEdgeId && inspectorRoot?.classList.contains("open")) ? edgeById.get(hoveredEdgeId) : undefined
    const selectedNode =
      selectedNodeId && selectedNodeId !== inspectedNodeId
        ? viewById.get(selectedNodeId)
        : undefined
    const selectedEdge =
      selectedEdgeId && !inspectorRoot?.classList.contains("open") ? edgeById.get(selectedEdgeId) : undefined
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
    hideNodeInspector()
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
    inspectedNodeId = null
    selectedEdgeId = view.edge.id
    selectedNodeId = null
    if (inspectorContent && inspectorRoot) {
      const header = element("header", "thought-inspector-header")
      const title = element("h2")
      const endpoint = (end: NodeView) => {
        const button = element("button","map-endpoint")
        button.type = "button"; appendMathText(button,end.node.title)
        button.title = "Inspect " + end.node.title
        button.onclick = () => openNodeInspector(end)
        return button
      }
      title.append(endpoint(view.source),document.createTextNode(view.kind === "hierarchy" ? " → " : " ↔ "),endpoint(view.target))
      const summary = element("p", "thought-summary")
      appendMathText(summary, inspectorConnectionExplanation(view))
      header.append(element("p", "thought-kicker", "Connection"), title, element("p", "thought-breadcrumb", connectionMeta(view)), summary)
      inspectorContent.replaceChildren(header)
      inspectorRoot.classList.add("open")
      inspectorRoot.setAttribute("aria-hidden", "false")
    }
    refreshStyles()
    syncFloatingCallout()
    emitGraphContext()
  }

  function clearSelection() {
    if (
      selectedNodeId === null &&
      selectedEdgeId === null &&
      inspectedNodeId === null &&
      !calloutVisible
    )
      return
    hideNodeInspector()
    selectedNodeId = null
    selectedEdgeId = null
    refreshStyles()
    syncFloatingCallout()
    emitGraphContext()
  }

  const handleInspectorClose = () => clearSelection()
  const handleInspectorKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && (inspectedNodeId || selectedEdgeId)) clearSelection()
  }
  inspectorClose?.addEventListener("click", handleInspectorClose)
  window.addEventListener("keydown", handleInspectorKeydown)
  cleanups.push(() => {
    inspectorClose?.removeEventListener("click", handleInspectorClose)
    window.removeEventListener("keydown", handleInspectorKeydown)
  })

  let lastRightClick: { nodeId: string; at: number } | null = null

  function openNode(view: NodeView) {
    if (openTopologyChat(view.node.id, view.node.navigateSlug)) return
    const rawSlug =
      view.node.navigateSlug ??
      (view.node.kind === "garden" || view.node.folderPath === ""
        ? gardenSlug
        : view.node.kind === "folder"
          ? `${gardenSlug}/${view.node.folderPath}`
          : undefined)
    if (!rawSlug) return
    // Payload slugs keep the raw folder and file names; Quartz publishes them
    // slugified, and the static server answers the raw form with its
    // "garden is being prepared" 404.
    const targetSlug = topologyNavigationSlug(rawSlug)
    if (context.onNavigate) {
      context.onNavigate(view.node.id, targetSlug)
      return
    }
    const target = resolveRelative(fullSlug, targetSlug as SimpleSlug)
    ;(window as typeof window & { spaNavigate: (url: URL) => void }).spaNavigate(
      new URL(target, window.location.toString()),
    )
  }

  /** Lock a node where it currently sits; the position persists per Garden. */
  function pinNode(view: NodeView) {
    const node = view.node
    const position = { x: node.x, y: node.y, z: node.z }
    const positions = readStoredPositions(positionScope)
    positions[node.id] = position
    homePositions.set(node.id, position)
    permanentHomeIds.add(node.id)
    returnTargets.delete(node.id)
    returningNodeIds.delete(node.id)
    node.fx = position.x
    node.fy = position.y
    node.fz = position.z
    homeXForce.x(homeXForNode)
    homeYForce.y(homeYForNode)
    writeStoredPositions(positionScope, positions)
    refreshNodeInspector()
    invalidate()
    emitGraphContext()
  }

  /** Release a pinned node so it drifts back to its planned home. */
  function releaseNode(view: NodeView) {
    const node = view.node
    const positions = readStoredPositions(positionScope)
    delete positions[node.id]
    writeStoredPositions(positionScope, positions)
    permanentHomeIds.delete(node.id)
    const home = plannedHome(node.id)
    if (home) homePositions.set(node.id, home)
    node.fx = null
    node.fy = null
    node.fz = null
    homeXForce.x(homeXForNode)
    homeYForce.y(homeYForNode)
    if (reducedMotion) {
      if (home) {
        node.x = home.x
        node.y = home.y
        node.z = home.z
        if (isHomeFixed(node)) {
          node.fx = home.x
          node.fy = home.y
          node.fz = home.z
        }
      }
    } else {
      if (node.kind === "garden" && home) {
        returnTargets.set(node.id, { ...home, pin: true })
        returningNodeIds.add(node.id)
      }
      simulationSettled = false
      simulation.alpha(Math.max(simulation.alpha(), 0.25)).restart()
    }
    refreshNodeInspector()
    invalidate()
    emitGraphContext()
  }

  /**
   * A right click opens the node's filtered connection drawer. A quick second
   * right click toggles whether the node is fixed to the board.
   */
  function handleRightNodeClick(view: NodeView) {
    const now = performance.now()
    const doubleClick =
      lastRightClick?.nodeId === view.node.id && now - lastRightClick.at <= RIGHT_DOUBLE_CLICK_MS
    openNodeInspector(view)
    if (doubleClick) {
      lastRightClick = null
      if (permanentHomeIds.has(view.node.id)) releaseNode(view)
      else pinNode(view)
      return
    }
    lastRightClick = { nodeId: view.node.id, at: now }
  }

  const accents = new Graphics({ eventMode: "none", zIndex: 4 })
  stage.addChild(accents)
  const resultNodes = new Set<string>(), resultEdges = new Map<string, EdgeView>()
  let answerPulseUntil = 0
  const freshNodes = new Set<string>(), freshEdges = new Set<string>()
  const now = Date.now()
  let history = activitySeenByHost.get(graph)
  if (!history || history.slug !== payload.garden.slug) {
    history = { slug: payload.garden.slug, seen: new Map() }
    activitySeenByHost.set(graph, history)
  }
  const seen = history.seen
  function arrived(id: string, at: number | undefined) {
    const previous = seen.get(id)
    const latest = at && at <= now ? at : 0
    seen.set(id, Math.max(previous ?? 0, latest))
    return latest > (previous ?? 0) && now - latest < (previous === undefined ? 60_000 : 7 * 86_400_000)
  }
  for (const n of payload.nodes) {
    if (arrived(n.id, Math.max(0, ...(n.activityTimes ?? []))) && viewById.has(n.id)) freshNodes.add(n.id)
  }
  for (const e of payload.edges) {
    if (!arrived(e.id,e.changedAt) || !edgeById.has(e.id)) continue
    freshEdges.add(e.id)
    freshNodes.add(e.source)
    freshNodes.add(e.target)
  }
  const arrivalPulseUntil = freshNodes.size || freshEdges.size ? performance.now() + 1600 : 0
  function drawAccents(time: number) {
    accents.clear()
    const waveAt = (until: number) => time < until && !reducedMotion ? (1 + Math.cos((until - time) / 140)) / 2 : .6
    const answerWave = waveAt(answerPulseUntil), arrivalWave = waveAt(arrivalPulseUntil)
    const drawLine = (e: EdgeView, wave: number) => {
      const a = screenOf(e.source.node), b = screenOf(e.target.node)
      accents.moveTo(a.x,a.y).lineTo(b.x,b.y).stroke({width:1.3+wave*.9,color:colors.text,alpha:.55+.4*wave})
    }
    for (const edge of resultEdges.values()) drawLine(edge, answerWave)
    if (time < arrivalPulseUntil) for (const id of freshEdges) {
      const edge = edgeById.get(id)
      if (edge && !resultEdges.has(id)) drawLine(edge, arrivalWave)
    }
    const ring = (id: string, wave: number) => {
      const v=viewById.get(id); if (!v) return
      const p=screenOf(v.node)
      accents.circle(p.x,p.y,6 + wave*3).stroke({width:1.7,color:tone(v.node),alpha:.85})
    }
    if (settings.activity !== "off") {
      for (const [id, count] of counts) {
        const view = viewById.get(id)
        if (!view) continue
        const p = screenOf(view.node)
        accents.circle(p.x,p.y,screenRadius(view.node)+2+Math.min(4,Math.log2(count)))
          .stroke({width:1,color:tone(view.node),alpha:.55})
      }
    }
    for (const id of permanentHomeIds) if (!resultNodes.has(id)) ring(id, .6)
    for (const id of resultNodes) ring(id, answerWave)
    if (time < arrivalPulseUntil) for (const id of freshNodes) if (!resultNodes.has(id)) ring(id, arrivalWave)
    return time < arrivalPulseUntil || (!reducedMotion && time < answerPulseUntil)
  }
  if (interactive && !preview && outer && outer.dataset.graphSurface !== "garden") {
    const host = element("div","map-assistant")
    const toggle = element("button","map-assistant-toggle","Assistant")
    toggle.type = "button"; toggle.setAttribute("aria-expanded","false")
    const panel = element("section","map-assistant-panel")
    panel.hidden = true; panel.setAttribute("aria-label","Knowledge assistant")
    const header = element("header","map-filter-header")
    const dismiss = element("button","thought-topology-filter-link","Close")
    header.append(element("strong",undefined,"Knowledge assistant"),dismiss)
    const messages = element("div","map-assistant-messages")
    messages.setAttribute("aria-live","polite")
    const purpose = element("p","map-assistant-purpose","Ask how nodes are connected. I’ll highlight the nodes and links behind each answer.")
    const form = element("form","map-assistant-compose")
    const input = element("input"); input.placeholder = "Ask about this map…"; input.setAttribute("aria-label","Ask about connections")
    const send = element("button",undefined,"Ask"); send.type = "submit"; form.append(input,send)
    const defaultPrompt = gardenSpheres && plan.edges.some(edge => edge.crossFolder) ?
      "Find connections across Gardens" : "Show strongest connections"
    const explore = element("button","map-assistant-prompt",defaultPrompt)
    panel.append(header,purpose,messages,explore,form); host.append(panel,toggle); outer.append(host)
    const setOpen = (open: boolean) => {
      panel.hidden = !open; toggle.setAttribute("aria-expanded",String(open))
      if (open) {
        explore.textContent = selectedNodeId ? "Find connections to this node" :
          selectedEdgeId ? "Explain this connection" : defaultPrompt
        input.focus()
      } else toggle.focus()
    }
    toggle.onclick = () => setOpen(panel.hidden); dismiss.onclick = () => setOpen(false)
    panel.onkeydown = e => { if(e.key==="Escape") { e.stopPropagation(); setOpen(false) } }
    let eligible: PlannedEdge[] | undefined
    function highlight(edges: EdgeView[], nodes: string[] = []) {
      resultNodes.clear(); resultEdges.clear()
      for (const id of nodes) resultNodes.add(id)
      for (const edge of edges) {
        resultEdges.set(edge.edge.id,edge); resultNodes.add(edge.edge.source); resultNodes.add(edge.edge.target)
      }
      if (resultNodes.size) {
        const points = [...resultNodes].map(id => projected(viewById.get(id)!.node))
        const bounds = boundsOf(points, 56)
        const insets = currentInsets()
        if (inspectorRoot?.classList.contains("open")) insets.left += Math.min(width * .4, inspectorRoot.offsetWidth)
        if (!panel.hidden && width > 650) insets.right += Math.min(width * .38, panel.offsetWidth)
        const next = fitTransform(bounds, {width, height}, insets, {minScale: .01, maxScale: Math.max(fitK, Math.min(1.45, transform.k * 1.45))})
        viewState = "focus"
        applyTransform(next, true)
      }
      answerPulseUntil = resultNodes.size && !reducedMotion ? performance.now() + 2200 : 0
      invalidate()
    }
    form.onsubmit = e => {
      e.preventDefault()
      const q=input.value.trim(); if(!q) return
      purpose.hidden = true
      eligible ??= planThoughtTopology(payload,{...planOptions,maxConnectionsPerNode:0}).edges
        .filter(edge => viewById.has(edge.source) && viewById.has(edge.target))
      const found = answerMapQuestion(plan.nodes, eligible, q, {
        selectedNodeId,
        selectedEdge: selectedEdgeId ? edgeById.get(selectedEdgeId)?.edge :
          !selectedNodeId && resultEdges.size === 1 ? resultEdges.values().next().value?.edge : undefined,
        multipleGardens: gardenSpheres,
        visibleConnectionCount: shaderEdges.length,
      })
      if (found.nodes.length || found.edges.length) clearSelection()
      const hits = found.edges.map(edge => edgeById.get(edge.id) ?? ({
        edge,kind:"semantic",source:viewById.get(edge.source)!,target:viewById.get(edge.target)!,
        alpha:1,alphaTarget:1,color:colors.edgeActive,restColor:colors.edgeActive,widthBoost:0,selected:false,
      } as EdgeView))
      messages.replaceChildren(element("p","map-question",q))
      const answer = element("p","map-answer")
      appendMathText(answer, found.text)
      messages.append(answer)
      highlight(hits, found.nodes.map(node => node.id))
      for (const node of found.nodes) {
        const button = element("button", "map-source", node.title)
        button.type = "button"
        button.onclick = () => { setOpen(false); openNodeInspector(viewById.get(node.id)!); highlight([], [node.id]) }
        messages.append(button)
      }
      for (const hit of hits) {
        const button = element("button","map-source")
        button.type = "button"
        const arrow = hit.kind === "hierarchy" || hit.edge.direction === "directed" ? " → " : " ↔ "
        button.append(element("strong",undefined,hit.source.node.title+arrow+hit.target.node.title),
          element("small",undefined,connectionMeta(hit)),element("span",undefined,inspectorConnectionExplanation(hit)))
        button.onclick = () => { setOpen(false); edgeById.set(hit.edge.id,hit); selectEdge(hit); highlight([hit]) }
        messages.append(button)
      }
      if (resultNodes.size) {
        const clear = element("button","thought-topology-filter-link","Clear highlights")
        clear.onclick = () => { highlight([]); clear.remove() }; messages.append(clear)
      }
      input.value=""; messages.scrollTop=0
    }
    explore.onclick = () => { input.value = explore.textContent ?? defaultPrompt; form.requestSubmit() }
    onCleanup(() => host.remove())
  }

  // --- Pointer interactions ------------------------------------------------
  if (interactive) {
    let hoverFrame = 0
    let lastPoint: { x: number; y: number } | null = null
    const updateHover = () => {
      hoverFrame = 0
      const node = lastPoint ? nodeAtScreenPoint(lastPoint.x, lastPoint.y) : undefined
      const edge = lastPoint && !node ? edgeAt(lastPoint.x, lastPoint.y) : undefined
      if (hoveredNodeId === (node?.node.id ?? null) && hoveredEdgeId === (edge?.edge.id ?? null)) return
      hoveredNodeId = node?.node.id ?? null
      hoveredEdgeId = edge?.edge.id ?? null
      refreshStyles(); syncFloatingCallout()
    }
    const hover = (e: PointerEvent) => {
      if (e.buttons) return
      lastPoint = canvasPoint(e)
      if (!hoverFrame) hoverFrame = requestAnimationFrame(updateHover)
    }
    const leave = () => { lastPoint = null; updateHover() }
    let press: { x: number; y: number } | null = null
    const down = (e: PointerEvent) => { press = e.button === 0 ? canvasPoint(e) : null }
    const up = (e: PointerEvent) => {
      const p = canvasPoint(e), start = press
      press = null
      if (!start || Math.hypot(p.x-start.x,p.y-start.y) > CLICK_SLOP_PX || nodeAtScreenPoint(p.x,p.y)) return
      const edge = edgeAt(p.x,p.y)
      if (edge) { hoveredEdgeId = edge.edge.id; selectEdge(edge) }
    }
    app.canvas.addEventListener("pointermove",hover)
    app.canvas.addEventListener("pointerleave",leave)
    app.canvas.addEventListener("pointerdown",down)
    app.canvas.addEventListener("pointerup",up)
    cleanups.push(() => {
      cancelAnimationFrame(hoverFrame)
      app.canvas.removeEventListener("pointermove",hover); app.canvas.removeEventListener("pointerleave",leave)
      app.canvas.removeEventListener("pointerdown",down); app.canvas.removeEventListener("pointerup",up)
    })

    const handleContextMenu = (event: MouseEvent) => {
      const point = canvasPoint(event)
      if (nodeAtScreenPoint(point.x, point.y) || hoveredEdgeId !== null) event.preventDefault()
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
          z: number
          fz: number | null | undefined
          fx: number | null | undefined
          fy: number | null | undefined
        }>
      }
      let dragState: DragState | null = null
      let nextDragIsPermanent = false
      canvasSelection.call(
        drag<HTMLCanvasElement, unknown>()
          .filter((event) => {
            const accepted =
              !event.ctrlKey &&
              (event.type === "touchstart" || event.button === 0 || event.button === 2)
            if (accepted) nextDragIsPermanent = event.button === 2
            return accepted
          })
          .container(() => app.canvas)
          .subject((event) => {
            const view = nodeAtScreenPoint(event.x, event.y)
            if (view && hoveredEdgeId !== null && hoveredNodeId === null) {
              const position = screenOf(view.node)
              const visualRadius = Math.max(6, screenRadius(view.node) + 3)
              if (Math.hypot(event.x - position.x, event.y - position.y) > visualRadius) {
                return undefined as unknown as object
              }
            }
            return view ? { x: event.x, y: event.y, view } : (undefined as unknown as object)
          })
          .on("start", (event) => {
            const view = (event.subject as { view: NodeView }).view
            const source = event.sourceEvent as MouseEvent | undefined
            const permanent =
              nextDragIsPermanent || source?.button === 2 || Boolean((source?.buttons ?? 0) & 2)
            nextDragIsPermanent = false
            if (!event.active && !reducedMotion && !largeMap) simulation.alphaTarget(1).restart()
            simulationSettled = false
            draggingNode = true
            activeDragNodeId = view.node.id
            userMovedView = true
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
                  z: view.node.z,
                  fz: view.node.fz,
                  fx: view.node.fx,
                  fy: view.node.fy,
                },
              ],
            }
            view.node.fx = view.node.x
            view.node.fy = view.node.y
            view.node.fz = view.node.z
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
            const delta = camera.unproject({ x: dx, y: dy, z: 0 })
            for (const member of dragState.members) {
              const x = member.x + delta.x
              const y = member.y + delta.y
              const z = member.z + delta.z
              member.view.node.x = x
              member.view.node.y = y
              member.view.node.z = z
              member.view.node.fz = z
              member.view.node.fx = x
              member.view.node.fy = y
            }
            invalidate()
          })
          .on("end", (event) => {
            if (!dragState) return
            const state = dragState
            dragState = null
            draggingNode = false
            activeDragNodeId = null
            if (!event.active && !reducedMotion) simulation.alphaTarget(0)
            if (reducedMotion || largeMap) { simulationSettled = true; positionsDirty = true }
            if (state.moved <= CLICK_SLOP_PX) {
              for (const member of state.members) {
                const home = homePositions.get(member.view.node.id)
                if (isHomeFixed(member.view.node) && home) {
                  member.view.node.fx = home.x
                  member.view.node.fy = home.y
                  member.view.node.fz = home.z
                } else {
                  member.view.node.fx = member.fx
                  member.view.node.fy = member.fy
                  member.view.node.fz = member.fz
                }
              }
              // A quiet left click opens the page (or folder). A quiet right
              // click opens its connection drawer; a second toggles its fix.
              if (state.permanent) handleRightNodeClick(state.view)
              else openNodeInspector(state.view)
              return
            }
            lastRightClick = null
            if (state.members.length === 0) return
            if (state.permanent) {
              const positions = readStoredPositions(positionScope)
              for (const member of state.members) {
                const position = {
                  x: member.view.node.x,
                  y: member.view.node.y,
                  z: member.view.node.z,
                }
                homePositions.set(member.view.node.id, position)
                positions[member.view.node.id] = position
                permanentHomeIds.add(member.view.node.id)
                returnTargets.delete(member.view.node.id)
                returningNodeIds.delete(member.view.node.id)
                member.view.node.fx = position.x
                member.view.node.fy = position.y
                member.view.node.fz = position.z
              }
              homeXForce.x(homeXForNode)
              homeYForce.y(homeYForNode)
              writeStoredPositions(positionScope, positions)
              refreshNodeInspector()
              invalidate()
              emitGraphContext()
              return
            }
            let homeForceChanged = false
            for (const member of state.members) {
              const home = homePositions.get(member.view.node.id)
              if (!home) continue
              if (reducedMotion || largeMap) {
                member.view.node.x = home.x
                member.view.node.y = home.y
                member.view.node.z = home.z
                member.view.node.fx = isHomeFixed(member.view.node) ? home.x : null
                member.view.node.fy = isHomeFixed(member.view.node) ? home.y : null
                member.view.node.fz = isHomeFixed(member.view.node) ? home.z : null
              } else {
                member.view.node.fx = null
                member.view.node.fy = null
                member.view.node.fz = null
                const pin = isHomeFixed(member.view.node)
                const target = pin ? home : { x: member.x, y: member.y, z: member.z }
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
            invalidate()
            emitGraphContext()
            void event
          }),
      )
    } else {
      for (const view of views)
        view.gfx.on("pointertap", (event) =>
          event.button === 2 ? handleRightNodeClick(view) : openNodeInspector(view),
        )
    }

    if (config.zoom) {
      // Keep d3 wheel/pinch zoom and Shift/middle-button panning. Ordinary
      // background drags orbit; node drags above still own their usual gestures.
      zoomBehavior.filter(
        (event) =>
          event.type === "wheel" ||
          (event.type === "touchstart" && event.touches.length > 1) ||
          (event.type === "mousedown" && (event.shiftKey || event.button === 1)),
      )
      canvasSelection.call(zoomBehavior).on("dblclick.zoom", null)
    }
    if (config.drag) {
      let orbit: {
        id: number
        x: number
        y: number
        startX: number
        startY: number
        moved: boolean
      } | null = null
      const startOrbit = (event: PointerEvent) => {
        if (orbit && orbit.id !== event.pointerId) {
          orbit = null
          return
        }
        if (event.button !== 0 || event.shiftKey || event.ctrlKey) return
        const point = canvasPoint(event)
        if (nodeAtScreenPoint(point.x, point.y)) return
        orbit = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
        }
      }
      const moveOrbit = (event: PointerEvent) => {
        if (!orbit || orbit.id !== event.pointerId || draggingNode) return
        if (
          !orbit.moved &&
          Math.hypot(event.clientX - orbit.startX, event.clientY - orbit.startY) <= CLICK_SLOP_PX
        )
          return
        if (!orbit.moved) {
          canvasSelection.interrupt()
          transitioning = false
          hoveredNodeId = null
          hoveredEdgeId = null
          refreshStyles()
          syncFloatingCallout()
        }
        orbit.moved = true
        camera.orbit(event.clientX - orbit.x, event.clientY - orbit.y)
        orbit.x = event.clientX
        orbit.y = event.clientY
        userMovedView = true
        viewState = "user"
        invalidate()
        emitGraphContext()
      }
      const endOrbit = () => {
        orbit = null
      }
      app.canvas.addEventListener("pointerdown", startOrbit)
      window.addEventListener("pointermove", moveOrbit)
      window.addEventListener("pointerup", endOrbit)
      window.addEventListener("pointercancel", endOrbit)
      window.addEventListener("blur", endOrbit)
      cleanups.push(() => {
        app.canvas.removeEventListener("pointerdown", startOrbit)
        window.removeEventListener("pointermove", moveOrbit)
        window.removeEventListener("pointerup", endOrbit)
        window.removeEventListener("pointercancel", endOrbit)
        window.removeEventListener("blur", endOrbit)
      })
    }

    // A quiet click on empty canvas clears the selection. Drags and pans do not.
    let backgroundPress: { x: number; y: number; onTarget: boolean } | null = null
    const onPointerDown = (event: PointerEvent) => {
      const point = canvasPoint(event)
      backgroundPress = {
        x: event.clientX,
        y: event.clientY,
        onTarget:
          Boolean(nodeAtScreenPoint(point.x, point.y)) ||
          hoveredNodeId !== null ||
          hoveredEdgeId !== null,
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
  onCleanup(() => {
    graph.removeEventListener("graph-search", handleGraphSearch)
    graph.removeEventListener("graph-search-commit", handleGraphSearchCommit)
  })
  if (graph.dataset.searchQuery) updateSearch(graph.dataset.searchQuery)

  // --- Context for the dashboard assistant ---------------------------------
  function emitGraphContext() {
    const selectedEdge = selectedEdgeId ? edgeById.get(selectedEdgeId) : undefined
    const selectedNode = selectedNodeId ? viewById.get(selectedNodeId)?.node : undefined
    const directNeighborSlugs = selectedNode
      ? [...(neighbours.get(selectedNode.id) ?? [])]
          .map((id) => viewById.get(id)?.node)
          .filter((node): node is SimNode => Boolean(node))
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
            explanation: inspectorConnectionExplanation(selectedEdge),
          }
        : null,
      visibleNodeSlugs: plan.nodes.slice(0, 24).map((node) => node.navigateSlug ?? node.id),
      directNeighborSlugs,
      activeCluster: context.scopeCluster,
      filters: searchQuery ? [searchQuery] : [],
      depth: context.configuredDepth < 0 ? 3 : context.configuredDepth,
      relationshipTypes: selectedEdge ? [selectedEdge.edge.relationType] : ["semantic-affinity"],
      dimension: "3d",
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
          shaders.resize(width, height)
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
          invalidate()
        })
  resizeObserver?.observe(graph)
  onCleanup(() => resizeObserver?.disconnect())

  // --- Frame loop ----------------------------------------------------------
  const lerp = (current: number, target: number) =>
    Math.abs(target - current) < 0.01 ? target : current + (target - current) * 0.22

  // Pixi triangulates/uploads each shape the first time it is drawn. Creating
  // objects in batches alone does not prevent that first GPU upload spike.
  let revealedNodes = largeMap ? 0 : views.length
  let revealedEdges = largeMap ? 0 : connectionViews.length
  function animate(time: number): boolean {
    if (stopAnimation) return false
    if (labelsDirty) updateLabels()
    let fading = false
    revealedNodes = Math.min(views.length, revealedNodes + INITIAL_NODE_BATCH)
    revealedEdges = Math.min(connectionViews.length, revealedEdges + INITIAL_EDGE_BATCH)
    const sceneReady = revealedNodes === views.length && revealedEdges === connectionViews.length
    const inverseScale = 1 / Math.sqrt(transform.k)
    plates.clear()
    for (let index = 0; index < revealedNodes; index++) {
      const view = views[index]
      const { node } = view
      view.gfx.visible = true
      view.gfx.position.set(worldX(node), worldY(node))
      view.gfx.zIndex = node.kind === "page" ? 0 : 1
      view.gfx.scale.set(inverseScale, inverseScale)
      view.alpha = lerp(view.alpha, view.alphaTarget)
      view.gfx.alpha = view.alpha
      view.labelAlpha = lerp(view.labelAlpha, view.labelTarget)
      fading ||= view.alpha !== view.alphaTarget || view.labelAlpha !== view.labelTarget
      const placement = view.placement
      if (placement && view.labelAlpha > 0.02) {
        const position = screenOf(node)
        view.label.visible = true
        view.label.alpha = view.labelAlpha
        view.label.anchor.set(placement.anchorX, placement.anchorY)
        view.label.position.set(position.x + placement.dx, position.y + placement.dy)
        const label = view.label, w = label.width, h = label.height
        const left = Math.round(label.x-w*placement.anchorX-4)+.5
        const top = Math.round(label.y-h*placement.anchorY-2)+.5
        if (isDark) plates.rect(left,top,w+8,h+4)
        else plates.roundRect(left,top,w+8,h+4,4)
        plates.fill({color:colors.paper,alpha:view.labelAlpha})
          .stroke({color:isDark ? colors.text : labelBorders[toneOf(node)],alpha:view.labelAlpha,width:1})
        // Wrapped lines align towards the dot they belong to.
        const align =
          placement.side === "left" ? "right" : placement.side === "right" ? "left" : "center"
        if (view.label.style.align !== align) view.label.style.align = align
      } else {
        view.label.visible = false
      }
    }
    if (!simulationSettled || draggingNode || positionsDirty) {
      shaders.updatePositions(shaderNodes, shaderEdges)
      positionsDirty = false
    }
    const pulsing = drawAccents(time)
    positionFloatingCallout()
    if (debugEnabled) {
      const debugWindow = window as Window & { __breadboardThoughtTopologyDebug?: unknown }
      debugWindow.__breadboardThoughtTopologyDebug = {
        dimension: "3d",
        sceneReady,
        spinning: false,
        camera: { yaw: camera.yaw, pitch: camera.pitch },
        selectedConnectionId: selectedEdgeId,
        highlightedNodes: [...resultNodes],
        highlightedEdges: [...resultEdges.keys()],
        answerPulseActive: time < answerPulseUntil,
        freshNodeCount: freshNodes.size,
        freshEdgeCount: freshEdges.size,
        selectedNodeId,
        inspectedNodeId,
        inspectorOpen: inspectorRoot?.classList.contains("open") ?? false,
        hoveredNodeId,
        activeDragNodeId,
        returningNodeIds: [...returningNodeIds],
        permanentNodeIds: [...permanentHomeIds],
        viewState,
        viewSettled: sceneReady && !transitioning && (simulationSettled || draggingNode),
        simulationSettled,
        calloutVisible,
        compactSidebar,
        visibleLayers: {
          nodes: nodeLayer.visible,
          connections: linkLayer.visible,
          hierarchy: hierarchyLayer.visible,
        },
        transform: { k: transform.k, x: transform.x, y: transform.y },
        labels: Object.fromEntries(
          views.filter((view) => view.label.visible).map((view) => [view.node.id, view.label.text]),
        ),
        nodes: Object.fromEntries(views.map((view) => [view.node.id, screenOf(view.node)])),
        worldNodes: Object.fromEntries(
          views.map((view) => [view.node.id, { x: view.node.x, y: view.node.y, z: view.node.z }]),
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
                opacity: view.edge.opacity,
                strength: view.edge.strength,
                restColor: view.restColor,
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
                opacity: view.edge.opacity,
                strength: view.edge.strength,
                restColor: view.restColor,
                renderedWidth: view.selected
                  ? view.edge.width + view.widthBoost + 1.2
                  : view.edge.width + view.widthBoost,
              },
            ]
          }),
        ),
      }
    }
    try {
      const picked = hoveredEdgeId ?? hoveredNodeId ?? selectedEdgeId ?? selectedNodeId
      shaders.draw(camera, {x: 0, y: 0}, {
        x: transform.x + (transform.k - 1) * width / 2,
        y: transform.y + (transform.k - 1) * height / 2,
      }, fitK, transform.k / fitK, picked === null ? null : { id: picked }, shaderColors, shaderInk)
      app.renderer.resetState()
      app.renderer.render({ container: stage, clear: false })
    } catch {
      invalidateRenderer()
      return false
    }
    return !sceneReady || fading || transitioning || pulsing
  }

  renderLoop = new GraphRenderLoop(animate)
  let intersecting = false
  const updateVisibility = () => {
    const visible = !document.hidden && intersecting && !stopAnimation
    renderLoop?.setActive(visible)
    if (visible) {
      if (!simulationSettled) simulation.restart()
      invalidate()
    } else {
      simulation.stop()
    }
  }
  // A hidden tab or an offscreen preview must not keep its graphics or
  // layout simulation running. Intersection also handles collapsed overlays.
  const rect = graph.getBoundingClientRect()
  intersecting = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 &&
    rect.top < window.innerHeight && rect.left < window.innerWidth
  const intersectionObserver = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
    intersecting = entries.some(entry => entry.isIntersecting)
    updateVisibility()
  })
  intersectionObserver?.observe(graph)
  document.addEventListener("visibilitychange", updateVisibility)
  onCleanup(() => {
    intersectionObserver?.disconnect()
    document.removeEventListener("visibilitychange", updateVisibility)
    canvasSelection.interrupt()
  })
  updateVisibility()
  graph.dataset.mapReady = "true"
  onCleanup(() => { if (!graph.querySelector("canvas")) delete graph.dataset.mapReady })
  refreshStyles()
  fitView(false, !simulationSettled)
  emitGraphContext()
  renderLoop.invalidate()

  const cleanup = () => {
    stopAnimation = true
    hideCallout()
    if (calloutRoot) {
      calloutRoot.style.removeProperty("transform-origin")
      calloutRoot.style.removeProperty("transform")
    }
    obscureOverlayClose(false)
    inspectorRoot?.remove()
    const hasReplacementCanvas = graph.querySelectorAll(":scope > canvas").length > 1
    if (!hasReplacementCanvas) {
      if (graphRoot && graphRoot.dataset.activeMode === "thought-topology")
        delete graphRoot.dataset.activeMode
      if (heading) heading.hidden = true
    }
  }
  onCleanup(cleanup)
  return {
    cleanup,
    folderOptions: plan.folderOptions,
    visiblePageCount: plan.visiblePageCount,
    totalPageCount: plan.totalPageCount,
    connectionCount: plan.edges.length + (settings.showHierarchy ? plan.hierarchyEdges.length : 0),
  }
}
