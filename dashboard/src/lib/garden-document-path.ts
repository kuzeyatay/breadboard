/** Decode paths sent through Quartz URLs and encoded API route parameters. */
export function decodeSlug(value: string): string {
  let current = value;
  for (let index = 0; index < 4; index += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      current = decoded;
    } catch { break; }
  }
  return current;
}

/** A garden prefix is only a prefix. A basename (or interior folder) with
 * the same name as its garden is still part of the document's identity. */
export function normalizeDocumentPath(clusterSlug: string, input: string): string | null {
  const cluster = clusterSlug.trim();
  let value = decodeSlug(input).trim().replace(/\\/g, '/');
  // Saved dashboard links can carry the actual note in their query string.
  const query = value.indexOf('?');
  if (query >= 0) {
    const note = new URLSearchParams(value.slice(query + 1).split('#')[0]).get('note');
    if (note !== null) value = decodeSlug(note).replace(/\\/g, '/');
  }
  // Strip only a URL's authority; URL.pathname would silently resolve ../.
  value = value.replace(/^(?:https?:)?\/\/[^/?#]+/i, '').replace(/[?#].*$/, '').trim();
  const parts = value.split('/').map(part => part.trim()).filter(Boolean);
  if (parts.some(part => part === '.' || part === '..' || /[:\0]/.test(part))) return null;
  if (parts[0] === 'garden' && parts[1] === cluster) parts.splice(0, 2);
  else if (parts[0] === cluster && parts.length > 1) parts.shift();
  if (!parts.length) return null;
  const last = parts.length - 1;
  parts[last] = parts[last].replace(/\.(?:md|html)$/i, '');
  if (!parts[last] || /^_?index$/i.test(parts[last])) return null;
  return parts.join('/');
}

/** Basename identity used by the document, source PDF, and media APIs. */
export function normalizeDocumentSlug(clusterSlug: string, input: string): string | null {
  return normalizeDocumentPath(clusterSlug, input)?.split('/').at(-1) ?? null;
}
