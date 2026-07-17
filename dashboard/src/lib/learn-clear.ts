/**
 * Filesystem-only cleanup for an explicitly confirmed Learn-data clear.
 *
 * Durable source inputs stay in place. Generated learner content and its
 * projections are removed, source-visual extraction records are returned to
 * their unassigned state, and mixed ledgers (events and interactive visuals)
 * are filtered by ownership instead of being deleted wholesale.
 */

import fs from "node:fs";
import path from "node:path";

export interface LearnFilesystemClearResult {
  /** Garden-relative files or directory roots that were removed. */
  removedPaths: string[];
  /** Existing mixed ledgers rewritten in place. */
  modifiedPaths: string[];
  /** Markdown files removed with the generated learner projection. */
  removedLearnerPagePaths: string[];
  /** Interactive visuals owned exclusively by removed learner pages. */
  removedVisualIds: string[];
  removedEventCount: number;
  resetSourceVisualCount: number;
}

/** Learn-owned paths that never contain durable source ingestion data. */
const GENERATED_LEARN_PATHS = [
  ".breadboard/Internal",
  ".breadboard/backups",
  ".breadboard/build-workspace.json",
  ".breadboard/canonical-shadow",
  ".breadboard/debug/failed-pages",
  ".breadboard/debug/failed-repairs",
  ".breadboard/learn-run-snapshots",
  ".breadboard/planning",
  ".breadboard/quarantine",
  ".breadboard/source-snapshots",
  ".breadboard/acceptance-status.json",
  ".breadboard/active-build-manifest.json",
  ".breadboard/anchor-critic-decisions.json",
  ".breadboard/anchor-replacement-plan.json",
  ".breadboard/anchor-replacement-plan.md",
  ".breadboard/claims.json",
  ".breadboard/claims-history.json",
  ".breadboard/concept-registry.json",
  ".breadboard/concept-registry-history.json",
  ".breadboard/critic-issues.json",
  ".breadboard/critic-loop.json",
  ".breadboard/critic-report.md",
  ".breadboard/formula-assignment-plan.json",
  ".breadboard/formula-identities.json",
  ".breadboard/learn-build.lock.json",
  ".breadboard/learning-unit-contract.json",
  ".breadboard/repair-log.json",
  ".breadboard/repair-report.md",
  ".breadboard/render-manifest.json",
  ".breadboard/scoped-repair.json",
  ".breadboard/scoped-repair.md",
  ".breadboard/semantic-migration.json",
  ".breadboard/source-anchor-evidence.json",
  ".breadboard/source-anchor-evidence.md",
  ".breadboard/source-anchor-migration.json",
  ".breadboard/source-anchor-migration.md",
  ".breadboard/source-anchors.json",
  ".breadboard/validation-report.md",
  ".breadboard/visual-necessity-decisions.json",
  ".breadboard/visual-necessity-decisions.md",
  ".breadboard/visualization-plan.json",
  ".breadboard/visualization-coverage.json",
  ".breadboard/visualization-coverage.md",
  ".breadboard/visualization-events.json",
  ".breadboard/visualization-report.md",
  ".breadboard/weak-anchor-self-healing.json",
  ".breadboard/weak-anchor-self-healing.md",
] as const;

const SOURCE_VISUAL_ASSIGNMENT_FIELDS = [
  "conceptUsage",
  "cropStatus",
  "assignedPageId",
  "assignedSectionId",
  "skipReason",
] as const;

interface RemovedPageOwnership {
  markdownPaths: Set<string>;
  pathReferences: Set<string>;
  pageIds: Set<string>;
  unitIds: Set<string>;
  visualIds: Set<string>;
}

interface VisualOwnershipEvidence {
  learning: Set<string>;
  nonLearning: Set<string>;
}

type JsonRecord = Record<string, unknown>;

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/+$/, "");
}

function gardenRelativePath(gardenDir: string, absolutePath: string): string {
  return normalizeRelativePath(path.relative(gardenDir, absolutePath));
}

