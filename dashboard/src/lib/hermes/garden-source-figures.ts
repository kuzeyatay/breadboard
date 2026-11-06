// Inspect preserved visual evidence without starting extraction or a Garden build.
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { gardenDirectory } from "../garden-directory.ts";
import { gardenReadEntries, readGardenPage } from "./garden-reader.ts";
import type { KnowledgeNode } from "../knowledge.ts";
import type { SourceVisual } from "../source-visuals.ts";
import { sourceImageReferences, compactVisualText, visualSearchTerms, normalizeVisualSearchText, genericVisualCaption } from "./garden-visual-context.ts";
import { cachedVisualDescription, localGardenImage, loadVisualDescriptions, readVisualDescription, type VisualDescriptionCache } from "./garden-visual-descriptions.ts";

interface FigureCandidate {
  sourceVisualId?: string;
  caption: string;
  type: string;
  pageNumber?: number;
  imagePath?: string;
  unreliable?: boolean;
  context?: string;
  timestamp?: string;
  description?: string;
  visibleText?: string;
  descriptionSource?: "visual_detection" | "vision" | "source_caption" | "context_only";
}

function integer(value: unknown, fallback: number, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(0, Math.floor(n))) : fallback;
}

/** Resolve Markdown-relative image links before reusing them in another note. */
function gardenImagePath(gardenSlug: string, relPath: string, imagePath?: string): string | undefined {
  if (!imagePath || imagePath.startsWith("/")) return imagePath;
  if (/^[a-z][a-z\d+.-]*:|[\\\u0000-\u001f]/i.test(imagePath)) return imagePath;
  const directory = path.posix.dirname(`/${gardenSlug}/${relPath.replace(/\\/g, "/")}`);
  return path.posix.normalize(`${directory}/${imagePath}`);
}

