import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import {
  resolvePaths,
  mutableDirectories,
  ensureMutableDirectories,
  isInside,
  repoRootFromModuleDir,
} from "../src/main/path-resolver";

const fakeRepo = fs.mkdtempSync(path.join(os.tmpdir(), "bb-repo-"));
fs.mkdirSync(path.join(fakeRepo, "desktop", "dist", "main"), { recursive: true });
const moduleDir = path.join(fakeRepo, "desktop", "dist", "main");

test("dev mode resolves everything inside the repository", () => {
  const paths = resolvePaths({
    isPackaged: false,
    forceDev: false,
    userDataDir: path.join(os.tmpdir(), "bb-userdata"),
    electronResourcesPath: undefined,
    moduleDir,
  });
  assert.equal(paths.mode, "dev");
  assert.equal(paths.appRoot, fakeRepo);
  assert.equal(paths.databaseDir, path.join(fakeRepo, "dashboard", "db"));
  assert.equal(paths.quartzContent, path.join(fakeRepo, "quartz", "content"));
  assert.equal(paths.dashboardServerDir, path.join(fakeRepo, "dashboard"));
  assert.equal(paths.runtimesDir, "");
});

test("packaged mode separates resources from user data", () => {
  const userData = path.join(os.tmpdir(), "bb-userdata-packaged");
  const resources = path.join(os.tmpdir(), "bb-resources");
  const paths = resolvePaths({
    isPackaged: true,
    forceDev: false,
    userDataDir: userData,
    electronResourcesPath: resources,
    moduleDir,
  });
  assert.equal(paths.mode, "packaged");
  assert.equal(paths.appRoot, path.join(resources, "app-services"));
  assert.ok(isInside(userData, paths.databaseDir));
  assert.ok(isInside(userData, paths.quartzContent));
  assert.ok(isInside(userData, paths.logsDir));
  assert.ok(isInside(userData, paths.openharnessRoot));
  // No mutable directory may live under the read-only resources.
  for (const dir of mutableDirectories(paths)) {
    assert.ok(!isInside(resources, dir), `${dir} must not be inside resources`);
  }
  assert.equal(
    paths.dashboardServerDir,
    path.join(resources, "app-services", "dashboard-standalone", "dashboard"),
  );
});

test("forceDev overrides isPackaged", () => {
  const paths = resolvePaths({
    isPackaged: true,
    forceDev: true,
    userDataDir: path.join(os.tmpdir(), "bb-userdata"),
    electronResourcesPath: path.join(os.tmpdir(), "bb-resources"),
    moduleDir,
  });
  assert.equal(paths.mode, "dev");
});

test("ensureMutableDirectories creates the full mutable tree", () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "bb-ud-"));
  const paths = resolvePaths({
    isPackaged: true,
    forceDev: false,
    userDataDir: userData,
    electronResourcesPath: path.join(os.tmpdir(), "bb-resources"),
    moduleDir,
  });
  ensureMutableDirectories(paths);
  for (const dir of mutableDirectories(paths)) {
    assert.ok(fs.existsSync(dir), `${dir} should exist`);
  }
});

test("isInside guards against traversal", () => {
  assert.ok(isInside("C:\\data", "C:\\data\\sub\\file.txt"));
  assert.ok(!isInside("C:\\data", "C:\\data\\..\\other"));
  assert.ok(!isInside("C:\\data", "D:\\data\\sub"));
});

test("repoRootFromModuleDir walks three levels up", () => {
  assert.equal(repoRootFromModuleDir(moduleDir), fakeRepo);
});
