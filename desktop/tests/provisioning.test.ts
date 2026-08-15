import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolvePaths, type ResolvedPaths } from "../src/main/path-resolver";
import {
  currentWorkspaceVersion,
  needsQuartzProvisioning,
  provisionQuartzWorkspace,
  provisionQaDashboardWorkspace,
  writeScriberrComposeOverride,
} from "../src/main/provisioning";

/** Build a packaged-mode paths object over throwaway directories, with a
 * minimal Quartz template + shared/ tree staged in "resources". */
function packagedFixture(): { paths: ResolvedPaths; userData: string; resources: string } {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "bb-prov-ud-"));
  const resources = fs.mkdtempSync(path.join(os.tmpdir(), "bb-prov-res-"));
  const paths = resolvePaths({
    isPackaged: true,
    forceDev: false,
    userDataDir: userData,
    electronResourcesPath: resources,
    moduleDir: path.join(os.tmpdir(), "bb-repo", "desktop", "dist", "main"),
  });
  const template = path.join(paths.appRoot, "quartz-template");
  fs.mkdirSync(path.join(template, "quartz"), { recursive: true });
  fs.writeFileSync(path.join(template, "quartz", "bootstrap-cli.mjs"), "// cli");
  fs.writeFileSync(path.join(template, "package.json"), "{}");
  fs.mkdirSync(path.join(template, "node_modules", "preact"), { recursive: true });
  fs.writeFileSync(path.join(template, "node_modules", "preact", "package.json"), "{}");
  fs.mkdirSync(path.join(paths.appRoot, "shared"), { recursive: true });
  fs.writeFileSync(
    path.join(paths.appRoot, "shared", "visualization-renderers.json"),
    JSON.stringify({ renderers: [] }),
  );
  return { paths, userData, resources };
}

test("quartz provisioning is required on first run and satisfied afterwards", () => {
  const { paths } = packagedFixture();
  assert.equal(needsQuartzProvisioning(paths, "0.1.0"), true);
  provisionQuartzWorkspace(paths, "0.1.0");
  assert.equal(needsQuartzProvisioning(paths, "0.1.0"), false);
  // A new app version triggers a refresh of the program files.
  assert.equal(needsQuartzProvisioning(paths, "0.2.0"), true);
});

test("provisioning stages shared/ as a sibling of the quartz workspace", () => {
  const { paths } = packagedFixture();
  provisionQuartzWorkspace(paths, "0.1.0");
  // quartz/util/visualizationRegistry.ts imports "../../../shared/…", i.e.
  // <dataRoot>/shared relative to <dataRoot>/quartz/quartz/util.
  const shared = path.join(path.dirname(paths.quartzWorkspace), "shared", "visualization-renderers.json");
  assert.ok(fs.existsSync(shared), `expected shared asset at ${shared}`);
  const fromRegistry = path.resolve(
    paths.quartzWorkspace,
    "quartz",
    "util",
    "../../../shared/visualization-renderers.json",
  );
  assert.equal(fromRegistry, shared);
});

test("a fresh install gets a landing page so the garden is not a bare 404", () => {
  const { paths } = packagedFixture();
  provisionQuartzWorkspace(paths, "0.1.0");
  const landing = path.join(paths.quartzContent, "index.md");
  assert.ok(fs.existsSync(landing));
  assert.match(fs.readFileSync(landing, "utf8"), /title: Breadboard/);
});

test("the landing page is never re-seeded over an existing garden", () => {
  const { paths } = packagedFixture();
  provisionQuartzWorkspace(paths, "0.1.0");
  const landing = path.join(paths.quartzContent, "index.md");
  fs.writeFileSync(landing, "# my own index");
  provisionQuartzWorkspace(paths, "0.2.0");
  assert.equal(fs.readFileSync(landing, "utf8"), "# my own index");

  // And a garden that already has content but no index.md stays untouched.
  const other = packagedFixture().paths;
  fs.mkdirSync(path.join(other.quartzContent, "existing-garden"), { recursive: true });
  provisionQuartzWorkspace(other, "0.1.0");
  assert.ok(!fs.existsSync(path.join(other.quartzContent, "index.md")));
});

