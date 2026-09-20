"use client";

import type { PresentedArtifact } from "@/lib/hermes/artifact-types";
import { ArtifactFileIcon, artifactDescription } from "./artifact-viewer";

/** Shared file widget used by the transcript and the artifact archive. */
export default function ArtifactCardContent({ artifact, showVersion = false }: {
  artifact: PresentedArtifact;
  showVersion?: boolean;
}) {
  return <>
    <span className="bb-neu-artifact-preview bb-neu-artifact-preview-tilted inline-flex h-14 w-12 shrink-0 -rotate-3 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] text-[var(--botanical)] shadow-sm [&_svg]:h-5 [&_svg]:w-5 [&_svg]:stroke-current [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round] [&_svg]:[stroke-width:1.6]">
      <ArtifactFileIcon kind={artifact.kind} renderer={artifact.renderer} />
    </span>
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-medium text-[var(--ink-heading)]" title={artifact.title}>{artifact.title}</span>
      <span className="mt-0.5 block text-xs text-[var(--ink-muted)]">
        {artifactDescription(artifact)}{showVersion ? ` · v${artifact.version}` : ""}
      </span>
    </span>
  </>;
}