function pathInsideGarden(gardenDir: string, relPath: string): string {
  const root = path.resolve(gardenDir);
  const target = path.resolve(root, ...normalizeRelativePath(relPath).split("/"));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Learn clear path escapes the staged garden: ${relPath}`);
  }
  return target;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function own(record: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function readJson(filePath: string): unknown | undefined {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function removeExistingPath(gardenDir: string, relPath: string, removed: Set<string>): void {
  const normalized = normalizeRelativePath(relPath);
  const absolute = pathInsideGarden(gardenDir, normalized);
  if (!fs.existsSync(absolute)) return;
  fs.rmSync(absolute, { recursive: true, force: true });
  removed.add(normalized);
}

function frontmatter(markdown: string): string | null {
  const withoutBom = markdown.charCodeAt(0) === 0xfeff ? markdown.slice(1) : markdown;
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(withoutBom);
  return match?.[1] ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanYamlScalar(value: string): string {
  const withoutComment = value.replace(/\s+#.*$/, "").trim();
  if (withoutComment.length >= 2 && withoutComment.startsWith('"') && withoutComment.endsWith('"')) {
    try {
      const parsed = JSON.parse(withoutComment);
      return typeof parsed === "string" ? parsed : String(parsed);
    } catch {
      return withoutComment.slice(1, -1);
    }
  }
  if (withoutComment.length >= 2 && withoutComment.startsWith("'") && withoutComment.endsWith("'")) {
    return withoutComment.slice(1, -1).replace(/''/g, "'");
  }
  return withoutComment;
}

function frontmatterScalar(raw: string, key: string): string | undefined {
  const pattern = new RegExp(`^${escapeRegExp(key)}\\s*:\\s*(.*?)\\s*$`, "im");
  const value = pattern.exec(raw)?.[1];
  if (value === undefined || value.trim() === "") return undefined;
  return cleanYamlScalar(value);
}

function frontmatterArray(raw: string, key: string): string[] {
  const lines = raw.split(/\r?\n/);
  const keyPattern = new RegExp(`^${escapeRegExp(key)}\\s*:\\s*(.*)$`, "i");
  const index = lines.findIndex((line) => keyPattern.test(line));
  if (index < 0) return [];
  const inline = keyPattern.exec(lines[index])?.[1]?.trim() ?? "";
  if (inline) {
    try {
      const parsed = JSON.parse(inline);
      if (Array.isArray(parsed)) {
        return parsed.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean);
      }
    } catch {
      if (inline.startsWith("[") && inline.endsWith("]")) {
        return inline.slice(1, -1).split(",").map(cleanYamlScalar).filter(Boolean);
      }
      return [cleanYamlScalar(inline)].filter(Boolean);
    }
  }
  const values: string[] = [];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (/^[A-Za-z0-9_-]+\s*:/.test(line)) break;
    const item = /^\s+-\s+(.+?)\s*$/.exec(line)?.[1];
    if (item) values.push(cleanYamlScalar(item));
  }
  return values.filter(Boolean);
}

function generatedByLearn(frontmatterRaw: string): boolean {
  const generatedBy = frontmatterScalar(frontmatterRaw, "generatedBy") ??
    frontmatterScalar(frontmatterRaw, "generated_by");
  if (generatedBy && /^(?:learn|learn_button|breadboard_learn)$/i.test(generatedBy.replace(/[ -]+/g, "_"))) {
    return true;
  }
  if (frontmatterScalar(frontmatterRaw, "generatedByBuildId")) return true;

  const pageId = frontmatterScalar(frontmatterRaw, "pageId");
  const unitId = frontmatterScalar(frontmatterRaw, "learningUnitId") ??
    frontmatterScalar(frontmatterRaw, "generatedFromUnitId");
  const version = frontmatterScalar(frontmatterRaw, "learningVersionId") ??
    frontmatterScalar(frontmatterRaw, "learningVersion");
  if (pageId && unitId) return true;
  if (unitId && version) return true;

  const type = (frontmatterScalar(frontmatterRaw, "knowledge_type") ??
    frontmatterScalar(frontmatterRaw, "breadboardType") ?? "").replace(/_/g, "-").toLowerCase();
  return type === "learning-page" && Boolean(pageId || unitId || version);
}

function visualIdsFromMarkdown(markdown: string, frontmatterRaw: string): string[] {
  const ids = new Set([
    ...frontmatterArray(frontmatterRaw, "visualIds"),
    ...frontmatterArray(frontmatterRaw, "visuals"),
  ]);
  const blockPattern = /```breadboard-visual[^\r\n]*\r?\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(markdown)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (isRecord(parsed) && typeof parsed.id === "string" && parsed.id.trim()) ids.add(parsed.id.trim());
    } catch {
      const id = /["']id["']\s*:\s*["']([^"']+)["']/.exec(match[1])?.[1]?.trim();
      if (id) ids.add(id);
    }
  }
  return sorted(ids);
}

