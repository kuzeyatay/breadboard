import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Single authority for every filesystem location the desktop app uses.
 *
 * Two modes:
 *  - dev:      running from the repository checkout (`electron . --breadboard-dev`
 *              or app.isPackaged === false). Services run from the repo while
 *              durable user data stays in the same profile as the packaged app.
 *  - packaged: running from an installed build. Immutable program files live
 *              under `process.resourcesPath`; every mutable byte lives under
 *              the OS user-data directory.
 */
export type DesktopMode = "dev" | "packaged";

export interface ResolvedPaths {
  readonly mode: DesktopMode;
  /** True only for the explicitly gated Playwright development harness. */
  readonly qaMode: boolean;
  /** Repo root (dev) or `<resources>/app-services` (packaged): a directory
   * that mirrors the repo layout for read-only code and entrypoints. */
  readonly appRoot: string;
  /** Immutable executable/manifest authority root. Runtime V2 resolves only
   * bundled runtimes and launch manifests here, never from appRoot or data. */
  readonly runtimeRoot: string;
  /** Read-only resources root (equals appRoot in dev). */
  readonly resourcesRoot: string;
  /** Base of all mutable data (Electron userData in packaged mode). */
  readonly dataRoot: string;
  /** Dashboard SQLite directory (contains brain.db, skills-catalog.db). */
  readonly databaseDir: string;
  /** Quartz workspace (mutable: content/, public/, .quartz-cache). */
  readonly quartzWorkspace: string;
  readonly quartzContent: string;
  /** Hermes session workspace root, separate from Hermes's own state home. */
  readonly hermesWorkspaceRoot: string;
  /** Disposable Hermes home (config, logs, and non-canonical session cache). */
  readonly hermesHome: string;
  /** Disposable Codex coding-agent home; Breadboard remains canonical. */
  readonly codexHome: string;
  /** Skill stores. */
  readonly skillsQuarantine: string;
  readonly skillsApproved: string;
  readonly skillsConditional: string;
  readonly logsDir: string;
  readonly runtimeDir: string;
  readonly configDir: string;
  readonly backupsDir: string;
  readonly tempDir: string;
  /** Where the Next.js standalone server.js lives (packaged) or the dashboard
   * package dir (dev). */
  readonly dashboardServerDir: string;
  /** Pinned Hermes source marker/resources directory. */
  readonly hermesAppDir: string;
  /** Bundled runtimes (Python) in packaged mode; empty string in dev. */
  readonly runtimesDir: string;
  /** Bundled auxiliary binaries (ffmpeg, yt-dlp) when present. */
  readonly binDir: string;
}

export interface PathResolverInput {
  readonly isPackaged: boolean;
  readonly forceDev: boolean;
  readonly qaMode?: boolean;
  /** Electron app.getPath("userData"). */
  readonly userDataDir: string;
  /** process.resourcesPath when packaged. */
  readonly electronResourcesPath: string | undefined;
  /** Directory of the compiled desktop main (dist/main) — used to find the repo
   * root in dev mode. */
  readonly moduleDir: string;
}

export function repoRootFromModuleDir(moduleDir: string): string {
  // dist/main -> dist -> desktop -> repo root
  return path.resolve(moduleDir, "..", "..", "..");
}

