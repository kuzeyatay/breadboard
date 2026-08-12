/**
 * Where a Fast-read session gets its words.
 *
 * Ingest turns a PDF into a markdown note that sits beside the file in the
 * garden — the extracted text is never written back into the PDF — so the note
 * is always the better source: it keeps headings, images, and typeset maths that
 * the reader stops on. A PDF with no note behind it (a chat artifact, a file
 * whose note was deleted) falls back to its own text layer, rebuilt here.
 */

export interface FastReadNote {
  title: string;
  content: string;
}

/** Load the markdown of a garden note. Throws with the server's message. */
export async function fetchFastReadNote(
  clusterSlug: string,
  slug: string,
): Promise<FastReadNote> {
  const response = await fetch(
    `/api/documents/${encodeURIComponent(slug)}?clusterSlug=${encodeURIComponent(clusterSlug)}`,
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.success || typeof body.content !== 'string') {
    throw new Error(typeof body.error === 'string' ? body.error : 'Could not read this page');
  }

  return {
    title:
      (typeof body.title === 'string' && body.title.trim()) ||
      (typeof body.fileName === 'string' && body.fileName.replace(/\.md$/i, '')) ||
      slug.replace(/^.*\//, ''),
    content: body.content,
  };
}

/** A page of `getTextContent()`. Items are unknown so marked-content markers pass through. */
export interface PdfTextPageLike {
  items: unknown[];
}

interface PdfTextRun {
  str: string;
  hasEOL: boolean;
}

function textRun(item: unknown): PdfTextRun | null {
  if (!item || typeof item !== 'object') return null;
  const { str, hasEOL } = item as { str?: unknown; hasEOL?: unknown };
  if (typeof str !== 'string') return null;
  return { str, hasEOL: hasEOL === true };
}

/** pdf.js emits runs, not lines; `hasEOL` is where the line actually broke. */
function pageLines(items: unknown[]): string[] {
  const lines: string[] = [];
  let current = '';

  for (const item of items) {
    const run = textRun(item);
    if (!run) continue;
    current += run.str;
    if (run.hasEOL) {
      lines.push(current);
      current = '';
    }
  }
  lines.push(current);

  return lines.map((line) => line.replace(/\s+/g, ' ').trim());
}

/**
 * `environ-` + `ment` is one word, and reading it as two is the loudest artefact
 * of line-based extraction. Only a lowercase continuation is joined, so a real
 * trailing dash before a new sentence survives.
 */
function joinHyphenated(lines: string[]): string[] {
  const out: string[] = [];

  for (const line of lines) {
    const previous = out.at(-1);
    if (previous && /\p{L}-$/u.test(previous) && /^\p{Ll}/u.test(line)) {
      out[out.length - 1] = `${previous.slice(0, -1)}${line}`;
      continue;
    }
    out.push(line);
  }

  return out;
}

const PAGE_LABEL_RE = /^(?:page\s*)?(?:\d{1,4}|[ivxlcdm]+)$/i;

/**
 * Rebuild readable prose from a PDF's own text layer.
 *
 * Two things make a raw extraction unreadable one word at a time: words split
 * across a line break, and the running head, footer, and page number that repeat
 * on every page. Both are dropped; everything else is left as written.
 */
export function pdfTextToMarkdown(pages: PdfTextPageLike[]): string {
  const perPage = pages.map((page) => pageLines(page?.items ?? []));
  const pageCount = perPage.length;

  // A short line that shows up on more than half the pages is furniture, not prose.
  const pagesWithLine = new Map<string, number>();
  for (const lines of perPage) {
    for (const line of new Set(lines)) {
      if (!line || line.length > 80) continue;
      pagesWithLine.set(line, (pagesWithLine.get(line) ?? 0) + 1);
    }
  }

  const isFurniture = (line: string): boolean =>
    Boolean(line) &&
    (PAGE_LABEL_RE.test(line) ||
      (pageCount >= 3 && (pagesWithLine.get(line) ?? 0) > pageCount / 2));

  return perPage
    .map((lines) => joinHyphenated(lines.filter((line) => !isFurniture(line))).join('\n'))
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
