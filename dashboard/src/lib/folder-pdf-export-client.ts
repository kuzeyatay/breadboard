export interface FolderPdfExportMessage {
  requestId?: string;
  cluster?: string;
  folderTitle?: string;
  documents?: Array<{
    slug?: string;
    title?: string;
  }>;
}

export interface FolderPdfExportResult {
  type: "second-brain:folder-pdf-result";
  requestId: string;
  ok: boolean;
  error?: string;
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

function fallbackFileName(title: string): string {
  const base = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "folder"}.pdf`;
}

export async function exportFolderPdf(
  message: FolderPdfExportMessage,
  fallbackCluster = "",
): Promise<FolderPdfExportResult> {
  const requestId =
    typeof message.requestId === "string" ? message.requestId : "";
  const clusterSlug =
    typeof message.cluster === "string" && message.cluster.trim()
      ? message.cluster.trim()
      : fallbackCluster.trim();
  const folderTitle =
    typeof message.folderTitle === "string" && message.folderTitle.trim()
      ? message.folderTitle.trim()
      : "Folder";
  const selected = Array.isArray(message.documents)
    ? message.documents.filter(
        (document) =>
          document && typeof document.slug === "string" && document.slug.trim(),
      )
    : [];

  const result = (ok: boolean, error?: string): FolderPdfExportResult => ({
    type: "second-brain:folder-pdf-result",
    requestId,
    ok,
    error,
  });

  if (!requestId || !clusterSlug || selected.length === 0) {
    return result(false, "No Markdown notes were selected.");
  }
  if (selected.length > 500) {
    return result(false, "Select 500 Markdown notes or fewer for one PDF.");
  }

  try {
    const documents: Array<{ content: string; title: string }> = [];
    for (let offset = 0; offset < selected.length; offset += 8) {
      const batch = selected.slice(offset, offset + 8);
      const loaded = await Promise.all(
        batch.map(async (document) => {
          const slug = document.slug!.trim();
          const response = await fetch(
            `/api/documents/${encodeURIComponent(slug)}?clusterSlug=${encodeURIComponent(clusterSlug)}`,
          );
          const body = await response.json().catch(() => ({}));
          if (
            !response.ok ||
            !body.success ||
            typeof body.content !== "string"
          ) {
            throw new Error(
              typeof body.error === "string"
                ? body.error
                : `Could not read ${document.title || slug}`,
            );
          }
          return {
            content: body.content,
            title:
              typeof document.title === "string" && document.title.trim()
                ? document.title.trim()
                : slug,
          };
        }),
      );
      documents.push(...loaded);
    }

    const pdfResponse = await fetch("/api/markdown-to-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clusterSlug,
        title: folderTitle,
        fileName: folderTitle,
        documents,
      }),
    });
    if (!pdfResponse.ok) {
      const body = await pdfResponse.json().catch(() => ({}));
      throw new Error(
        typeof body.error === "string" ? body.error : "Could not create PDF",
      );
    }

    const blob = await pdfResponse.blob();
    downloadBlob(
      blob,
      filenameFromDisposition(
        pdfResponse.headers.get("Content-Disposition"),
        fallbackFileName(folderTitle),
      ),
    );
    return result(true);
  } catch (error) {
    return result(
      false,
      error instanceof Error ? error.message : "Could not export folder PDF.",
    );
  }
}
