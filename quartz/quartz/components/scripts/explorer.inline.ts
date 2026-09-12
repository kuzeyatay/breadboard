import { FileTrieNode } from "../../util/fileTrie"
import {
  gardenClusterFoldersFromJson,
  groupGardenExplorerNodes,
  isVirtualGardenClusterNode,
} from "../../util/gardenExplorerGroups"
import { isVisibleGardenRootEntry } from "../../util/explorerScope"
import { FilePath, FullSlug, resolveRelative, simplifySlug, slugifyFilePath } from "../../util/path"
import { ContentDetails } from "../../plugins/emitters/contentIndex"
import { TOPOLOGY_SOURCE_COLORS, topologySourceKind } from "./sourceNodeVisual"

type MaybeHTMLElement = HTMLElement | undefined

interface ParsedOptions {
  folderClickBehavior: "collapse" | "link"
  folderDefaultState: "collapsed" | "open"
  useSavedState: boolean
  sortFn: (a: FileTrieNode, b: FileTrieNode) => number
  filterFn: (node: FileTrieNode) => boolean
  mapFn: (node: FileTrieNode) => void
  order: "sort" | "filter" | "map"[]
}

type FolderState = {
  path: string
  collapsed: boolean
}

const DEFAULT_FLAG_COLOR = "#facc15"
const FLAG_COLORS = [
  DEFAULT_FLAG_COLOR,
  "#fb7185",
  "#f97316",
  "#22c55e",
  "#14b8a6",
  "#38bdf8",
  "#60a5fa",
  "#a78bfa",
  "#f472b6",
  "#a3e635",
]
const GENERATED_GARDEN_ROOTS = new Set([
  "private-library",
  "public-library",
  "private-quartz",
  "public-quartz",
])
const NON_GARDEN_ROOTS = new Set(["tags", "static", "index", "404"])
const GARDEN_TITLE_MARQUEE_DELAY_MS = 350
const GARDEN_TITLE_MARQUEE_SPEED_PX_PER_SEC = 42
/** Share of the animation spent travelling one way; the rest is the pause at each end. */
const GARDEN_TITLE_MARQUEE_TRAVEL_SHARE = 0.36

function bindGardenTitleMarquee(trigger: HTMLElement, title: HTMLElement, signal: AbortSignal) {
  const hoverQuery = window.matchMedia("(hover: hover) and (pointer: fine)")
  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
  let timer: number | null = null

  const stop = () => {
    if (timer !== null) {
      window.clearTimeout(timer)
      timer = null
    }
    title.removeAttribute("data-marquee")
    title.style.removeProperty("--bb-marquee-distance")
    title.style.removeProperty("--bb-marquee-duration")
  }

  const start = () => {
    if (!hoverQuery.matches || reducedMotionQuery.matches || timer !== null) return
    timer = window.setTimeout(() => {
      timer = null
      const distance = title.scrollWidth - title.clientWidth
      if (distance < 2) return

      const duration =
        distance / GARDEN_TITLE_MARQUEE_SPEED_PX_PER_SEC / GARDEN_TITLE_MARQUEE_TRAVEL_SHARE
      title.style.setProperty("--bb-marquee-distance", `${distance}px`)
      title.style.setProperty("--bb-marquee-duration", `${duration.toFixed(2)}s`)
      title.dataset.marquee = "run"
    }, GARDEN_TITLE_MARQUEE_DELAY_MS)
  }

  trigger.addEventListener("mouseenter", start, { signal })
  trigger.addEventListener("mouseleave", stop, { signal })
  signal.addEventListener("abort", stop, { once: true })
}

function parseJsonArray(value: string | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.length > 0)
      : []
  } catch {
    return []
  }
}