function newRemovedPageOwnership(): RemovedPageOwnership {
  return {
    markdownPaths: new Set(),
    pathReferences: new Set(),
    pageIds: new Set(),
    unitIds: new Set(),
    visualIds: new Set(),
  };
}

function recordRemovedMarkdown(
  gardenDir: string,
  absolutePath: string,
  ownership: RemovedPageOwnership,
): void {
  const relPath = gardenRelativePath(gardenDir, absolutePath);
  let markdown = "";
  try {
    markdown = fs.readFileSync(absolutePath, "utf8");
  } catch {
    ownership.markdownPaths.add(relPath);
    return;
  }
  const raw = frontmatter(markdown) ?? "";
  ownership.markdownPaths.add(relPath);
  ownership.pathReferences.add(normalizeOwnerPath(relPath));
  ownership.pathReferences.add(normalizeOwnerPath(relPath.replace(/\.md$/i, "")));
  const pageId = frontmatterScalar(raw, "pageId");
  if (pageId) ownership.pageIds.add(pageId);
  const unitIds = [
    frontmatterScalar(raw, "learningUnitId"),
    frontmatterScalar(raw, "generatedFromUnitId"),
  ].filter((entry): entry is string => Boolean(entry));
  for (const unitId of unitIds) {
    ownership.unitIds.add(unitId);
    ownership.pageIds.add(`page:${unitId}`);
  }
  for (const id of visualIdsFromMarkdown(markdown, raw)) ownership.visualIds.add(id);
}

function walkMarkdown(directory: string, visitor: (filePath: string) => void): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walkMarkdown(absolute, visitor);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) visitor(absolute);
  }
}

