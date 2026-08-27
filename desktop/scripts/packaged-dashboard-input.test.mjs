import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { dashboardBuildFingerprint, dashboardBuildPaths } from "./dashboard-build-cache.mjs";
import {
  assertCurrentStandaloneBuildManifest,
  findNestedDashboardRuntimeDuplicates,
  packagedDashboardCopyPlan,
  shouldExcludePackagedDashboardPath,
} from "./packaged-dashboard-input.mjs";

function temporaryRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-packaged-dashboard-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dashboard = path.join(root, "dashboard");
  fs.mkdirSync(path.join(dashboard, "src"), { recursive: true });
  fs.writeFileSync(path.join(dashboard, "src", "input.ts"), "export const input = 1;\n", "utf8");
  fs.writeFileSync(path.join(dashboard, "package.json"), "{}\n", "utf8");
  fs.writeFileSync(path.join(dashboard, "package-lock.json"), "{\"lockfileVersion\":3}\n", "utf8");
  const paths = dashboardBuildPaths(root);
  fs.mkdirSync(path.dirname(paths.server), { recursive: true });
  fs.writeFileSync(paths.server, "export {};\n", "utf8");
  fs.writeFileSync(
    paths.manifest,
    `${JSON.stringify({
      version: 2,
      fingerprint: dashboardBuildFingerprint(root),
      builtAt: "2026-08-26T00:00:00.000Z",
    })}\n`,
    "utf8",
  );
  return { root, dashboard, paths };
}

test("only one current exact v2 standalone manifest is accepted for packaging", (t) => {
  const fixture = temporaryRepo(t);
  assert.deepEqual(assertCurrentStandaloneBuildManifest(fixture.root), fixture.paths);

  fs.writeFileSync(path.join(fixture.dashboard, "src", "input.ts"), "export const input = 2;\n", "utf8");
  assert.throws(
    () => assertCurrentStandaloneBuildManifest(fixture.root),
    /stale or unavailable: dashboard inputs changed/u,
  );
});

test("legacy or decorated standalone manifests fail closed", (t) => {
  const fixture = temporaryRepo(t);
  const manifest = JSON.parse(fs.readFileSync(fixture.paths.manifest, "utf8"));
  manifest.version = 1;
  fs.writeFileSync(fixture.paths.manifest, `${JSON.stringify(manifest)}\n`, "utf8");
  assert.throws(() => assertCurrentStandaloneBuildManifest(fixture.root), /valid v2 receipt/u);

  manifest.version = 2;
  manifest.unreviewed = true;
  fs.writeFileSync(fixture.paths.manifest, `${JSON.stringify(manifest)}\n`, "utf8");
  assert.throws(() => assertCurrentStandaloneBuildManifest(fixture.root), /valid v2 receipt/u);
});

test("dashboard-root standalone output is wrapped exactly once for the installed contract", (t) => {
  const fixture = temporaryRepo(t);
  const stagingRoot = path.join(fixture.root, "desktop", "build-resources", "app-services");
  const plan = packagedDashboardCopyPlan(fixture.paths, stagingRoot);
  assert.equal(plan.standaloneSource, fixture.paths.standaloneDashboard);
  assert.equal(plan.dashboardTarget, path.join(stagingRoot, "dashboard-standalone"));
  assert.equal(
    path.join(plan.packagedDashboardTarget, "server.js"),
    path.join(stagingRoot, "dashboard-standalone", "dashboard", "server.js"),
  );
  assert.notEqual(path.basename(plan.standaloneSource), "dashboard");
});

test("the root-relative packaging filter excludes mutable data but retains active build assets", () => {
  for (const candidate of [
    "db/brain.db",
    "database/profile.sqlite",
    "artifacts/output.bin",
    ".env.local",
    ".next/cache/webpack.bin",
    ".next-dev/server.js",
    ".next-production/cache.bin",
    ".vercel/project.json",
    "tmp-secret",
  ]) {
    assert.equal(shouldExcludePackagedDashboardPath(candidate), true, candidate);
  }
  for (const candidate of [
    "server.js",
    ".next-desktop/static/chunk.js",
    "public/logo.svg",
    "node_modules/next/package.json",
  ]) {
    assert.equal(shouldExcludePackagedDashboardPath(candidate), false, candidate);
  }
});

