import fs from "node:fs";
import path from "node:path";
import type { ArtifactKind, ArtifactRendererId } from "./artifact-types.ts";
import { parseFrontmatter, renderMarkdownToPdf } from "../markdown-render/pdf.ts";
import { markdownToDocxPreviewHtml, renderMarkdownToDocx } from "../markdown-render/docx.ts";
import { themeFromMetadata } from "../markdown-render/theme.ts";

export interface ArtifactRenderContext {
  directory: string;
  filename: string;
  /** Artifact title, used as the document title / metadata. */
  title?: string;
  /**
   * Artifact metadata. `metadata.theme` / `.style` drives the document look for
   * the pdf and docx renderers, so the output reflects the user's request
   * instead of one fixed template.
   */
  metadata?: Record<string, unknown>;
}

export interface ArtifactRenderResult {
  outputPath: string;
  previewPath: string;
  mimeType: string;
}

export interface ArtifactRenderer {
  kind: ArtifactKind;
  id: ArtifactRendererId;
  mimeType: string;
  extension: string;
  validate(content: string): Promise<{ ok: true } | { ok: false; error: string }>;
  render(content: string, context: ArtifactRenderContext): Promise<ArtifactRenderResult>;
}

function atomicWrite(target: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, target);
}

function titleFromFilename(filename: string): string {
  const base = filename.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim();
  return base ? base.replace(/\b\w/g, (c) => c.toUpperCase()) : "Document";
}

function documentTitle(
  content: string,
  context: ArtifactRenderContext,
): { body: string; title: string } {
  const { body, title: frontmatterTitle } = parseFrontmatter(content);
  const title = context.title?.trim() || frontmatterTitle || titleFromFilename(context.filename);
  return { body, title };
}

const textRenderer = (id: "text" | "markdown", kind: "text" | "markdown"): ArtifactRenderer => ({
  id,
  kind,
  mimeType: kind === "markdown" ? "text/markdown; charset=utf-8" : "text/plain; charset=utf-8",
  extension: kind === "markdown" ? ".md" : ".txt",
  async validate(content) {
    return content.length > 0 ? { ok: true } : { ok: false, error: "Artifact content is empty." };
  },
  async render(content, context) {
    const outputPath = path.join(context.directory, context.filename);
    atomicWrite(outputPath, content);
    return { outputPath, previewPath: outputPath, mimeType: this.mimeType };
  },
});

const docxRenderer: ArtifactRenderer = {
  id: "docx",
  kind: "document",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  extension: ".docx",
  async validate(content) {
    return content.trim() ? { ok: true } : { ok: false, error: "Document content is empty." };
  },
  async render(content, context) {
    const outputPath = path.join(context.directory, context.filename);
    const { body } = documentTitle(content, context);
    const theme = themeFromMetadata(context.metadata);
    const docx = renderMarkdownToDocx(body, { theme });
    atomicWrite(outputPath, docx);
    const previewPath = path.join(context.directory, "preview.html");
    atomicWrite(previewPath, markdownToDocxPreviewHtml(body, { theme }));
    return { outputPath, previewPath, mimeType: this.mimeType };
  },
};

const pdfRenderer: ArtifactRenderer = {
  id: "pdf",
  kind: "pdf",
  mimeType: "application/pdf",
  extension: ".pdf",
  async validate(content) {
    return content.trim() ? { ok: true } : { ok: false, error: "PDF content is empty." };
  },
  async render(content, context) {
    const outputPath = path.join(context.directory, context.filename);
    const { body, title } = documentTitle(content, context);
    const theme = themeFromMetadata(context.metadata);
    const pdf = await renderMarkdownToPdf([{ content: body, title }], { title, theme });
    atomicWrite(outputPath, pdf);
    return { outputPath, previewPath: outputPath, mimeType: this.mimeType };
  },
};