function currentClusterFromUrl(): string {
  const parts = window.location.pathname.replace(/^\//, "").split("/").filter(Boolean)
  return parts[0] ?? ""
}

function gardenExplorerClusters(explorer: HTMLElement): string[] | null {
  const allowedClusters = parseJsonArray(explorer.dataset.graphClusters)
  const hasGardenScope =
    explorer.dataset.gardenScope === "private" || explorer.dataset.gardenScope === "public"
  const urlCluster = currentClusterFromUrl()
  return hasGardenScope && allowedClusters.length > 0
    ? allowedClusters
    : urlCluster
      ? [urlCluster]
      : null
}

function applyGardenExplorerScope(explorer: HTMLElement, trie: FileTrieNode<ContentDetails>) {
  const allowedClusters = parseJsonArray(explorer.dataset.graphClusters)
  const hasGardenScope =
    explorer.dataset.gardenScope === "private" || explorer.dataset.gardenScope === "public"

  // Fall back to URL-based cluster detection when frontmatter doesn't provide a scope
  const urlCluster = currentClusterFromUrl()
  const effectiveAllowed = gardenExplorerClusters(explorer)

  trie.children = trie.children.filter((node) => {
    if (GENERATED_GARDEN_ROOTS.has(node.slugSegment)) return false
    if (!effectiveAllowed) return true
    return effectiveAllowed.includes(node.slugSegment)
  })

  const shouldEnforceGardenTree =
    hasGardenScope || Boolean(urlCluster && !NON_GARDEN_ROOTS.has(urlCluster))
  if (!shouldEnforceGardenTree || !effectiveAllowed) return
  for (const clusterNode of trie.children) {
    if (!effectiveAllowed.includes(clusterNode.slugSegment)) continue
    clusterNode.children = clusterNode.children.filter(isVisibleGardenRootEntry)
  }

  if (explorer.dataset.gardenScope === "private") {
    groupGardenExplorerNodes(
      trie,
      allowedClusters,
      gardenClusterFoldersFromJson(explorer.dataset.gardenClusterFolders),
    )
  }
}

function validFlagColor(value: unknown): string {
  const color = typeof value === "string" ? value.trim() : ""
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : ""
}

function sendFlagColor(slug: FullSlug, flagColor: string) {
  window.parent?.postMessage(
    {
      type: "second-brain:set-flag-color",
      slug,
      flagColor,
    },
    "*",
  )
}

// ── Folder drag-and-drop (only when embedded in the dashboard iframe) ─────────
const insideDashboard = typeof window !== "undefined" && window.parent !== window
let draggedSlug: string | null = null

// A note's full slug is "<cluster>/<...folder>/<basename>".
function clusterAndBasename(slug: string): { cluster: string; basename: string } {
  const parts = slug.split("/").filter(Boolean)
  return { cluster: parts[0] ?? "", basename: parts[parts.length - 1] ?? "" }
}

// A folder's slug is "<cluster>/<...folder>/index"; "<cluster>/index" is the root.
function clusterAndRelFolder(folderSlug: string): { cluster: string; relFolder: string } {
  const parts = folderSlug.split("/").filter(Boolean)
  if (parts[parts.length - 1] === "index") parts.pop()
  return { cluster: parts[0] ?? "", relFolder: parts.slice(1).join("/") }
}

function clearDropTargets() {
  for (const el of document.querySelectorAll(".explorer .drop-target")) {
    el.classList.remove("drop-target")
  }
}

function sendMoveNote(cluster: string, slug: string, toFolder: string) {
  window.parent?.postMessage({ type: "second-brain:move-note", cluster, slug, toFolder }, "*")
}

function sendCreateFolder(cluster: string, folder: string) {
  window.parent?.postMessage({ type: "second-brain:create-folder", cluster, folder }, "*")
}

function sendDeleteFolder(cluster: string, folder: string) {
  window.parent?.postMessage({ type: "second-brain:delete-folder", cluster, folder }, "*")
}

interface CreateFolderDialog {
  overlay: HTMLDivElement
  panel: HTMLDivElement
  form: HTMLFormElement
  input: HTMLInputElement
  error: HTMLParagraphElement
  cancel: HTMLButtonElement
  close: HTMLButtonElement
  submit: HTMLButtonElement
  cluster: string
  relFolder: string
  pendingFolder: string
  pending: boolean
  retryTimer: number | null
  timeoutTimer: number | null
  returnFocus: HTMLElement | null
}

let createFolderDialog: CreateFolderDialog | null = null
let createFolderResultListenerBound = false
let explorerSlug: FullSlug | null = null
const canonicalFolders = new Map<string, Map<string, string>>()
const canonicalDocuments = new Map<FullSlug, ContentDetails>()
const unpublishedDocuments = new Set<FullSlug>()
const unpublishedFolders = new Set<string>()
const boundExplorerToggles = new WeakSet<HTMLElement>()
const explorerRenderControllers = new WeakMap<HTMLElement, AbortController>()
const explorerRenderVersions = new WeakMap<HTMLElement, number>()
const boundExplorerRenderCleanup = new WeakSet<HTMLElement>()
const folderSnapshotRetries = new Map<string, number>()

function requestFolderSnapshot(cluster: string, attempt = 0) {
  const previous = folderSnapshotRetries.get(cluster)
  if (previous !== undefined) window.clearTimeout(previous)
  window.parent.postMessage({ type: "second-brain:request-folders", cluster }, "*")
  // The iframe can finish before the dashboard hydrates its message listener.
  // Retry the read until acknowledged instead of losing saved folders on reload.
  if (attempt < 5) {
    folderSnapshotRetries.set(
      cluster,
      window.setTimeout(() => {
        requestFolderSnapshot(cluster, attempt + 1)
      }, 2_000),
    )
  } else {
    folderSnapshotRetries.delete(cluster)
  }
}

function rememberFolder(cluster: string, folder: string, name?: string) {
  if (
    !cluster ||
    !folder ||
    folder.split("/").some((part) => !part || part === "." || part === "..")
  )
    return
  const folders = canonicalFolders.get(cluster) ?? new Map<string, string>()
  folders.set(
    folder,
    name ||
      folder
        .split("/")
        .pop()!
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" "),
  )
  canonicalFolders.set(cluster, folders)
}

function clearCreateFolderTimers(dialog: CreateFolderDialog) {
  if (dialog.retryTimer !== null) window.clearTimeout(dialog.retryTimer)
  if (dialog.timeoutTimer !== null) window.clearTimeout(dialog.timeoutTimer)
  dialog.retryTimer = null
  dialog.timeoutTimer = null
}

function setCreateFolderDialogError(dialog: CreateFolderDialog, message = "", waiting = false) {
  dialog.error.textContent = message
  dialog.error.hidden = !message
  dialog.error.dataset.waiting = String(waiting)
}

function setCreateFolderDialogPending(
  dialog: CreateFolderDialog,
  pending: boolean,
  waiting = false,
) {
  dialog.pending = pending
  dialog.panel.setAttribute("aria-busy", String(pending))
  dialog.input.disabled = pending
  dialog.submit.disabled = pending || !dialog.input.value.trim()
  dialog.submit.textContent = pending ? (waiting ? "Waiting..." : "Creating...") : "Create folder"
}

