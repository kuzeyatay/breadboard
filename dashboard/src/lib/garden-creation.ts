import db from "@/lib/db";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { externalRuntimeFilesystem as fs } from "@/lib/external-runtime-filesystem";
import { externalRuntimePath as path } from "@/lib/external-runtime-path";
import { refreshClusterIndex } from "@/lib/knowledge";
import { refreshPrivateQuartzIndexCooperatively } from "@/lib/quartz-garden-index";
import { publishQuartzAfterMutation } from "@/lib/quartz-publish";
import { acquireGardenMutationLease } from "@/lib/garden-mutation-lease";
import { uniqueGardenSlug } from "@/lib/garden-slug";
import { ensureFolderPath, normalizeFolderPath } from "@/lib/cluster-folders";
import type { ClusterRow } from "@/app/actions/clusters";

/** Both the dashboard action and Bread's signed tool supply the authenticated owner. */
export function createOwnedGarden(userId: number, name: string, description: string, folder?: string | null) {
  const slug = uniqueGardenSlug(db, name);
  const cleanFolder = normalizeFolderPath(folder);
  if (cleanFolder) ensureFolderPath(db, userId, cleanFolder);
  const contentPath = process.env.QUARTZ_CONTENT_PATH;
  const clusterDir = contentPath ? path.join(contentPath, slug) : null;
  const lease = clusterDir
    ? acquireGardenMutationLease(clusterDir, "create-garden")
    : null;
  let created: ClusterRow;

  try {
    created = db.prepare(
      `INSERT INTO clusters (
        user_id, name, slug, description, visibility, border_color, folder,
        thought_topology_enabled, thought_topology_revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0) RETURNING *`,
    ).get(
      userId,
      name,
      slug,
      description,
      "private",
      "#a9c1b1",
      cleanFolder || null,
    ) as ClusterRow;

    if (contentPath && clusterDir) {
      fs.mkdirSync(clusterDir, { recursive: true });
      const date = new Date().toISOString().split("T")[0];
      const indexContent = `---\ntitle: ${JSON.stringify(name)}\ndate: ${date}\ndescription: ${JSON.stringify(description || "")}\nknowledge_type: "cluster-index"\n---\n`;
      fs.writeFileSync(path.join(clusterDir, "_index.md"), indexContent);
      refreshClusterIndex(contentPath, slug);
    }
  } finally {
    lease?.release();
  }

  // The garden is usable as soon as its database row and source index exist.
  // Preparing the library scans every existing garden, so it belongs after
  // the response too, alongside the potentially long Quartz publication.
  after(async () => {
    try {
      await refreshPrivateQuartzIndexCooperatively(userId);
      await publishQuartzAfterMutation(`create cluster ${slug}`, {
        userId,
        gardenSlug: slug,
      });
    } catch (error) {
      console.error(
        `[quartz] Failed to publish newly created garden ${slug}:`,
        error,
      );
    }
  });
  revalidatePath("/dashboard");
  revalidatePath("/new-tab");
  revalidatePath("/browser");
  revalidatePath("/garden");
  return created;
}
