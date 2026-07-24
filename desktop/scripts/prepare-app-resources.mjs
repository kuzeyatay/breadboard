// Stages the read-only application resources bundled into the installer under
// build-resources/app-services/. Run AFTER the dashboard standalone build:
//
//   cd dashboard && BREADBOARD_DESKTOP_BUILD=1 BREADBOARD_NEXT_DIST_DIR=.next-desktop npx next build
//
// Layout produced (mirrors the repo for the services' repo-root assumptions):
//   app-services/
//     dashboard-standalone/       <- .next-desktop/standalone (server.js tree)
//     dashboard/                  <- marker only (repo-root detection)
//     chatmock/                   <- ChatMock source (no docker/tests)
//     openharness/                <- OpenHarness source + node_modules
//     openharness-config/         <- agent/skill/system config (read-only)
//     quartz-template/            <- Quartz program files (no content/public)
//     scriberr/                   <- docker-compose only (optional Docker mode)
//     shared/                     <- static shared assets

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "..");
const stagingRoot = path.join(desktopRoot, "build-resources", "app-services");

function log(message) {
  console.log(`[prepare-app] ${message}`);
}

function fail(message) {
  console.error(`[prepare-app] ERROR: ${message}`);
  process.exit(1);
}

/** Copy `source` to `target`, skipping any relative path for which `skip` returns true. */
function copyTree(source, target, skip = () => false) {
  fs.cpSync(source, target, {
    recursive: true,
    force: true,
    // Materialize symlinks as real files: creating symlinks on Windows needs
    // elevated privileges, and installer resources must be self-contained.
    dereference: true,
    filter: (src) => {
      const rel = path.relative(source, src);
      if (rel === "") return true;
      return !skip(rel.split(path.sep).join("/"));
    },
  });
}

function freshDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

// --- dashboard standalone -------------------------------------------------
const standaloneSource = path.join(repoRoot, "dashboard", ".next-desktop", "standalone");
const serverJs = path.join(standaloneSource, "dashboard", "server.js");
if (!fs.existsSync(serverJs)) {
  fail(
    `Standalone build not found (${serverJs}). Run the dashboard desktop build first ` +
      "(BREADBOARD_DESKTOP_BUILD=1 BREADBOARD_NEXT_DIST_DIR=.next-desktop npx next build).",
  );
}
const dashboardTarget = path.join(stagingRoot, "dashboard-standalone");
log("staging dashboard standalone server");
freshDir(dashboardTarget);
copyTree(standaloneSource, dashboardTarget, (rel) =>
  // Belt-and-braces: never ship data, secrets, or dev build state even if
  // tracing regressions reintroduce them.
  /^dashboard\/(db\/|artifacts\/|\.env|\.next\/|\.next-dev|\.next-production|\.vercel\/|tmp-)/.test(rel),
);
// Static assets + public files live outside the standalone tree.
log("staging dashboard static assets");
copyTree(
  path.join(repoRoot, "dashboard", ".next-desktop", "static"),
  path.join(dashboardTarget, "dashboard", ".next-desktop", "static"),
);
copyTree(
  path.join(repoRoot, "dashboard", "public"),
  path.join(dashboardTarget, "dashboard", "public"),
);

// Repo-root marker so services that look for `<root>/dashboard` next to
// `<root>/openharness-config` recognize the staged layout.
fs.mkdirSync(path.join(stagingRoot, "dashboard"), { recursive: true });
fs.writeFileSync(
  path.join(stagingRoot, "dashboard", "README.txt"),
  "Marker directory. The dashboard server runs from dashboard-standalone/dashboard/server.js.\n",
);

// --- chatmock -------------------------------------------------------------
log("staging chatmock");
freshDir(path.join(stagingRoot, "chatmock"));
copyTree(path.join(repoRoot, "chatmock"), path.join(stagingRoot, "chatmock"), (rel) =>
  /^(docker\/|Dockerfile|docker-compose|tests\/|chatmock\.egg-info\/|build\.py|gui\.py|__pycache__|\.git)/.test(rel) ||
  rel.includes("__pycache__"),
);