function closeCreateFolderDialog(force = false) {
  const dialog = createFolderDialog
  if (!dialog || (dialog.pending && !force)) return
  clearCreateFolderTimers(dialog)
  dialog.overlay.hidden = true
  dialog.input.value = ""
  dialog.pendingFolder = ""
  setCreateFolderDialogError(dialog)
  setCreateFolderDialogPending(dialog, false)
  document.documentElement.classList.remove("explorer-modal-open")
  if (!force) dialog.returnFocus?.focus()
  dialog.returnFocus = null
}

function bindCreateFolderResultListener() {
  if (createFolderResultListenerBound) return
  createFolderResultListenerBound = true
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return
    const data = event.data as
      | {
          type?: string
          cluster?: string
          folder?: string
          normalizedFolder?: string
          folders?: Array<{ folder: string; name: string }>
          documents?: Array<{ relPath: string; title: string; type?: string; sourceType?: string }>
          reveal?: string
          ok?: boolean
          error?: string
          retryable?: boolean
          retryAfterMs?: number
        }
      | undefined
    if (
      data?.type === "second-brain:documents" &&
      typeof data.cluster === "string" &&
      Array.isArray(data.documents)
    ) {
      for (const entry of data.documents) {
        if (
          typeof entry.relPath !== "string" ||
          typeof entry.title !== "string" ||
          entry.relPath.split("/").some((part) => !part || part === "." || part === "..")
        )
          continue
        const filePath = `${data.cluster}/${entry.relPath}` as FilePath
        const slug = slugifyFilePath(filePath)
        canonicalDocuments.set(slug, {
          slug,
          filePath,
          title: entry.title,
          knowledgeType: entry.type,
          sourceType: entry.sourceType,
          links: [],
          tags: [],
          content: "",
        })
      }
      if (data.reveal) {
        const slug = slugifyFilePath(`${data.cluster}/${data.reveal}` as FilePath)
        const segments = slug.split("/")
        for (let depth = 1; depth < segments.length; depth++) {
          const path = `${segments.slice(0, depth).join("/")}/index`
          const entry = currentExplorerState.find((item) => item.path === path)
          if (entry) entry.collapsed = false
          else currentExplorerState.push({ path, collapsed: false })
        }
        localStorage.setItem("fileTree", JSON.stringify(currentExplorerState))
      }
      if (explorerSlug) void setupExplorer(explorerSlug)
      return
    }
    if (
      data?.type === "second-brain:folders" &&
      typeof data.cluster === "string" &&
      Array.isArray(data.folders)
    ) {
      const retry = folderSnapshotRetries.get(data.cluster)
      if (retry !== undefined) window.clearTimeout(retry)
      folderSnapshotRetries.delete(data.cluster)
      for (const entry of data.folders) {
        if (typeof entry.folder === "string" && typeof entry.name === "string") {
          rememberFolder(data.cluster, entry.folder, entry.name)
        }
      }
      if (explorerSlug) void setupExplorer(explorerSlug)
      return
    }
    // Update the tree even if the user closed the dialog while the save ran.
    if (
      data?.type === "second-brain:create-folder-result" &&
      data.ok &&
      typeof data.cluster === "string" &&
      typeof data.normalizedFolder === "string"
    ) {
      rememberFolder(data.cluster, data.normalizedFolder)
      // Expand the ancestors so the newly saved folder is actually visible.
      const states: FolderState[] = JSON.parse(localStorage.getItem("fileTree") || "[]")
      const parts = `${data.cluster}/${data.normalizedFolder}`.split("/")
      for (let depth = 1; depth < parts.length; depth++) {
        const path = `${parts.slice(0, depth).join("/")}/index`
        const state = states.find((entry) => entry.path === path)
        if (state) state.collapsed = false
        else states.push({ path, collapsed: false })
      }
      localStorage.setItem("fileTree", JSON.stringify(states))
      if (explorerSlug) void setupExplorer(explorerSlug)
    }
    const dialog = createFolderDialog
    if (
      !dialog?.pending ||
      data?.type !== "second-brain:create-folder-result" ||
      (data.cluster !== undefined && data.cluster !== dialog.cluster) ||
      data.folder !== dialog.pendingFolder
    ) {
      return
    }

    if (data.ok) {
      closeCreateFolderDialog(true)
      return
    }

    if (data.retryable) {
      const retryAfterMs = Number.isFinite(data.retryAfterMs)
        ? Math.min(10_000, Math.max(1_000, Number(data.retryAfterMs)))
        : 2_000
      setCreateFolderDialogPending(dialog, true, true)
      setCreateFolderDialogError(dialog, "Waiting for the current garden update to finish…", true)
      if (dialog.retryTimer !== null) window.clearTimeout(dialog.retryTimer)
      dialog.retryTimer = window.setTimeout(() => {
        const current = createFolderDialog
        if (!current?.pending || current.pendingFolder !== data.folder) return
        current.retryTimer = null
        sendCreateFolder(current.cluster, current.pendingFolder)
      }, retryAfterMs)
      return
    }

    clearCreateFolderTimers(dialog)
    setCreateFolderDialogPending(dialog, false)
    setCreateFolderDialogError(dialog, data.error || "Could not create folder.")
    dialog.input.focus()
  })
}

