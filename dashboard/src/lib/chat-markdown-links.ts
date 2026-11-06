import { gardenSourcePdfViewerHref } from './garden-source-navigation.ts';

function validSegment(segment: string): boolean {
  return Boolean(segment) && !segment.startsWith('.') && !/[\\/:?#\p{Cc}]/u.test(segment);
}

/** Build a reader URL from the exact, unencoded path returned by Garden tools. */
export function gardenDocumentHref(garden: string, relPath: string): string | null {
  if (!validSegment(garden)) return null;
  const parts = relPath.split('/');
  if (!parts.every(validSegment)) return null;
  const note = relPath.replace(/\.md$/i, '');
  return `/garden/${encodeURIComponent(garden)}?note=${encodeURIComponent(note)}`;
}

/** Resolve model citations before react-markdown discards unknown protocols. */
export function chatMarkdownHref(value: string): string | null {
  const href = value.trim();
  if (!href || href === '#' || /[\\\p{Cc}]/u.test(href)) return null;

  if (/^garden:/i.test(href)) {
    const match = /^garden:(?:\/\/)?([^/?#]+)\/([^?#]+)(#[^\s]*)?$/i.exec(href);
    if (!match) return null;
    try {
      const garden = decodeURIComponent(match[1]);
      const parts = match[2].split('/').map(decodeURIComponent);
      if (!validSegment(garden) || !parts.every(validSegment)) return null;
      const path = parts.join('/');
      const hash = match[3] ?? '';
      const pdf = gardenSourcePdfViewerHref(
        `/${encodeURIComponent(garden)}/${parts.map(encodeURIComponent).join('/')}${hash}`,
      );
      if (pdf) return pdf;
      // Garden page citations describe Markdown, not arbitrary local files.
      if (parts[0] === 'assets' || /\.[a-z0-9]+$/i.test(path) && !/\.md$/i.test(path)) return null;
      const reader = gardenDocumentHref(garden, path);
      return reader ? reader + hash : null;
    } catch {
      return null;
    }
  }

  if (/^https?:\/\//i.test(href) || href.startsWith('//')) {
    try {
      const url = new URL(href.startsWith('//') ? `https:${href}` : href);
      return url.hostname ? href : null;
    } catch {
      return null;
    }
  }
  if (/^mailto:[^\s]+$/i.test(href)) return href;
  // Preserve native app routes and Markdown footnotes. A relative disk path
  // has no reliable base in a chat and must not become a broken browser tab.
  if (href.startsWith('/')) return gardenSourcePdfViewerHref(href) ?? href;
  if (href.startsWith('#')) return href;
  return null;
}