export function resolvePaths(input: PathResolverInput): ResolvedPaths {
  const mode: DesktopMode = input.isPackaged && !input.forceDev ? "packaged" : "dev";
  const qaMode = mode === "dev" && input.qaMode === true;
  const userDataRoot = path.join(input.userDataDir, "Data");

  if (mode === "dev") {
    const repoRoot = repoRootFromModuleDir(input.moduleDir);
    assertDir(repoRoot, "repository root");
    // Hot/lean development and the packaged app are two program builds of the
    // same local product, not two accounts. Keep one durable profile so a
    // person sees the same gardens, conversations, memories, and artifacts in
    // either build. QA still gets an isolated Electron userData directory from
    // its launcher, so using userDataRoot here preserves test isolation.
    const dataRoot = userDataRoot;
    const runtimeRoot = path.join(repoRoot, "desktop", "build-resources");
    const quartzWorkspace = path.join(dataRoot, "quartz");
    return {
      mode,
      qaMode,
      appRoot: repoRoot,
      runtimeRoot,
      resourcesRoot: repoRoot,
      dataRoot,
      databaseDir: path.join(dataRoot, "database"),
      quartzWorkspace,
      quartzContent: path.join(quartzWorkspace, "content"),
      hermesWorkspaceRoot: path.join(dataRoot, "runtime", "hermes-workspaces"),
      hermesHome: path.join(dataRoot, "runtime", "hermes"),
      codexHome: path.join(dataRoot, "runtime", "codex"),
      skillsQuarantine: path.join(dataRoot, "skills", "quarantine"),
      skillsApproved: path.join(dataRoot, "skills", "approved"),
      skillsConditional: path.join(dataRoot, "skills", "conditional"),
      logsDir: path.join(dataRoot, "logs"),
      runtimeDir: path.join(dataRoot, "runtime"),
      configDir: path.join(dataRoot, "config"),
      backupsDir: path.join(dataRoot, "backups"),
      tempDir: path.join(dataRoot, "temp"),
      // Hot development must execute the real source tree so Turbopack sees
      // physical dependencies beneath its narrow project root and HMR observes
      // edits. QA still isolates every mutable Breadboard store in dataRoot;
      // Next's checkout-scoped lock rejects a second hot compiler rather than
      // queueing it; Electron's Hot checkout guard reports that before Runtime
      // V2 starts.
      dashboardServerDir: path.join(repoRoot, "dashboard"),
      hermesAppDir: path.join(repoRoot, "hermes-agent"),
      runtimesDir: "",
      binDir: path.join(repoRoot, "desktop", "resources", "bin"),
    };
  }

  const resources = input.electronResourcesPath;
  if (!resources) {
    throw new Error("Packaged mode requires process.resourcesPath");
  }
  const appRoot = path.join(resources, "app-services");
  const dataRoot = userDataRoot;
  const quartzWorkspace = path.join(dataRoot, "quartz");
  return {
    mode,
    qaMode: false,
    appRoot,
    runtimeRoot: resources,
    resourcesRoot: resources,
    dataRoot,
    databaseDir: path.join(dataRoot, "database"),
    quartzWorkspace,
    quartzContent: path.join(quartzWorkspace, "content"),
    hermesWorkspaceRoot: path.join(dataRoot, "runtime", "hermes-workspaces"),
    hermesHome: path.join(dataRoot, "runtime", "hermes"),
    codexHome: path.join(dataRoot, "runtime", "codex"),
    skillsQuarantine: path.join(dataRoot, "skills", "quarantine"),
    skillsApproved: path.join(dataRoot, "skills", "approved"),
    skillsConditional: path.join(dataRoot, "skills", "conditional"),
    logsDir: path.join(dataRoot, "logs"),
    runtimeDir: path.join(dataRoot, "runtime"),
    configDir: path.join(dataRoot, "config"),
    backupsDir: path.join(dataRoot, "backups"),
    tempDir: path.join(dataRoot, "temp"),
    dashboardServerDir: path.join(appRoot, "dashboard-standalone", "dashboard"),
    hermesAppDir: path.join(appRoot, "hermes-agent"),
    runtimesDir: path.join(resources, "runtimes"),
    binDir: path.join(resources, "bin"),
  };
}

/** Directories that must exist before services start (mutable side only). */
export function mutableDirectories(paths: ResolvedPaths): string[] {
  return [
    paths.databaseDir,
    paths.quartzContent,
    paths.hermesWorkspaceRoot,
    paths.hermesHome,
    paths.codexHome,
    paths.skillsQuarantine,
    paths.skillsApproved,
    paths.skillsConditional,
    paths.logsDir,
    paths.runtimeDir,
    paths.configDir,
    paths.backupsDir,
    paths.tempDir,
  ];
}

export function ensureMutableDirectories(paths: ResolvedPaths): void {
  for (const dir of mutableDirectories(paths)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function assertDir(dir: string, label: string): void {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`Expected ${label} at ${dir}`);
  }
}

/** Normalize + validate that `child` stays inside `parent` (path traversal guard). */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