function ensureCreateFolderDialog(): CreateFolderDialog {
  if (createFolderDialog && document.body.contains(createFolderDialog.overlay)) {
    return createFolderDialog
  }

  const overlay = document.createElement("div")
  overlay.className = "explorer-folder-modal"
  overlay.hidden = true
  overlay.innerHTML = `
    <div class="explorer-folder-panel" role="dialog" aria-modal="true" aria-labelledby="explorer-folder-title">
      <div class="explorer-folder-header">
        <h2 id="explorer-folder-title">New folder</h2>
        <button class="explorer-folder-close" type="button" aria-label="Close new folder dialog">&times;</button>
      </div>
      <form class="explorer-folder-form">
        <label for="explorer-folder-name">Folder name</label>
        <input id="explorer-folder-name" type="text" maxlength="80" autocomplete="off" />
        <p class="explorer-folder-error" role="alert" hidden></p>
        <div class="explorer-folder-actions">
          <button class="explorer-folder-cancel" type="button">Cancel</button>
          <button class="explorer-folder-submit" type="submit" disabled>Create folder</button>
        </div>
      </form>
    </div>`
  document.body.appendChild(overlay)

  const panel = overlay.querySelector(".explorer-folder-panel") as HTMLDivElement
  const form = overlay.querySelector(".explorer-folder-form") as HTMLFormElement
  const input = overlay.querySelector("#explorer-folder-name") as HTMLInputElement
  const error = overlay.querySelector(".explorer-folder-error") as HTMLParagraphElement
  const cancel = overlay.querySelector(".explorer-folder-cancel") as HTMLButtonElement
  const close = overlay.querySelector(".explorer-folder-close") as HTMLButtonElement
  const submit = overlay.querySelector(".explorer-folder-submit") as HTMLButtonElement

  createFolderDialog = {
    overlay,
    panel,
    form,
    input,
    error,
    cancel,
    close,
    submit,
    cluster: "",
    relFolder: "",
    pendingFolder: "",
    pending: false,
    retryTimer: null,
    timeoutTimer: null,
    returnFocus: null,
  }

  input.addEventListener("input", () => {
    if (!createFolderDialog) return
    setCreateFolderDialogError(createFolderDialog)
    createFolderDialog.submit.disabled = !input.value.trim()
  })
  form.addEventListener("submit", (event) => {
    event.preventDefault()
    const dialog = createFolderDialog
    if (!dialog || dialog.pending) return
    const name = dialog.input.value.trim()
    if (!name) {
      setCreateFolderDialogError(dialog, "Enter a folder name.")
      dialog.input.focus()
      return
    }
    const folder = dialog.relFolder ? `${dialog.relFolder}/${name}` : name
    dialog.pendingFolder = folder
    if (dialog.retryTimer !== null) window.clearTimeout(dialog.retryTimer)
    dialog.retryTimer = null
    if (dialog.timeoutTimer !== null) window.clearTimeout(dialog.timeoutTimer)
    dialog.timeoutTimer = window.setTimeout(() => {
      clearCreateFolderTimers(dialog)
      setCreateFolderDialogPending(dialog, false)
      setCreateFolderDialogError(
        dialog,
        "Could not confirm folder creation. Try again; an existing folder will be reused.",
      )
      dialog.input.focus()
    }, 30_000)
    setCreateFolderDialogError(dialog)
    setCreateFolderDialogPending(dialog, true)
    sendCreateFolder(dialog.cluster, folder)
  })
  const cancelPendingCreation = () => {
    const returnFocus = createFolderDialog?.returnFocus
    closeCreateFolderDialog(true)
    returnFocus?.focus()
  }
  cancel.addEventListener("click", cancelPendingCreation)
  close.addEventListener("click", cancelPendingCreation)
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) cancelPendingCreation()
  })
  overlay.addEventListener("keydown", (event) => {
    if (event.key === "Escape") cancelPendingCreation()
  })

  bindCreateFolderResultListener()
  return createFolderDialog
}

function openCreateFolderDialog(cluster: string, relFolder: string, trigger: HTMLElement) {
  const dialog = ensureCreateFolderDialog()
  dialog.cluster = cluster
  dialog.relFolder = relFolder
  dialog.returnFocus = trigger
  dialog.input.value = ""
  setCreateFolderDialogError(dialog)
  setCreateFolderDialogPending(dialog, false)
  dialog.overlay.hidden = false
  document.documentElement.classList.add("explorer-modal-open")
  window.requestAnimationFrame(() => dialog.input.focus())
}

function makeFileDraggable(li: HTMLElement, slug: FullSlug) {
  if (!insideDashboard) return
  li.draggable = true
  li.classList.add("explorer-draggable")
  li.addEventListener("dragstart", (event) => {
    draggedSlug = slug
    event.dataTransfer?.setData("text/plain", slug)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"
  })
  li.addEventListener("dragend", () => {
    draggedSlug = null
    clearDropTargets()
  })
}

function makeFolderDropTarget(el: HTMLElement, folderSlug: string) {
  if (!insideDashboard) return
  const target = clusterAndRelFolder(folderSlug)

  el.addEventListener("dragover", (event) => {
    if (!draggedSlug) return
    if (clusterAndBasename(draggedSlug).cluster !== target.cluster) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move"
    el.classList.add("drop-target")
  })
  el.addEventListener("dragleave", () => el.classList.remove("drop-target"))
  el.addEventListener("drop", (event) => {
    el.classList.remove("drop-target")
    if (!draggedSlug) return
    const dragged = clusterAndBasename(draggedSlug)
    if (dragged.cluster !== target.cluster) return
    event.preventDefault()
    event.stopPropagation()
    sendMoveNote(target.cluster, dragged.basename, target.relFolder)
    draggedSlug = null
  })
}

