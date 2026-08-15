import * as fs from "node:fs";
import * as path from "node:path";
import type { ResolvedPaths } from "./path-resolver";

/**
 * First-run provisioning of the mutable Quartz workspace.
 *
 * Quartz's build output (`public/`) and cache (`.quartz-cache/`) are written
 * next to its own source tree, so the whole workspace must live in user data.
 * We copy the read-only template shipped in resources into
 * `<dataRoot>/quartz` once, marked with a version file so app updates can
 * refresh program files without touching user content.
 *
 * `content/` is user data: it is only created (empty) if missing and is never
 * overwritten by re-provisioning.
 */
const WORKSPACE_VERSION_FILE = ".breadboard-workspace-version";

/** Directories/files of the Quartz checkout that are program files (safe to
 * refresh on update). `content/`, `public/`, `.quartz-cache/` are excluded. */
const TEMPLATE_ENTRIES = [
  "quartz",
  "node_modules",
  "package.json",
  "package-lock.json",
  "quartz.config.ts",
  "quartz.layout.ts",
  "tsconfig.json",
  "globals.d.ts",
  "index.d.ts",
];

const QA_DASHBOARD_LINK_ENTRIES = ["node_modules"];
const QA_DASHBOARD_COPY_DIRECTORIES = ["src", "public"];
const QA_DASHBOARD_COPY_ENTRIES = [
  "package.json",
  "package-lock.json",
  "next.config.ts",
  "postcss.config.mjs",
  "tsconfig.json",
  "tsconfig.desktop.json",
  "next-env.d.ts",
  "eslint.config.mjs",
];

interface NextSwcBinding {
  packageName: string;
  binaryName: string;
}

function nextSwcBindingsForCurrentPlatform(): NextSwcBinding[] {
  const binding = (target: string): NextSwcBinding => ({
    packageName: `@next/swc-${target}`,
    binaryName: `next-swc.${target}.node`,
  });

  if (process.platform === "win32") {
    if (process.arch === "x64") return [binding("win32-x64-msvc")];
    if (process.arch === "arm64") return [binding("win32-arm64-msvc")];
    if (process.arch === "ia32") return [binding("win32-ia32-msvc")];
  }
  if (process.platform === "darwin") {
    if (process.arch === "x64") return [binding("darwin-x64")];
    if (process.arch === "arm64") return [binding("darwin-arm64")];
  }
  if (process.platform === "linux") {
    // Both libc variants are optional dependencies. Trying the installed
    // candidate makes the preflight work on GNU and musl distributions
    // without guessing the host libc from a child-process environment.
    if (process.arch === "x64") {
      return [binding("linux-x64-gnu"), binding("linux-x64-musl")];
    }
    if (process.arch === "arm64") {
      return [binding("linux-arm64-gnu"), binding("linux-arm64-musl")];
    }
    if (process.arch === "arm") return [binding("linux-arm-gnueabihf")];
  }
  return [];
}

/**
 * Fail before exposing the real dashboard dependencies to the QA workspace.
 * If Next cannot load its native SWC optional dependency, it attempts to
 * download a fallback into the dependency tree/cache. That would violate QA's
 * no-write boundary around the developer checkout.
 */
function preflightQaDashboardSwc(sourceRoot: string): void {
  const candidates = nextSwcBindingsForCurrentPlatform();
  const platform = `${process.platform}/${process.arch}`;
  if (candidates.length === 0) {
    throw new Error(
      `Breadboard QA dashboard cannot start safely: no supported Next.js native SWC binding is known for ${platform}.`,
    );
  }

  const failures: string[] = [];
  for (const candidate of candidates) {
    const packageDir = path.join(sourceRoot, "node_modules", ...candidate.packageName.split("/"));
    const packageJson = path.join(packageDir, "package.json");
    const binary = path.join(packageDir, candidate.binaryName);
    if (!fs.existsSync(packageJson) || !fs.existsSync(binary)) {
      failures.push(`${candidate.packageName} is incomplete or missing`);
      continue;
    }
    try {
      // Loading the exact binary (rather than merely resolving its package)
      // catches corrupt files, wrong-architecture installs, and loader errors.
      const loaded: unknown = require(binary);
      if (loaded === null || (typeof loaded !== "object" && typeof loaded !== "function")) {
        throw new Error("native module returned no exports");
      }
      return;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      failures.push(`${candidate.packageName} failed to load: ${detail}`);
    }
  }

  throw new Error(
    [
      `Breadboard QA dashboard cannot start safely on ${platform}: its native Next.js SWC dependency is unavailable.`,
      ...failures,
      "Run the dashboard dependency install for this platform before starting QA; fallback downloads are not allowed through the real dashboard/node_modules tree.",
    ].join(" "),
  );
}

export function quartzTemplateDir(paths: ResolvedPaths): string {
  return path.join(paths.appRoot, paths.qaMode ? "quartz" : "quartz-template");
}

export function currentWorkspaceVersion(appVersion: string): string {
  return `quartz-workspace/${appVersion}`;
}

export function needsQuartzProvisioning(paths: ResolvedPaths, appVersion: string): boolean {
  if (paths.mode === "dev" && !paths.qaMode) return false;
  const versionFile = path.join(paths.quartzWorkspace, WORKSPACE_VERSION_FILE);
  if (!fs.existsSync(versionFile)) return true;
  try {
    return fs.readFileSync(versionFile, "utf8").trim() !== currentWorkspaceVersion(appVersion);
  } catch {
    return true;
  }
}