// --- openharness ----------------------------------------------------------
// The vendored checkout uses Bun's isolated install layout (junctions into a
// node_modules/.bun store) which cannot be copied portably. Stage only the
// server-runtime workspace closure of packages/opencode (the web/console/
// desktop app workspaces are dev-only and pull unreachable preview tarballs),
// then run a hoisted install INSIDE the staging tree: real files, no
// junctions, vendored checkout untouched.
const OPENHARNESS_RUNTIME_WORKSPACES = [
  "packages/codemode",
  "packages/core",
  "packages/effect-drizzle-sqlite",
  "packages/effect-sqlite-node",
  "packages/http-recorder",
  "packages/llm",
  "packages/opencode",
  "packages/plugin",
  "packages/protocol",
  "packages/schema",
  "packages/script",
  "packages/sdk/js",
  "packages/server",
  "packages/tui",
  "packages/ui",
];
log("staging openharness sources (server runtime closure)");
const openharnessTarget = path.join(stagingRoot, "openharness");
freshDir(openharnessTarget);
for (const entry of [
  "package.json",
  "bun.lock",
  "bunfig.toml",
  "tsconfig.json",
  "patches",
  "AGENTS.md",
  "BREADBOARD.md",
  "LICENSE",
  "README.md",
]) {
  const source = path.join(repoRoot, "openharness", entry);
  if (!fs.existsSync(source)) continue;
  copyTree(source, path.join(openharnessTarget, entry));
}
for (const workspace of OPENHARNESS_RUNTIME_WORKSPACES) {
  const source = path.join(repoRoot, "openharness", workspace);
  if (!fs.existsSync(source)) fail(`OpenHarness workspace missing: ${source}`);
  copyTree(source, path.join(openharnessTarget, workspace), (rel) =>
    /(^|\/)node_modules(\/|$)/.test(rel) || /(^|\/)(test|tests)(\/|$)/.test(rel),
  );
}
// Restrict the staged workspace list to the runtime closure so bun does not
// look for the excluded app workspaces.
{
  const manifestPath = path.join(openharnessTarget, "package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.workspaces = {
    packages: OPENHARNESS_RUNTIME_WORKSPACES,
    catalog: manifest.workspaces.catalog,
  };
  delete manifest.scripts.prepare; // husky is dev-only
  // We install with --ignore-scripts, so the trusted-scripts list only
  // triggers a bun hoisted-linker bug (packages left unextracted with
  // "failed to enqueue lifecycle scripts: ENOENT"). Drop it.
  delete manifest.trustedDependencies;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}
// OpenHarness node_modules are NOT shipped: Bun's isolated installer uses
// machine-absolute junctions, and its hoisted linker is broken on Windows
// (bun 1.3.14 leaves packages empty). Instead:
//   1. validate the trimmed workspace installs + produce a lockfile and a
//      fresh, self-contained package cache in a LOCAL temp dir (Bun installs
//      also silently fail on OneDrive-synced folders);
//   2. ship sources + bun.lock + the cache (resources/bun-cache);
//   3. the desktop app runs `bun install` at first launch (offline-first
//      against the bundled cache) — see desktop/src/main/provisioning.ts.
log("validating openharness install and building the bundled package cache");
{
  const bunBinary =
    process.platform === "win32"
      ? path.join(desktopRoot, "build-resources", "runtimes", "bun", "bun.exe")
      : "bun";
  const bunCommand = fs.existsSync(bunBinary) ? bunBinary : "bun";
  const localInstallDir = path.join(os.tmpdir(), "breadboard-openharness-install");
  const localCacheDir = path.join(os.tmpdir(), "breadboard-bun-cache");
  fs.rmSync(localInstallDir, { recursive: true, force: true });
  // Bun mutates patched-package cache entries during installation. Reusing a
  // cache from an interrupted build can ship half-renamed directories that
  // fail with ENOTEMPTY on the user's first launch.
  fs.rmSync(localCacheDir, { recursive: true, force: true });
  fs.mkdirSync(localInstallDir, { recursive: true });
  fs.mkdirSync(localCacheDir, { recursive: true });
  copyTree(openharnessTarget, localInstallDir);
  const install = spawnSync(bunCommand, ["install", "--ignore-scripts"], {
    cwd: localInstallDir,
    stdio: "inherit",
    shell: false,
    env: { ...process.env, BUN_INSTALL_CACHE_DIR: localCacheDir },
  });
  if (install.status !== 0) fail("bun install validation for the trimmed OpenHarness tree failed");
  // Isolated layout: real files live in node_modules/.bun/<pkg>@<ver>/...
  const store = path.join(localInstallDir, "node_modules", ".bun");
  const storeOk =
    fs.existsSync(store) &&
    fs
      .readdirSync(store)
      .some(
        (name) =>
          name.startsWith("hono@") &&
          fs.existsSync(path.join(store, name, "node_modules", "hono", "package.json")),
      );
  if (!storeOk) fail(`bun install produced an empty node_modules store (${store})`);
  // Ship the exact lockfile this resolution produced.
  fs.copyFileSync(path.join(localInstallDir, "bun.lock"), path.join(openharnessTarget, "bun.lock"));
  log("copying the bundled bun package cache into build-resources");
  const cacheTarget = path.join(desktopRoot, "build-resources", "bun-cache");
  fs.rmSync(cacheTarget, { recursive: true, force: true });
  copyTree(localCacheDir, cacheTarget);
  fs.rmSync(localInstallDir, { recursive: true, force: true });
}