let dndStylesInjected = false
function ensureDndStyles() {
  if (dndStylesInjected || typeof document === "undefined") return
  dndStylesInjected = true
  const style = document.createElement("style")
  style.textContent = `
    .explorer .drop-target { background: rgba(56, 189, 248, 0.18); outline: 1px solid rgba(56, 189, 248, 0.5); border-radius: 4px; }
    .explorer .explorer-draggable { cursor: grab; }
    .folder-container .explorer-folder-action {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      border: 0;
      background: transparent;
      color: var(--secondary);
      opacity: 0;
      cursor: pointer;
      padding: 2px;
      border-radius: 4px;
      transition: opacity 0.15s ease, color 0.15s ease, background 0.15s ease;
    }
    .folder-container .explorer-folder-add { margin-left: auto; }
    .folder-container:hover .explorer-folder-action { opacity: 0.55; }
    .folder-container .explorer-folder-add:hover { opacity: 1; color: var(--tertiary); background: var(--lightgray); }
    .folder-container .explorer-folder-del:hover { opacity: 1; color: #dc2626; background: color-mix(in srgb, #dc2626 12%, transparent); }
  `
  document.head.appendChild(style)
}

let currentExplorerState: Array<FolderState>
const explorerMobileLayouts = new WeakMap<HTMLElement, boolean>()

function setExplorerExpanded(explorer: HTMLElement, expanded: boolean) {
  explorer.classList.toggle("collapsed", !expanded)
  explorer.setAttribute("aria-expanded", String(expanded))
  for (const element of explorer.querySelectorAll(".explorer-toggle, .explorer-content")) {
    element.setAttribute("aria-expanded", String(expanded))
  }
}

function syncExplorerScrollLock() {
  const mobileMenuOpen = Array.from(document.querySelectorAll(".explorer")).some(
    (explorer) =>
      explorer.querySelector(".mobile-explorer")?.checkVisibility() &&
      !explorer.classList.contains("collapsed"),
  )
  document.documentElement.classList.toggle("mobile-no-scroll", mobileMenuOpen)
}

function syncExplorerViewport(reset = false) {
  for (const explorer of document.querySelectorAll<HTMLElement>(".explorer")) {
    const mobileButton = explorer.querySelector(".mobile-explorer")
    if (!mobileButton) continue

    const mobile = mobileButton.checkVisibility()
    // An iframe can cross the breakpoint when its assistant pane is resized.
    // A collapsed mobile menu must not become a 1.2rem desktop navigation tree.
    if (reset || explorerMobileLayouts.get(explorer) !== mobile) {
      setExplorerExpanded(explorer, !mobile)
    }
    explorerMobileLayouts.set(explorer, mobile)
  }
  syncExplorerScrollLock()
}

function toggleExplorer(this: HTMLElement) {
  const nearestExplorer = this.closest(".explorer") as HTMLElement
  if (!nearestExplorer) return
  setExplorerExpanded(nearestExplorer, nearestExplorer.classList.contains("collapsed"))
  syncExplorerScrollLock()
}

function toggleFolder(evt: MouseEvent) {
  evt.stopPropagation()
  const target = evt.target as MaybeHTMLElement
  if (!target) return

  // Check if target was svg icon or button
  const isSvg = target.nodeName === "svg"

  // corresponding <ul> element relative to clicked button/folder
  const folderContainer = (
    isSvg
      ? // svg -> div.folder-container
        target.parentElement
      : // button.folder-button -> div -> div.folder-container
        target.parentElement?.parentElement
  ) as MaybeHTMLElement
  if (!folderContainer) return
  const childFolderContainer = folderContainer.nextElementSibling as MaybeHTMLElement
  if (!childFolderContainer) return

  childFolderContainer.classList.toggle("open")

  // Collapse folder container
  const isCollapsed = !childFolderContainer.classList.contains("open")
  setFolderState(childFolderContainer, isCollapsed)

  const currentFolderState = currentExplorerState.find(
    (item) => item.path === folderContainer.dataset.folderpath,
  )
  if (currentFolderState) {
    currentFolderState.collapsed = isCollapsed
  } else {
    currentExplorerState.push({
      path: folderContainer.dataset.folderpath as FullSlug,
      collapsed: isCollapsed,
    })
  }

  const stringifiedFileTree = JSON.stringify(currentExplorerState)
  localStorage.setItem("fileTree", stringifiedFileTree)
}