test("provisioning creates content/ but never overwrites existing user content", () => {
  const { paths } = packagedFixture();
  provisionQuartzWorkspace(paths, "0.1.0");
  const note = path.join(paths.quartzContent, "my-garden", "sources", "note.md");
  fs.mkdirSync(path.dirname(note), { recursive: true });
  fs.writeFileSync(note, "# keep me");
  // Simulate an app update re-provisioning the workspace.
  provisionQuartzWorkspace(paths, "0.2.0");
  assert.equal(fs.readFileSync(note, "utf8"), "# keep me");
  assert.ok(fs.existsSync(path.join(paths.quartzWorkspace, "quartz", "bootstrap-cli.mjs")));
});

test("missing template fails loudly instead of producing a broken workspace", () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "bb-prov-ud-"));
  const resources = fs.mkdtempSync(path.join(os.tmpdir(), "bb-prov-res-"));
  const paths = resolvePaths({
    isPackaged: true,
    forceDev: false,
    userDataDir: userData,
    electronResourcesPath: resources,
    moduleDir: path.join(os.tmpdir(), "bb-repo", "desktop", "dist", "main"),
  });
  assert.throws(() => provisionQuartzWorkspace(paths, "0.1.0"), /template missing/i);
});

test("dev mode never provisions (services run from the repo)", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "bb-repo-"));
  fs.mkdirSync(path.join(repo, "desktop", "dist", "main"), { recursive: true });
  const paths = resolvePaths({
    isPackaged: false,
    forceDev: false,
    userDataDir: path.join(os.tmpdir(), "bb-ud"),
    electronResourcesPath: undefined,
    moduleDir: path.join(repo, "desktop", "dist", "main"),
  });
  assert.equal(needsQuartzProvisioning(paths, "0.1.0"), false);
});

test("QA dev provisions an isolated workspace while linking only dependencies", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "bb-qa-repo-"));
  const moduleDir = path.join(repo, "desktop", "dist", "main");
  const sourceQuartz = path.join(repo, "quartz");
  fs.mkdirSync(path.join(sourceQuartz, "quartz"), { recursive: true });
  fs.mkdirSync(path.join(sourceQuartz, "node_modules", "preact"), { recursive: true });
  fs.mkdirSync(path.join(repo, "shared"), { recursive: true });
  fs.writeFileSync(path.join(sourceQuartz, "quartz", "bootstrap-cli.mjs"), "// qa");
  fs.writeFileSync(path.join(sourceQuartz, "package.json"), "{}");
  fs.writeFileSync(path.join(repo, "shared", "visualization-renderers.json"), "{}");

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "bb-qa-ud-"));
  const paths = resolvePaths({
    isPackaged: false,
    forceDev: true,
    qaMode: true,
    userDataDir: userData,
    electronResourcesPath: undefined,
    moduleDir,
  });
  assert.equal(needsQuartzProvisioning(paths, "0.1.0"), true);
  provisionQuartzWorkspace(paths, "0.1.0");
  const isolatedQuartz = path.join(paths.quartzWorkspace, "quartz");
  assert.notEqual(fs.realpathSync(isolatedQuartz), fs.realpathSync(path.join(sourceQuartz, "quartz")));
  assert.equal(
    fs.readFileSync(path.join(isolatedQuartz, "bootstrap-cli.mjs"), "utf8"),
    "// qa",
  );
  assert.equal(
    fs.realpathSync(path.join(paths.quartzWorkspace, "node_modules")),
    fs.realpathSync(path.join(sourceQuartz, "node_modules")),
  );
  assert.ok(paths.quartzContent.startsWith(path.join(userData, "Data")));
  const note = path.join(paths.quartzContent, "qa-note.md");
  fs.writeFileSync(note, "# isolated");
  provisionQuartzWorkspace(paths, "0.2.0");
  assert.equal(fs.readFileSync(note, "utf8"), "# isolated");
});

