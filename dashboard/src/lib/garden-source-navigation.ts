/** Turn a canonical Garden source asset into its reader, retaining the citation page. */
export function gardenSourcePdfViewerHref(href: string): string | null {
  // Only root-relative Garden paths: never reinterpret a remote site's assets.
  const match = /^\/([^/?#]+)\/assets\/([^/?#]+)-source\.pdf(\?[^#]*)?(#.*)?$/i.exec(href);
  if (!match) return null;
  try {
    const garden = decodeURIComponent(match[1]);
    const source = decodeURIComponent(match[2]);
    if ([garden, source].some(part => !part || part.startsWith('.') || /[\\/:\p{Cc}]/u.test(part))) return null;
    return `/gardens/${encodeURIComponent(garden)}/pdf/${encodeURIComponent(source)}${match[3] ?? ''}${match[4] ?? ''}`;
  } catch {
    return null;
  }
}

/** A citation's explicit page wins over the last page remembered for the PDF. */
export function pdfCitationPage(hash: string): number | null {
  const value = new URLSearchParams(hash.replace(/^#/, '')).get('page');
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const page = Number(value);
  return Number.isSafeInteger(page) ? page : null;
}
