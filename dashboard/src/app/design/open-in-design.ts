import { openInDesktopTab } from "@/lib/desktop-browser-tabs";
import type { PresentedArtifact } from "@/lib/hermes/artifact-types";

/** Editing a chat image opens it on the Design page, in its own tab, with Bread beside it. */
export function openImageInDesign(artifact: PresentedArtifact): void {
  const href = `/design?${new URLSearchParams({ artifact: artifact.id, conversation: artifact.conversationId, title: artifact.title })}`;
  void openInDesktopTab(href).then(opened => { if (!opened) window.open(href, "_blank", "noopener"); });
}