const htmlRenderer: ArtifactRenderer = {
  id: "html",
  kind: "html",
  mimeType: "text/html; charset=utf-8",
  extension: ".html",
  async validate(content) {
    if (!content.trim()) return { ok: false, error: "HTML content is empty." };
    if (!/<(?:!doctype|html|body|main|section|article|div|p|h1)/i.test(content)) {
      return { ok: false, error: "HTML content must contain a document or visible root element." };
    }
    return { ok: true };
  },
  async render(content, context) {
    const outputPath = path.join(context.directory, context.filename);
    atomicWrite(outputPath, content);
    return { outputPath, previewPath: outputPath, mimeType: this.mimeType };
  },
};

const codeRenderer: ArtifactRenderer = {
  id: "code",
  kind: "code",
  mimeType: "text/plain; charset=utf-8",
  extension: ".txt",
  async validate(content) {
    return content.trim()
      ? { ok: true }
      : { ok: false, error: "Code artifact content is empty." };
  },
  async render(content, context) {
    const outputPath = path.join(context.directory, context.filename);
    atomicWrite(outputPath, content);
    return { outputPath, previewPath: outputPath, mimeType: this.mimeType };
  },
};

const jsonRenderer: ArtifactRenderer = {
  id: "json",
  kind: "data",
  mimeType: "application/json; charset=utf-8",
  extension: ".json",
  async validate(content) {
    try {
      JSON.parse(content);
      return { ok: true };
    } catch {
      return { ok: false, error: "Data artifacts rendered as JSON must contain valid JSON." };
    }
  },
  async render(content, context) {
    const outputPath = path.join(context.directory, context.filename);
    atomicWrite(outputPath, `${JSON.stringify(JSON.parse(content), null, 2)}\n`);
    return { outputPath, previewPath: outputPath, mimeType: this.mimeType };
  },
};

const csvRenderer: ArtifactRenderer = {
  id: "csv",
  kind: "spreadsheet",
  mimeType: "text/csv; charset=utf-8",
  extension: ".csv",
  async validate(content) {
    if (!content.trim()) return { ok: false, error: "Spreadsheet content is empty." };
    const lines = content.replace(/\r\n/g, "\n").split("\n").filter(Boolean);
    if (!lines.some((line) => /[,;\t]/.test(line))) {
      return { ok: false, error: "CSV content must contain at least one delimited row." };
    }
    return { ok: true };
  },
  async render(content, context) {
    const outputPath = path.join(context.directory, context.filename);
    atomicWrite(outputPath, content);
    return { outputPath, previewPath: outputPath, mimeType: this.mimeType };
  },
};

const presentationHtmlRenderer: ArtifactRenderer = {
  id: "presentation-html",
  kind: "presentation",
  mimeType: "text/html; charset=utf-8",
  extension: ".html",
  validate: htmlRenderer.validate,
  async render(content, context) {
    const outputPath = path.join(context.directory, context.filename);
    atomicWrite(outputPath, content);
    return { outputPath, previewPath: outputPath, mimeType: this.mimeType };
  },
};

