import { downloadPdf } from "./pdf-download-client";

export type MarkdownExportAction = "copy" | "markdown" | "pdf";

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function copyMarkdown(content: string): Promise<string> {
  try {
    await navigator.clipboard.writeText(content);
  } catch {
    // Clipboard permissions may not be delegated to the Quartz iframe.
    const focused = document.activeElement;
    const selection = window.getSelection();
    const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
    const field = document.createElement("textarea");
    field.value = content;
    field.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
    document.body.append(field);
    field.focus({ preventScroll: true });
    field.select();
    try {
      if (!document.execCommand("copy")) throw new Error("Could not copy Markdown. Try Download .md instead.");
    } finally {
      field.remove();
      if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
      selection?.removeAllRanges();
      for (const range of ranges) selection?.addRange(range);
    }
  }
  return "Markdown copied.";
}

/** Read the canonical source, including frontmatter, for every export. */
export async function exportMarkdownPage(input: {
  clusterSlug: string;
  slug: string;
  action: MarkdownExportAction;
  apiBase?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const { clusterSlug, slug, action, signal } = input;
  const base = (input.apiBase ?? "").replace(/\/+$/, "");
  const response = await fetch(`${base}/api/documents/${encodeURIComponent(slug)}?clusterSlug=${encodeURIComponent(clusterSlug)}`, {
    cache: "no-store", credentials: "include", signal,
  });
  const note = await response.json().catch(() => ({}));
  if (!response.ok || !note.success || typeof note.content !== "string") {
    throw new Error(typeof note.error === "string" ? note.error : "Could not read Markdown. Try again.");
  }
  const filename = (typeof note.fileName === "string" ? note.fileName : slug.split("/").pop() || "note")
    .replace(/^.*[\\/]/, "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\.md$/i, "") || "note";
  if (action === "copy") return copyMarkdown(note.content);
  if (action === "markdown") {
    download(new Blob([note.content], { type: "text/markdown;charset=utf-8" }), `${filename}.md`);
    return "Markdown download started.";
  }
  const pdf = await fetch(`${base}/api/markdown-to-pdf`, {
    method: "POST", credentials: "include", signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clusterSlug, slug: note.sourceSlug ?? slug, fileName: note.fileName ?? `${filename}.md`,
      content: note.content, title: note.title, folderTitle: note.folderTitle }),
  });
  if (!pdf.ok) {
    const body = await pdf.json().catch(() => ({}));
    throw new Error(typeof body.error === "string" ? body.error : "Could not create PDF. Try again.");
  }
  const disposition = pdf.headers.get("Content-Disposition");
  let pdfName = disposition?.match(/filename="?([^";]+)"?/i)?.[1] ?? `${filename}.pdf`;
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) { try { pdfName = decodeURIComponent(encoded); } catch { /* Use the fallback filename. */ } }
  return downloadPdf(await pdf.blob(), pdfName);
}
