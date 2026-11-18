import { generatedVisualDashboardBaseUrl } from "./generatedVisualHost.ts"

export type TopologySourceKind = "pdf" | "link" | "video" | "audio" | "document" | "chat"

export type SourceNodeTheme = "light" | "dark"

/** The medium palette is shared by Thought Topology and every Quartz surface
 * that represents the same source node. */
export const TOPOLOGY_SOURCE_COLORS: Record<SourceNodeTheme, Record<TopologySourceKind, string>> = {
  light: {
    pdf: "#be123c",
    link: "#2563eb",
    video: "#b45309",
    audio: "#7e22ce",
    document: "#15803d",
    chat: "#0f766e",
  },
  dark: {
    pdf: "#fb7185",
    link: "#60a5fa",
    video: "#f59e0b",
    audio: "#c084fc",
    document: "#4ade80",
    chat: "#2dd4bf",
  },
}

export type SourceKindInput = {
  kind?: "markdown" | "source" | "internal-concept" | "chat"
  knowledgeType?: string
  sourceType?: string
  title: string
  relPath: string
}

/** Normalize the source metadata emitted by Garden ingestion. Older artifacts
 * may not carry `sourceType`, so filenames and titles remain a best-effort
 * fallback until the next rebuild. */
export function topologySourceKind(
  node: SourceKindInput,
  folderPath = "",
): TopologySourceKind | null {
  if (node.kind === "chat") return "chat"
  const isSource =
    node.kind === "source" ||
    node.knowledgeType === "source-document" ||
    folderPath
      .replace(/\\/g, "/")
      .split("/")
      .some((part) => part.toLocaleLowerCase() === "sources")
  if (!isSource) return null

  const sourceType = node.sourceType?.trim().toLocaleLowerCase() ?? ""
  const fallback = `${node.title} ${node.relPath}`.toLocaleLowerCase()
  if (sourceType.includes("audio") || /\.(?:aac|flac|m4a|mp3|ogg|opus|wav)(?:\s|$)/i.test(fallback))
    return "audio"
  if (
    sourceType === "youtube" ||
    sourceType.includes("video") ||
    /(?:youtube\.com|youtu\.be|\.(?:avi|m4v|mkv|mov|mp4|webm)(?:\s|$))/i.test(fallback)
  )
    return "video"
  if (
    sourceType === "url" ||
    sourceType === "link" ||
    sourceType === "web" ||
    sourceType.includes("website") ||
    sourceType.includes("web-page") ||
    /(?:https?:\/\/|www\.)/i.test(fallback)
  )
    return "link"
  if (sourceType.includes("pdf") || /\.pdf(?:\s|$)/i.test(fallback)) return "pdf"
  return "document"
}

/** The dashboard adds the viewer's own chats to the map as `chat:<id>` nodes
 * inside the virtual `folder:$chats`; neither is a published Quartz page. */
export const TOPOLOGY_CHATS_FOLDER_ID = "folder:$chats"

/** "PDF source", "Video source", "Your chat". */
export function topologySourceLabel(kind: TopologySourceKind): string {
  if (kind === "chat") return "Your chat"
  return `${kind === "pdf" ? "PDF" : kind[0].toUpperCase() + kind.slice(1)} source`
}

/** Opens a chat node in the Garden's chat panel, at the answer its slug names
 * (`chat:<id>#<answer id>`). False when the node is not a chat. */
export function openTopologyChat(nodeId: string, navigateSlug = ""): boolean {
  const chatId = /^chat:(\d+)$/.exec(nodeId)?.[1]
  if (!chatId) return nodeId === TOPOLOGY_CHATS_FOLDER_ID
  const messageId = navigateSlug.split("#")[1] ?? ""
  const chatLink = messageId
    ? { chatId, selectionId: "", messageId, surface: "garden" }
    : { chatId, selectionId: "topology", surface: "garden" }
  if (window.parent !== window) {
    const dashboard = generatedVisualDashboardBaseUrl(
      window.location.href,
      document.referrer,
      window.location.ancestorOrigins?.[0],
    )
    window.parent.postMessage({ type: "second-brain:assistant-open-chat", chatLink }, dashboard)
  } else {
    window.dispatchEvent(new CustomEvent("breadboard:assistant-open-chat", { detail: { chatLink } }))
  }
  return true
}
