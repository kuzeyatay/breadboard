import { pdfReadingPositionKey, validPdfPage } from "./pdf-reading-position.ts";

const ENDPOINT = "/api/pdf-reading-position";
let lastObservedAt = 0;

function cachedPage(key: string): number | null {
  try {
    const page = Number(localStorage.getItem(key));
    return validPdfPage(page) ? page : null;
  } catch { return null; }
}

export async function loadPdfReadingPosition(source: string, legacyKey: string): Promise<number | null> {
  const key = pdfReadingPositionKey(source);
  if (!key) return null;
  try {
    const response = await fetch(`${ENDPOINT}?${new URLSearchParams({ source: key })}`, {
      cache: "no-store", signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const result = await response.json();
      if (validPdfPage(result.page)) return result.page;
      if (result.page === null) {
        const previous = cachedPage(`sb:pdf-page:${key}`) ?? cachedPage(legacyKey);
        if (previous !== null) savePdfReadingPosition(key, previous);
        return previous;
      }
    }
  } catch { /* Keep reading usable while offline; migrate old browser-only positions. */ }
  return cachedPage(`sb:pdf-page:${key}`) ?? cachedPage(legacyKey);
}

export function savePdfReadingPosition(source: string, page: number): void {
  const key = pdfReadingPositionKey(source);
  if (!key || !validPdfPage(page)) return;
  try { localStorage.setItem(`sb:pdf-page:${key}`, String(page)); } catch { /* Storage may be unavailable. */ }
  lastObservedAt = Math.max(Date.now(), lastObservedAt + 1);
  // Save as the page changes, including during a tab close; no shutdown timer to lose.
  void fetch(ENDPOINT, {
    method: "PUT", headers: { "Content-Type": "application/json" }, keepalive: true,
    body: JSON.stringify({ source: key, page, observedAt: lastObservedAt }),
  }).catch(() => {});
}
