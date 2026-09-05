export type TopologySourceKind = "pdf" | "link" | "video" | "audio" | "document"

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
  },
  dark: {
    pdf: "#fb7185",
    link: "#60a5fa",
    video: "#f59e0b",
    audio: "#c084fc",
    document: "#4ade80",
  },
}

export type SourceKindInput = {
  kind?: "markdown" | "source" | "internal-concept"
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