function createFileNode(currentSlug: FullSlug, node: FileTrieNode): HTMLLIElement {
  const template = document.getElementById("template-file") as HTMLTemplateElement
  const clone = template.content.cloneNode(true) as DocumentFragment
  const li = clone.querySelector("li") as HTMLLIElement
  const a = li.querySelector("a") as HTMLAnchorElement
  const flagColor = validFlagColor(node.data?.flagColor)
  const sourceKind = topologySourceKind(
    {
      knowledgeType: node.data?.knowledgeType,
      sourceType: node.data?.sourceType,
      title: node.data?.title ?? node.displayName,
      relPath: String(node.data?.filePath ?? node.slug),
    },
    String(node.slug),
  )
  const isTextbookPage =
    node.data?.knowledgeType === "textbook-page" ||
    node.data?.knowledgeType === "learning-page" ||
    node.data?.breadboardType === "textbook_page" ||
    node.data?.breadboardType === "learning_page"
  const isInternalConcept =
    node.data?.knowledgeType === "internal-concept" ||
    node.data?.breadboardType === "internal_concept"
  const isChatNodeNote =
    node.data?.knowledgeType === "generated-note" && node.data?.generatedNoteType === "chat-node"
  li.classList.add("explorer-file")
  if (sourceKind) {
    li.classList.add("source-document")
    li.dataset.sourceKind = sourceKind
    li.style.setProperty("--source-node-color-light", TOPOLOGY_SOURCE_COLORS.light[sourceKind])
    li.style.setProperty("--source-node-color-dark", TOPOLOGY_SOURCE_COLORS.dark[sourceKind])
  }
  if (isTextbookPage) li.classList.add("textbook-page")
  if (isInternalConcept) li.classList.add("internal-concept")
  if (isChatNodeNote) li.classList.add("chat-node-note")
  a.href = resolveRelative(currentSlug, node.slug)
  a.dataset.for = node.slug
  a.textContent = node.displayName
  if (unpublishedDocuments.has(node.slug)) {
    // The canonical file is saved, but its static URL does not exist yet.
    a.removeAttribute("href")
    a.title = "Saved. The reading page is being published."
    a.setAttribute("aria-disabled", "true")
  }
  makeFileDraggable(li, node.slug)

  if (currentSlug === node.slug) {
    a.classList.add("active")
  }

  const flagMenu = document.createElement("div")
  flagMenu.className = "explorer-flag-menu"

  const flag = document.createElement("button")
  flag.type = "button"
  flag.className = "explorer-flag-button"
  flag.title = flagColor ? `Flagged ${flagColor}` : "Choose flag color"
  flag.ariaLabel = "Flag note"
  const swatch = document.createElement("span")
  swatch.className = "explorer-flag-swatch"
  if (flagColor) swatch.style.backgroundColor = flagColor

  const palette = document.createElement("div")
  palette.className = "explorer-flag-palette"

  const clear = document.createElement("button")
  clear.type = "button"
  clear.className = "explorer-flag-clear"
  clear.textContent = "Clear"
  clear.hidden = !flagColor

  const setActiveOption = (color: string) => {
    for (const option of palette.querySelectorAll(".explorer-flag-option")) {
      option.classList.toggle("active", (option as HTMLElement).dataset.flagColor === color)
    }
  }

  let paletteReady = false
  const ensurePalette = () => {
    if (paletteReady) return
    paletteReady = true
    for (const color of FLAG_COLORS) {
      const option = document.createElement("button")
      option.type = "button"
      option.className = `explorer-flag-option${flagColor === color ? " active" : ""}`
      option.dataset.flagColor = color
      option.style.backgroundColor = color
      option.title = color
      option.ariaLabel = `Flag ${color}`
      option.addEventListener("click", (event) => {
        event.preventDefault()
        event.stopPropagation()
        swatch.style.backgroundColor = color
        flag.title = `Flagged ${color}`
        clear.hidden = false
        setActiveOption(color)
        flagMenu.classList.remove("open")
        sendFlagColor(node.slug, color)
      })
      palette.appendChild(option)
    }
    palette.appendChild(clear)
  }

  clear.addEventListener("click", (event) => {
    event.preventDefault()
    event.stopPropagation()
    swatch.style.backgroundColor = "transparent"
    flag.title = "Choose flag color"
    clear.hidden = true
    setActiveOption("")
    flagMenu.classList.remove("open")
    sendFlagColor(node.slug, "")
  })

  flag.addEventListener("click", (event) => {
    event.preventDefault()
    event.stopPropagation()
    const willOpen = !flagMenu.classList.contains("open")
    if (willOpen) ensurePalette()
    for (const menu of document.querySelectorAll(".explorer-flag-menu.open")) {
      if (menu !== flagMenu) menu.classList.remove("open")
    }
    flagMenu.classList.toggle("open", willOpen)
  })

  flag.appendChild(swatch)
  flagMenu.appendChild(flag)
  flagMenu.appendChild(palette)
  li.insertBefore(flagMenu, a)

  return li
}

