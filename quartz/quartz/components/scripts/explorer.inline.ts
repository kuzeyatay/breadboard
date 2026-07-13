import { FileTrieNode } from "../../util/fileTrie"
import { FullSlug, resolveRelative, simplifySlug } from "../../util/path"
import { ContentDetails } from "../../plugins/emitters/contentIndex"

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
const LEARNER_GARDEN_FOLDERS = new Set(["learning", "sources"])
const NON_GARDEN_ROOTS = new Set(["tags", "static", "index", "404"])

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

function applyGardenExplorerScope(explorer: HTMLElement, trie: FileTrieNode<ContentDetails>) {
  const allowedClusters = parseJsonArray(explorer.dataset.graphClusters)
  const hasGardenScope =
    explorer.dataset.gardenScope === "private" || explorer.dataset.gardenScope === "public"

  // Fall back to URL-based cluster detection when frontmatter doesn't provide a scope
  const urlCluster = currentClusterFromUrl()
  const effectiveAllowed =
    hasGardenScope && allowedClusters.length > 0
      ? allowedClusters
      : urlCluster
        ? [urlCluster]
        : null

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
    clusterNode.children = clusterNode.children.filter(
      (child) => child.isFolder && LEARNER_GARDEN_FOLDERS.has(child.slugSegment),
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
function toggleExplorer(this: HTMLElement) {
  const nearestExplorer = this.closest(".explorer") as HTMLElement
  if (!nearestExplorer) return
  const explorerCollapsed = nearestExplorer.classList.toggle("collapsed")
  nearestExplorer.setAttribute(
    "aria-expanded",
    nearestExplorer.getAttribute("aria-expanded") === "true" ? "false" : "true",
  )

  if (!explorerCollapsed) {
    // Stop <html> from being scrollable when mobile explorer is open
    document.documentElement.classList.add("mobile-no-scroll")
  } else {
    document.documentElement.classList.remove("mobile-no-scroll")
  }
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
  const isSourceDocument = node.data?.knowledgeType === "source-document"
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
  if (isSourceDocument) li.classList.add("source-document")
  if (isTextbookPage) li.classList.add("textbook-page")
  if (isInternalConcept) li.classList.add("internal-concept")
  if (isChatNodeNote) li.classList.add("chat-node-note")
  a.href = resolveRelative(currentSlug, node.slug)
  a.dataset.for = node.slug
  a.textContent = node.displayName
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
    for (const menu of document.querySelectorAll(".explorer-flag-menu.open")) {
      if (menu !== flagMenu) menu.classList.remove("open")
    }
    flagMenu.classList.toggle("open", willOpen)
  })

  flag.appendChild(swatch)
  flagMenu.appendChild(flag)
  flagMenu.appendChild(palette)
  palette.appendChild(clear)
  li.insertBefore(flagMenu, a)

  return li
}

