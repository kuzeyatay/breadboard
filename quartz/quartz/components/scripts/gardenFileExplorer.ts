import type { ContentDetails } from "../../plugins/emitters/contentIndex"
import type { FileTrieNode } from "../../util/fileTrie"
import { slugifyFilePath, type FilePath, type FullSlug } from "../../util/path"
import type { GardenFileEntry } from "../../../../dashboard/src/lib/garden-files/types"
import { droppedGardenFiles } from "../../../../dashboard/src/lib/garden-files/drop"

// Only authenticated host snapshots enter this map. Never persist them in Quartz
// indexes or browser storage: a shared Garden can also contain private files.
const snapshotKey = Symbol.for("breadboard.garden-file-snapshots")
const originKey = Symbol.for("breadboard.garden-file-origin")
const runtime = window as unknown as { [snapshotKey]: Map<string, { files: GardenFileEntry[]; canEdit: boolean }>; [originKey]?: string }
const snapshots = runtime[snapshotKey] ??= new Map<string, { files: GardenFileEntry[]; canEdit: boolean }>()
let refreshTree: (() => void) | undefined
let parentOrigin = ""
let open = false
let installed = false
let selectedId = ""
const post = (message: object) => { if (parentOrigin) window.parent.postMessage(message, parentOrigin) }

function bounds() {
  if (!open) return
  const center = document.querySelector<HTMLElement>(".center")
  if (!center) return
  const rect = center.getBoundingClientRect(), top = Math.max(8, Math.min(rect.top, 100))
  post({ type: "second-brain:file-bounds", left: Math.max(0, rect.left), top,
    width: Math.min(rect.width, innerWidth - Math.max(0, rect.left)), height: Math.max(200, innerHeight - top - 8) })
}