function learningTreeDirectories(gardenDir: string): string[] {
  try {
    return fs.readdirSync(gardenDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && entry.name.toLowerCase() === "learning")
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function discoverRemovedPages(gardenDir: string): { ownership: RemovedPageOwnership; learningRoots: string[] } {
  const ownership = newRemovedPageOwnership();
  const learningRoots = learningTreeDirectories(gardenDir);
  for (const root of learningRoots) walkMarkdown(path.join(gardenDir, root), (file) => recordRemovedMarkdown(gardenDir, file, ownership));

  const skipTopLevel = new Set([".breadboard", "assets", "sources", ...learningRoots.map((entry) => entry.toLowerCase())]);
  const walkOutside = (directory: string, depth: number): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (depth === 0 && skipTopLevel.has(entry.name.toLowerCase())) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walkOutside(absolute, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
      try {
        const markdown = fs.readFileSync(absolute, "utf8");
        const raw = frontmatter(markdown);
        if (raw && generatedByLearn(raw)) recordRemovedMarkdown(gardenDir, absolute, ownership);
      } catch {
        // An unreadable ordinary file is not safe to classify or remove.
      }
    }
  };
  walkOutside(gardenDir, 0);
  return { ownership, learningRoots };
}

function normalizeOwnerPath(value: string): string {
  let decoded = value.trim();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep the original path when a malformed percent escape is present.
  }
  return normalizeRelativePath(decoded.split(/[?#]/, 1)[0]).replace(/\.md$/i, "").toLowerCase();
}

function isLearningPathReference(value: string, gardenDir: string, removed: RemovedPageOwnership): boolean {
  const normalized = normalizeOwnerPath(value);
  if (!normalized) return false;
  if (removed.pathReferences.has(normalized)) return true;
  if (normalized === "learning" || normalized.startsWith("learning/")) return true;
  const gardenName = path.basename(path.resolve(gardenDir)).toLowerCase();
  return normalized === `${gardenName}/learning` || normalized.startsWith(`${gardenName}/learning/`);
}

const VISUAL_OWNER_PATH_KEYS = ["pageSlug", "pagePath", "pageRel", "pageRelPath", "targetPage", "ownerPage"] as const;
const VISUAL_OWNER_PAGE_ID_KEYS = ["pageId", "canonicalPageId"] as const;

function recordOwnershipEvidence(record: JsonRecord, gardenDir: string, removed: RemovedPageOwnership): "learning" | "non-learning" | "unknown" {
  let sawOwner = false;
  let sawLearning = false;
  for (const key of VISUAL_OWNER_PATH_KEYS) {
    const value = record[key];
    if (typeof value !== "string" || !value.trim()) continue;
    sawOwner = true;
    if (isLearningPathReference(value, gardenDir, removed)) sawLearning = true;
  }
  for (const key of VISUAL_OWNER_PAGE_ID_KEYS) {
    const value = record[key];
    if (typeof value !== "string" || !value.trim()) continue;
    sawOwner = true;
    if (removed.pageIds.has(value) || isLearningPathReference(value, gardenDir, removed)) sawLearning = true;
  }
  const unitId = record.learningUnitId;
  if (typeof unitId === "string" && unitId.trim()) {
    sawOwner = true;
    if (removed.unitIds.has(unitId)) sawLearning = true;
  }
  return sawLearning ? "learning" : sawOwner ? "non-learning" : "unknown";
}

function noteVisualEvidence(evidence: VisualOwnershipEvidence, id: string, kind: "learning" | "non-learning" | "unknown"): void {
  const normalized = id.trim();
  if (!normalized || kind === "unknown") return;
  (kind === "learning" ? evidence.learning : evidence.nonLearning).add(normalized);
}

function visualIndexEntries(value: unknown): Array<{ id: string; entry: JsonRecord }> {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => isRecord(entry) && typeof entry.id === "string" ? [{ id: entry.id, entry }] : []);
  }
  if (!isRecord(value)) return [];
  if (Array.isArray(value.visuals)) return visualIndexEntries(value.visuals);
  if (isRecord(value.visuals)) {
    return Object.entries(value.visuals).flatMap(([key, entry]) => isRecord(entry)
      ? [{ id: typeof entry.id === "string" ? entry.id : key, entry }]
      : []);
  }
  return Object.entries(value).flatMap(([key, entry]) => isRecord(entry)
    ? [{ id: typeof entry.id === "string" ? entry.id : key, entry }]
    : []);
}

function collectVisualIndexEvidence(
  index: unknown,
  gardenDir: string,
  removed: RemovedPageOwnership,
  evidence: VisualOwnershipEvidence,
): void {
  for (const { id, entry } of visualIndexEntries(index)) {
    noteVisualEvidence(evidence, id, recordOwnershipEvidence(entry, gardenDir, removed));
  }
}

function jsonRecordsBelow(directory: string): JsonRecord[] {
  const records: JsonRecord[] = [];
  const walk = (current: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
        const parsed = readJson(absolute);
        if (isRecord(parsed)) records.push(parsed);
      }
    }
  };
  walk(directory);
  return records;
}

function collectVisualArtifactEvidence(
  visualsDir: string,
  gardenDir: string,
  removed: RemovedPageOwnership,
  evidence: VisualOwnershipEvidence,
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(visualsDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink() || entry.name.startsWith(".")) continue;
    const id = entry.isFile() && entry.name.toLowerCase().endsWith(".json")
      ? entry.name.replace(/\.json$/i, "")
      : entry.isDirectory() ? entry.name : "";
    if (!id) continue;
    const absolute = path.join(visualsDir, entry.name);
    const records = entry.isDirectory()
      ? jsonRecordsBelow(absolute)
      : (() => {
          const parsed = readJson(absolute);
          return isRecord(parsed) ? [parsed] : [];
        })();
    for (const record of records) {
      const recordId = typeof record.id === "string" && record.id.trim() ? record.id : id;
      noteVisualEvidence(evidence, recordId, recordOwnershipEvidence(record, gardenDir, removed));
    }
  }
}

