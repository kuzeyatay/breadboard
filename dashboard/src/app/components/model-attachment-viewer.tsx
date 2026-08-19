"use client";

// An attached 3D file, in a chat.
//
// The card is the resting state and shows what was read out of the file when it
// was stored — format, size, triangle count, envelope — so a transcript full of
// meshes is still readable without opening any of them.
//
// Nothing is rendered until asked. A browser allows only a handful of live
// WebGL contexts, and a long conversation can hold more models than that, so
// mounting a canvas per attachment would make old previews go black as new ones
// appeared. Preview and full screen are therefore two states of one viewer, and
// only one of them is mounted at a time.

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ModelCubeIcon from "@/app/components/model-cube-icon";
import type { ModelViewerHandle, StandardView } from "@/app/components/cad/model-viewer";
import type { ChatMessageAttachment } from "@/lib/chat-attachments";
import {
  defaultModelUpAxis,
  formatModelSize,
  modelAttachmentHref,
  modelFormatLabel,
  modelPreviewStrategy,
  type ModelAttachmentSummary,
} from "@/lib/model-attachments";

// three.js needs a real WebGL context, so the viewer only exists in the browser.
const ModelViewer = dynamic(() => import("@/app/components/cad/model-viewer"), {
  ssr: false,
  loading: () => (
    <p className="flex h-full items-center justify-center text-sm text-[var(--ink-muted)]">
      Loading the 3D viewer…
    </p>
  ),
});

type ModelAttachment = Extract<ChatMessageAttachment, { type: "model" }>;

const STANDARD_VIEWS: Array<{ id: StandardView; label: string }> = [
  { id: "isometric", label: "Iso" },
  { id: "front", label: "Front" },
  { id: "top", label: "Top" },
  { id: "right", label: "Right" },
];

const toggleBase =
  "rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors";
const toggleOff =
  `${toggleBase} border-[var(--line)] bg-[var(--paper-strong)] text-[var(--ink)] hover:bg-[var(--paper-raised)]`;
const toggleOn =
  `${toggleBase} border-[var(--botanical)] bg-[color-mix(in_srgb,var(--botanical)_18%,transparent)] text-[var(--ink-heading)]`;

