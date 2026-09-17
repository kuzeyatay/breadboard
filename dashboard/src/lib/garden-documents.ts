import {
  externalRuntimeFilesystem as fs,
  externalRuntimePortableRealpath,
} from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";
import {
  normalizeTopicTags,
  refreshClusterIndex,
  slugify,
  walkClusterMarkdown,
} from "./knowledge.ts";
import { publishQuartzAfterMutation } from "./quartz-publish.ts";
import { assertGardenMutationWritePaths, withGardenMutationLease } from "./garden-mutation-lease.ts";
import { applyGardenRevision } from "./garden-revision.ts";
import { ApiError } from "./hermes/route-core.ts";

export interface CreateGardenDocumentInput {
  userId: number;
  clusterSlug: string;
  title: string;
  content: string;
  folder?: string;
  tags?: string[];
}

export interface CreatedGardenDocument {
  slug: string;
  folder: string;
  relPath: string;
  tags: string[];
}

/** The same index, publication and write lease used by Garden authoring. */
export async function reviseGardenDocument(input: {
  userId: number;
  clusterSlug: string;
  pageSlug: string;
  patchOrReplacement: string;
}): Promise<CreatedGardenDocument & { content: string }> {
  const contentPath = process.env.QUARTZ_CONTENT_PATH;
  if (!contentPath) throw new Error("QUARTZ_CONTENT_PATH not configured");
  const root = path.resolve(contentPath);
  const gardenDir = path.resolve(root, input.clusterSlug);
  const requested = input.pageSlug.replace(/\\/g, "/").replace(/\.md$/i, "");
  if (!gardenDir.startsWith(root + path.sep) || !requested || requested.split("/").some(part => !part || part === "." || part === "..")) {
    throw new ApiError(400, "invalid_revision_path", "Invalid revision destination.");
  }
  const resolvePage = () => {
    const pages = walkClusterMarkdown(gardenDir);
    const exact = pages.filter(page => page.relPath.replace(/\.md$/i, "").toLowerCase() === requested.toLowerCase());
    const matches = exact.length ? exact : pages.filter(page => slugify(path.basename(page.entry, ".md")) === slugify(requested));
    if (matches.length !== 1) throw new ApiError(409, "revision_page_unresolved", "The revision must identify one existing page.");
    return matches[0];
  };
  const beforeSave = resolvePage();
  const document = await withGardenMutationLease(gardenDir, "apply-page-revision", (lease) => {
    const page = resolvePage();
    assertGardenMutationWritePaths(lease, gardenDir, [page.relPath]);
    if (!externalRuntimePortableRealpath(page.filePath).startsWith(externalRuntimePortableRealpath(gardenDir) + path.sep)) {
      throw new ApiError(400, "invalid_revision_path", "Invalid revision destination.");
    }
    const previous = fs.readFileSync(page.filePath, "utf8");
    const content = applyGardenRevision(previous, input.patchOrReplacement);
    try {
      fs.writeFileSync(page.filePath, content, "utf8");
      refreshClusterIndex(contentPath, input.clusterSlug, { migrateSources: false });
    } catch (error) {
      fs.writeFileSync(page.filePath, previous, "utf8");
      refreshClusterIndex(contentPath, input.clusterSlug, { migrateSources: false });
      throw error;
    }
    return { slug: page.relPath.replace(/\.md$/i, ""), folder: page.folder, relPath: page.relPath, tags: [], content };
  }, { paths: [beforeSave.relPath] });
  // The canonical save owns the decision. Derived publication must neither
  // hold the Garden lease for minutes nor roll back a successful edit.
  void publishQuartzAfterMutation(`revise document ${input.clusterSlug}/${document.relPath}`, {
    userId: input.userId, gardenSlug: input.clusterSlug,
  }).catch(error => console.error("[garden] Revision saved; publication failed:", error));
  return document;
}

/** Normalize a user-facing nested folder while keeping it inside the Garden. */
export function normalizeGardenFolder(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .map((segment) => slugify(segment))
    .filter(Boolean)
    .slice(0, 12)
    .join("/")
    .slice(0, 400);
}

/**
 * Canonical Garden-note writer shared by the authoring API and approved agent
 * proposals. Authorization happens before this helper is called.
 */
export async function createGardenDocument(
  input: CreateGardenDocumentInput,
): Promise<CreatedGardenDocument> {
  const clusterSlug = input.clusterSlug.trim();
  const title = input.title.trim();
  if (!clusterSlug) throw new Error("clusterSlug is required");
  if (!title) throw new Error("title is required");
  if (typeof input.content !== "string") throw new Error("content is required");

  const contentPath = process.env.QUARTZ_CONTENT_PATH;
  if (!contentPath) throw new Error("QUARTZ_CONTENT_PATH not configured");

  const clusterDir = path.resolve(contentPath, clusterSlug);
  const folder = normalizeGardenFolder(input.folder);
  const targetDir = path.resolve(clusterDir, folder);
  if (
    targetDir !== clusterDir &&
    !targetDir.startsWith(`${clusterDir}${path.sep}`)
  ) {
    throw new Error("Invalid folder path");
  }
  const created = await withGardenMutationLease(
    clusterDir,
    "create-document",
    () => {
      fs.mkdirSync(targetDir, { recursive: true });

      const baseSlug = slugify(title) || "note";
      let suffix = Date.now();
      let slug = `${baseSlug}-${suffix}`;
      while (fs.existsSync(path.join(targetDir, `${slug}.md`))) {
        suffix += 1;
        slug = `${baseSlug}-${suffix}`;
      }

      const body = input.content.trim() || `## ${title}\n\n`;
      const tags = normalizeTopicTags(
        (input.tags ?? []).map((tag) => tag.trim()).filter(Boolean),
        body,
        5,
        `${title}\n${body}`,
      );
      const semanticHintsLine = tags.length
        ? `semanticHints: [${tags.map((tag) => JSON.stringify(tag)).join(", ")}]\n`
        : "";
      const frontmatter = [
        "---",
        `title: ${JSON.stringify(title)}`,
        `date: ${JSON.stringify(new Date().toISOString())}`,
        'source: "user-note"',
        'knowledge_type: "user-note"',
        semanticHintsLine.trimEnd(),
        "---",
        "",
      ]
        .filter((line, index, lines) => line || index === lines.length - 1)
        .join("\n");

      fs.writeFileSync(
        path.join(targetDir, `${slug}.md`),
        `${frontmatter}\n${body}`,
        "utf8",
      );
      refreshClusterIndex(contentPath, clusterSlug, { migrateSources: false });
      return {
        slug,
        folder,
        relPath: `${folder ? `${folder}/` : ""}${slug}.md`,
        tags,
      };
    },
    { paths: [`${folder ? `${folder}/` : ""}note.md`] },
  );
  // The note is already durable. A slow or failed static rebuild must not
  // turn that successful save into a timeout (and a duplicate on retry).
  void publishQuartzAfterMutation(
    `create document ${clusterSlug}/${created.relPath.replace(/\.md$/i, "")}`,
    { userId: input.userId, gardenSlug: clusterSlug },
  ).catch((error) => console.error("[garden] Note saved; publication failed:", error));
  return created;
}