test("the duplicate scan allows only the reviewed dashboard-root package locations", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-dashboard-duplicates-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ["@esbuild", "esbuild", "typescript", "three"]) {
    fs.mkdirSync(path.join(root, "node_modules", name), { recursive: true });
  }
  assert.deepEqual(findNestedDashboardRuntimeDuplicates(root), []);

  for (const name of ["@esbuild", "esbuild", "typescript", "three"]) {
    fs.mkdirSync(path.join(root, "server", "node_modules", name), { recursive: true });
  }
  assert.deepEqual(findNestedDashboardRuntimeDuplicates(root), [
    "server/node_modules/@esbuild",
    "server/node_modules/esbuild",
    "server/node_modules/three",
    "server/node_modules/typescript",
  ]);
});

test("the duplicate scan fails closed at a link that could hide another dependency graph", (t) => {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-dashboard-link-test-"));
  t.after(() => fs.rmSync(container, { recursive: true, force: true }));
  const root = path.join(container, "dashboard");
  const hidden = path.join(container, "hidden-dependency-graph");
  fs.mkdirSync(path.join(root, "server", "node_modules"), { recursive: true });
  fs.mkdirSync(path.join(hidden, "node_modules", "esbuild"), { recursive: true });
  const linked = path.join(root, "server", "node_modules", "unrelated-package");
  fs.symlinkSync(hidden, linked, process.platform === "win32" ? "junction" : "dir");

  assert.deepEqual(findNestedDashboardRuntimeDuplicates(root), [
    "server/node_modules/unrelated-package (unscannable link or junction)",
  ]);
});

test("resource preparation validates the current manifest and compiler receipt before copying", () => {
  const source = fs.readFileSync(
    path.join(import.meta.dirname, "prepare-app-resources.mjs"),
    "utf8",
  );
  const manifestGate = source.indexOf(
    "currentDashboardBuild = assertCurrentStandaloneBuildManifest(repoRoot);",
  );
  const compilerGate = source.indexOf(
    "assertStandaloneDashboardRuntimeDependencies(repoRoot);",
  );
  const firstDashboardMutation = source.indexOf("freshDir(dashboardTarget);");
  assert.ok(manifestGate >= 0, "the current build-manifest gate must remain present");
  assert.ok(compilerGate > manifestGate, "the exact compiler receipt must be checked after the manifest");
  assert.ok(
    firstDashboardMutation > compilerGate,
    "both immutable input gates must complete before the staging destination is mutated",
  );
  assert.match(source, /packagedDashboardCopyPlan\(currentDashboardBuild, stagingRoot\)/u);
  assert.match(
    source,
    /copyTree\(standaloneSource, packagedDashboardTarget,[\s\S]*shouldExcludePackagedDashboardPath\(rel\)/u,
  );
});

test("the package verifier enforces the licensed esbuild binary provenance and full-tree scan", () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, "verify-package.mjs"), "utf8");
  assert.match(source, /"node_modules\/esbuild\/LICENSE\.md"/u);
  assert.match(
    source,
    /esbuildPackage\["esbuild\.binaryHashes"\]\?\.\[binaryHashKey\] !== nativeBinaryReceipt\?\.sha256/u,
  );
  assert.match(source, /findNestedDashboardRuntimeDuplicates\(dashboard\)/u);
});

test("packaging carries and verifies the generated-visual compiler support closure", () => {
  const prepare = fs.readFileSync(
    path.join(import.meta.dirname, "prepare-app-resources.mjs"),
    "utf8",
  );
  const verify = fs.readFileSync(path.join(import.meta.dirname, "verify-package.mjs"), "utf8");
  for (const script of [
    "runtime-v2-generated-visual-compiler-worker.mjs",
    "runtime-v2-generated-visual-compiler-executor.mjs",
  ]) {
    assert.ok(prepare.includes(`"${script}"`), `${script} must be staged`);
    assert.ok(verify.includes(`"${script}"`), `${script} must be verified`);
  }
  assert.match(verify, /\["lib", "generated-visual-compiler\.ts"\]/u);
  assert.match(verify, /\["lib", "generated-visual-browser-tests\.ts"\]/u);
  assert.match(verify, /\["lib", "generated-visuals\.ts"\]/u);
  assert.match(
    prepare,
    /\["lib", "generated-visual-browser-tests\.ts"\]/u,
  );
  assert.match(
    verify,
    /\["lib", "hermes", "interactive-visualizer-plan\.ts"\]/u,
  );
});
