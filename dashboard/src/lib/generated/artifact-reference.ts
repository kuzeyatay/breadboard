// Generated from ../quartz/quartz/util/artifactReference.ts. Do not edit by hand.
/** A note stores an identity; access to the artifact is checked when opened. */
export interface ArtifactReference {
  id: string
  conversationId: string
  title: string
  kind: string
  version?: number
}

export const ARTIFACT_CATEGORIES = ["All", "Documents", "Web & interactive", "Images", "Media", "Data & code", "Files & folders"] as const
export type ArtifactCategory = typeof ARTIFACT_CATEGORIES[number]

export function artifactCategory(item: { kind: string; renderer?: string }): ArtifactCategory {
  if (item.renderer === "interactive-visualizer" || item.kind === "html" || item.kind === "gadget") return "Web & interactive"
  if (["image", "diagram"].includes(item.kind)) return "Images"
  if (["video", "audio", "model"].includes(item.kind)) return "Media"
  if (["data", "code", "spreadsheet"].includes(item.kind)) return "Data & code"
  if (["folder", "unknown"].includes(item.kind)) return "Files & folders"
  return "Documents"
}

export function artifactKindLabel(item: { kind: string; renderer?: string }): string {
  if (item.renderer === "interactive-visualizer") return "Interactive"
  const labels: Record<string, string> = { html: "Web page", pdf: "PDF", document: "Document", markdown: "Note", text: "Text", presentation: "Slides", spreadsheet: "Spreadsheet", image: "Image", video: "Video", audio: "Audio", code: "Code", data: "Data", diagram: "Diagram", model: "3D model", gadget: "App", folder: "Folder", unknown: "File" }
  return labels[item.kind] || "File"
}

export function parseArtifactReference(value: string): ArtifactReference | null {
  try {
    const item = JSON.parse(value)
    if (!item || typeof item !== "object") return null
    const validId = (id: unknown) => typeof id === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(id)
    if (!validId(item.id) || !validId(item.conversationId)) return null
    if (item.version !== undefined && (!Number.isSafeInteger(item.version) || item.version < 1)) return null
    return {
      id: item.id,
      conversationId: item.conversationId,
      title: typeof item.title === "string" ? item.title.slice(0, 240) : "Artifact",
      kind: typeof item.kind === "string" ? item.kind.slice(0, 40) : "artifact",
      ...(item.version === undefined ? {} : { version: item.version }),
    }
  } catch {
    return null
  }
}

export function artifactReferenceMarkdown(reference: ArtifactReference): string {
  const validated = parseArtifactReference(JSON.stringify(reference))
  if (!validated) throw new Error("Invalid artifact reference")
  // A title containing a code fence must never terminate the reference block.
  const json = JSON.stringify(validated).replace(/`/g, "\\u0060")
  return "```artifact\n" + json + "\n```"
}