export function installGardenFiles(refresh: () => void) {
  refreshTree = refresh
  if (installed || window.parent === window) return
  installed = true
  window.addEventListener("message", event => {
    if (event.source !== window.parent || !event.data) return
    const data = event.data
    if (data.type === "second-brain:files" && typeof data.cluster === "string" && Array.isArray(data.files)) {
      parentOrigin = event.origin
      runtime[originKey] = parentOrigin
      snapshots.set(data.cluster, { files: data.files.filter((file: GardenFileEntry) => typeof file.id === "string" && /^gf_[a-f0-9]{32}$/.test(file.id) && typeof file.path === "string" && file.gardenId === data.cluster && !file.deletedAt), canEdit: data.canEdit === true })
      refreshTree?.()
    }
    if (data.type === "second-brain:file-view" && event.origin === parentOrigin) {
      open = data.open === true
      selectedId = typeof data.fileId === "string" ? data.fileId : ""
      document.documentElement.classList.toggle("garden-file-open", open)
      document.querySelectorAll<HTMLElement>("[data-garden-file-id]").forEach(element => element.classList.toggle("active", element.dataset.gardenFileId === selectedId))
      bounds()
    }
    if (data.type === "second-brain:open-library-note" && event.origin === parentOrigin && typeof data.cluster === "string" && typeof data.path === "string") {
      const slug = slugifyFilePath(`${data.cluster}/${data.path}` as FilePath)
      window.spaNavigate(new URL(`/${slug}`, window.location.href))
    }
    if (data.type === "second-brain:open-library-url" && event.origin === parentOrigin && typeof data.url === "string") {
      const url = new URL(data.url, location.href)
      if (url.origin === location.origin) window.spaNavigate(url)
    }
  })
  document.addEventListener("click", event => {
    if (!open || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    const link = (event.target as Element).closest<HTMLAnchorElement>("a[href]")
    if (!link || link.dataset.gardenFileId || link.hasAttribute("download") || (event.target as Element).closest("[data-garden-file-folder]")) return
    const url = new URL(link.href)
    if (url.origin !== location.origin) return
    event.preventDefault(); event.stopImmediatePropagation()
    post({ type: "second-brain:leave-file", url: url.href })
  }, { capture: true })
  window.addEventListener("resize", bounds)
  document.addEventListener("scroll", bounds, { passive: true })
  const observer = new ResizeObserver(bounds)
  observer.observe(document.documentElement)
  document.addEventListener("nav", () => {
    open = false
    document.documentElement.classList.remove("garden-file-open")
  })
}

export function managedExplorerEntries(allowed: string[] | undefined | null, canonical: Iterable<ContentDetails> = [], canonicalFolders: string[] = []): ContentDetails[] {
  const entries: ContentDetails[] = []
  const diskFolders = new Map<string, FullSlug>()
  for (const folder of canonicalFolders) diskFolders.set(folder, slugifyFilePath(`${folder}/_index.md` as FilePath).replace(/\/index$/, "") as FullSlug)
  for (const entry of canonical) {
    const filePath = String(entry.filePath ?? "")
    const parts = filePath.split("/").slice(0, -1)
    for (let length = 2; length <= parts.length; length++) {
      const folder = parts.slice(0, length).join("/")
      diskFolders.set(folder, slugifyFilePath(`${folder}/_index.md` as FilePath).replace(/\/index$/, "") as FullSlug)
    }
  }
  for (const [cluster, snapshot] of snapshots) {
    if (allowed && !allowed.includes(cluster)) continue
    const folderSlugs = new Map<string, string>([["", cluster]])
    const folderSlug = (folder: string): string => {
      const known = folderSlugs.get(folder)
      if (known) return known
      const parts = folder.split("/"), name = parts.pop()!, parent = parts.join("/")
      // Virtual directories get distinct URL segments even when Quartz's note
      // slugifier would collapse names such as "A B" and "A-B".
      const disk = diskFolders.get(`${cluster}/${folder}`)
      const segment = Array.from(new TextEncoder().encode(name)).map(byte => byte.toString(16).padStart(2,"0")).join("")
      const slug = disk ?? `${folderSlug(parent)}/__folder-${segment}`
      folderSlugs.set(folder, slug)
      return slug
    }
    for (const file of snapshot.files) {
      const folder = file.kind === "folder" ? file.path : file.folder
      const slug = file.kind === "folder"
        ? `${folderSlug(folder)}/index` as FullSlug
        : `${folderSlug(folder)}/__file-${file.id}` as FullSlug
      entries.push({ slug, title: file.name, filePath: `${cluster}/${file.path}${file.kind === "folder" ? "/_index.md" : ""}` as FilePath,
        links: [], tags: [], content: "", gardenFileId: file.id, gardenFileKind: file.kind })
    }
    for (const [folder, slug] of folderSlugs) {
      if (!folder || diskFolders.has(`${cluster}/${folder}`) || snapshot.files.some(file => file.kind === "folder" && file.path === folder)) continue
      entries.push({ slug: `${slug}/index` as FullSlug, title: folder.split("/").pop()!, filePath: `${cluster}/${folder}/_index.md` as FilePath, links: [], tags: [], content: "", gardenFileKind: "folder" })
    }
  }
  return entries
}

function entryFor(id?: string) {
  for (const snapshot of snapshots.values()) {
    const file = snapshot.files.find(item => item.id === id)
    if (file) return file
  }
}

export function searchManagedFiles(query: string, cluster: string | null) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  const scope = document.querySelector<HTMLElement>(".explorer")?.dataset.graphClusters
  let allowed: string[] | null = null
  if (scope) { try { const parsed: unknown = JSON.parse(scope); if (Array.isArray(parsed)) allowed = parsed.filter((item): item is string => typeof item === "string") } catch { allowed = [] } }
  return [...snapshots.values()].flatMap(snapshot => snapshot.files).filter(file => file.kind === "file" && (!cluster || file.gardenId === cluster) && (!allowed || allowed.includes(file.gardenId)) && terms.every(term => file.path.toLowerCase().includes(term))).slice(0, 20)
}

export function openManagedFile(file: GardenFileEntry) {
  // Search and Explorer may be emitted as separate script bundles.
  const origin = runtime[originKey]
  if (origin) window.parent.postMessage({ type: "second-brain:open-file", cluster: file.gardenId, fileId: file.id }, origin)
}

export const managedFileHref = (file: GardenFileEntry) => `${runtime[originKey] ?? ""}/garden/${encodeURIComponent(file.gardenId)}/files/${encodeURIComponent(file.id)}`

