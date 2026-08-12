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
