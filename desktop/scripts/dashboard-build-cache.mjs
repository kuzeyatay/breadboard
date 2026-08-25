import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MANIFEST_VERSION = 1;
const MANIFEST_NAME = "breadboard-build-manifest.json";

function collectFiles(root, target, files) {
  if (!fs.existsSync(target)) return;
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) {
    files.push({ absolute: target, relative: path.relative(root, target), link: fs.readlinkSync(target) });
    return;
  }
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(target).sort()) {
      collectFiles(root, path.join(target, name), files);
    }
    return;
  }
  if (stat.isFile()) files.push({ absolute: target, relative: path.relative(root, target), link: null });
}

/**
 * Content fingerprint for files that can change the standalone server graph.
 * Public assets are deliberately excluded: they are copied into a reusable
 * artifact on every launch and do not require webpack to run again.
 */
export function dashboardBuildFingerprint(repoRoot) {
  const dashboard = path.join(repoRoot, "dashboard");
  const files = [];
  for (const relative of [
    "src",
    "scripts",
    "package.json",
    "package-lock.json",
    "bun.lock",
    "next.config.ts",
    "next-env.d.ts",
    "postcss.config.mjs",
    "tsconfig.json",
    "tsconfig.desktop.json",
    ".env",
    ".env.local",
    ".env.production",
    ".env.production.local",
  ]) {
    collectFiles(dashboard, path.join(dashboard, relative), files);
  }
  collectFiles(repoRoot, path.join(repoRoot, "scripts", "setup-mem0.mjs"), files);
  files.sort((left, right) => left.relative.localeCompare(right.relative));

  const hash = createHash("sha256");
  hash.update(`breadboard-dashboard-build-v${MANIFEST_VERSION}\0`);
  for (const file of files) {
    hash.update(file.relative.replaceAll(path.sep, "/"));
    hash.update("\0");
    if (file.link !== null) hash.update(`link:${file.link}`);
    else hash.update(fs.readFileSync(file.absolute));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function dashboardBuildPaths(repoRoot) {
  const output = path.join(repoRoot, "dashboard", ".next-desktop");
  const standaloneDashboard = path.join(output, "standalone", "dashboard");
  return {
    output,
    standaloneDashboard,
    server: path.join(standaloneDashboard, "server.js"),
    manifest: path.join(output, MANIFEST_NAME),
  };
}

function dashboardBuildBackupPath(repoRoot) {
  return path.join(repoRoot, "dashboard", ".next-desktop-last-good");
}

/** Restore the last complete artifact after a killed/interrupted build. */
export function recoverInterruptedDashboardBuild(repoRoot) {
  const { output } = dashboardBuildPaths(repoRoot);
  const backup = dashboardBuildBackupPath(repoRoot);
  if (!fs.existsSync(backup)) return false;
  if (fs.existsSync(output)) fs.rmSync(output, { recursive: true, force: true });
  fs.renameSync(backup, output);
  return true;
}

/**
 * Move the current complete artifact out of Next's destructive output path.
 * Directory rename is same-volume and immediate; no second multi-GiB copy is
 * committed while the build is already under memory pressure.
 */
export function beginDashboardBuild(repoRoot) {
  recoverInterruptedDashboardBuild(repoRoot);
  const { output } = dashboardBuildPaths(repoRoot);
  const backup = dashboardBuildBackupPath(repoRoot);
  if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
  const current = availableDashboardBuild(repoRoot);
  if (current.available) {
    fs.renameSync(output, backup);
    return true;
  }
  if (fs.existsSync(output)) fs.rmSync(output, { recursive: true, force: true });
  return false;
}

/** Commit the newly validated artifact and discard its rollback slot. */
export function completeDashboardBuild(repoRoot) {
  const backup = dashboardBuildBackupPath(repoRoot);
  if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
}

export function reusableDashboardBuild(repoRoot) {
  const available = availableDashboardBuild(repoRoot);
  if (!available.available) {
    return { reusable: false, reason: available.reason };
  }
  return available.current
    ? { reusable: true, reason: "dashboard inputs are unchanged" }
    : { reusable: false, reason: "dashboard inputs changed" };
}

/**
 * Describe the last complete standalone artifact independently of freshness.
 *
 * Lean mode may deliberately run a stale artifact when Windows cannot safely
 * admit another production build. That is still a lean, bounded server; the
 * important invariant is that a manifest from this build format and its
 * server entry both exist. Missing/incompatible artifacts never fall through
 * to `next dev`.
 */
export function availableDashboardBuild(repoRoot) {
  const paths = dashboardBuildPaths(repoRoot);
  if (!fs.existsSync(paths.server)) return { available: false, current: false, reason: "standalone server is absent" };
  if (!fs.existsSync(paths.manifest)) return { available: false, current: false, reason: "build manifest is absent" };
  try {
    const manifest = JSON.parse(fs.readFileSync(paths.manifest, "utf8"));
    if (manifest.version !== MANIFEST_VERSION || typeof manifest.fingerprint !== "string") {
      return { available: false, current: false, reason: "build manifest is incompatible" };
    }
    const fingerprint = dashboardBuildFingerprint(repoRoot);
    const current = manifest.fingerprint === fingerprint;
    return {
      available: true,
      current,
      reason: current ? "dashboard inputs are unchanged" : "dashboard inputs changed",
      builtAt: typeof manifest.builtAt === "string" ? manifest.builtAt : null,
    };
  } catch {
    return { available: false, current: false, reason: "build manifest is unreadable" };
  }
}

export function writeDashboardBuildManifest(repoRoot) {
  const paths = dashboardBuildPaths(repoRoot);
  if (!fs.existsSync(paths.server)) {
    throw new Error(`Standalone dashboard build did not produce ${paths.server}`);
  }
  fs.writeFileSync(
    paths.manifest,
    `${JSON.stringify({
      version: MANIFEST_VERSION,
      fingerprint: dashboardBuildFingerprint(repoRoot),
      builtAt: new Date().toISOString(),
    }, null, 2)}\n`,
    "utf8",
  );
}

/** Refresh assets that Next intentionally keeps outside its traced server. */
export function refreshStandaloneDashboardAssets(repoRoot) {
  const dashboard = path.join(repoRoot, "dashboard");
  const { standaloneDashboard } = dashboardBuildPaths(repoRoot);
  const staticSource = path.join(dashboard, ".next-desktop", "static");
  if (fs.existsSync(staticSource)) {
    fs.cpSync(staticSource, path.join(standaloneDashboard, ".next-desktop", "static"), {
      recursive: true,
      force: true,
    });
  }
  const publicSource = path.join(dashboard, "public");
  if (fs.existsSync(publicSource)) {
    fs.cpSync(publicSource, path.join(standaloneDashboard, "public"), {
      recursive: true,
      force: true,
    });
  }
}