export function managedFileNode(node: FileTrieNode, li: HTMLLIElement): boolean {
  const file = entryFor(node.data?.gardenFileId)
  if (!file || file.kind !== "file") return false
  const link = li.querySelector("a")!
  li.classList.add("explorer-file", "explorer-managed-file")
  link.textContent = file.name
  link.title = file.name
  link.dataset.gardenFileId = file.id
  link.classList.toggle("active", selectedId === file.id)
  link.href = `${parentOrigin}/garden/${encodeURIComponent(file.gardenId)}/files/${encodeURIComponent(file.id)}`
  link.dataset.noPopover = "true"
  const icon = document.createElement("span")
  icon.className = "explorer-file-type"
  icon.textContent = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".") + 1).slice(0, 5).toUpperCase() : "FILE"
  icon.setAttribute("aria-hidden", "true")
  link.prepend(icon)
  link.addEventListener("click", event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey) { link.target = "_top"; return }
    event.preventDefault(); event.stopImmediatePropagation()
    post({ type: "second-brain:open-file", cluster: file.gardenId, fileId: file.id })
  })
  li.addEventListener("contextmenu", event => {
    event.preventDefault(); event.stopPropagation()
    post({ type: "second-brain:open-file", cluster: file.gardenId, fileId: file.id, menu: true })
  })
  if (file.canEdit) {
    li.draggable = true
    li.addEventListener("dragstart", event => {
      event.stopPropagation()
      event.dataTransfer?.setData("application/x-breadboard-file", JSON.stringify({ cluster: file.gardenId, fileId: file.id, revision: file.revision, name: file.name }))
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"
    })
  }
  return true
}

export function decorateFileFolder(node: FileTrieNode, container: HTMLElement, title: HTMLElement, cluster: string, folder: string, diskFolderExists: boolean) {
  const snapshot = snapshots.get(cluster)
  if (!snapshot) return
  const managedFolder = snapshot.files.find(file => file.kind === "folder" && file.path === folder)
  const openFolder = () => post({ type: "second-brain:open-file-folder", cluster, folder, fileId: managedFolder?.id })
  if (managedFolder && folder || !diskFolderExists && folder) {
    title.dataset.gardenFileFolder = "true"
    title.addEventListener("click", event => { event.preventDefault(); event.stopImmediatePropagation(); openFolder() }, { capture: true })
  }
  if (!diskFolderExists && folder) {
    for (const [selector, action] of [[".explorer-folder-copy", "copy"], [".explorer-folder-rename", "rename"], [".explorer-folder-del", "trash"], [".explorer-folder-add", "new"]]) {
      const button = container.querySelector(selector)
      button?.addEventListener("click", event => { event.preventDefault(); event.stopImmediatePropagation(); post({ type: "second-brain:open-file-folder", cluster, folder, fileId: managedFolder?.id, action }) }, { capture: true })
    }
  }
  if (!snapshot.canEdit) {
    container.querySelectorAll(".explorer-folder-copy,.explorer-folder-rename,.explorer-folder-del,.explorer-folder-add").forEach(button => button.remove())
    return
  }
  const button = document.createElement("button")
  button.className = "explorer-folder-action explorer-file-add"
  button.type = "button"; button.title = "Add files"; button.ariaLabel = `Add files to ${folder || "garden"}`
  button.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/></svg>'
  button.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); post({ type: "second-brain:add-files", cluster, folder }) })
  container.appendChild(button)
  container.addEventListener("contextmenu", event => { event.preventDefault(); event.stopPropagation(); openFolder() })
  container.addEventListener("dragover", event => {
    if (!event.dataTransfer || !Array.from(event.dataTransfer.types).some(type => type === "Files" || type === "application/x-breadboard-file")) return
    event.preventDefault(); event.stopPropagation(); container.classList.add("drop-target")
    event.dataTransfer.dropEffect = event.dataTransfer.types.includes("Files") ? "copy" : "move"
  })
  container.addEventListener("dragleave", () => container.classList.remove("drop-target"))
  container.addEventListener("drop", event => {
    container.classList.remove("drop-target")
    const transfer = event.dataTransfer
    if (!transfer) return
    const moved = transfer.getData("application/x-breadboard-file")
    if (moved) {
      event.preventDefault(); event.stopImmediatePropagation()
      try { post({ type: "second-brain:move-file", ...JSON.parse(moved), destinationCluster: cluster, folder }) } catch { /* Ignore unrelated drag data. */ }
    } else if (transfer.types.includes("Files")) {
      event.preventDefault(); event.stopImmediatePropagation()
      void droppedGardenFiles(transfer).then(result => post({ type: "second-brain:import-files", cluster, folder, ...result }))
        .catch(error => post({ type: "second-brain:file-error", error: error.message }))
    }
  }, { capture: true })
}
