"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import GardenFileViewer from "@/app/garden/garden-file-viewer";
import type { GardenFileEntry } from "@/lib/garden-files/types";
import { spacesKindForPath } from "@/lib/office/types";
import SpacesShell, { type SpacesGarden } from "../spaces-shell";

/** A Spaces document or page, full width, with its Garden's assistant in the corner. */
export default function SpacesEditor({ showFlowers, garden, file: initial, ask }: { showFlowers: boolean; garden: SpacesGarden; file: GardenFileEntry; ask: string | null }) {
  const router = useRouter();
  const [file, setFile] = useState(initial);
  const asked = useRef(false);

  // "Ask Bread" from Spaces: attach the file to Bread's chat with the instruction ready (a page hands over its text instead).
  useEffect(() => {
    if (ask === null || asked.current) return;
    asked.current = true;
    const url = new URL(location.href); url.searchParams.delete("ask"); history.replaceState(history.state, "", url);
    const event = file.capabilities.viewer === "affine"
      ? new CustomEvent("sb:assistant-prefill", { detail: { text: `${ask}\n\n(The page "${file.name}" is open in Spaces; its text is in this Garden's notes.)` } })
      : new CustomEvent("sb:garden-file-use", { detail: { file, action: "chat", instruction: ask } });
    // The assistant mounts its listeners in the same commit; dispatch once it has.
    requestAnimationFrame(() => window.dispatchEvent(event));
  }, [ask, file]);

  const kind = spacesKindForPath(file.path);
  return (
    <SpacesShell showFlowers={showFlowers} garden={garden} trail={[kind?.label ?? "File"]} pageKey={`file:${file.id}`} initialAssistantOpen={ask !== null}>
      <GardenFileViewer file={file} startEditing={file.canEdit} onChanged={entry => { if (entry.deletedAt) router.push("/spaces"); else setFile(entry); }} onClose={() => router.push("/spaces")} />
    </SpacesShell>
  );
}
