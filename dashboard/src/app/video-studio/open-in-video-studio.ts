import { openInDesktopTab } from "@/lib/desktop-browser-tabs";
import type { PresentedArtifact } from "@/lib/hermes/artifact-types";

/** Editing a chat video opens it in Video Studio, in its own tab, with Bread beside it. */
export function openVideoInStudio(artifact: PresentedArtifact): void {
  const href = `/spaces/edit?${new URLSearchParams({ app: "video", artifact: artifact.id, conversation: artifact.conversationId, title: artifact.title, kind: artifact.kind })}`;
  void openInDesktopTab(href).then(opened => { if (!opened) window.open(href, "_blank", "noopener"); });
}
