import db from "@/lib/db";
import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";
import { scanClusterKnowledge } from "@/lib/knowledge";
import { organizationClusterClause } from "@/lib/organizations/store";

interface GardenClusterRow {
  id: number;
  user_id: number;
  name: string;
  slug: string;
  description: string | null;
  visibility: "private" | "organization" | "public";
  border_color: string;
  view_count: number | null;
  folder: string | null;
  created_at: string;
  ownerUsername?: string | null;
  ownerEmail?: string | null;
}

interface GardenCluster {
  row: GardenClusterRow;
  stats: ReturnType<typeof scanClusterKnowledge>["stats"];
}

const PRIVATE_LIBRARY_ROOT = "private-library";
const PUBLIC_LIBRARY_ROOT = "public-library";
const ORGANIZATION_LIBRARY_ROOT = "organization-library";

// `clusters.folder` holds a materialized path, so clusters can nest.
const FOLDER_SEPARATOR = "/";

function contentPath(): string | null {
  const configured = process.env.QUARTZ_CONTENT_PATH?.trim();
  if (!configured) return null;
  return configured;
}

function yamlQuote(value: string): string {
  return JSON.stringify(value.replace(/\r/g, ""));
}

function yamlArray(values: string[]): string {
  return `[${values.map(yamlQuote).join(", ")}]`;
}

function frontmatter(data: Record<string, string | string[]>): string {
  const lines = Object.entries(data).map(([key, value]) => {
    if (Array.isArray(value)) return `${key}: ${yamlArray(value)}`;
    return `${key}: ${yamlQuote(value)}`;
  });

  return `---\n${lines.join("\n")}\n---\n\n`;
}

function countLabel(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function quartzLink(slug: string, label: string): string {
  return `[${label.replace(/\]/g, "\\]")}](/${encodeURIComponent(slug)}/)`;
}

function readClusterStats(
  baseContentPath: string,
  row: GardenClusterRow,
): GardenCluster {
  try {
    return {
      row,
      stats: scanClusterKnowledge(baseContentPath, row.slug).stats,
    };
  } catch {
    return {
      row,
      stats: {
        documents: 0,
        topics: 0,
        textbookPages: 0,
        conceptNodes: 0,
        learningPages: 0,
        generatedNotes: 0,
        links: 0,
        words: 0,
      },
    };
  }
}

function writeGardenIndex({
  baseContentPath,
  pageSlug,
  title,
  description,
  scope,
  clusters,
  emptyText,
}: {
  baseContentPath: string;
  pageSlug: string;
  title: string;
  description: string;
  scope: "private" | "organization" | "public";
  clusters: GardenCluster[];
  emptyText: string;
}): string {
  const date = new Date().toISOString().split("T")[0];
  const pageDir = path.join(baseContentPath, pageSlug);
  fs.mkdirSync(pageDir, { recursive: true });

  const clusterSlugs = clusters.map(({ row }) => row.slug);
  const totalTextbookPages = clusters.reduce(
    (sum, cluster) => sum + cluster.stats.textbookPages,
    0,
  );
  const totalLinks = clusters.reduce(
    (sum, cluster) => sum + cluster.stats.links,
    0,
  );
  const totalWords = clusters.reduce(
    (sum, cluster) => sum + cluster.stats.words,
    0,
  );

  const clusterLine = (
    { row, stats }: GardenCluster,
    index: number,
  ): string => {
    const owner =
      scope !== "private" && (row.ownerUsername || row.ownerEmail)
        ? ` by ${row.ownerUsername ?? row.ownerEmail}`
        : "";
    const popularity =
      scope === "public"
        ? `, ${countLabel(Number(row.view_count) || 0, "view")}`
        : "";
    return `${index + 1}. ${quartzLink(row.slug, row.name)}${owner} - ${countLabel(stats.textbookPages, "lesson page")}, ${countLabel(stats.links, "link")}${popularity}`;
  };

  // Private gardens group clusters under their virtual folder; public stays flat.
  const renderClusters = (): string => {
    if (clusters.length === 0) return `- ${emptyText}`;
    if (scope !== "private") {
      return clusters.map((cluster, index) => clusterLine(cluster, index)).join("\n");
    }

    const groups = new Map<string, GardenCluster[]>();
    for (const cluster of clusters) {
      const key = (cluster.row.folder ?? "").trim();
      const list = groups.get(key) ?? [];
      list.push(cluster);
      groups.set(key, list);
    }

    const sections: string[] = [];
    const ungrouped = groups.get("") ?? [];
    if (ungrouped.length > 0) {
      sections.push(
        ungrouped.map((cluster, index) => clusterLine(cluster, index)).join("\n"),
      );
    }

    // Clusters nest, and `folder` holds a materialized path ("A/B/C"). Expand
    // each one into its ancestor chain so an intermediate cluster still gets a
    // heading when it holds only nested clusters and no gardens of its own.
    const paths = new Set<string>();
    for (const key of groups.keys()) {
      const segments = key.split(FOLDER_SEPARATOR).filter(Boolean);
      for (let i = 0; i < segments.length; i += 1) {
        paths.add(segments.slice(0, i + 1).join(FOLDER_SEPARATOR));
      }
    }

    // Depth-first order: compare segment by segment, since a plain string sort
    // would let a sibling like "A B" slip between "A" and its child "A/B".
    const byPath = (a: string, b: string): number => {
      const left = a.split(FOLDER_SEPARATOR);
      const right = b.split(FOLDER_SEPARATOR);
      for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
        const cmp = left[i].localeCompare(right[i]);
        if (cmp !== 0) return cmp;
      }
      return left.length - right.length;
    };

    for (const folder of [...paths].sort(byPath)) {
      const segments = folder.split(FOLDER_SEPARATOR);
      const heading = `${"#".repeat(Math.min(2 + segments.length, 6))} ${
        segments[segments.length - 1]
      }`;
      const list = groups.get(folder) ?? [];
      sections.push(
        list.length > 0
          ? `${heading}\n\n` +
              list.map((cluster, index) => clusterLine(cluster, index)).join("\n")
          : heading,
      );
    }
    return sections.join("\n\n");
  };

  const content =
    frontmatter({
      title,
      date,
      description,
      knowledge_type: "garden-overview",
      garden_scope: scope,
      graph_clusters: clusterSlugs,
      cluster_order: clusterSlugs,
    }) +
    `## ${title}\n\n` +
    `${description}\n\n` +
    `- Gardens: ${clusters.length}\n` +
    `- Lesson pages: ${totalTextbookPages}\n` +
    `- Graph links: ${totalLinks}\n` +
    `- Indexed words: ${totalWords}\n\n` +
    `## Gardens\n\n` +
    `${renderClusters()}\n`;

  fs.writeFileSync(path.join(pageDir, "_index.md"), content, "utf-8");
  return pageSlug;
}