const svgRenderer: ArtifactRenderer = {
  id: "svg",
  kind: "diagram",
  mimeType: "image/svg+xml",
  extension: ".svg",
  async validate(content) {
    if (!/<svg(?:\s|>)/i.test(content)) {
      return { ok: false, error: "Diagram content must be an SVG document." };
    }
    if (
      /<\s*(?:script|foreignObject|iframe|object|embed)\b/i.test(content) ||
      /\son[a-z]+\s*=/i.test(content) ||
      /\b(?:href|src)\s*=\s*["']\s*(?:https?:|file:|javascript:)/i.test(content)
    ) {
      return {
        ok: false,
        error: "SVG diagrams cannot contain scripts, embedded documents, event handlers, or external resources.",
      };
    }
    return { ok: true };
  },
  async render(content, context) {
    const outputPath = path.join(context.directory, context.filename);
    atomicWrite(outputPath, content);
    return { outputPath, previewPath: outputPath, mimeType: this.mimeType };
  },
};

function importOnlyRenderer(
  id: ArtifactRendererId,
  kind: ArtifactKind,
  mimeType: string,
  extension: string,
): ArtifactRenderer {
  return {
    id,
    kind,
    mimeType,
    extension,
    async validate() {
      return {
        ok: false,
        error: "Binary and native application files must use artifact_import from the authorized workspace.",
      };
    },
    async render() {
      throw new Error("Imported artifact files cannot use the text renderer.");
    },
  };
}

/**
 * Registry entry for the dedicated visualizer pipeline. Raw model output must
 * never pass through the generic renderer because that would bypass AST,
 * bundling, and browser publication gates. The visualizer service publishes
 * only its already-validated bundle with publishValidatedArtifactVersion().
 */
const interactiveVisualizerRenderer: ArtifactRenderer = {
  id: "interactive-visualizer",
  kind: "html",
  mimeType: "text/html; charset=utf-8",
  extension: ".html",
  async validate() {
    return {
      ok: false,
      error: "Interactive visualizers must use the dedicated validated publication pipeline.",
    };
  },
  async render() {
    throw new Error(
      "Interactive visualizers cannot be rendered through the generic artifact renderer.",
    );
  },
};

/**
 * A hardware blueprint stores its whole HardwareDesign as the artifact source,
 * so reopening one never needs the model again. The renderer validates the
 * structure before it is published — a malformed design would render an empty
 * blueprint that still looked authoritative.
 */
const hardwareBlueprintRenderer: ArtifactRenderer = {
  id: "hardware-blueprint",
  kind: "data",
  mimeType: "application/json; charset=utf-8",
  extension: ".json",
  async validate(content) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { ok: false, error: "A hardware blueprint must contain valid JSON." };
    }
    const { parseStoredDesign } = await import("../hardware/schemas.ts");
    const result = parseStoredDesign(parsed);
    return result.ok
      ? { ok: true }
      : { ok: false, error: `${result.error} ${result.issues.slice(0, 3).join("; ")}`.trim() };
  },
  async render(content, context) {
    const outputPath = path.join(context.directory, context.filename);
    atomicWrite(outputPath, `${JSON.stringify(JSON.parse(content), null, 2)}\n`);
    return { outputPath, previewPath: outputPath, mimeType: this.mimeType };
  },
};

/**
 * A parametric CAD design stores its whole manifest as the artifact source —
 * specification, CadQuery program, measured geometry, validation and revision
 * history — so reopening one never needs the model or the CAD service again.
 * The renderer validates the structure before it is published: a malformed
 * manifest would render an empty viewer that still looked authoritative.
 *
 * Export bytes are deliberately not inlined here. They live in CAD storage and
 * are referenced by (projectId, revision, format), which the authenticated
 * download route resolves against the database.
 */
const parametricCadRenderer: ArtifactRenderer = {
  id: "parametric-cad",
  kind: "data",
  mimeType: "application/vnd.breadboard.parametric-cad+json",
  extension: ".json",
  async validate(content) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { ok: false, error: "A parametric CAD design must contain valid JSON." };
    }
    const { parseStoredCadArtifact } = await import("../cad/schemas.ts");
    const result = parseStoredCadArtifact(parsed);
    return result.ok
      ? { ok: true }
      : { ok: false, error: `${result.error} ${result.issues.slice(0, 3).join("; ")}`.trim() };
  },
  async render(content, context) {
    const outputPath = path.join(context.directory, context.filename);
    atomicWrite(outputPath, `${JSON.stringify(JSON.parse(content), null, 2)}\n`);
    return { outputPath, previewPath: outputPath, mimeType: this.mimeType };
  },
};

/**
 * A ViMax film stores its whole production as the artifact source — story,
 * characters, screenplay, storyboard, and the first-frame/motion/last-frame
 * decomposition each shot would be rendered from. Reopening a film therefore
 * never needs the model again, and the structure is verified before publication
 * because a malformed production would play as an empty film that still looked
 * authoritative. Drawn frames are separate image artifacts referenced by id.
 */
