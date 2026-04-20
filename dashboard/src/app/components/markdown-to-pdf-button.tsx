"use client";

import { useEffect, useMemo, useState } from "react";

interface ActiveNote {
  clusterSlug: string;
  slug: string;
}

interface ActiveNoteDetail {
  cluster?: string;
  slug?: string;
  isMarkdownDocument?: boolean;
}

interface Props {
  clusterSlug?: string;
  initialNote?: string;
  label?: string;
}

function isMarkdownDocument(
  slug: string | undefined,
  clusterSlug: string,
): slug is string {
  const clean = (slug ?? "")
    .replace(/^\/+|\/+$/g, "")
    .trim()
    .toLowerCase();
  const cleanCluster = clusterSlug.replace(/^\/+|\/+$/g, "").trim().toLowerCase();
  return Boolean(
    clean &&
      clean !== "index" &&
      clean !== cleanCluster &&
      !clean.endsWith("/index") &&
      !clean.endsWith("/_index") &&
      !clean.startsWith("tags/"),
  );
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function filenameFromDisposition(
  disposition: string | null,
  fallback: string,
): string {
  if (!disposition) return fallback;
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return fallback;
    }
  }

  return disposition.match(/filename="?([^";]+)"?/i)?.[1] ?? fallback;
}

export default function MarkdownToPdfButton({
  clusterSlug,
  initialNote,
  label = "PDF",
}: Props) {
  const initialActiveNote = useMemo<ActiveNote | null>(() => {
    if (!clusterSlug) return null;
    if (!isMarkdownDocument(initialNote, clusterSlug)) return null;
    return { clusterSlug, slug: initialNote };
  }, [clusterSlug, initialNote]);
  const [activeNote, setActiveNote] = useState<ActiveNote | null>(
    initialActiveNote,
  );
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setActiveNote(initialActiveNote);
  }, [initialActiveNote]);

  useEffect(() => {
    function handleActiveNote(event: Event) {
      const detail = (event as CustomEvent<ActiveNoteDetail>).detail;
      const fixedCluster = clusterSlug?.trim();
      const eventCluster = detail?.cluster?.trim();
      const noteCluster = fixedCluster || eventCluster;

      if (
        !noteCluster ||
        (fixedCluster && eventCluster !== fixedCluster) ||
        !detail?.isMarkdownDocument ||
        !isMarkdownDocument(detail.slug, noteCluster)
      ) {
        setActiveNote(null);
        return;
      }

      setActiveNote({ clusterSlug: noteCluster, slug: detail.slug });
      setError("");
    }

    window.addEventListener("sb:active-note", handleActiveNote);
    return () => window.removeEventListener("sb:active-note", handleActiveNote);
  }, [clusterSlug]);

  async function handleDownload() {
    if (!activeNote || downloading) return;

    setDownloading(true);
    setError("");

    try {
      const documentResponse = await fetch(
        `/api/documents/${encodeURIComponent(activeNote.slug)}?clusterSlug=${encodeURIComponent(activeNote.clusterSlug)}`,
      );
      const documentBody = await documentResponse.json().catch(() => ({}));
      if (
        !documentResponse.ok ||
        !documentBody.success ||
        typeof documentBody.content !== "string"
      ) {
        throw new Error(
          typeof documentBody.error === "string"
            ? documentBody.error
            : "Could not read markdown",
        );
      }

      const pdfResponse = await fetch("/api/markdown-to-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clusterSlug: activeNote.clusterSlug,
          slug: activeNote.slug,
          fileName:
            typeof documentBody.fileName === "string"
              ? documentBody.fileName
              : activeNote.slug,
          content: documentBody.content,
        }),
      });
      if (!pdfResponse.ok) {
        const body = await pdfResponse.json().catch(() => ({}));
        throw new Error(
          typeof body.error === "string" ? body.error : "Could not create PDF",
        );
      }

      const blob = await pdfResponse.blob();
      const fileName = filenameFromDisposition(
        pdfResponse.headers.get("Content-Disposition"),
        `${activeNote.slug.replace(/^.*\//, "") || "markdown-note"}.pdf`,
      );
      downloadBlob(blob, fileName);
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "Could not download PDF",
      );
    } finally {
      setDownloading(false);
    }
  }

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={handleDownload}
        disabled={!activeNote || downloading}
        title={
          activeNote
            ? "Download current markdown note as PDF"
            : "Open a markdown note to download as PDF"
        }
        className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-gray-700 disabled:hover:text-gray-300"
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"
          />
        </svg>
        {downloading ? "Exporting..." : label}
      </button>
      {error && (
        <span className="absolute right-0 top-full z-20 mt-2 w-64 rounded-lg border border-red-900/70 bg-gray-950 px-3 py-2 text-xs text-red-300 shadow-xl">
          {error}
        </span>
      )}
    </span>
  );
}
