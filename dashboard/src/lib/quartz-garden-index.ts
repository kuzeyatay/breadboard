import fs from "fs";
import path from "path";
import db from "@/lib/db";
import { scanClusterKnowledge } from "@/lib/knowledge";

interface GardenClusterRow {
  id: number;
  user_id: number;
  name: string;
  slug: string;
  description: string | null;
  visibility: "private" | "public";
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
  scope: "private" | "public";
  clusters: GardenCluster[];
  emptyText: string;
}): string {
  const date = new Date().toISOString().split("T")[0];
  const pageDir = path.join(baseContentPath, pageSlug);
  fs.mkdirSync(pageDir, { recursive: true });

  const clusterSlugs = clusters.map(({ row }) => row.slug);
  const totalSources = clusters.reduce(
    (sum, cluster) => sum + cluster.stats.documents,
    0,
  );
  const totalTextbookPages = clusters.reduce(
    (sum, cluster) => sum + cluster.stats.textbookPages,
    0,
  );
  const totalConceptNodes = clusters.reduce(
    (sum, cluster) => sum + cluster.stats.conceptNodes,
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
      scope === "public" && (row.ownerUsername || row.ownerEmail)
        ? ` by ${row.ownerUsername ?? row.ownerEmail}`
        : "";
    const popularity =
      scope === "public"
        ? `, ${countLabel(Number(row.view_count) || 0, "view")}`
        : "";
    return `${index + 1}. ${quartzLink(row.slug, row.name)}${owner} - ${countLabel(stats.documents, "source document")}, ${countLabel(stats.textbookPages, "textbook page")}, ${countLabel(stats.links, "link")}${popularity}`;
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
    for (const name of [...groups.keys()]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))) {
      const list = groups.get(name) ?? [];
      sections.push(
        `### ${name}\n\n` +
          list.map((cluster, index) => clusterLine(cluster, index)).join("\n"),
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
    `- Source documents: ${totalSources}\n` +
    `- Textbook pages: ${totalTextbookPages}\n` +
    `- Internal ConceptNodes: ${totalConceptNodes}\n` +
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