const vimaxProductionRenderer: ArtifactRenderer = {
  id: "vimax-production",
  kind: "data",
  mimeType: "application/vnd.breadboard.vimax-production+json",
  extension: ".json",
  async validate(content) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { ok: false, error: "A ViMax production must contain valid JSON." };
    }
    const { parseStoredProduction } = await import("../vimax/schemas.ts");
    const result = parseStoredProduction(parsed);
    return result.ok
      ? { ok: true }
      : { ok: false, error: `${result.error} ${result.issues.slice(0, 3).join("; ")}`.trim() };
  },
  async render(content, context) {
    const outputPath = path.join(context.directory, context.filename);
    atomicWrite(outputPath, `${JSON.stringify(JSON.parse(content), null, 2)}\n`);
    return { outputPath, previewPath: outputPath, mimeType: this.mimeType };
  },
};

/**
 * A Vox Director production stores the whole film as the artifact source — the
 * beat map, every poster prompt as the clone's own composer wrote it, the
 * element and camera plan each shot was animated from, and which backend
 * actually produced each piece. Reopening a film therefore never needs the
 * model again, and the structure is verified before publication because a
 * malformed production would open as a film that still looked authoritative.
 * The MP4 and the posters are ordinary video and image artifacts, referenced
 * by id, so nothing here is a viewer only this page can open.
 */
const voxDirectorProductionRenderer: ArtifactRenderer = {
  id: "vox-director-production",
  kind: "data",
  mimeType: "application/vnd.breadboard.vox-director-production+json",
  extension: ".json",
  async validate(content) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { ok: false, error: "A Vox Director production must contain valid JSON." };
    }
    const { parseStoredProduction } = await import("../vox-director/schemas.ts");
    const result = parseStoredProduction(parsed);
    return result.ok
      ? { ok: true }
      : { ok: false, error: `${result.error} ${result.issues.slice(0, 3).join("; ")}`.trim() };
  },
  async render(content, context) {
    const outputPath = path.join(context.directory, context.filename);
    atomicWrite(outputPath, `${JSON.stringify(JSON.parse(content), null, 2)}
`);
    return { outputPath, previewPath: outputPath, mimeType: this.mimeType };
  },
};

/**
 * A social post stores the post itself — copy, network, character ceiling,
 * artwork and calendar slot — because a post is something to finish rather than
 * something to read. Its viewer is the post studio, so the structure is checked
 * before publication for the same reason the others are: an editor opened over
 * a malformed post would save that malformed post back.
 */
const socialsManagerPostRenderer: ArtifactRenderer = {
  id: "socials-manager-post",
  kind: "data",
  mimeType: "application/vnd.breadboard.socials-post+json",
  extension: ".json",
  async validate(content) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { ok: false, error: "A social post must contain valid JSON." };
    }
    const { parseStoredSocialsPost } = await import("../socials-manager/post-artifact.ts");
    const result = parseStoredSocialsPost(parsed);
    return result.ok
      ? { ok: true }
      : { ok: false, error: `${result.error} ${result.issues.slice(0, 3).join("; ")}`.trim() };
  },
  async render(content, context) {
    const outputPath = path.join(context.directory, context.filename);
    atomicWrite(outputPath, `${JSON.stringify(JSON.parse(content), null, 2)}\n`);
    return { outputPath, previewPath: outputPath, mimeType: this.mimeType };
  },
};

/**
 * A gadget stores its whole package as the artifact source — manifest, declared
 * bindings, and the three files it runs — so reopening or editing one never
 * needs the model again. The structure is verified before publication because a
 * malformed package would mount an empty sandbox that still looked like a
 * working app, and because the declared bindings are what the host bridge
 * enforces at call time: an unverified binding list is an unenforced one.
 */
