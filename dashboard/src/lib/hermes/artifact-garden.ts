// Publishes agent-created artifacts into the user's Quartz garden so they live
// alongside their notes — under a dedicated `artifacts/` folder — instead of only
// existing as ephemeral chat attachments.
//
// A PDF artifact is published as a `source_pdf`-backed note (typed `artifact`,
// NOT `source-document`, so it never shows up in the garden's Sources section)
// plus the rendered PDF written into the cluster's `assets/`. That is exactly the
// shape the existing PDF viewer (`/gardens/<slug>/pdf/<doc>`) reads, so a created
// PDF opens in the same full editor as any uploaded source PDF. The backing note
// is a plain garden document, not another artifact, so it never appears as its
// own artifact card.
//
// Text-like artifacts (markdown / docx / plain text) are published as readable
// notes; docx/pdf also drop their rendered file into `assets/` with a download
// link. Binary/media kinds are left as chat-only artifacts.
//
// All writes are best-effort at the call site: publishing must never fail an
// artifact render. Deleting an artifact calls unpublish to remove the note,
// the asset, and any saved PDF edits.

import fs from "node:fs";
import path from "node:path";
import db from "../db.ts";
import { refreshClusterIndex, slugify } from "../knowledge.ts";
import { publishQuartzAfterMutation } from "../quartz-publish.ts";
import { parseFrontmatter } from "../markdown-render/pdf.ts";

export const ARTIFACTS_FOLDER = "artifacts";

// Renderer ids that produce a text-representable garden note. Media/binary kinds
// (image, audio, video, …) are intentionally excluded.
const PUBLISHABLE_RENDERERS = new Set(["pdf", "docx", "markdown", "text", "code"]);

export interface GardenArtifactRef {
  clusterSlug: string;
  documentSlug: string;
  /** Path relative to the content root, e.g. `artifacts/<slug>.md`. */
  markdownRelPath: string;
  /** `/<cluster>/assets/<file>.pdf` when a PDF asset was written. */
  sourcePdf?: string;
  /** `/<cluster>/assets/<file>.<ext>` for a downloadable rendered file. */
  downloadAsset?: string;
}

export function isPublishableRenderer(rendererId: string): boolean {
  return PUBLISHABLE_RENDERERS.has(rendererId);
}

function contentRoot(): string | null {
  const value = process.env.QUARTZ_CONTENT_PATH;
  return value && value.trim() ? path.resolve(value.trim()) : null;
}

function clusterDir(root: string, clusterSlug: string): string | null {
  const dir = path.resolve(root, clusterSlug.trim());
  return dir.startsWith(root + path.sep) || dir === root ? dir : null;
}

function withinClusterAsset(clusterDirPath: string, fileName: string): string | null {
  if (!fileName || fileName.includes("/") || fileName.includes("\\") || fileName.includes("..")) {
    return null;
  }
  const target = path.resolve(clusterDirPath, "assets", fileName);
  return target.startsWith(clusterDirPath + path.sep) ? target : null;
}

function documentSlugFor(title: string, artifactId: string, existingSlug?: string): string {
  if (existingSlug && /^[a-z0-9-]+$/.test(existingSlug)) return existingSlug;
  const base = slugify(title || "artifact") || "artifact";
  const suffix = artifactId.replace(/[^a-z0-9]/gi, "").slice(-8).toLowerCase() || "doc";
  return `${base}-${suffix}`;
}

function frontmatter(fields: Record<string, string | undefined>, tags: string[]): string {
  const lines = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  if (tags.length) lines.push(`tags: [${tags.map((tag) => JSON.stringify(tag)).join(", ")}]`);
  return `---\n${lines.join("\n")}\n---\n\n`;
}

export interface PublishArtifactInput {
  clusterSlug: string;
  artifactId: string;
  title: string;
  rendererId: string;
  /** The artifact's Markdown/text source. */
  markdownSource: string;
  /** Absolute path to the rendered output file (the `.pdf`/`.docx`), if any. */
  renderedFilePath?: string;
  /** Reuse this slug across re-renders so the garden doc is updated, not duplicated. */
  existingSlug?: string;
}

/**
 * Publishes (or re-publishes) an artifact into the garden. Returns the reference
 * needed to open/delete it, or null when the kind is not publishable or no
 * content root is configured. Never throws for expected conditions; callers
 * should still wrap in try/catch to keep publishing best-effort.
 */