function finalLearningVisualIds(removed: RemovedPageOwnership, evidence: VisualOwnershipEvidence): Set<string> {
  const candidates = new Set([...removed.visualIds, ...evidence.learning]);
  for (const id of evidence.nonLearning) candidates.delete(id);
  return candidates;
}

function pruneIndexValue(value: unknown, removeIds: Set<string>): unknown {
  if (Array.isArray(value)) {
    return value.filter((entry) => !(isRecord(entry) && typeof entry.id === "string" && removeIds.has(entry.id)));
  }
  if (!isRecord(value)) return value;
  if (Array.isArray(value.visuals)) return { ...value, visuals: pruneIndexValue(value.visuals, removeIds) };
  if (isRecord(value.visuals)) {
    const nextVisuals = Object.fromEntries(Object.entries(value.visuals).filter(([key, entry]) => {
      const id = isRecord(entry) && typeof entry.id === "string" ? entry.id : key;
      return !removeIds.has(id);
    }));
    return { ...value, visuals: nextVisuals };
  }
  return Object.fromEntries(Object.entries(value).filter(([key, entry]) => {
    if (!isRecord(entry)) return true;
    const id = typeof entry.id === "string" ? entry.id : key;
    return !removeIds.has(id);
  }));
}

function pruneVisualIndex(
  gardenDir: string,
  removeIds: Set<string>,
  modifiedPaths: Set<string>,
): void {
  const relPath = ".breadboard/visual-index.json";
  const absolute = pathInsideGarden(gardenDir, relPath);
  const parsed = readJson(absolute);
  if (parsed === undefined || removeIds.size === 0) return;
  const next = pruneIndexValue(parsed, removeIds);
  if (JSON.stringify(next) === JSON.stringify(parsed)) return;
  writeJson(absolute, next);
  modifiedPaths.add(relPath);
}

function pruneVisualArtifacts(
  gardenDir: string,
  removeIds: Set<string>,
  removedPaths: Set<string>,
): void {
  if (removeIds.size === 0) return;
  const visualsDir = pathInsideGarden(gardenDir, ".breadboard/visuals");
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(visualsDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink() || entry.name.startsWith(".")) continue;
    const id = entry.isFile() && entry.name.toLowerCase().endsWith(".json")
      ? entry.name.replace(/\.json$/i, "")
      : entry.isDirectory() ? entry.name : "";
    if (!id || !removeIds.has(id)) continue;
    removeExistingPath(gardenDir, `.breadboard/visuals/${entry.name}`, removedPaths);
  }
}

function resetSourceVisualAssignments(gardenDir: string, modifiedPaths: Set<string>): number {
  const relPath = ".breadboard/source-visuals.json";
  const absolute = pathInsideGarden(gardenDir, relPath);
  const parsed = readJson(absolute);
  if (!Array.isArray(parsed)) return 0;
  let resetCount = 0;
  const next = parsed.map((entry) => {
    if (!isRecord(entry)) return entry;
    const needsReset = entry.usageStatus !== "unused" ||
      SOURCE_VISUAL_ASSIGNMENT_FIELDS.some((field) => own(entry, field));
    if (!needsReset) return entry;
    resetCount += 1;
    const reset: JsonRecord = { ...entry, usageStatus: "unused" };
    for (const field of SOURCE_VISUAL_ASSIGNMENT_FIELDS) delete reset[field];
    return reset;
  });
  if (resetCount > 0) {
    writeJson(absolute, next);
    modifiedPaths.add(relPath);
  }
  return resetCount;
}