const gadgetRenderer: ArtifactRenderer = {
  id: "gadget",
  kind: "gadget",
  mimeType: "application/vnd.breadboard.gadget+json",
  extension: ".json",
  async validate(content) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { ok: false, error: "A gadget must contain valid JSON." };
    }
    const { parseStoredGadget } = await import("./gadget-validator.ts");
    const result = parseStoredGadget(parsed);
    return result.ok
      ? { ok: true }
      : { ok: false, error: `${result.error} ${result.issues.slice(0, 3).join("; ")}`.trim() };
  },
  async render(content, context) {
    const outputPath = path.join(context.directory, context.filename);
    atomicWrite(outputPath, `${JSON.stringify(JSON.parse(content), null, 2)}\n`);
    return { outputPath, previewPath: outputPath, mimeType: this.mimeType };
  },
};

const registry = new Map<ArtifactRendererId, ArtifactRenderer>([
  ["text", textRenderer("text", "text")],
  ["markdown", textRenderer("markdown", "markdown")],
  ["docx", docxRenderer],
  ["pdf", pdfRenderer],
  ["html", htmlRenderer],
  ["code", codeRenderer],
  ["json", jsonRenderer],
  ["csv", csvRenderer],
  ["presentation-html", presentationHtmlRenderer],
  ["svg", svgRenderer],
  // An already-rendered PDF — a downloaded paper, a report a tool produced —
  // enters through artifact_import, not through the markdown PDF renderer.
  ["pdf-file", importOnlyRenderer("pdf-file", "pdf", "application/pdf", ".pdf")],
  ["image-file", importOnlyRenderer("image-file", "image", "image/png", ".png")],
  ["audio-file", importOnlyRenderer("audio-file", "audio", "audio/mpeg", ".mp3")],
  ["video-file", importOnlyRenderer("video-file", "video", "video/mp4", ".mp4")],
  ["document-file", importOnlyRenderer(
    "document-file",
    "document",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".docx",
  )],
  ["presentation-file", importOnlyRenderer(
    "presentation-file",
    "presentation",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".pptx",
  )],
  ["spreadsheet-file", importOnlyRenderer(
    "spreadsheet-file",
    "spreadsheet",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xlsx",
  )],
  ["diagram-file", importOnlyRenderer("diagram-file", "diagram", "image/svg+xml", ".svg")],
  ["data-file", importOnlyRenderer("data-file", "data", "application/json", ".json")],
  ["model-file", importOnlyRenderer("model-file", "model", "model/gltf-binary", ".glb")],
  ["interactive-visualizer", interactiveVisualizerRenderer],
  ["hardware-blueprint", hardwareBlueprintRenderer],
  ["parametric-cad", parametricCadRenderer],
  ["vimax-production", vimaxProductionRenderer],
  ["vox-director-production", voxDirectorProductionRenderer],
  ["socials-manager-post", socialsManagerPostRenderer],
  ["gadget", gadgetRenderer],
]);

export function artifactRenderer(id: string): ArtifactRenderer | null {
  return registry.get(id as ArtifactRendererId) ?? null;
}

export function availableArtifactRenderers(): Array<{ id: ArtifactRendererId; kind: ArtifactKind; mimeType: string }> {
  return [...registry.values()].map(({ id, kind, mimeType }) => ({ id, kind, mimeType }));
}

/**
 * Binary artifacts normally arrive with an OfficeCLI snapshot. When that
 * optional binary is not provisioned, PPTX alone has a local in-process
 * RenderTree fallback. Other imported formats keep their existing behavior.
 */
export async function renderImportedArtifactFallbackPreview(
  filePath: string,
  previewPath: string,
): Promise<string | null> {
  if (path.extname(filePath).toLowerCase() !== ".pptx") return null;
  try {
    const { renderPptxPreviewHtml } = await import("../genoffice/pptx-preview.ts");
    atomicWrite(previewPath, await renderPptxPreviewHtml(fs.readFileSync(filePath)));
    return previewPath;
  } catch {
    return null;
  }
}