export function refreshPrivateQuartzIndex(userId: number): string | null {
  const baseContentPath = contentPath();
  if (!baseContentPath || !Number.isFinite(userId)) return null;

  const rows = db
    .prepare(
      `SELECT c.*
       FROM clusters c
       WHERE c.user_id = ?
       ORDER BY c.created_at DESC`,
    )
    .all(userId) as GardenClusterRow[];

  return writeGardenIndex({
    baseContentPath,
    pageSlug: `${PRIVATE_LIBRARY_ROOT}/user-${userId}`,
    title: "My garden",
    description: "All the gardens attached to your account.",
    scope: "private",
    clusters: rows.map((row) => readClusterStats(baseContentPath, row)),
    emptyText: "No private gardens yet.",
  });
}

/**
 * One index per account rather than per organization, because someone can be in
 * several and the tab shows all of them at once.
 */
export function refreshOrganizationQuartzIndex(userId: number): string | null {
  const baseContentPath = contentPath();
  if (!baseContentPath || !Number.isFinite(userId)) return null;

  const shared = organizationClusterClause(userId, "c");
  const rows =
    shared === "0"
      ? []
      : (db
          .prepare(
            `SELECT c.*, u.username AS ownerUsername, u.email AS ownerEmail
             FROM clusters c
             JOIN users u ON u.id = c.user_id
             WHERE ${shared}
             ORDER BY c.created_at DESC`,
          )
          .all() as GardenClusterRow[]);

  return writeGardenIndex({
    baseContentPath,
    pageSlug: `${ORGANIZATION_LIBRARY_ROOT}/user-${userId}`,
    title: "Organization garden",
    description: "Gardens shared with the organizations you are in.",
    scope: "organization",
    clusters: rows.map((row) => readClusterStats(baseContentPath, row)),
    emptyText: "No gardens shared with your organizations yet.",
  });
}

export function refreshPublicQuartzIndex(): string | null {
  const baseContentPath = contentPath();
  if (!baseContentPath) return null;

  const rows = db
    .prepare(
      `SELECT c.*, u.username AS ownerUsername, u.email AS ownerEmail
       FROM clusters c
       JOIN users u ON u.id = c.user_id
       WHERE c.visibility = 'public'
       ORDER BY COALESCE(c.view_count, 0) DESC, c.created_at DESC`,
    )
    .all() as GardenClusterRow[];

  return writeGardenIndex({
    baseContentPath,
    pageSlug: PUBLIC_LIBRARY_ROOT,
    title: "Public garden",
    description: "Shared gardens ranked by popularity.",
    scope: "public",
    clusters: rows.map((row) => readClusterStats(baseContentPath, row)),
    emptyText: "No public gardens yet.",
  });
}