function eventBelongsToLearn(
  event: unknown,
  gardenDir: string,
  removed: RemovedPageOwnership,
  removedVisualIds: Set<string>,
): boolean {
  if (!isRecord(event)) return false;
  const type = typeof event.type === "string" ? event.type.trim() : "";
  if (/^learn(?:[_-]|$)/i.test(type)) return true;
  const generatedBy = typeof event.generatedBy === "string" ? event.generatedBy :
    typeof event.generated_by === "string" ? event.generated_by : "";
  if (/^(?:learn|learn_button|breadboard_learn)$/i.test(generatedBy.replace(/[ -]+/g, "_"))) return true;
  const jobId = typeof event.jobId === "string" ? event.jobId :
    typeof event.job_id === "string" ? event.job_id : "";
  if (/^learn_job_/i.test(jobId.trim())) return true;
  const visualId = typeof event.visualId === "string" ? event.visualId :
    typeof event.visualizationId === "string" ? event.visualizationId : "";
  if (visualId && removedVisualIds.has(visualId)) return true;
  return recordOwnershipEvidence(event, gardenDir, removed) === "learning";
}

function filterLearnEvents(
  gardenDir: string,
  removed: RemovedPageOwnership,
  removedVisualIds: Set<string>,
  modifiedPaths: Set<string>,
): number {
  const relPath = ".breadboard/events.jsonl";
  const absolute = pathInsideGarden(gardenDir, relPath);
  let text: string;
  try {
    text = fs.readFileSync(absolute, "utf8");
  } catch {
    return 0;
  }
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  let removedCount = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      kept.push(line);
      continue;
    }
    if (eventBelongsToLearn(parsed, gardenDir, removed, removedVisualIds)) removedCount += 1;
    else kept.push(line);
  }
  if (removedCount > 0) {
    fs.writeFileSync(absolute, kept.length > 0 ? `${kept.join("\n")}\n` : "", "utf8");
    modifiedPaths.add(relPath);
  }
  return removedCount;
}

/**
 * Clear one staged garden after explicit confirmation without touching a
 * database or publishing anything. The caller is responsible for staging and
 * atomic promotion.
 */
export function clearGeneratedLearnState(gardenDir: string): LearnFilesystemClearResult {
  const root = path.resolve(gardenDir);
  const stat = fs.statSync(root);
  if (!stat.isDirectory()) throw new Error(`Learn clear target is not a directory: ${gardenDir}`);

  const removedPaths = new Set<string>();
  const modifiedPaths = new Set<string>();
  const { ownership, learningRoots } = discoverRemovedPages(root);

  const indexPath = pathInsideGarden(root, ".breadboard/visual-index.json");
  const visualIndex = readJson(indexPath);
  const evidence: VisualOwnershipEvidence = {
    learning: new Set(ownership.visualIds),
    nonLearning: new Set(),
  };
  collectVisualIndexEvidence(visualIndex, root, ownership, evidence);
  const visualsDir = pathInsideGarden(root, ".breadboard/visuals");
  collectVisualArtifactEvidence(visualsDir, root, ownership, evidence);
  const removedVisualIds = finalLearningVisualIds(ownership, evidence);

  for (const rootName of learningRoots) removeExistingPath(root, rootName, removedPaths);
  for (const relPath of ownership.markdownPaths) {
    if (learningRoots.some((rootName) => relPath.toLowerCase() === rootName.toLowerCase() || relPath.toLowerCase().startsWith(`${rootName.toLowerCase()}/`))) {
      continue;
    }
    removeExistingPath(root, relPath, removedPaths);
  }
  for (const relPath of GENERATED_LEARN_PATHS) removeExistingPath(root, relPath, removedPaths);

  const resetSourceVisualCount = resetSourceVisualAssignments(root, modifiedPaths);
  pruneVisualIndex(root, removedVisualIds, modifiedPaths);
  pruneVisualArtifacts(root, removedVisualIds, removedPaths);
  const removedEventCount = filterLearnEvents(root, ownership, removedVisualIds, modifiedPaths);

  return {
    removedPaths: sorted(removedPaths),
    modifiedPaths: sorted(modifiedPaths),
    removedLearnerPagePaths: sorted(ownership.markdownPaths),
    removedVisualIds: sorted(removedVisualIds),
    removedEventCount,
    resetSourceVisualCount,
  };
}
