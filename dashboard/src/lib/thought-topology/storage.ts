import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { StringDecoder } from "node:string_decoder";

import { THOUGHT_TOPOLOGY_SCHEMA_VERSION, type ThoughtTopology, type ThoughtTopologyCache, type ThoughtTopologyCacheNode, type ThoughtTopologyCacheEdge } from "./types.ts";

export const TOPOLOGY_ARTIFACT_REL_PATH = ".breadboard/thought-topology.json";
export const TOPOLOGY_CACHE_REL_PATH = ".breadboard/thought-topology-cache.json";
const BUILD_CACHE_REL_PATH = ".breadboard/thought-topology-build-cache.json";
const BUILD_JOURNAL_REL_PATH = ".breadboard/thought-topology-build-journal.jsonl";
const MAX_RENDERER_BYTES = 64 * 1024 * 1024;
// The private cache also carries vectors and passages for every page.
const MAX_CACHE_BYTES = 256 * 1024 * 1024;

function readJson<T>(filePath: string, maxBytes = MAX_RENDERER_BYTES): T | null {
  let size: number;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    size = stat.size;
  } catch { return null; }
  if (size > maxBytes) {
    if (maxBytes === MAX_CACHE_BYTES) throw new Error("Thought Topology cache exceeds its read limit.");
    return null;
  }
  try {
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
  if (value?.schemaVersion !== THOUGHT_TOPOLOGY_SCHEMA_VERSION || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) return null;
  // Published maps from before activity tracking have one recoverable event:
  // the source file's last edit. Reading a map never counts as an edit.
  const since = Date.now() - 7 * 86400000;
  for (const node of value.nodes) {
    if (node.activityTimes || node.kind === "chat" || !node.relPath) continue;
    const file = path.resolve(gardenDir,node.relPath);
    const relative = path.relative(gardenDir,file);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) continue;
    try {
      const at = fs.statSync(file).mtimeMs;
      node.activityTimes = at >= since ? [at] : [];
    } catch { node.activityTimes = []; }
  }
  return value;
}

export function readThoughtTopologyCache(gardenDir: string): ThoughtTopologyCache | null {
  const value = readJson<ThoughtTopologyCache>(path.join(gardenDir, TOPOLOGY_CACHE_REL_PATH), MAX_CACHE_BYTES);
  return value?.schemaVersion === THOUGHT_TOPOLOGY_SCHEMA_VERSION && value.nodes && value.edges
    ? value
    : null;
}

function replayBuildJournal(filePath: string, cache: ThoughtTopologyCache): void {
  let handle: number;
  try { handle = fs.openSync(filePath, "r"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const replayLine = (line: string) => {
    if (!line) return;
    try {
      const entry = JSON.parse(line);
      if (entry?.schemaVersion !== THOUGHT_TOPOLOGY_SCHEMA_VERSION) return;
      if (entry.kind === "node" && typeof entry.value?.id === "string" && entry.value.summary) cache.nodes[entry.value.id] = entry.value;
      if (entry.kind === "edge" && typeof entry.value?.pairHash === "string" && entry.value.explanation) cache.edges[entry.value.pairHash] = entry.value;
    } catch { /* A process killed mid-append can leave a torn final record. */ }
  };
  // Replay a large journal a chunk at a time. Its total length grows even
  // when the worker saves the same page several times during a single pass.
  try {
    const buffer = Buffer.allocUnsafe(256 * 1024);
    const decoder = new StringDecoder("utf8");
    let tail = "";
    let length: number;
    while ((length = fs.readSync(handle, buffer, 0, buffer.length, null)) > 0) {
      const lines = decoder.write(buffer.subarray(0, length)).split("\n");
      lines[0] = tail + lines[0];
      tail = lines.pop()!;
      if (tail.length > MAX_RENDERER_BYTES) throw new Error("Thought Topology journal record exceeds its read limit.");
      for (const line of lines) replayLine(line);
    }
    replayLine(tail + decoder.end());
  } finally { fs.closeSync(handle); }
}

/** Private, resumable work. The published cache/artifact remain untouched until
 * the complete graph passes content verification. Hashes are checked by the
 * builder before reusing any record, including across Garden edits. */
export function openThoughtTopologyBuildCache(gardenDir: string, published: ThoughtTopologyCache | null) {
  const snapshotPath = path.join(gardenDir, BUILD_CACHE_REL_PATH);
  const journalPath = path.join(gardenDir, BUILD_JOURNAL_REL_PATH);
  const saved = readJson<ThoughtTopologyCache>(snapshotPath, MAX_CACHE_BYTES);
  const resume = saved?.schemaVersion === THOUGHT_TOPOLOGY_SCHEMA_VERSION && saved.nodes && saved.edges ? saved : null;
  const cache: ThoughtTopologyCache = {
    schemaVersion: THOUGHT_TOPOLOGY_SCHEMA_VERSION,
    sourceRevision: published?.sourceRevision ?? resume?.sourceRevision ?? "pending",
    scoringVersion: published?.scoringVersion ?? resume?.scoringVersion ?? "pending",
    nodes: { ...published?.nodes, ...resume?.nodes },
    edges: { ...published?.edges, ...resume?.edges },
  };
  replayBuildJournal(journalPath, cache);
  // Compact before reopening the journal. A crash between these writes only
  // replays duplicate records, which are idempotent by their cache keys.
  atomicJson(snapshotPath, cache);
  fs.writeFileSync(journalPath, "", { mode: 0o600 });
  const append = (kind: "node" | "edge", value: ThoughtTopologyCacheNode | ThoughtTopologyCacheEdge) => {
    const handle = fs.openSync(journalPath, "a", 0o600);
    try {
      fs.writeFileSync(handle, `${JSON.stringify({ schemaVersion: THOUGHT_TOPOLOGY_SCHEMA_VERSION, kind, value })}\n`, "utf8");
      fs.fsyncSync(handle);
    } finally { fs.closeSync(handle); }
  };
  return {
    cache,
    node(value: ThoughtTopologyCacheNode) { append("node", value); },
    edge(value: ThoughtTopologyCacheEdge) { append("edge", value); },
  };
}

export function clearThoughtTopologyBuildCache(gardenDir: string): void {
  for (const relative of [BUILD_CACHE_REL_PATH, BUILD_JOURNAL_REL_PATH]) {
    fs.rmSync(path.join(gardenDir, relative), { force: true });
  }
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