function createFolderNode(
  currentSlug: FullSlug,
  node: FileTrieNode,
  opts: ParsedOptions,
  signal: AbortSignal,
): HTMLLIElement {
  const template = document.getElementById("template-folder") as HTMLTemplateElement
  const clone = template.content.cloneNode(true) as DocumentFragment
  const li = clone.querySelector("li") as HTMLLIElement
  const folderContainer = li.querySelector(".folder-container") as HTMLElement
  const titleContainer = folderContainer.querySelector("div") as HTMLElement
  const folderOuter = li.querySelector(".folder-outer") as HTMLElement
  const ul = folderOuter.querySelector("ul") as HTMLUListElement

  const folderPath = node.slug
  const { cluster, relFolder } = clusterAndRelFolder(folderPath)
  const isGardenRoot = relFolder.length === 0
  const isVirtualCluster = isVirtualGardenClusterNode(node)
  const isUnpublished = unpublishedFolders.has(folderPath)
  // Existing emitted pages may outlive an asset-only rebuild, so apply the
  // clipping hook at runtime as well as in Explorer's template.
  titleContainer.classList.add("folder-title-clip")
  folderContainer.dataset.folderpath = folderPath

  if (currentSlug === folderPath) {
    folderContainer.classList.add("active")
  }

  // Virtual cluster headings organize Gardens in the library. They are not
  // content folders, so note/file actions remain on the real Garden nodes.
  if (!isVirtualCluster) makeFolderDropTarget(folderContainer, folderPath)
  if (insideDashboard && !isVirtualCluster) {
    const addBtn = document.createElement("button")
    addBtn.type = "button"
    addBtn.className = "explorer-folder-add explorer-folder-action"
    addBtn.title = "New sub-folder"
    addBtn.ariaLabel = "New sub-folder"
    addBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`
    addBtn.addEventListener("click", (event) => {
      event.preventDefault()
      event.stopPropagation()
      openCreateFolderDialog(cluster, relFolder, addBtn)
    })
    folderContainer.appendChild(addBtn)

    // The cluster root has no relFolder and cannot be deleted from here.
    if (relFolder) {
      const delBtn = document.createElement("button")
      delBtn.type = "button"
      delBtn.className = "explorer-folder-del explorer-folder-action"
      delBtn.title = "Delete folder"
      delBtn.ariaLabel = "Delete folder"
      delBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`
      delBtn.addEventListener("click", (event) => {
        event.preventDefault()
        event.stopPropagation()
        const ok = window.confirm(
          `Delete the folder "${relFolder}" and all notes inside it? This cannot be undone.`,
        )
        if (!ok) return
        sendDeleteFolder(cluster, relFolder)
      })
      folderContainer.appendChild(delBtn)
    }
  }

  let folderTitle: HTMLElement
  if (opts.folderClickBehavior === "link" && !isVirtualCluster && !isUnpublished) {
    // Replace button with link for link behavior
    const button = titleContainer.querySelector(".folder-button") as HTMLElement
    const a = document.createElement("a")
    a.href = resolveRelative(currentSlug, folderPath)
    a.dataset.for = folderPath
    a.className = "folder-title"
    a.textContent = node.displayName
    button.replaceWith(a)
    folderTitle = a
  } else {
    const button = titleContainer.querySelector(".folder-button") as HTMLButtonElement
    const span = titleContainer.querySelector(".folder-title") as HTMLElement
    span.textContent = node.displayName
    folderTitle = span
    if ((isVirtualCluster || isUnpublished) && opts.folderClickBehavior === "link") {
      button.ariaLabel = `Toggle ${isVirtualCluster ? "cluster" : "folder"} ${node.displayName}`
      button.addEventListener("click", toggleFolder, { signal })
    }
  }

  if (isVirtualCluster) folderContainer.classList.add("garden-cluster-group")

  if (isGardenRoot) {
    folderContainer.classList.add("garden-root")
    bindGardenTitleMarquee(titleContainer, folderTitle, signal)
  }

  // if the saved state is collapsed or the default state is collapsed
  const isCollapsed =
    currentExplorerState.find((item) => item.path === folderPath)?.collapsed ??
    opts.folderDefaultState === "collapsed"

  // if this folder is a prefix of the current path we
  // want to open it anyways
  const simpleFolderPath = simplifySlug(folderPath)
  const folderIsPrefixOfCurrentSlug =
    simpleFolderPath === currentSlug.slice(0, simpleFolderPath.length)

  if (!isCollapsed || folderIsPrefixOfCurrentSlug) {
    folderOuter.classList.add("open")
  }

  for (const child of node.children) {
    const childNode = child.isFolder
      ? createFolderNode(currentSlug, child, opts, signal)
      : createFileNode(currentSlug, child)
    ul.appendChild(childNode)
  }

  return li
}

// The build transpiles Explorer.tsx with esbuild's keepNames, which wraps inner
// functions in a __name(...) helper. That helper leaks into the serialized fn
// source, so provide a no-op shim when reviving.
function reviveDataFn(source: string | undefined) {
  return new Function("__name", "return " + (source || "undefined"))(<T>(fn: T) => fn)
}

