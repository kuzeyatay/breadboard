import crypto from "crypto";
import fs from "fs";
import path from "path";
import { acquireGardenMutationLease } from "./garden-mutation-lease.ts";

export interface GardenLink {
  id: string;
  title: string;
  url: string;
  sourceSlug?: string;
  sourceRelPath?: string;
  contentHash?: string;
  importedAt?: string;
  provider?: string;
  createdAt: string;
  updatedAt: string;
}

const LINKS_FILE = "links.json";

function metadataDir(
  contentPath: string,
  gardenSlug: string,
  create = false,
): string {
  const root = path.resolve(contentPath);
  const clusterDir = path.resolve(root, gardenSlug.trim());
  if (clusterDir !== root && !clusterDir.startsWith(root + path.sep)) {
    throw new Error("Invalid garden path");
  }
  const dir = path.join(clusterDir, ".breadboard");
  if (create) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function linksFilePath(
  contentPath: string,
  gardenSlug: string,
  create = false,
): string {
  return path.join(metadataDir(contentPath, gardenSlug, create), LINKS_FILE);
}

function normalizeTitle(value: unknown, url: string): string {
  const title = typeof value === "string" ? value.trim() : "";
  if (title) return title.slice(0, 160);
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

function normalizeUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Link URL is required");
  }
  const raw = value.trim();
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("Enter a valid link URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS links are supported");
  }
  return parsed.toString();
}

function normalizeLink(value: unknown): GardenLink | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<GardenLink>;
  if (typeof record.id !== "string" || !record.id.trim()) return null;
  if (typeof record.url !== "string" || !record.url.trim()) return null;
  const createdAt =
    typeof record.createdAt === "string" && record.createdAt
      ? record.createdAt
      : new Date().toISOString();
  const updatedAt =
    typeof record.updatedAt === "string" && record.updatedAt
      ? record.updatedAt
      : createdAt;
  return {
    id: record.id,
    title: normalizeTitle(record.title, record.url),
    url: record.url,
    sourceSlug:
      typeof record.sourceSlug === "string" && record.sourceSlug.trim()
        ? record.sourceSlug.trim()
        : undefined,
    sourceRelPath:
      typeof record.sourceRelPath === "string" && record.sourceRelPath.trim()
        ? record.sourceRelPath.trim()
        : undefined,
    contentHash:
      typeof record.contentHash === "string" && record.contentHash.trim()
        ? record.contentHash.trim()
        : undefined,
    importedAt:
      typeof record.importedAt === "string" && record.importedAt.trim()
        ? record.importedAt.trim()
        : undefined,
    provider:
      typeof record.provider === "string" && record.provider.trim()
        ? record.provider.trim()
        : undefined,
    createdAt,
    updatedAt,
  };
}

export function readGardenLinks(
  contentPath: string,
  gardenSlug: string,
): GardenLink[] {
  const filePath = linksFilePath(contentPath, gardenSlug);
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    const rawLinks: unknown[] =
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { links?: unknown }).links)
        ? (parsed as { links: unknown[] }).links
        : [];
    return rawLinks
      .map(normalizeLink)
      .filter((link): link is GardenLink => Boolean(link))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  } catch {
    return [];
  }
}

function writeGardenLinks(
  contentPath: string,
  gardenSlug: string,
  links: GardenLink[],
): void {
  const filePath = linksFilePath(contentPath, gardenSlug, true);
  const payload = {
    version: 1,
    links: links
      .slice()
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
  };
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function addGardenLink(
  contentPath: string,
  gardenSlug: string,
  input: {
    title?: unknown;
    url?: unknown;
    sourceSlug?: unknown;
    sourceRelPath?: unknown;
    contentHash?: unknown;
    importedAt?: unknown;
    provider?: unknown;
  },
): GardenLink {
  const gardenDir = path.dirname(metadataDir(contentPath, gardenSlug));
  const lease = acquireGardenMutationLease(gardenDir, "add-garden-link");
  try {
    const url = normalizeUrl(input.url);
    const now = new Date().toISOString();
    const link: GardenLink = {
      id: crypto.randomUUID(),
      title: normalizeTitle(input.title, url),
      url,
      sourceSlug:
        typeof input.sourceSlug === "string" && input.sourceSlug.trim()
          ? input.sourceSlug.trim()
          : undefined,
      sourceRelPath:
        typeof input.sourceRelPath === "string" && input.sourceRelPath.trim()
          ? input.sourceRelPath.trim()
          : undefined,
      contentHash:
        typeof input.contentHash === "string" && input.contentHash.trim()
          ? input.contentHash.trim()
          : undefined,
      importedAt:
        typeof input.importedAt === "string" && input.importedAt.trim()
          ? input.importedAt.trim()
          : undefined,
      provider:
        typeof input.provider === "string" && input.provider.trim()
          ? input.provider.trim()
          : undefined,
      createdAt: now,
      updatedAt: now,
    };
    const links = readGardenLinks(contentPath, gardenSlug);
    writeGardenLinks(contentPath, gardenSlug, [link, ...links]);
    return link;
  } finally {
    lease.release();
  }
}

export function deleteGardenLink(
  contentPath: string,
  gardenSlug: string,
  linkId: unknown,
): boolean {
  if (typeof linkId !== "string" || !linkId.trim()) {
    throw new Error("Link id is required");
  }
  const gardenDir = path.dirname(metadataDir(contentPath, gardenSlug));
  const lease = acquireGardenMutationLease(gardenDir, "delete-garden-link");
  try {
    const links = readGardenLinks(contentPath, gardenSlug);
    const next = links.filter((link) => link.id !== linkId);
    if (next.length === links.length) return false;
    writeGardenLinks(contentPath, gardenSlug, next);
    return true;
  } finally {
    lease.release();
  }
}