export function provisionQuartzWorkspace(
  paths: ResolvedPaths,
  appVersion: string,
  onProgress?: (message: string) => void,
): void {
  const template = quartzTemplateDir(paths);
  if (!fs.existsSync(template)) {
    throw new Error(
      `Quartz template missing at ${template}. The installation is incomplete; reinstall Breadboard.`,
    );
  }
  fs.mkdirSync(paths.quartzWorkspace, { recursive: true });
  for (const entry of TEMPLATE_ENTRIES) {
    const source = path.join(template, entry);
    if (!fs.existsSync(source)) continue;
    const destination = path.join(paths.quartzWorkspace, entry);
    onProgress?.(`Installing garden component: ${entry}`);
    fs.rmSync(destination, { recursive: true, force: true });
    if (paths.qaMode && entry === "node_modules" && fs.statSync(source).isDirectory()) {
      // Dependencies are treated as immutable program assets. Quartz itself
      // writes a cache below its source directory, so its source must be a real
      // isolated copy rather than a junction back into the checkout.
      fs.symlinkSync(source, destination, process.platform === "win32" ? "junction" : "dir");
    } else {
      fs.cpSync(source, destination, { recursive: true });
    }
  }
  fs.mkdirSync(paths.quartzContent, { recursive: true });
  // A brand-new install has no gardens yet; without any page Quartz serves a
  // bare 404. Seed a landing page once (never overwrite it, and never touch a
  // garden that already has content).
  const landingPage = path.join(paths.quartzContent, "index.md");
  if (!fs.existsSync(landingPage) && fs.readdirSync(paths.quartzContent).length === 0) {
    fs.writeFileSync(
      landingPage,
      [
        "---",
        "title: Breadboard",
        "---",
        "",
        "Your gardens will appear here.",
        "",
        "Create a cluster in the Breadboard workspace and ingest a source; its",
        "`sources` and `learning` pages are published into this garden.",
        "",
      ].join("\n"),
      "utf8",
    );
  }
  // Quartz's visualization registry imports `../../../shared/…` — the repo
  // keeps `shared/` as a sibling of `quartz/`, so the data root mirrors that.
  const sharedSource = path.join(paths.appRoot, "shared");
  if (fs.existsSync(sharedSource)) {
    const sharedTarget = path.join(path.dirname(paths.quartzWorkspace), "shared");
    fs.rmSync(sharedTarget, { recursive: true, force: true });
    fs.cpSync(sharedSource, sharedTarget, { recursive: true });
  }
  fs.writeFileSync(
    path.join(paths.quartzWorkspace, WORKSPACE_VERSION_FILE),
    currentWorkspaceVersion(appVersion),
    "utf8",
  );
}

/**
 * Run Next development code from an isolated working directory.
 *
 * Next owns an exclusive `.next/dev/lock` and may rewrite tsconfig.json. A QA
 * instance therefore cannot safely use the checkout directory when a developer
 * instance is already open. Source and public assets are copied because Next
 * does not reliably discover an App Router through a Windows junction and may
 * rewrite project files. Only immutable dependencies are linked.
 */
export function provisionQaDashboardWorkspace(paths: ResolvedPaths): void {
  if (!paths.qaMode) return;
  const sourceRoot = path.join(paths.appRoot, "dashboard");
  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`Dashboard source missing at ${sourceRoot}`);
  }
  preflightQaDashboardSwc(sourceRoot);
  fs.mkdirSync(paths.dashboardServerDir, { recursive: true });

  for (const entry of QA_DASHBOARD_LINK_ENTRIES) {
    const source = path.join(sourceRoot, entry);
    if (!fs.existsSync(source)) continue;
    const destination = path.join(paths.dashboardServerDir, entry);
    fs.rmSync(destination, { recursive: true, force: true });
    fs.symlinkSync(
      source,
      destination,
      process.platform === "win32" ? "junction" : "dir",
    );
  }
  for (const entry of QA_DASHBOARD_COPY_DIRECTORIES) {
    const source = path.join(sourceRoot, entry);
    if (!fs.existsSync(source)) continue;
    const destination = path.join(paths.dashboardServerDir, entry);
    fs.rmSync(destination, { recursive: true, force: true });
    fs.cpSync(source, destination, { recursive: true });
  }
  for (const entry of QA_DASHBOARD_COPY_ENTRIES) {
    const source = path.join(sourceRoot, entry);
    if (!fs.existsSync(source)) continue;
    fs.copyFileSync(source, path.join(paths.dashboardServerDir, entry));
  }
}

/** Generated compose override for the optional Scriberr Docker mode. */
export function writeScriberrComposeOverride(paths: ResolvedPaths, hostPort: number): string {
  const overridePath = path.join(paths.runtimeDir, "scriberr-compose.override.yml");
  fs.mkdirSync(paths.runtimeDir, { recursive: true });
  fs.writeFileSync(
    overridePath,
    `services:\n  scriberr:\n    ports: !override\n      - "${hostPort}:8080"\n`,
    "utf8",
  );
  return overridePath;
}