function createFolderNode(
  currentSlug: FullSlug,
  node: FileTrieNode,
  opts: ParsedOptions,
): HTMLLIElement {
  const template = document.getElementById("template-folder") as HTMLTemplateElement
  const clone = template.content.cloneNode(true) as DocumentFragment
  const li = clone.querySelector("li") as HTMLLIElement
  const folderContainer = li.querySelector(".folder-container") as HTMLElement
  const titleContainer = folderContainer.querySelector("div") as HTMLElement
  const folderOuter = li.querySelector(".folder-outer") as HTMLElement
  const ul = folderOuter.querySelector("ul") as HTMLUListElement

  const folderPath = node.slug
  folderContainer.dataset.folderpath = folderPath

  if (currentSlug === folderPath) {
    folderContainer.classList.add("active")
  }

  // Allow dropping notes into this folder and creating/deleting sub-folders from the dashboard.
  makeFolderDropTarget(folderContainer, folderPath)
  if (insideDashboard) {
    const { cluster, relFolder } = clusterAndRelFolder(folderPath)

    const addBtn = document.createElement("button")
    addBtn.type = "button"
    addBtn.className = "explorer-folder-add explorer-folder-action"
    addBtn.title = "New sub-folder"
    addBtn.ariaLabel = "New sub-folder"
    addBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`
    addBtn.addEventListener("click", (event) => {
      event.preventDefault()
      event.stopPropagation()
      const name = window.prompt("New folder name")
      if (!name || !name.trim()) return
      const folder = relFolder ? `${relFolder}/${name.trim()}` : name.trim()
      sendCreateFolder(cluster, folder)
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

  if (opts.folderClickBehavior === "link") {
    // Replace button with link for link behavior
    const button = titleContainer.querySelector(".folder-button") as HTMLElement
    const a = document.createElement("a")
    a.href = resolveRelative(currentSlug, folderPath)
    a.dataset.for = folderPath
    a.className = "folder-title"
    a.textContent = node.displayName
    button.replaceWith(a)
  } else {
    const span = titleContainer.querySelector(".folder-title") as HTMLElement
    span.textContent = node.displayName
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
      ? createFolderNode(currentSlug, child, opts)
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
  ensureDndStyles()
  const allExplorers = document.querySelectorAll("div.explorer") as NodeListOf<HTMLElement>

  for (const explorer of allExplorers) {
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
    const entries = [...Object.entries(data)] as [FullSlug, ContentDetails][]
    const trie = FileTrieNode.fromEntries(entries)
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
        ? createFolderNode(currentSlug, child, opts)
        : createFileNode(currentSlug, child)

      fragment.appendChild(node)
    }
    explorerUl.insertBefore(fragment, explorerUl.firstChild)

    // restore explorer scrollTop position if it exists
    const scrollTop = sessionStorage.getItem("explorerScrollTop")
    if (scrollTop) {
      explorerUl.scrollTop = parseInt(scrollTop)
    } else {
      // try to scroll to the active element if it exists
      const activeElement = explorerUl.querySelector(".active")
      if (activeElement) {
        activeElement.scrollIntoView({ behavior: "smooth" })
      }
    }

    // Set up event handlers
    const explorerButtons = explorer.getElementsByClassName(
      "explorer-toggle",
    ) as HTMLCollectionOf<HTMLElement>
    for (const button of explorerButtons) {
      button.addEventListener("click", toggleExplorer)
      window.addCleanup(() => button.removeEventListener("click", toggleExplorer))
    }

    // Set up folder click handlers
    if (opts.folderClickBehavior === "collapse") {
      const folderButtons = explorer.getElementsByClassName(
        "folder-button",
      ) as HTMLCollectionOf<HTMLElement>
      for (const button of folderButtons) {
        button.addEventListener("click", toggleFolder)
        window.addCleanup(() => button.removeEventListener("click", toggleFolder))
      }
    }

    const folderIcons = explorer.getElementsByClassName(
      "folder-icon",
    ) as HTMLCollectionOf<HTMLElement>
    for (const icon of folderIcons) {
      icon.addEventListener("click", toggleFolder)
      window.addCleanup(() => icon.removeEventListener("click", toggleFolder))
    }
  }
}

document.addEventListener("prenav", async () => {
  // save explorer scrollTop position
  const explorer = document.querySelector(".explorer-ul")
  if (!explorer) return
  sessionStorage.setItem("explorerScrollTop", explorer.scrollTop.toString())
})

document.addEventListener("nav", async (e: CustomEventMap["nav"]) => {
  const currentSlug = e.detail.url
  await setupExplorer(currentSlug)

  // if mobile hamburger is visible, collapse by default
  for (const explorer of document.getElementsByClassName("explorer")) {
    const mobileExplorer = explorer.querySelector(".mobile-explorer")
    if (!mobileExplorer) return

    if (mobileExplorer.checkVisibility()) {
      explorer.classList.add("collapsed")
      explorer.setAttribute("aria-expanded", "false")

      // Allow <html> to be scrollable when mobile explorer is collapsed
      document.documentElement.classList.remove("mobile-no-scroll")
    }

    mobileExplorer.classList.remove("hide-until-loaded")
  }
})

window.addEventListener("resize", function () {
  // Desktop explorer opens by default, and it stays open when the window is resized
  // to mobile screen size. Applies `no-scroll` to <html> in this edge case.
  const explorer = document.querySelector(".explorer")
  if (explorer && !explorer.classList.contains("collapsed")) {
    document.documentElement.classList.add("mobile-no-scroll")
    return
  }
})

function setFolderState(folderElement: HTMLElement, collapsed: boolean) {
  return collapsed ? folderElement.classList.remove("open") : folderElement.classList.add("open")
}