async function setupExplorer(currentSlug: FullSlug) {
  explorerSlug = currentSlug
  bindCreateFolderResultListener()
  ensureDndStyles()
  const allExplorers = document.querySelectorAll("div.explorer") as NodeListOf<HTMLElement>

  for (const explorer of allExplorers) {
    const renderVersion = (explorerRenderVersions.get(explorer) ?? 0) + 1
    explorerRenderVersions.set(explorer, renderVersion)
    const dataFns = JSON.parse(explorer.dataset.dataFns || "{}")
    const opts: ParsedOptions = {
      folderClickBehavior: (explorer.dataset.behavior || "collapse") as "collapse" | "link",
      folderDefaultState: (explorer.dataset.collapsed || "collapsed") as "collapsed" | "open",
      useSavedState: explorer.dataset.savestate === "true",
      order: dataFns.order || ["filter", "map", "sort"],
      sortFn: reviveDataFn(dataFns.sortFn),
      filterFn: reviveDataFn(dataFns.filterFn),
      mapFn: reviveDataFn(dataFns.mapFn),
    }

    // Get folder state from local storage
    const storageTree = localStorage.getItem("fileTree")
    const serializedExplorerState = storageTree && opts.useSavedState ? JSON.parse(storageTree) : []
    const oldIndex = new Map<string, boolean>(
      serializedExplorerState.map((entry: FolderState) => [entry.path, entry.collapsed]),
    )

    const data = await fetchData
    if (explorerRenderVersions.get(explorer) !== renderVersion || !explorer.isConnected) continue

    explorerRenderControllers.get(explorer)?.abort()
    const renderController = new AbortController()
    const { signal } = renderController
    explorerRenderControllers.set(explorer, renderController)
    if (!boundExplorerRenderCleanup.has(explorer)) {
      boundExplorerRenderCleanup.add(explorer)
      window.addCleanup(() => {
        explorerRenderControllers.get(explorer)?.abort()
        explorerRenderControllers.delete(explorer)
        boundExplorerRenderCleanup.delete(explorer)
      })
    }

    const allowedClusters = gardenExplorerClusters(explorer)
    const isAllowed = (filePath: string, slug: string) =>
      !allowedClusters ||
      allowedClusters.some(
        (cluster) =>
          filePath === cluster ||
          filePath.startsWith(`${cluster}/`) ||
          slug === cluster ||
          slug.startsWith(`${cluster}/`),
      )
    const entries = Object.entries(data).filter(([slug, entry]) =>
      isAllowed(entry.filePath ?? "", slug),
    ) as [FullSlug, ContentDetails][]
    const trie = FileTrieNode.fromEntries(entries)
    for (const [slug, document] of canonicalDocuments) {
      if (!isAllowed(document.filePath, slug)) continue
      if (data[slug]) {
        unpublishedDocuments.delete(slug)
      } else {
        unpublishedDocuments.add(slug)
        trie.add(document)
      }
    }
    for (const [cluster, folders] of canonicalFolders) {
      if (allowedClusters && !allowedClusters.includes(cluster)) continue
      for (const [folder, title] of folders) {
        // The snapshot contains disk paths; Quartz URLs replace spaces and
        // other characters. Match the published node instead of adding a
        // second tree for folders such as EM1's numbered learning sections.
        const filePath = `${cluster}/${folder}/_index.md` as FilePath
        const slug = slugifyFilePath(filePath)
        if (data[slug]) {
          unpublishedFolders.delete(slug)
          continue
        }
        unpublishedFolders.add(slug)
        trie.add({ slug, title, filePath, links: [], tags: [], content: "" })
      }
    }
    applyGardenExplorerScope(explorer, trie)

    // Apply functions in order
    for (const fn of opts.order) {
      switch (fn) {
        case "filter":
          if (opts.filterFn) trie.filter(opts.filterFn)
          break
        case "map":
          if (opts.mapFn) trie.map(opts.mapFn)
          break
        case "sort":
          if (opts.sortFn) trie.sort(opts.sortFn)
          break
      }
    }

    // Get folder paths for state management
    const folderPaths = trie.getFolderPaths()
    currentExplorerState = folderPaths.map((path) => {
      const previousState = oldIndex.get(path)
      return {
        path,
        collapsed:
          previousState === undefined ? opts.folderDefaultState === "collapsed" : previousState,
      }
    })

    const explorerUl = explorer.querySelector(".explorer-ul")
    if (!explorerUl) continue

    // Create and insert new content
    const fragment = document.createDocumentFragment()
    for (const child of trie.children) {
      const node = child.isFolder
        ? createFolderNode(currentSlug, child, opts, signal)
        : createFileNode(currentSlug, child)

      fragment.appendChild(node)
    }
    const overflowEnd = explorerUl.querySelector(":scope > .overflow-end")
    explorerUl.replaceChildren(fragment)
    if (overflowEnd) explorerUl.appendChild(overflowEnd)

    // restore explorer scrollTop position if it exists
    const scrollTop = sessionStorage.getItem("explorerScrollTop")
    if (scrollTop) {
      explorerUl.scrollTop = parseInt(scrollTop)
    } else {
      // try to scroll to the active element if it exists
      const activeElement = explorerUl.querySelector(".active")
      if (activeElement) {
        // Scroll only the tree, including while the mobile drawer is hidden.
        // scrollIntoView also scrolls the document and can hide the page title.
        const activeBounds = activeElement.getBoundingClientRect()
        const listBounds = explorerUl.getBoundingClientRect()
        if (activeBounds.top < listBounds.top || activeBounds.bottom > listBounds.bottom) {
          explorerUl.scrollTop += activeBounds.top - listBounds.top - explorerUl.clientHeight / 2
        }
      }
    }

    // Set up event handlers
    const explorerButtons = explorer.getElementsByClassName(
      "explorer-toggle",
    ) as HTMLCollectionOf<HTMLElement>
    for (const button of explorerButtons) {
      if (boundExplorerToggles.has(button)) continue
      boundExplorerToggles.add(button)
      button.addEventListener("click", toggleExplorer, { signal })
      signal.addEventListener(
        "abort",
        () => {
          boundExplorerToggles.delete(button)
        },
        { once: true },
      )
    }

    // Set up folder click handlers
    if (opts.folderClickBehavior === "collapse") {
      const folderButtons = explorer.getElementsByClassName(
        "folder-button",
      ) as HTMLCollectionOf<HTMLElement>
      for (const button of folderButtons) {
        button.addEventListener("click", toggleFolder, { signal })
      }
    }

    const folderIcons = explorer.getElementsByClassName(
      "folder-icon",
    ) as HTMLCollectionOf<HTMLElement>
    for (const icon of folderIcons) {
      icon.addEventListener("click", toggleFolder, { signal })
    }
  }
}

document.addEventListener("prenav", async () => {
  for (const retry of folderSnapshotRetries.values()) window.clearTimeout(retry)
  folderSnapshotRetries.clear()
  // save explorer scrollTop position
  const explorer = document.querySelector(".explorer-ul")
  if (!explorer) return
  sessionStorage.setItem("explorerScrollTop", explorer.scrollTop.toString())
})

document.addEventListener("nav", async (e: CustomEventMap["nav"]) => {
  const currentSlug = e.detail.url
  await setupExplorer(currentSlug)
  if (insideDashboard) {
    const clusters = new Set<string>()
    for (const root of document.querySelectorAll<HTMLElement>(".explorer .garden-root")) {
      const { cluster } = clusterAndRelFolder(root.dataset.folderpath || "")
      if (cluster) clusters.add(cluster)
    }
    for (const cluster of clusters) {
      requestFolderSnapshot(cluster)
    }
  }

  for (const explorer of document.getElementsByClassName("explorer")) {
    const mobileExplorer = explorer.querySelector(".mobile-explorer")
    mobileExplorer?.classList.remove("hide-until-loaded")
  }
  syncExplorerViewport(true)
})

window.addEventListener("resize", () => syncExplorerViewport())

function setFolderState(folderElement: HTMLElement, collapsed: boolean) {
  return collapsed ? folderElement.classList.remove("open") : folderElement.classList.add("open")
}