/** The stats worth stating up front, in the order they answer "what is this". */
function summaryLine(summary: ModelAttachmentSummary | undefined): string | null {
  if (!summary) return null;
  const parts: string[] = [];
  if (summary.triangles !== undefined) {
    parts.push(`${summary.triangles.toLocaleString()} triangles`);
  } else if (summary.vertices !== undefined) {
    parts.push(`${summary.vertices.toLocaleString()} vertices`);
  }
  if (summary.meshes !== undefined && summary.meshes > 1) {
    parts.push(`${summary.meshes.toLocaleString()} meshes`);
  }
  if (summary.materials !== undefined) {
    parts.push(`${summary.materials} material${summary.materials === 1 ? "" : "s"}`);
  }
  if (summary.animations !== undefined) {
    parts.push(`${summary.animations} animation${summary.animations === 1 ? "" : "s"}`);
  }
  if (summary.extent) {
    const round = (value: number) => Number(value.toPrecision(3)).toLocaleString();
    parts.push(
      `${round(summary.extent.x)} × ${round(summary.extent.y)} × ${round(summary.extent.z)}`,
    );
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export default function ModelAttachmentViewer({
  attachment,
}: {
  attachment: ModelAttachment;
}) {
  // What actually draws. A STEP file is viewed through the glTF mesh the CAD
  // service made of it; everything else is viewed through its own bytes.
  const drawn = attachment.previewBlobId
    ? { blobId: attachment.previewBlobId, format: attachment.previewFormat ?? "glb" }
    : { blobId: attachment.blobId, format: attachment.format };
  const viewable =
    Boolean(attachment.previewBlobId) || modelPreviewStrategy(attachment.format) === "three";

  const [mode, setMode] = useState<"closed" | "inline" | "fullscreen">("closed");
  const [wireframe, setWireframe] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [upAxis, setUpAxis] = useState<"y" | "z">(() => defaultModelUpAxis(drawn.format));
  const viewer = useRef<ModelViewerHandle | null>(null);

  const source = modelAttachmentHref(drawn.blobId);
  const stats = summaryLine(attachment.summary);
  const notes = attachment.summary?.notes ?? [];

  const close = useCallback(() => setMode("closed"), []);

  useEffect(() => {
    if (mode !== "fullscreen") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMode("closed");
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mode]);

  const controls = (
    <div className="flex flex-wrap items-center gap-1.5">
      {STANDARD_VIEWS.map((view) => (
        <button
          key={view.id}
          type="button"
          className={toggleOff}
          onClick={() => viewer.current?.setView(view.id)}
        >
          {view.label}
        </button>
      ))}
      <button
        type="button"
        className={wireframe ? toggleOn : toggleOff}
        onClick={() => setWireframe((current) => !current)}
      >
        Wireframe
      </button>
      <button
        type="button"
        className={showGrid ? toggleOn : toggleOff}
        onClick={() => setShowGrid((current) => !current)}
      >
        Grid
      </button>
      <button
        type="button"
        className={toggleOff}
        onClick={() => setUpAxis((current) => (current === "y" ? "z" : "y"))}
        title="Most formats do not record which way is up. Flip this if the model is lying on its side."
      >
        {upAxis === "y" ? "Y-up" : "Z-up"}
      </button>
    </div>
  );

  const canvas = (
    <ModelViewer
      source={source}
      format={drawn.format}
      presentation="asset"
      upAxis={upAxis}
      gridUnit="units"
      wireframe={wireframe}
      showGrid={showGrid}
      handleRef={viewer}
    />
  );

  return (
    <>
      <div className="neu-surface-raised w-full max-w-[min(34rem,80vw)] overflow-hidden rounded-[22px] border border-[var(--line)] text-left">
        <div className="flex items-start gap-2.5 px-3 py-2.5">
          <span className="neu-inset mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--line)] text-[var(--botanical)]">
            <ModelCubeIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-[var(--ink-heading)]" title={attachment.name}>
              {attachment.name}
            </p>
            <p className="truncate text-[11px] text-[var(--ink-muted)]">
              {modelFormatLabel(attachment.format)}
              {attachment.sizeBytes !== undefined ? ` · ${formatModelSize(attachment.sizeBytes)}` : ""}
            </p>
            {stats ? (
              <p className="mt-0.5 truncate text-[11px] text-[var(--ink-muted)]" title={stats}>
                {stats}
              </p>
            ) : null}
          </div>
        </div>

        {notes.length > 0 ? (
          <p className="px-3 pb-2 text-[11px] leading-snug text-[var(--ink-muted)]">
            {notes.join(" ")}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--line)] px-3 py-2">
          {viewable ? (
            <>
              <button
                type="button"
                className={toggleOff}
                onClick={() => setMode((current) => (current === "inline" ? "closed" : "inline"))}
              >
                {mode === "inline" ? "Hide preview" : "Preview in 3D"}
              </button>
              <button type="button" className={toggleOff} onClick={() => setMode("fullscreen")}>
                Full screen
              </button>
            </>
          ) : (
            // No preview button at all rather than one that opens an error: the
            // note above already says why, and offering it would be a lie.
            <span className="text-[11px] text-[var(--ink-muted)]">No 3D preview available</span>
          )}
          <a
            href={modelAttachmentHref(attachment.blobId, { download: true })}
            download={attachment.name}
            className={`${toggleOff} ml-auto`}
          >
            Download original
          </a>
        </div>

        {mode === "inline" ? (
          <div className="border-t border-[var(--line)]">
            <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">{controls}</div>
            <div className="h-[min(46vh,340px)] min-h-[220px] w-full bg-[var(--paper-surface)]">
              {canvas}
            </div>
          </div>
        ) : null}
      </div>

      {mode === "fullscreen" && typeof document !== "undefined" ? createPortal(
        <div
          className="fixed inset-0 z-[200] flex flex-col bg-[var(--paper)] p-3 sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-label={`3D preview: ${attachment.name}`}
        >
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p className="mr-auto min-w-0 truncate text-sm font-medium text-[var(--ink-heading)]">
              {attachment.name}
            </p>
            {controls}
            <a
              href={modelAttachmentHref(attachment.blobId, { download: true })}
              download={attachment.name}
              className={toggleOff}
            >
              Download
            </a>
            <button
              type="button"
              onClick={close}
              className="grid h-8 w-8 place-items-center rounded-full border border-[var(--line)] bg-[var(--paper-raised)] text-[var(--ink)] transition hover:bg-[var(--paper-strong)]"
              aria-label="Close 3D preview"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)]">
            {canvas}
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
