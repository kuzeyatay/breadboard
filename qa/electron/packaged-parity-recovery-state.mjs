import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const QA_RUN_MARKER = ".breadboard-qa-run.json";
const PERSONA_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function fail(message) {
  throw new Error(`Packaged parity recovery state rejected: ${message}`);
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    fail(`${label} must be a non-empty trimmed string.`);
  }
  return value;
}

function samePath(left, right) {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLocaleLowerCase() === normalizedRight.toLocaleLowerCase()
    : normalizedLeft === normalizedRight;
}

function assertRegularFile(file, label) {
  const info = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!info?.isFile() || info.isSymbolicLink()) fail(`${label} is not a regular file.`);
}

function assertRegularDirectory(directory, label) {
  const info = fs.lstatSync(directory, { throwIfNoEntry: false });
  if (!info?.isDirectory() || info.isSymbolicLink()) fail(`${label} is not a non-symlink directory.`);
}

function pathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveQaDatabase(options) {
  const repoRoot = path.resolve(nonEmptyString(options?.repoRoot, "repoRoot"));
  const runtimeRoot = path.resolve(nonEmptyString(options?.runtimeRoot, "runtimeRoot"));
  const runRoot = path.resolve(nonEmptyString(options?.runRoot, "runRoot"));
  const dataDir = path.resolve(nonEmptyString(options?.dataDir, "dataDir"));
  const runId = nonEmptyString(options?.runId, "runId");
  assertRegularDirectory(runtimeRoot, "QA runtime root");
  assertRegularDirectory(runRoot, "QA run root");
  const realRuntimeRoot = fs.realpathSync(runtimeRoot);
  const realRunRoot = fs.realpathSync(runRoot);
  if (
    !samePath(path.dirname(runRoot), runtimeRoot) ||
    !samePath(path.dirname(realRunRoot), realRuntimeRoot) ||
    !pathInside(realRuntimeRoot, realRunRoot) ||
    samePath(realRuntimeRoot, realRunRoot)
  ) {
    fail("runRoot is not a real non-symlink direct child of runtimeRoot.");
  }

  const expectedDataDir = path.join(runRoot, "user-data", "Data");
  if (!samePath(dataDir, expectedDataDir)) {
    fail("dataDir is not the isolated QA run's exact user-data/Data directory.");
  }

  const markerFile = path.join(runRoot, QA_RUN_MARKER);
  assertRegularFile(markerFile, "QA run marker");
  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(markerFile, "utf8"));
  } catch {
    fail("QA run marker is not valid JSON.");
  }
  if (
    marker?.schemaVersion !== 1 ||
    marker.runId !== runId ||
    marker.ownerPid !== process.pid ||
    typeof marker.repoRoot !== "string" ||
    !samePath(marker.repoRoot, repoRoot) ||
    typeof marker.runtimeRoot !== "string" ||
    !samePath(marker.runtimeRoot, runtimeRoot) ||
    typeof marker.runRoot !== "string" ||
    !samePath(marker.runRoot, runRoot)
  ) {
    fail("QA run marker does not authorize this run root.");
  }

  const userDataDir = path.join(runRoot, "user-data");
  const databaseDir = path.join(dataDir, "database");
  for (const [directory, label] of [
    [userDataDir, "QA user-data directory"],
    [dataDir, "QA data directory"],
    [databaseDir, "QA database directory"],
  ]) {
    assertRegularDirectory(directory, label);
    const realDirectory = fs.realpathSync(directory);
    if (!pathInside(realRunRoot, realDirectory) || samePath(realRunRoot, realDirectory)) {
      fail(`${label} escapes the real QA run root.`);
    }
  }

  const databasePath = path.join(databaseDir, "brain.db");
  assertRegularFile(databasePath, "QA conversation database");
  const realDatabasePath = fs.realpathSync(databasePath);
  if (!pathInside(realRunRoot, realDatabasePath)) {
    fail("QA conversation database escapes the real QA run root.");
  }
  const require = createRequire(path.join(repoRoot, "dashboard", "package.json"));
  const Database = require("better-sqlite3");
  return { Database, databasePath };
}

function openDatabase(options) {
  const { Database, databasePath } = resolveQaDatabase(options);
  const database = new Database(databasePath);
  database.pragma("busy_timeout = 5000");
  database.pragma("foreign_keys = ON");
  return database;
}

/**
 * Inject one unresolvable persisted persona reference into the marker-owned QA
 * conversation database. The persona was selected through the UI first; this
 * helper changes only the recovery fault state and can never target user data.
 */
export function injectUnresolvablePersonaSelection(options) {
  const expectedSelectionIdentity = nonEmptyString(
    options?.expectedSelectionIdentity,
    "expectedSelectionIdentity",
  );
  if (!PERSONA_ID_PATTERN.test(expectedSelectionIdentity)) {
    fail("expectedSelectionIdentity is not a canonical persona slug.");
  }
  const capabilityId = nonEmptyString(options?.capabilityId, "capabilityId");
  const faultSelectionIdentity = `parity-missing-${createHash("sha256")
    .update(`${capabilityId}:${expectedSelectionIdentity}`, "utf8")
    .digest("hex")
    .slice(0, 24)}`;

  const database = openDatabase(options);
  try {
    const rows = database.prepare(`
      SELECT id, public_id AS publicId
      FROM conversations
      WHERE active_agency_agent_slug = ?
      ORDER BY id
    `).all(expectedSelectionIdentity);
    if (rows.length !== 1) {
      fail(
        `${capabilityId} expected exactly one UI-selected conversation for ${expectedSelectionIdentity}; observed ${rows.length}.`,
      );
    }
    const row = rows[0];
    if (!Number.isSafeInteger(row.id) || typeof row.publicId !== "string" || !row.publicId) {
      fail(`${capabilityId} selected conversation row is malformed.`);
    }
    const update = database.prepare(`
      UPDATE conversations
      SET active_agency_agent_slug = ?, updated_at = datetime('now')
      WHERE id = ? AND public_id = ? AND active_agency_agent_slug = ?
    `).run(faultSelectionIdentity, row.id, row.publicId, expectedSelectionIdentity);
    if (update.changes !== 1) fail(`${capabilityId} persona fault injection lost its compare-and-swap authority.`);
    return Object.freeze({
      rowId: row.id,
      conversationPublicId: row.publicId,
      faultSelectionIdentity,
    });
  } finally {
    database.close();
  }
}

export function readInjectedPersonaSelection(options) {
  if (!Number.isSafeInteger(options?.rowId) || options.rowId <= 0) {
    fail("rowId must be a positive safe integer.");
  }
  const conversationPublicId = nonEmptyString(options?.conversationPublicId, "conversationPublicId");
  const database = openDatabase(options);
  try {
    const row = database.prepare(`
      SELECT active_agency_agent_slug AS selectionIdentity
      FROM conversations
      WHERE id = ? AND public_id = ?
    `).get(options.rowId, conversationPublicId);
    if (!row) fail("the fault-injected QA conversation disappeared.");
    return row.selectionIdentity === null ? null : nonEmptyString(row.selectionIdentity, "selectionIdentity");
  } finally {
    database.close();
  }
}
