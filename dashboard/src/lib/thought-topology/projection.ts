import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  readGardenSemanticArtifacts,
  parseSemanticMarkdown,
} from "../garden-semantics.ts";
import type { ClusterKnowledge, KnowledgeNode } from "../knowledge.ts";
import type { AuthoredCandidate, ScoringDocument } from "./scoring.ts";
import type {
  EnrichmentText,
  TopologyFolder,
  TopologyNode,
  TopologyRelationType,
} from "./types.ts";

export const NODE_SUMMARY_PROMPT_VERSION = "thought-topology-node-summary-v1";
export const EDGE_EXPLANATION_PROMPT_VERSION =
  "thought-topology-edge-explanation-v1";
export const TOPOLOGY_EMBEDDING_MODEL = "local/bge-small-en-v1.5";

export interface ProjectedTopologyNode extends TopologyNode, ScoringDocument {
  semanticText: string;
  lexicalText: string;
  claimTexts: string[];
  headings: string[];
}

export interface GardenProjection {
  sourceRevision: string;
  folders: TopologyFolder[];
  nodes: ProjectedTopologyNode[];
  authoredEdges: AuthoredCandidate[];
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeRel(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function titleFromFolder(folder: string): string {
  if (!folder) return "Garden root";
  return (folder.split("/").pop() ?? folder)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function folderId(folder: string): string {
  return `folder:${folder || "$root"}`;
}

function degradedText(text: string): EnrichmentText {
  return { state: "degraded", text };
}

function visibleMarkdown(node: KnowledgeNode): boolean {
  const rel = normalizeRel(node.relPath);
  return Boolean(
    rel &&
    !/(^|\/)_(?:index)\.md$/i.test(rel) &&
    node.type !== "internal-concept" &&
    node.internal !== "true" &&
    node.draft !== "true",
  );
}

function meaningfulPassages(body: string): string[] {
  return body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\^?[^\]]+\]/g, " ")
    .split(/\n\s*\n/)
    .map((part) =>
      part
        .replace(/^\s{0,3}(?:[-*+] |\d+[.)] |> ?)/gm, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((part) => part.length >= 45)
    .sort(
      (left, right) => right.length - left.length || left.localeCompare(right),
    )
    .slice(0, 8)
    .map((part) => part.slice(0, 700));
}

function semanticProjection(
  node: KnowledgeNode,
  claimTexts: string[],
): {
  semanticText: string;
  lexicalText: string;
  headings: string[];
} {
  const parsed = parseSemanticMarkdown(node.content);
  const headings = [...parsed.body.matchAll(/^#{1,6}\s+(.+)$/gm)]
    .map((match) => match[1].replace(/[#*_`]/g, "").trim())
    .filter(Boolean)
    .slice(0, 40);
  const formulas = [
    ...parsed.body.matchAll(
      /(?:\$\$?[\s\S]{2,220}?\$\$?|\\\[[\s\S]{2,220}?\\\])/g,
    ),
  ]
    .map((match) => match[0].replace(/\s+/g, " ").trim())
    .slice(0, 30);
  const passages = meaningfulPassages(parsed.body);
  const sections = [
    `Title: ${node.title}`,
    headings.length ? `Headings: ${headings.join(" | ")}` : "",
    node.primaryConcepts.length
      ? `Primary concepts: ${node.primaryConcepts.join(", ")}`
      : "",
    node.supportingConcepts.length
      ? `Supporting concepts: ${node.supportingConcepts.join(", ")}`
      : "",
    claimTexts.length ? `Registered claims: ${claimTexts.join(" | ")}` : "",
    formulas.length ? `Formulae: ${formulas.join(" | ")}` : "",
    passages.length ? `Passages: ${passages.join(" | ")}` : "",
  ].filter(Boolean);
  const semanticText = sections.join("\n").slice(0, 16_000);
  return { semanticText, lexicalText: semanticText, headings };
}

function folderPaths(
  gardenDir: string,
  nodes: readonly ProjectedTopologyNode[],
): string[] {
  const folders = new Set<string>([""]);
  for (const node of nodes) {
    let current = normalizeRel(path.posix.dirname(normalizeRel(node.relPath)));
    if (current === ".") current = "";
    while (current) {
      folders.add(current);
      const parent = normalizeRel(path.posix.dirname(current));
      current = parent === "." ? "" : parent;
    }
  }
  const visit = (absolute: string, relative: string) => {
    if (!fs.existsSync(absolute)) return;
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      if (
        !entry.isDirectory() ||
        [".breadboard", "assets", ".git", "node_modules"].includes(entry.name)
      )
        continue;
      const next = normalizeRel(
        relative ? `${relative}/${entry.name}` : entry.name,
      );
      folders.add(next);
      visit(path.join(absolute, entry.name), next);
    }
  };
  visit(gardenDir, "");
  return [...folders].sort(
    (left, right) =>
      left.split("/").length - right.split("/").length ||
      left.localeCompare(right),
  );
}

function authoredRelation(relation: string): TopologyRelationType {
  if (relation === "source") return "derives-from";
  return "related";
}

export function buildGardenProjection(input: {
  gardenDir: string;
  gardenId: string;
  gardenTitle: string;
  knowledge: ClusterKnowledge;
}): GardenProjection {
  const artifacts = readGardenSemanticArtifacts(
    input.gardenDir,
    input.gardenId,
  );
  const claimById = new Map(
    artifacts.claims.claims.map((claim) => [claim.id, claim.text]),
  );
  const nodes = input.knowledge.nodes
    .filter(visibleMarkdown)
    .map((node): ProjectedTopologyNode => {
      const claimTexts = node.claimIds
        .map((id) => claimById.get(id))
        .filter((value): value is string => Boolean(value));
      const projection = semanticProjection(node, claimTexts);
      const folderPath =
        normalizeRel(path.posix.dirname(normalizeRel(node.relPath))) === "."
          ? ""
          : normalizeRel(path.posix.dirname(normalizeRel(node.relPath)));
      const id = `page:${node.slug}`;
      return {
        id,
        slug: `${input.gardenId}/${normalizeRel(node.relPath).replace(/\.md$/i, "")}`,
        relPath: normalizeRel(node.relPath),
        folderId: folderId(folderPath),
        title: node.title || node.slug,
        kind: node.type === "source-document" ? "source" : "markdown",
        knowledgeType: node.type,
        contentHash: sha256(projection.semanticText),
        summary: degradedText(
          node.description ||
            node.excerpt ||
            `A note titled ${node.title || node.slug}.`,
        ),
        primaryConcepts: [...node.primaryConcepts].sort(),
        supportingConcepts: [...node.supportingConcepts].sort(),
        claimIds: [...node.claimIds].sort(),
        wordCount: node.wordCount,
        semanticText: projection.semanticText,
        lexicalText: projection.lexicalText,
        claimTexts,
        headings: projection.headings,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  const nodeIdByKnowledgeSlug = new Map(
    nodes.map((node) => [`page:${node.id.slice(5)}`, node.id]),
  );
  const authoredEdges = input.knowledge.edges
    .filter((edge) => edge.relation !== "shared-topic")
    .flatMap((edge) => {
      const source = nodeIdByKnowledgeSlug.get(`page:${edge.source}`);
      const target = nodeIdByKnowledgeSlug.get(`page:${edge.target}`);
      return source && target && source !== target
        ? [
            {
              source,
              target,
              origin:
                edge.relation === "source"
                  ? ("provenance" as const)
                  : ("authored" as const),
              relationType: authoredRelation(edge.relation),
            },
          ]
        : [];
    });

  const folders = folderPaths(input.gardenDir, nodes).map(
    (folderPath): TopologyFolder => {
      const depth = folderPath ? folderPath.split("/").length : 0;
      const parentPath =
        depth > 1 ? folderPath.split("/").slice(0, -1).join("/") : "";
      const directCount = nodes.filter(
        (node) => node.folderId === folderId(folderPath),
      ).length;
      return {
        id: folderId(folderPath),
        path: folderPath,
        parentId: depth === 0 ? null : folderId(parentPath),
        title: titleFromFolder(folderPath),
        depth,
        nodeCount: directCount,
        summary: degradedText(
          directCount === 1
            ? "Contains 1 page."
            : `Contains ${directCount} pages.`,
        ),
      };
    },
  );
  const revisionInput = JSON.stringify({
    garden: input.gardenTitle,
    nodes: nodes.map((node) => [node.id, node.relPath, node.contentHash]),
    authoredEdges,
    folders: folders.map((folder) => folder.path),
  });
  return {
    sourceRevision: sha256(revisionInput),
    folders,
    nodes,
    authoredEdges,
  };
}