test("QA dev gives Next an isolated workspace with copied source", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "bb-qa-dashboard-repo-"));
  const moduleDir = path.join(repo, "desktop", "dist", "main");
  const dashboard = path.join(repo, "dashboard");
  fs.mkdirSync(moduleDir, { recursive: true });
  fs.mkdirSync(path.join(dashboard, "src"), { recursive: true });
  const installedNodeModules = path.resolve(__dirname, "../../../dashboard/node_modules");
  assert.ok(fs.existsSync(installedNodeModules), "dashboard dependencies must be installed");
  fs.symlinkSync(
    installedNodeModules,
    path.join(dashboard, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  fs.mkdirSync(path.join(dashboard, "public"), { recursive: true });
  fs.writeFileSync(path.join(dashboard, "src", "page.tsx"), "export default 1");
  fs.writeFileSync(path.join(dashboard, "package.json"), "{}");
  fs.writeFileSync(path.join(dashboard, "tsconfig.json"), "{\"include\":[]}");
  fs.writeFileSync(path.join(dashboard, ".env.local"), "REAL_SECRET=never-copy");
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "bb-qa-dashboard-ud-"));
  const paths = resolvePaths({
    isPackaged: false,
    forceDev: true,
    qaMode: true,
    userDataDir: userData,
    electronResourcesPath: undefined,
    moduleDir,
  });

  provisionQaDashboardWorkspace(paths);
  assert.notEqual(
    fs.realpathSync(path.join(paths.dashboardServerDir, "src")),
    fs.realpathSync(path.join(dashboard, "src")),
  );
  assert.equal(
    fs.readFileSync(path.join(paths.dashboardServerDir, "src", "page.tsx"), "utf8"),
    "export default 1",
  );
  assert.equal(
    fs.readFileSync(path.join(paths.dashboardServerDir, "tsconfig.json"), "utf8"),
    "{\"include\":[]}",
  );
  assert.ok(!fs.existsSync(path.join(paths.dashboardServerDir, ".env.local")));
  fs.writeFileSync(path.join(paths.dashboardServerDir, "tsconfig.json"), "qa-only");
  assert.equal(fs.readFileSync(path.join(dashboard, "tsconfig.json"), "utf8"), "{\"include\":[]}");
});

test("QA dashboard provisioning fails closed before linking dependencies when native SWC is missing", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "bb-qa-dashboard-no-swc-repo-"));
  const moduleDir = path.join(repo, "desktop", "dist", "main");
  const dashboard = path.join(repo, "dashboard");
  fs.mkdirSync(moduleDir, { recursive: true });
  fs.mkdirSync(path.join(dashboard, "src"), { recursive: true });
  fs.mkdirSync(path.join(dashboard, "node_modules"), { recursive: true });
  fs.writeFileSync(path.join(dashboard, "package.json"), "{}");
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "bb-qa-dashboard-no-swc-ud-"));
  const paths = resolvePaths({
    isPackaged: false,
    forceDev: true,
    qaMode: true,
    userDataDir: userData,
    electronResourcesPath: undefined,
    moduleDir,
  });

  assert.throws(
    () => provisionQaDashboardWorkspace(paths),
    /native Next\.js SWC dependency is unavailable/i,
  );
  assert.ok(
    !fs.existsSync(path.join(paths.dashboardServerDir, "node_modules")),
    "dependency link must not be created after a failed preflight",
  );
});

test("scriberr compose override remaps the container port and stays in runtime dir", () => {
  const { paths } = packagedFixture();
  fs.mkdirSync(paths.runtimeDir, { recursive: true });
  const overridePath = writeScriberrComposeOverride(paths, 8091);
  assert.ok(overridePath.startsWith(paths.runtimeDir));
  const contents = fs.readFileSync(overridePath, "utf8");
  assert.match(contents, /"8091:8080"/);
});

test("workspace version string is stable for a given app version", () => {
  assert.equal(currentWorkspaceVersion("1.2.3"), "quartz-workspace/1.2.3");
});
