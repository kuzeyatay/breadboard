import fs from "node:fs";
import path from "node:path";

import {
  availableDashboardBuild,
  dashboardBuildPaths,
} from "./dashboard-build-cache.mjs";

const UNSAFE_STANDALONE_ROOT_PATH =
  /^(?:db\/|database\/|artifacts\/|\.env|\.next\/|\.next-dev|\.next-production|\.vercel\/|tmp-)/iu;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  return (
    isRecord(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())
  );
}

function assertDirectFile(filePath, label) {
  const metadata = fs.lstatSync(filePath, { throwIfNoEntry: false });
  if (!metadata?.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} is missing or is not a direct regular file: ${filePath}`);
  }
  const resolved = path.resolve(filePath);
  const canonical = fs.realpathSync.native(resolved);
  if (
    (process.platform === "win32" ? canonical.toLowerCase() : canonical) !==
    (process.platform === "win32" ? resolved.toLowerCase() : resolved)
  ) {
    throw new Error(`${label} traverses a link or junction: ${filePath}`);
  }
}

function validIsoTimestamp(value) {
  if (typeof value !== "string" || value.length > 64) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}

/**
 * Keep Next's dashboard-root standalone artifact canonical in the build cache,
 * while preserving the installed app's long-standing
 * `dashboard-standalone/dashboard` contract at the packaging boundary.
 */
export function packagedDashboardCopyPlan(currentBuild, stagingRoot) {
  if (
    !isRecord(currentBuild) ||
    typeof currentBuild.standaloneDashboard !== "string" ||
    !path.isAbsolute(currentBuild.standaloneDashboard)
  ) {
    throw new Error("The standalone dashboard copy source must be one absolute path.");
  }
  if (typeof stagingRoot !== "string" || !path.isAbsolute(stagingRoot)) {
    throw new Error("The packaged application staging root must be one absolute path.");
  }
  const dashboardTarget = path.join(stagingRoot, "dashboard-standalone");
  return Object.freeze({
    standaloneSource: path.resolve(currentBuild.standaloneDashboard),
    dashboardTarget,
    packagedDashboardTarget: path.join(dashboardTarget, "dashboard"),
  });
}

export function shouldExcludePackagedDashboardPath(relativePath) {
  if (typeof relativePath !== "string") return true;
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\.\//u, "");
  return UNSAFE_STANDALONE_ROOT_PATH.test(normalized);
}

export function assertCurrentStandaloneBuildManifest(repoRoot) {
  const paths = dashboardBuildPaths(repoRoot);
  assertDirectFile(paths.server, "standalone dashboard server");
  assertDirectFile(paths.manifest, "standalone dashboard build manifest");
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(paths.manifest, "utf8"));
  } catch (error) {
    throw new Error(
      `Standalone dashboard build manifest is invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (
    !hasExactKeys(manifest, ["version", "fingerprint", "builtAt"]) ||
    manifest.version !== 2 ||
    !/^[a-f0-9]{64}$/u.test(manifest.fingerprint ?? "") ||
    !validIsoTimestamp(manifest.builtAt)
  ) {
    throw new Error("Standalone dashboard build manifest is not one valid v2 receipt.");
  }
  const available = availableDashboardBuild(repoRoot);
  if (!available.available || !available.current) {
    throw new Error(`Standalone dashboard input is stale or unavailable: ${available.reason}.`);
  }
  return paths;
}

const RUNTIME_PACKAGE_NAMES = new Set(["@esbuild", "esbuild", "typescript", "three"]);

function normalizedPath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * Return every compiler/Three package occurrence outside the one reviewed
 * dashboard-root node_modules location. Links are never followed, so a nested
 * junction cannot hide a second mutable dependency graph from this scan.
 */
export function findNestedDashboardRuntimeDuplicates(dashboardRoot) {
  const root = path.resolve(dashboardRoot);
  const allowed = new Map(
    [...RUNTIME_PACKAGE_NAMES].map((name) => [
      name,
      normalizedPath(path.join(root, "node_modules", name)),
    ]),
  );
  const duplicates = new Set();
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      duplicates.add(
        `${path.relative(root, directory).split(path.sep).join("/") || "."} (unreadable directory)`,
      );
      continue;
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      let metadata;
      try {
        metadata = fs.lstatSync(absolute);
      } catch {
        duplicates.add(`${relative} (unreadable entry)`);
        continue;
      }
      const parentIsNodeModules = path.basename(directory).toLowerCase() === "node_modules";
      const packageName = entry.name.toLowerCase();
      if (parentIsNodeModules && RUNTIME_PACKAGE_NAMES.has(packageName)) {
        if (normalizedPath(absolute) !== allowed.get(packageName)) duplicates.add(relative);
      }
      if (metadata.isSymbolicLink()) {
        // A link with an unrelated basename can still point at an arbitrary
        // dependency graph. Refuse every unscannable edge rather than silently
        // claiming that the complete packaged dashboard was inspected.
        duplicates.add(`${relative} (unscannable link or junction)`);
        continue;
      }
      if (metadata.isDirectory()) pending.push(absolute);
    }
  }
  return [...duplicates].sort();
}
