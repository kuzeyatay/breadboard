import fs from "node:fs";
import path from "node:path";

import { THOUGHT_TOPOLOGY_SCHEMA_VERSION, type ThoughtTopology, type ThoughtTopologyCache } from "./types.ts";

export const TOPOLOGY_ARTIFACT_REL_PATH = ".breadboard/thought-topology.json";
export const TOPOLOGY_CACHE_REL_PATH = ".breadboard/thought-topology-cache.json";

function readJson<T>(filePath: string): T | null {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function atomicJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.pending-${process.pid}-${Date.now()}`;
  let handle: number | undefined;
  try {
    handle = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(handle, `${JSON.stringify(value)}\n`, "utf8");
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = undefined;
    fs.renameSync(temporary, filePath);
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

export function readThoughtTopology(gardenDir: string): ThoughtTopology | null {
  const value = readJson<ThoughtTopology>(path.join(gardenDir, TOPOLOGY_ARTIFACT_REL_PATH));
  return value?.schemaVersion === THOUGHT_TOPOLOGY_SCHEMA_VERSION && Array.isArray(value.nodes) && Array.isArray(value.edges)
    ? value
    : null;
}

export function readThoughtTopologyCache(gardenDir: string): ThoughtTopologyCache | null {
  const value = readJson<ThoughtTopologyCache>(path.join(gardenDir, TOPOLOGY_CACHE_REL_PATH));
  return value?.schemaVersion === THOUGHT_TOPOLOGY_SCHEMA_VERSION && value.nodes && value.edges
    ? value
    : null;
}

/** A renderer snapshot is complete only when every connection has durable
 * explanatory text. Historical `pending` edges are intentionally rejected. */
export function thoughtTopologyHasCompleteConnections(topology: ThoughtTopology): boolean {
  return topology.build?.state !== "building" && topology.edges.every((edge) => {
    const explanation = edge?.explanation;
    return Boolean(
      explanation &&
      explanation.state !== "pending" &&
      typeof explanation.text === "string" &&
      explanation.text.trim().length > 0,
    );
  });
}

/** Commit private cache first and sanitized renderer data last. */
export function commitThoughtTopology(
  gardenDir: string,
  cache: ThoughtTopologyCache,
  topology: ThoughtTopology,
): void {
  if (!thoughtTopologyHasCompleteConnections(topology)) {
    throw new Error("Thought Topology cannot be published before every connection explanation is generated.");
  }
  atomicJson(path.join(gardenDir, TOPOLOGY_CACHE_REL_PATH), cache);
  atomicJson(path.join(gardenDir, TOPOLOGY_ARTIFACT_REL_PATH), topology);
}

export function rendererArtifactContainsVector(value: unknown): boolean {
  const visit = (candidate: unknown): boolean => {
    if (!candidate || typeof candidate !== "object") return false;
    if (Array.isArray(candidate)) return candidate.some(visit);
    return Object.entries(candidate).some(([key, nested]) =>
      (/vectors?/i.test(key) || (key === "embedding" && Array.isArray(nested))) || visit(nested));
  };
  return visit(value);
}
