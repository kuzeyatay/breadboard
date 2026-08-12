// Support utilities for the public/embedded Quartz page AI surface.
//
// Quartz is served from a different origin (:8081) than the dashboard (:3000),
// and public gardens may be queried by anonymous readers. This module provides
// the CORS policy, a lightweight in-memory rate limiter, anonymous-session
// binding, and page-context assembly used by the /api/quartz-ai/* routes.

import crypto from "node:crypto";
import path from "node:path";
import db from "../db.ts";
import { ApiError } from "./route-core.ts";

// --- CORS -----------------------------------------------------------------

/**
 * Allowed origins for the Quartz AI endpoints. Configurable so a deployed Quartz
 * site's origin can call the dashboard. Defaults cover local Quartz + dashboard.
 */
function allowedOrigins(): string[] {
  const configured = (process.env.QUARTZ_AI_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const defaults = [
    process.env.NEXT_PUBLIC_QUARTZ_URL,
    "http://localhost:8081",
    "http://127.0.0.1:8081",
    "http://localhost:3000",
  ].filter((value): value is string => Boolean(value));
  return [...new Set([...configured, ...defaults])];
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const allowlist = allowedOrigins();
  const allowed = origin && allowlist.includes(origin) ? origin : allowlist[0] ?? "*";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Quartz-Client-Token",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

// --- Rate limiting --------------------------------------------------------

interface Bucket {
  count: number;
  resetAt: number;
}
const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;

/** Fixed-window per-key rate limit. Throws a 429 ApiError when exceeded. */
export function enforceRateLimit(key: string, now = Date.now()): void {
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  if (bucket.count >= MAX_PER_WINDOW) {
    throw new ApiError(429, "rate_limited", "Too many requests. Please slow down.");
  }
  bucket.count += 1;
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

// --- Anonymous session binding -------------------------------------------

export function newClientToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

// --- Access control -------------------------------------------------------

interface QuartzCluster {
  id: number;
  slug: string;
  name: string;
  user_id: number;
  visibility: "private" | "public";
  chat_accessible: number;
}

export function loadQuartzCluster(gardenId: string): QuartzCluster | null {
  const row = db
    .prepare("SELECT id, slug, name, user_id, visibility, chat_accessible FROM clusters WHERE slug = ?")
    .get(gardenId) as QuartzCluster | undefined;
  return row ?? null;
}

/**
 * Authorize a Quartz AI request. For public gardens, chat must be explicitly
 * enabled (chat_accessible). For private gardens, an authenticated owner is
 * required. Returns the cluster and whether the caller is the owner.
 */
export function authorizeQuartzAccess(
  gardenId: string,
  userId: number | null,
): { cluster: QuartzCluster; isOwner: boolean } {
  const cluster = loadQuartzCluster(gardenId);
  if (!cluster) throw new ApiError(404, "garden_not_found", "Garden not found.");
  const isOwner = userId !== null && cluster.user_id === userId;
  if (isOwner) return { cluster, isOwner };
  if (cluster.visibility === "public" && cluster.chat_accessible === 1) {
    return { cluster, isOwner: false };
  }
  // Private, or public with chat disabled: not accessible to this caller.
  throw new ApiError(403, "quartz_ai_forbidden", "AI chat is not enabled for this page.");
}

// --- Page context assembly ------------------------------------------------

export interface QuartzPageContext {
  gardenId: string;
  gardenName: string;
  pageSlug: string;
  pageTitle: string;
  excerpt: string;
  visibleContent: string;
  sources: string[];
  prerequisites: string[];
  backlinks: string[];
  outgoingLinks: string[];
  neighboringConcepts: string[];
  neighbors: Array<{ related: string; relation: string }>;
  graph: QuartzGraphContext | null;
}

export interface QuartzGraphInput {
  selectedNodeSlug?: unknown;
  visibleNodeSlugs?: unknown;
  directNeighborSlugs?: unknown;
  activeCluster?: unknown;
  filters?: unknown;
  depth?: unknown;
  relationshipTypes?: unknown;
  viewport?: unknown;
}

export interface QuartzGraphContext {
  selectedNode: { slug: string; title: string } | null;
  visibleNodes: Array<{ slug: string; title: string }>;
  directNeighbors: Array<{ slug: string; title: string; relation: string }>;
  activeCluster: string;
  filters: string[];
  depth: number;
  relationshipTypes: string[];
  viewport: { x: number; y: number; width: number; height: number; scale: number } | null;
}

/**
 * Assemble the authorized, bounded context for a page. Never sends the whole
 * garden — only the current page and its immediate neighborhood.
 */
export async function assembleQuartzContext(
  cluster: QuartzCluster,
  pageSlug: string,
  graphInput?: QuartzGraphInput | null,
): Promise<QuartzPageContext> {
  const contentPath = process.env.QUARTZ_CONTENT_PATH;
  if (!contentPath) throw new ApiError(500, "not_configured", "Content path not configured.");
  const { scanClusterKnowledge } = await import("../knowledge.ts");
  const knowledge = scanClusterKnowledge(contentPath, cluster.slug);
  const relativePageSlug = pageSlug.startsWith(`${cluster.slug}/`)
    ? pageSlug.slice(cluster.slug.length + 1)
    : pageSlug;
  const node = knowledge.nodes.find((n) => n.slug === relativePageSlug || n.relPath === relativePageSlug);

  const neighbors = node
    ? knowledge.edges
        .filter((edge) => edge.source === node.slug || edge.target === node.slug)
        .slice(0, 12)
        .map((edge) => ({
          related: edge.source === node.slug ? edge.target : edge.source,
          relation: edge.relation,
        }))
    : [];
  const backlinks = node
    ? knowledge.edges.filter((edge) => edge.target === node.slug).slice(0, 12).map((edge) => edge.source)
    : [];
  const outgoingLinks = node
    ? knowledge.edges.filter((edge) => edge.source === node.slug).slice(0, 12).map((edge) => edge.target)
    : [];

  return {
    gardenId: cluster.slug,
    gardenName: cluster.name,
    pageSlug,
    pageTitle: node?.title ?? pageSlug,
    excerpt: node?.excerpt?.slice(0, 1200) ?? "",
    visibleContent: node?.content?.slice(0, 12_000) ?? "",
    sources: node?.sourceAnchors?.slice(0, 12) ?? [],
    prerequisites: (node?.related ?? []).slice(0, 8),
    backlinks,
    outgoingLinks,
    neighboringConcepts: [...new Set([...backlinks, ...outgoingLinks, ...(node?.related ?? [])])].slice(0, 16),
    neighbors,
    graph: graphInput ? assembleBoundedGraphContext(cluster.slug, knowledge.nodes, knowledge.edges, graphInput) : null,
  };
}

export function assembleBoundedGraphContext(
  gardenSlug: string,
  nodes: Array<{ slug: string; title: string }>,
  edges: Array<{ source: string; target: string; relation: string }>,
  input: QuartzGraphInput,
): QuartzGraphContext {
  const bySlug = new Map(nodes.map((node) => [node.slug, node]));
  const normalize = (value: string) => {
    if (value === gardenSlug) return "index";
    if (value.startsWith(`${gardenSlug}/`)) return value.slice(gardenSlug.length + 1);
    return value.includes("/") && !bySlug.has(value) ? "" : value;
  };
  const displaySlug = (value: string) => `${gardenSlug}/${value}`;
  const requestedSelected = typeof input.selectedNodeSlug === "string" ? normalize(input.selectedNodeSlug) : "";
  const selected = bySlug.get(requestedSelected) ?? null;
  const visibleSlugs = Array.isArray(input.visibleNodeSlugs)
    ? input.visibleNodeSlugs.filter((value): value is string => typeof value === "string").slice(0, 24)
    : [];
  const visibleNodes = [...new Set(visibleSlugs)]
    .flatMap((slug) => {
      const value = bySlug.get(normalize(slug));
      return value ? [{ slug: displaySlug(value.slug), title: value.title }] : [];
    });
  const selectedEdges = selected
    ? edges.filter((edge) => edge.source === selected.slug || edge.target === selected.slug)
    : [];
  const requestedNeighbors = new Set(
    Array.isArray(input.directNeighborSlugs)
      ? input.directNeighborSlugs.filter((value): value is string => typeof value === "string").map(normalize).slice(0, 12)
      : [],
  );
  const directNeighbors = selectedEdges.flatMap((edge) => {
    const slug = edge.source === selected?.slug ? edge.target : edge.source;
    if (requestedNeighbors.size && !requestedNeighbors.has(slug)) return [];
    const value = bySlug.get(slug);
    return value ? [{ slug: displaySlug(slug), title: value.title, relation: edge.relation }] : [];
  }).slice(0, 12);
  const actualRelations = new Set(selectedEdges.map((edge) => edge.relation));
  const requestedRelations = Array.isArray(input.relationshipTypes)
    ? input.relationshipTypes.filter((value): value is string => typeof value === "string")
    : [];
  const viewport = boundedViewport(input.viewport);
  return {
    selectedNode: selected ? { slug: displaySlug(selected.slug), title: selected.title } : null,
    visibleNodes,
    directNeighbors,
    activeCluster: gardenSlug,
    filters: Array.isArray(input.filters)
      ? input.filters.filter((value): value is string => typeof value === "string").map((value) => value.slice(0, 100)).slice(0, 8)
      : [],
    depth: Math.max(0, Math.min(3, Number.isFinite(Number(input.depth)) ? Number(input.depth) : 1)),
    relationshipTypes: (requestedRelations.length ? requestedRelations.filter((value) => actualRelations.has(value)) : [...actualRelations]).slice(0, 8),
    viewport,
  };
}

export function quartzSystemContext(page: QuartzPageContext, selectedText?: string): string {
  return [
    `Authorized garden: ${page.gardenName} (${page.gardenId}).`,
    `Current page: ${page.pageTitle} (${page.pageSlug}).`,
    page.visibleContent ? `Visible page content:\n${page.visibleContent}` : "",
    selectedText ? `Reader selection:\n${selectedText.slice(0, 2_000)}` : "",
    page.backlinks.length ? `Backlinks: ${page.backlinks.join(", ")}` : "",
    page.outgoingLinks.length ? `Outgoing links: ${page.outgoingLinks.join(", ")}` : "",
    page.neighboringConcepts.length ? `Neighboring concepts: ${page.neighboringConcepts.join(", ")}` : "",
    page.sources.length ? `Source references: ${page.sources.join(", ")}` : "",
    page.graph ? `Bounded graph interaction context:\n${JSON.stringify(page.graph)}` : "",
    "Do not infer access to any other garden. Use proposal tools for every requested change.",
  ].filter(Boolean).join("\n\n");
}

function boundedViewport(value: unknown): QuartzGraphContext["viewport"] {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const numbers = [record.x, record.y, record.width, record.height, record.scale].map(Number);
  if (!numbers.every(Number.isFinite)) return null;
  return { x: numbers[0], y: numbers[1], width: numbers[2], height: numbers[3], scale: numbers[4] };
}

// A shared marker used by knowledge lint (path check) intentionally references
// this file so the QUARTZ_CONTENT_PATH root remains a single source of truth.
export function quartzGardenRoot(gardenId: string): string {
  const contentPath = process.env.QUARTZ_CONTENT_PATH;
  if (!contentPath) throw new ApiError(500, "not_configured", "Content path not configured.");
  return path.join(contentPath, gardenId);
}