export async function publishArtifactToGarden(
  input: PublishArtifactInput,
): Promise<GardenArtifactRef | null> {
  if (!isPublishableRenderer(input.rendererId)) return null;
  const root = contentRoot();
  if (!root) return null;
  const dir = clusterDir(root, input.clusterSlug);
  if (!dir) return null;

  const slug = documentSlugFor(input.title, input.artifactId, input.existingSlug);
  const { body } = parseFrontmatter(input.markdownSource);
  const date = new Date().toISOString();
  const title = input.title.trim() || "Artifact";

  let sourcePdf: string | undefined;
  let downloadAsset: string | undefined;
  const noteLines: string[] = [];

  // Rendered file -> cluster assets (PDF for the viewer, docx as a download).
  if (input.renderedFilePath && fs.existsSync(input.renderedFilePath)) {
    const ext = input.rendererId === "pdf" ? "pdf" : input.rendererId === "docx" ? "docx" : "";
    if (ext) {
      const assetName = `${slug}.${ext}`;
      const assetPath = withinClusterAsset(dir, assetName);
      if (assetPath) {
        fs.mkdirSync(path.dirname(assetPath), { recursive: true });
        fs.copyFileSync(input.renderedFilePath, assetPath);
        const rel = `/${input.clusterSlug.trim()}/assets/${assetName}`;
        if (ext === "pdf") sourcePdf = rel;
        else {
          downloadAsset = rel;
          noteLines.push(`> **Word document:** [${title}.docx](${rel})`, "");
        }
      }
    }
  }

  const fields: Record<string, string | undefined> = {
    title,
    date,
    knowledge_type: "artifact",
    source: "artifact",
    artifact_id: input.artifactId,
    source_pdf: sourcePdf,
    source_file: sourcePdf ? `${slug}.pdf` : undefined,
  };

  // Code artifacts read best inside a fence; others carry their Markdown as-is.
  const noteBody =
    input.rendererId === "code" ? `\`\`\`\n${body}\n\`\`\`` : body || `# ${title}\n`;
  const markdown = frontmatter(fields, ["artifact"]) + noteLines.join("\n") + noteBody + "\n";

  const notePath = path.resolve(dir, ARTIFACTS_FOLDER, `${slug}.md`);
  if (!notePath.startsWith(dir + path.sep)) return null;
  fs.mkdirSync(path.dirname(notePath), { recursive: true });
  const temporary = `${notePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, markdown, "utf8");
  fs.renameSync(temporary, notePath);

  refreshClusterIndex(root, input.clusterSlug.trim());
  await publishQuartzAfterMutation(`publish artifact ${input.clusterSlug}/${slug}`);

  return {
    clusterSlug: input.clusterSlug.trim(),
    documentSlug: slug,
    markdownRelPath: `${ARTIFACTS_FOLDER}/${slug}.md`,
    sourcePdf,
    downloadAsset,
  };
}

export interface UnpublishArtifactInput {
  clusterId: number;
  clusterSlug: string;
  documentSlug: string;
  sourcePdf?: string;
  downloadAsset?: string;
}

/** Removes a published artifact's note, its assets, and any saved PDF edits. */
export async function unpublishArtifactFromGarden(
  input: UnpublishArtifactInput,
): Promise<void> {
  const root = contentRoot();
  if (!root) return;
  const dir = clusterDir(root, input.clusterSlug);
  if (!dir) return;

  const notePath = path.resolve(dir, ARTIFACTS_FOLDER, `${input.documentSlug}.md`);
  if (notePath.startsWith(dir + path.sep) && fs.existsSync(notePath)) {
    fs.rmSync(notePath, { force: true });
  }

  for (const rel of [input.sourcePdf, input.downloadAsset]) {
    if (!rel) continue;
    const fileName = rel.split("/").filter(Boolean).at(-1);
    const assetPath = fileName ? withinClusterAsset(dir, fileName) : null;
    if (assetPath && fs.existsSync(assetPath)) fs.rmSync(assetPath, { force: true });
  }

  // Drop any saved PDF edits / history for this document so a re-created doc of
  // the same slug starts clean.
  try {
    db.prepare(`DELETE FROM pdf_document_edits WHERE cluster_id = ? AND document_slug = ?`)
      .run(input.clusterId, input.documentSlug);
    db.prepare(`DELETE FROM pdf_document_edit_history WHERE cluster_id = ? AND document_slug = ?`)
      .run(input.clusterId, input.documentSlug);
  } catch {
    // The edit tables are optional; cleanup is best-effort.
  }

  refreshClusterIndex(root, input.clusterSlug.trim());
  await publishQuartzAfterMutation(`remove artifact ${input.clusterSlug}/${input.documentSlug}`);
}