async function readFigureCatalog(contentPath: string, gardenSlug: string) {
  const root = await fs.promises.realpath(gardenDirectory(gardenSlug, contentPath));
  let visuals: SourceVisual[] = [];
  let catalogWarning: string | undefined;
  try {
    const ledger = await fs.promises.realpath(path.join(root, ".breadboard", "source-visuals.json"));
    if (!ledger.startsWith(root + path.sep)) throw new Error("Visual catalog is outside this Garden.");
    const parsed = JSON.parse(await fs.promises.readFile(ledger, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("Invalid visual catalog.");
    visuals = parsed;
  } catch (error) {
    if (!["ENOENT", "ENOTDIR"].includes(String((error as NodeJS.ErrnoException).code))) {
      catalogWarning = "The source visual catalog could not be read; only embedded Markdown images are listed.";
    }
  }
  return { root, visuals, catalogWarning };
}

async function readFigureDescriptions(root: string, catalogWarning?: string, imagePaths?: readonly string[]) {
  let descriptions: VisualDescriptionCache = new Map();
  try { descriptions = await loadVisualDescriptions(root, imagePaths); }
  catch { catalogWarning = [catalogWarning, "Saved visual descriptions could not be read; source captions and context remain searchable."].filter(Boolean).join(" "); }
  return { catalogWarning, descriptions };
}

function figureCandidates(gardenSlug: string, node: KnowledgeNode, visuals: SourceVisual[], args: Record<string, unknown>) {
  const sourceId = node.type === "source-document" ? node.slug
    : path.posix.basename(node.sourceDocument.replace(/\\/g, "/")).replace(/\.md$/i, "") || node.slug;
  const sourceVisuals = visuals.filter((visual) => visual?.sourceId === sourceId);
  // Most learning notes have no figures. Avoid parsing their full Markdown AST
  // just to discover that; the parser still decides which image syntax is real.
  if (!sourceVisuals.length && !node.sourceImages?.length &&
    !node.content.includes("![") && !/<img[\s/>]/i.test(node.content)) return [];
  const references = sourceImageReferences(node.content, node.sourceImages);
  const candidates: FigureCandidate[] = sourceVisuals
    .map((visual) => ({ sourceVisualId: visual.sourceVisualId, caption: visual.caption || "Source figure",
      type: visual.croppedImagePath ? visual.type : "full_page_fallback", pageNumber: visual.pageNumber,
      imagePath: visual.croppedImagePath || visual.pageImagePath,
      unreliable: visual.cropStatus === "omitted_unreliable",
      context: references.pageContext(visual.pageNumber), visibleText: visual.exactText,
      descriptionSource: genericVisualCaption(visual.caption ?? "") ? "context_only" : "visual_detection",
    }));
  for (const candidate of candidates) candidate.imagePath = gardenImagePath(gardenSlug, node.relPath, candidate.imagePath);
  const knownPaths = new Map(candidates.map((candidate) => [candidate.imagePath, candidate]));
  for (const reference of references.images) {
    const candidate: FigureCandidate = { ...reference,
      type: /-page-\d+\.(png|jpe?g|webp)$/i.test(reference.imagePath) ? "full_page_fallback" : "image",
      descriptionSource: genericVisualCaption(reference.caption)
        ? "context_only" : "source_caption" };
    candidate.imagePath = gardenImagePath(gardenSlug, node.relPath, candidate.imagePath);
    const existing = knownPaths.get(candidate.imagePath);
    if (existing) {
      existing.context = compactVisualText(`${existing.context ?? ""}\n${candidate.context ?? ""}`);
      existing.timestamp ??= candidate.timestamp;
    } else { candidates.push(candidate); knownPaths.set(candidate.imagePath, candidate); }
  }
  const pageStart = integer(args.pageStart, 0);
  const pageEnd = integer(args.pageEnd, Number.MAX_SAFE_INTEGER);
  return candidates.filter((candidate) =>
    ((args.pageStart === undefined && args.pageEnd === undefined) ||
      (candidate.pageNumber !== undefined && candidate.pageNumber >= pageStart && candidate.pageNumber <= pageEnd)));
}

async function renderFigure(root: string, gardenSlug: string, candidate: FigureCandidate, descriptions: VisualDescriptionCache) {
  const asset = !candidate.unreliable ? await localGardenImage(root, gardenSlug, candidate.imagePath) : null;
  const available = Boolean(asset);
  const description = asset && candidate.imagePath ? await readVisualDescription(root, candidate.imagePath, asset, descriptions) : null;
  if (description) candidate = { ...candidate, caption: description.caption, description: description.description,
    visibleText: description.visibleText, descriptionSource: "vision" };
  const caption = candidate.caption.replace(/[\\\[\]\r\n]/g, " ").replace(/\s+/g, " ").trim();
  // Angle brackets preserve spaces/parentheses in observed asset paths.
  const url = candidate.imagePath?.replace(/</g, "%3C").replace(/>/g, "%3E");
  return { ...candidate, unreliable: undefined,
    availability: candidate.unreliable ? "omitted_unreliable" : available ? "available" : "missing_or_not_local",
    markdown: available ? `![${caption}](<${url}>)` : null,
  };
}

function matchScore(figure: FigureCandidate, node: KnowledgeNode, terms: string[]): number {
  if (!terms.length) return 1;
  const direct = normalizeVisualSearchText(`${figure.caption} ${figure.description ?? ""} ${figure.visibleText ?? ""} ${figure.sourceVisualId ?? ""}`);
  const context = normalizeVisualSearchText(figure.context ?? "");
  const metadata = normalizeVisualSearchText(`${figure.imagePath ?? ""} ${node.title} ${node.relPath}`);
  if (!terms.every(term => `${direct} ${context} ${metadata}`.includes(term))) return 0;
  return terms.reduce((score, term) => score + (direct.includes(term) ? 8 : context.includes(term) ? 3 : 1), 0);
}

async function matchingFigures(root: string, gardenSlug: string, node: KnowledgeNode,
  candidates: FigureCandidate[], descriptions: VisualDescriptionCache, terms: string[]) {
  // A saved description may be stale, so either its text OR the original source
  // can admit a candidate. Only renderFigure's asset checks establish evidence.
  const plausible = candidates.filter(candidate => {
    if (matchScore(candidate, node, terms)) return true;
    const description = cachedVisualDescription(candidate.imagePath ?? "", descriptions);
    return description && matchScore({ ...candidate, caption: description.caption,
      description: description.description, visibleText: description.visibleText }, node, terms);
  });
  const matches = [];
  for (let start = 0; start < plausible.length; start += 16) {
    const batch = await Promise.all(plausible.slice(start, start + 16).map(async candidate => {
      const figure = await renderFigure(root, gardenSlug, candidate, descriptions);
      return { ...figure, score: matchScore(figure, node, terms) };
    }));
    matches.push(...batch.filter(figure => figure.score > 0));
  }
  return matches;
}

/** Rank against full page context, but return a preview instead of repeating it per image. */
function figurePreview<T extends FigureCandidate>(figure: T): T & { contextTruncated?: boolean } {
  if (!figure.context || figure.context.length <= 320) return figure;
  return { ...figure, context: `${figure.context.slice(0, 319).replace(/[\uD800-\uDBFF]$/, "")}…`, contextTruncated: true };
}

function selectSnapshots<T extends { type: string; availability: string }>(figures: T[], args: Record<string, unknown>): T[] {
  if (args.includePageSnapshots === true) return figures;
  const crops = figures.filter(figure => figure.type !== "full_page_fallback");
  // A source with no usable matching crop can still answer via its page/frame.
  if (args.includePageSnapshots !== false && typeof args.query === "string" && args.query.trim() &&
    !crops.some(figure => figure.availability === "available")) return figures;
  return crops;
}

export async function gardenSourceFigures(contentPath: string, gardenSlug: string, node: KnowledgeNode, args: Record<string, unknown>) {
  const catalog = await readFigureCatalog(contentPath, gardenSlug);
  const { root, visuals } = catalog;
  if (args.pdfPage !== undefined) {
    if (args.imagePath !== undefined) throw new Error("Choose pdfPage or imagePath for one inspection.");
    if (typeof args.pdfPage !== "number" || !Number.isInteger(args.pdfPage) || args.pdfPage < 1) {
      throw new Error("pdfPage must be a positive integer.");
    }
    const asset = await localGardenImage(root, gardenSlug, node.sourcePdf);
    if (!asset || !/\.pdf$/i.test(asset)) throw new Error("This page has no preserved PDF in the authorized Garden.");
    if ((await fs.promises.stat(asset)).size > 128 * 1024 * 1024) throw new Error("PDF exceeds the inspection size limit.");
    const { renderInspectionPdfPage } = await import("./image-inspection.ts");
    const figure: FigureCandidate = { type: "pdf_page", caption: `Source PDF page ${args.pdfPage}`, pageNumber: args.pdfPage };
    return { slug: node.slug, relPath: node.relPath, sourcePdf: node.sourcePdf,
      anchors: node.sourceAnchors.slice(0, 12),
      figures: [{ ...figure, availability: "available", markdown: null }], total: 1, offset: 0, nextOffset: null,
      ...await renderInspectionPdfPage(await fs.promises.readFile(asset), args.pdfPage, args) };
  }
  if (args.imagePath !== undefined) {
    if (typeof args.imagePath !== "string") throw new Error("Choose an imagePath from this page's figure inventory.");
    const candidate = figureCandidates(gardenSlug, node, visuals, {}).find(figure => figure.imagePath === args.imagePath);
    if (!candidate || candidate.unreliable) throw new Error("That image is not an inspectable figure on this page.");
    const asset = await localGardenImage(root, gardenSlug, candidate.imagePath);
    if (!asset) throw new Error("This figure's image is unavailable in the authorized Garden.");
    if ((await fs.promises.stat(asset)).size > 20 * 1024 * 1024) throw new Error("Image exceeds the inspection size limit.");
    const { descriptions } = await readFigureDescriptions(root, catalog.catalogWarning, [args.imagePath]);
    const { renderInspectionImage } = await import("./image-inspection.ts");
    return { slug: node.slug, relPath: node.relPath, sourcePdf: node.sourcePdf,
      anchors: node.sourceAnchors.slice(0, 12),
      figures: [figurePreview(await renderFigure(root, gardenSlug, candidate, descriptions))],
      total: 1, offset: 0, nextOffset: null,
      ...await renderInspectionImage(await fs.promises.readFile(asset), args),
    };
  }
  const terms = visualSearchTerms(typeof args.query === "string" ? args.query : "");
  const offset = integer(args.offset, 0);
  const limit = Math.max(1, integer(args.limit, 12, 50));
  const candidates = figureCandidates(gardenSlug, node, visuals, args);
  const inventory = candidates.filter(candidate => args.includePageSnapshots === true || candidate.type !== "full_page_fallback");
  const selected = terms.length ? candidates : inventory.slice(offset, offset + limit);
  const { descriptions, catalogWarning } = await readFigureDescriptions(root, catalog.catalogWarning,
    selected.flatMap(candidate => candidate.imagePath && !candidate.unreliable ? [candidate.imagePath] : []));
  if (!terms.length) {
    const figures = await Promise.all(selected.map(candidate => renderFigure(root, gardenSlug, candidate, descriptions)));
    return { slug: node.slug, relPath: node.relPath, sourcePdf: node.sourcePdf,
      anchors: node.sourceAnchors.slice(0, 12), figures: figures.map(figurePreview), total: inventory.length, offset,
      nextOffset: offset + limit < inventory.length ? offset + limit : null,
      ...(catalogWarning ? { warning: catalogWarning } : {}) };
  }
  const rendered = await matchingFigures(root, gardenSlug, node, candidates, descriptions, terms);
  const matches = selectSnapshots(rendered, args).sort((a, b) => b.score - a.score);
  const figures = matches.slice(offset, offset + limit).map(figurePreview);
  return { slug: node.slug, relPath: node.relPath, sourcePdf: node.sourcePdf,
    anchors: node.sourceAnchors.slice(0, 12), figures, total: matches.length, offset,
    nextOffset: offset + limit < matches.length ? offset + limit : null,
    ...(catalogWarning ? { warning: catalogWarning } : {}),
  };
}

/** One catalog read per Garden for durable backfills, with source-first deduplication. */
export async function* inventoryGardenSourceFigures(contentPath: string, gardenSlug: string) {
  const { root, visuals } = await readFigureCatalog(contentPath, gardenSlug);
  const { descriptions } = await readFigureDescriptions(root);
  const entries = await gardenReadEntries(contentPath, gardenSlug, undefined, { includeIndexes: true });
  entries.sort((a, b) => Number(b.relPath.startsWith("sources/")) - Number(a.relPath.startsWith("sources/")) || a.relPath.localeCompare(b.relPath));
  const seen = new Set<string>();
  for (const entry of entries) {
    const { node } = await readGardenPage(contentPath, gardenSlug, entry.relPath);
    if (!node || node.internal === "true" || node.draft === "true") continue;
    for (const candidate of figureCandidates(gardenSlug, node, node.type === "source-document" ? visuals : [], {})) {
      const key = candidate.imagePath || `${node.relPath}:${candidate.sourceVisualId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      yield { root, node, figure: await renderFigure(root, gardenSlug, candidate, descriptions) };
    }
  }
}

/** Search only the Gardens authorized by the caller; assets stay in their source Garden. */
export async function searchGardenSourceFigures(
  contentPath: string,
  gardens: readonly { slug: string; name: string }[],
  args: Record<string, unknown>,
) {
  const offset = integer(args.offset, 0);
  const limit = Math.max(1, integer(args.limit, 12, 50));
  const terms = visualSearchTerms(typeof args.query === "string" ? args.query : "");
  const figures = [];
  const warnings: { gardenId: string; warning: string }[] = [];
  for (const garden of gardens) {
    let catalog: Awaited<ReturnType<typeof readFigureCatalog>>;
    let entries: Awaited<ReturnType<typeof gardenReadEntries>>;
    try {
      catalog = await readFigureCatalog(contentPath, garden.slug);
      entries = await gardenReadEntries(contentPath, garden.slug, undefined, { includeIndexes: true });
    } catch {
      warnings.push({ gardenId: garden.slug, warning: "This Garden could not be read; other authorized Gardens were still searched." });
      continue;
    }
    const { root, visuals } = catalog;
    const { catalogWarning, descriptions } = await readFigureDescriptions(root, catalog.catalogWarning);
    if (catalogWarning) warnings.push({ gardenId: garden.slug, warning: catalogWarning });
    // Prefer the original source when the same image is reused by other notes.
    entries.sort((a, b) => Number(b.relPath.startsWith("sources/")) - Number(a.relPath.startsWith("sources/")) || a.relPath.localeCompare(b.relPath));
    const seen = new Set<string>();
    for (let start = 0; start < entries.length; start += 16) {
      const pages = await Promise.all(entries.slice(start, start + 16)
        .map(entry => readGardenPage(contentPath, garden.slug, entry.relPath)));
      for (const { node } of pages) {
        if (!node || node.internal === "true" || node.draft === "true") continue;
        // A lesson's source_document link does not make every image in that
        // source part of the lesson. Its actual embedded images remain searchable.
        const candidates = figureCandidates(garden.slug, node, node.type === "source-document" ? visuals : [], { ...args, query: undefined });
        const unseen = candidates.filter(candidate => !seen.has(candidate.imagePath || `${node.relPath}:${candidate.sourceVisualId}`));
        for (const figure of await matchingFigures(root, garden.slug, node, unseen, descriptions, terms)) {
          const key = figure.imagePath || `${node.relPath}:${figure.sourceVisualId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          figures.push({
            ...figure,
            gardenId: garden.slug, gardenName: garden.name,
            pageSlug: node.relPath.replace(/\.md$/i, ""), relPath: node.relPath, pageTitle: node.title,
            sourcePdf: node.sourcePdf, anchors: node.sourceAnchors.slice(0, 12),
          });
        }
      }
    }
  }
  const selected = selectSnapshots(figures, args).sort((a, b) => b.score - a.score);
  const total = selected.length;
  return { figures: selected.slice(offset, offset + limit).map(figurePreview), total, offset, nextOffset: offset + limit < total ? offset + limit : null,
    ...(warnings.length ? { warnings } : {}),
  };
}
