import { spawnSync } from "node:child_process";
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

export function quartzTemplateDir(paths: ResolvedPaths): string {
  return path.join(paths.appRoot, "quartz-template");
}

export function currentWorkspaceVersion(appVersion: string): string {
  return `quartz-workspace/${appVersion}`;
}

export function needsQuartzProvisioning(paths: ResolvedPaths, appVersion: string): boolean {
  if (paths.mode === "dev") return false;
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
    fs.cpSync(source, destination, { recursive: true });
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

const OPENHARNESS_VERSION_FILE = ".breadboard-runtime-version";

export function needsOpenHarnessProvisioning(paths: ResolvedPaths, appVersion: string): boolean {
  if (paths.mode === "dev") return false;
  const versionFile = path.join(paths.openharnessAppDir, OPENHARNESS_VERSION_FILE);
  if (!fs.existsSync(versionFile)) return true;
  try {
    return fs.readFileSync(versionFile, "utf8").trim() !== `agent-runtime/${appVersion}`;
  } catch {
    return true;
  }
}

/**
 * Provision the OpenHarness runtime workspace under user data.
 *
 * Bun's isolated installer creates machine-absolute junctions, so
 * node_modules cannot ship as installer resources. Instead the sources +
 * lockfile ship read-only, and this step copies them into user data and runs
 * `bun install` there against the bundled package cache (offline-first; the
 * registry is only consulted for manifest revalidation on a cache miss).
 */
export function provisionOpenHarnessRuntime(
  paths: ResolvedPaths,
  appVersion: string,
  bunBinary: string,
  onProgress?: (message: string) => void,
): void {
  const template = path.join(paths.appRoot, "openharness");
  if (!fs.existsSync(template)) {
    throw new Error(
      `Agent runtime sources missing at ${template}. The installation is incomplete; reinstall Breadboard.`,
    );
  }
  const target = paths.openharnessAppDir;
  onProgress?.("Copying agent runtime sources");
  // Refresh program files; node_modules is preserved across same-version
  // repairs but rebuilt on version change (install below is idempotent).
  for (const entry of fs.readdirSync(template)) {
    const destination = path.join(target, entry);
    fs.rmSync(destination, { recursive: true, force: true });
    fs.cpSync(path.join(template, entry), destination, { recursive: true });
  }

  const cacheDir = path.join(paths.resourcesRoot, "bun-cache");
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    BUN_INSTALL_CACHE_DIR: cacheDir,
  };
  onProgress?.("Installing agent runtime dependencies");
  const install = spawnSync(bunBinary, ["install", "--ignore-scripts"], {
    cwd: target,
    env,
    windowsHide: true,
    shell: false,
    stdio: "pipe",
    encoding: "utf8",
    timeout: 15 * 60 * 1000,
  });
  if (install.status !== 0) {
    throw new Error(
      `Agent runtime dependency installation failed (bun install exited ${install.status}). ` +
        `A network connection may be required on first launch. Details: ${truncate(install.stderr)}`,
    );
  }
  // Isolated layout: real files live in node_modules/.bun/<pkg>@<ver>/...
  const store = path.join(target, "node_modules", ".bun");
  const storeOk =
    fs.existsSync(store) &&
    fs
      .readdirSync(store)
      .some(
        (name) =>
          name.startsWith("hono@") &&
          fs.existsSync(path.join(store, name, "node_modules", "hono", "package.json")),
      );
  if (!storeOk) {
    throw new Error("Agent runtime installation produced an incomplete node_modules tree.");
  }
  onProgress?.("Finalizing agent runtime");
  const fixup = spawnSync(bunBinary, ["run", "--cwd", "packages/core", "fix-node-pty"], {
    cwd: target,
    env,
    windowsHide: true,
    shell: false,
    stdio: "pipe",
    encoding: "utf8",
    timeout: 5 * 60 * 1000,
  });
  if (fixup.status !== 0) {
    // Non-fatal: PTY features degrade but the server still runs.
    onProgress?.("Warning: node-pty fixup failed; terminal PTY features may be limited");
  }
  fs.writeFileSync(path.join(target, OPENHARNESS_VERSION_FILE), `agent-runtime/${appVersion}`, "utf8");
}

function truncate(text: string | null | undefined, max = 600): string {
  const value = (text ?? "").trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
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