// --- openharness-config ---------------------------------------------------
log("staging openharness-config");
freshDir(path.join(stagingRoot, "openharness-config"));
copyTree(path.join(repoRoot, "openharness-config"), path.join(stagingRoot, "openharness-config"));

// --- quartz template (program files only; content/public are user data) ---
log("staging quartz template");
const quartzTarget = path.join(stagingRoot, "quartz-template");
freshDir(quartzTarget);
for (const entry of [
  "quartz",
  "node_modules",
  "package.json",
  "package-lock.json",
  "quartz.config.ts",
  "quartz.layout.ts",
  "tsconfig.json",
  "globals.d.ts",
  "index.d.ts",
]) {
  const source = path.join(repoRoot, "quartz", entry);
  if (!fs.existsSync(source)) continue;
  copyTree(source, path.join(quartzTarget, entry), (rel) => rel.startsWith(".git"));
}

// --- scriberr (compose only, optional Docker compatibility mode) ----------
log("staging scriberr compose file");
freshDir(path.join(stagingRoot, "scriberr"));
fs.copyFileSync(
  path.join(repoRoot, "scriberr", "docker-compose.yml"),
  path.join(stagingRoot, "scriberr", "docker-compose.yml"),
);

// --- shared static assets -------------------------------------------------
if (fs.existsSync(path.join(repoRoot, "shared"))) {
  log("staging shared assets");
  freshDir(path.join(stagingRoot, "shared"));
  copyTree(path.join(repoRoot, "shared"), path.join(stagingRoot, "shared"));
}

// --- ui-tars-adapter (browser-operator sidecar; optional runtime) ---------
// Staged as SOURCE. Its production dependencies (@agent-tars/core, puppeteer-core,
// @tarko/*, @agent-infra/browser, react) must be installed into the staged dir at
// package time — run `npm install --omit=dev` in resources/app-services/ui-tars-adapter
// as a packaging step. UI-TARS is optional: if those deps or a system Chrome/Edge
// are absent, the app still runs and the agent shows an unavailable state. Chromium
// is NOT bundled; a system Chrome/Edge is located at runtime by browser-finder.
if (fs.existsSync(path.join(repoRoot, "ui-tars-adapter"))) {
  log("staging ui-tars-adapter (source; prod deps installed at package time)");
  const uiTarsTarget = path.join(stagingRoot, "ui-tars-adapter");
  freshDir(uiTarsTarget);
  copyTree(path.join(repoRoot, "ui-tars-adapter"), uiTarsTarget, (rel) =>
    /(^|\/)node_modules(\/|$)/.test(rel) || /(^|\/)test(\/|$)/.test(rel),
  );
}

// --- licenses -------------------------------------------------------------
log("staging license notices");
const licensesTarget = path.join(desktopRoot, "build-resources", "licenses");
fs.mkdirSync(licensesTarget, { recursive: true });
const licenseSources = [
  ["chatmock", path.join(repoRoot, "chatmock", "LICENSE")],
  ["openharness", path.join(repoRoot, "openharness", "LICENSE")],
  ["quartz", path.join(repoRoot, "quartz", "LICENSE.txt")],
];
for (const [name, source] of licenseSources) {
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, path.join(licensesTarget, `${name}-LICENSE.txt`));
  }
}

// Sanity guard: no databases or env files may be staged.
const forbidden = [];
function scanForbidden(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanForbidden(full);
    } else if (/\.(db|db-shm|db-wal)$/.test(entry.name) || /^\.env($|\.)/.test(entry.name)) {
      // .env.example files are documentation, not secrets.
      if (!entry.name.endsWith(".example")) forbidden.push(full);
    }
  }
}
scanForbidden(stagingRoot);
if (forbidden.length > 0) {
  fail(`Mutable data or env secrets staged into resources:\n  ${forbidden.join("\n  ")}`);
}
log("done");
