/** PDF identity must survive a desktop port change and not depend on its title. */
export function pdfReadingPositionKey(source: unknown): string | null {
  if (typeof source !== "string" || source.length > 4096 || !source.startsWith("/") ||
      source.startsWith("//") || /[\\\p{Cc}]/u.test(source)) return null;
  const url = new URL(source, "http://breadboard.local");
  url.searchParams.sort();
  return `${url.pathname}${url.search}`;
}

export function validPdfPage(page: unknown): page is number {
  return typeof page === "number" && Number.isSafeInteger(page) && page >= 1 && page <= 1_000_000;
}
