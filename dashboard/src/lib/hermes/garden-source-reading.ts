import { externalRuntimeFilesystem as fs } from '../external-runtime-filesystem.ts';
import { gardenDirectory } from '../garden-directory.ts';
import { localGardenImage } from './garden-visual-descriptions.ts';
import { renderInspectionPdfPages } from './image-inspection.ts';
import type { KnowledgeNode } from '../knowledge.ts';
import type { gardenPageExcerpt } from './garden-reader.ts';
import { readGardenPage } from './garden-reader.ts';
import type { DocumentSkillOrigin } from '../document-skills/types.ts';
import { parseSemanticMarkdown } from '../garden-semantics.ts';
import { withoutDetachedVisualPayloads } from '../garden-detached-visual.ts';

type Excerpt = ReturnType<typeof gardenPageExcerpt>;

/** Exact ingestion page headings identify original PDF positions, not printed
 * page labels. Keep pagination on the same source characters when limiting a
 * multimodal read. No semantic page selection or extra model call is involved. */
export function sourceExcerptPages(body: string, excerpt: Excerpt, maximumPages = 8) {
  const crossCheck = body.search(/^## AnyDoc cross-check[ \t]*\r?$/m);
  const canonicalEnd = crossCheck < 0 ? body.length : crossCheck;
  const headings = [...body.slice(0, canonicalEnd).matchAll(/^## Page ([1-9]\d*)[ \t]*\r?$/gm)];
  const numbers = headings.map(item => Number(item[1]));
  if (new Set(numbers).size !== numbers.length) return { excerpt, pages: [] as number[] };
  const end = excerpt.offset + excerpt.content.length;
  const overlaps = headings.filter((heading, index) => heading.index! < end &&
    (headings[index + 1]?.index ?? canonicalEnd) > excerpt.offset);
  const stop = overlaps[maximumPages]?.index ??
    (overlaps.length && end > canonicalEnd ? canonicalEnd : undefined);
  const clipped = stop === undefined ? excerpt : { ...excerpt,
    content: body.slice(excerpt.offset, stop), truncated: true, nextOffset: stop };
  return { excerpt: clipped, pages: overlaps.slice(0, maximumPages).map(item => Number(item[1])) };
}

/** A teaching read of a paginated PDF includes the original pages beside its
 * extraction. Missing pixels remain explicit; OCR is never labelled verified. */
export async function readGardenSourcePages(contentPath: string, gardenSlug: string, node: KnowledgeNode, excerpt: Excerpt,
  options: { completeSection?: boolean } = {}) {
  if (node.type !== 'source-document' || !node.sourcePdf) return { ...excerpt, sourcePages: [] };
  const reading = sourceExcerptPages(node.content, excerpt, options.completeSection ? Infinity : 8);
  // Document files have no continuation cursor. Never clip their source text
  // merely to limit images; report unavailable pixels instead.
  if (options.completeSection) reading.excerpt = excerpt;
  if (!reading.pages.length) return { ...excerpt, sourcePages: [] };
  try {
    if (reading.pages.length > 32) throw new Error('This section spans too many pages for one image read; original pages remain available through the source figure tool.');
    const root = gardenDirectory(gardenSlug, contentPath);
    const asset = await localGardenImage(root, gardenSlug, node.sourcePdf);
    if (!asset || !/\.pdf$/i.test(asset)) throw new Error('The preserved PDF is unavailable in this Garden.');
    if ((await fs.promises.stat(asset)).size > 128 * 1024 * 1024) throw new Error('PDF exceeds the inspection size limit.');
    const rendered = await renderInspectionPdfPages(await fs.promises.readFile(asset), reading.pages, {});
    if (rendered.pages.reduce((sum, page) => sum + page.screenshot.dataUrl.length, 0) > 30 * 1024 * 1024) {
      throw new Error('The original page images exceed the source read size limit; individual pages remain available through the source figure tool.');
    }
    return { ...reading.excerpt, sourcePages: rendered.pages.map(page => ({ ...page, sourcePdf: node.sourcePdf })),
      sourceTextFormat: 'Extracted text, which can contain transcription errors. Attached images show the original PDF pages.' };
  } catch (error) {
    return { ...reading.excerpt, sourcePages: [], sourcePagesUnavailable: reading.pages,
      sourceTextFormat: 'Extracted text only; the original PDF pages could not be delivered.',
      sourcePageError: error instanceof Error ? error.message : 'Source pages could not be rendered.' };
  }
}

/** Verbatim document sections retain their exact Garden origin. A stale or
 * ambiguous section cannot establish which original PDF pages it represents. */
export async function readDocumentSourcePages(contentPath: string, origin: DocumentSkillOrigin, section: string, returnedText = section) {
  if (origin.kind !== 'garden') return { sourcePages: [] };
  try {
    const { node, rawContent } = await readGardenPage(contentPath, origin.clusterSlug, origin.documentSlug);
    if (!node || node.type !== 'source-document' || !node.sourcePdf) return { sourcePages: [] };
    // Garden display reads trim their body. Verbatim document files preserve
    // the source's final newline, so match against the untrimmed source body.
    const body = withoutDetachedVisualPayloads(parseSemanticMarkdown(rawContent!).body);
    const offset = section ? body.indexOf(section) : -1;
    if (offset < 0 || body.indexOf(section, offset + 1) >= 0) {
      throw new Error('The document section does not uniquely match the preserved Garden source.');
    }
    const length = Math.min(section.length, returnedText.length);
    const reading = await readGardenSourcePages(contentPath, origin.clusterSlug, { ...node, content: body }, {
      content: section.slice(0, length), offset, totalChars: body.length,
      truncated: false, nextOffset: null,
    }, { completeSection: true });
    const { content: _content, offset: _offset, totalChars: _total, truncated: _truncated, nextOffset: _next, ...pages } = reading;
    return pages;
  } catch (error) {
    return { sourcePages: [], sourceTextFormat: 'Extracted text only; the original PDF pages could not be associated with this section.',
      sourcePageError: error instanceof Error ? error.message : 'Source pages unavailable.' };
  }
}
