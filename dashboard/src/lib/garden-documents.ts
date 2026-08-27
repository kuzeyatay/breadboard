import fs from "node:fs";
import path from "node:path";
import {
  normalizeTopicTags,
  refreshClusterIndex,
  slugify,
} from "./knowledge.ts";
import { publishQuartzAfterMutation } from "./quartz-publish.ts";
import { withGardenMutationLease } from "./garden-mutation-lease.ts";

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
      refreshClusterIndex(contentPath, clusterSlug);
      return {
        slug,
        folder,
        relPath: `${folder ? `${folder}/` : ""}${slug}.md`,
        tags,
      };
    },
  );
  await publishQuartzAfterMutation(
    `create document ${clusterSlug}/${created.relPath.replace(/\.md$/i, "")}`,
    { userId: input.userId },
  );
  return created;
}
