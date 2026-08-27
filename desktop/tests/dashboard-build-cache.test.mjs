import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertStandaloneDashboardRuntimeDependencies,
  availableDashboardBuild,
  beginDashboardBuild,
  completeDashboardBuild,
  recoverInterruptedDashboardBuild,
  recoverInterruptedDashboardRuntimeDependencyStaging,
  refreshStandaloneDashboardAssets,
  resolveEsbuildRuntimeClosure,
  resolveThreeRuntimeClosure,
  resolveTypeScriptRuntimeClosure,
  reusableDashboardBuild,
  stageStandaloneDashboardRuntimeDependencies,
  writeDashboardBuildManifest,
} from "../scripts/dashboard-build-cache.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..", "..");

function seedCompilerRuntimeClosures(root) {
  const closures = {
    esbuild: resolveEsbuildRuntimeClosure(repositoryRoot),
    three: resolveThreeRuntimeClosure(repositoryRoot),
    typescript: resolveTypeScriptRuntimeClosure(repositoryRoot),
  };
  const sourceDashboard = path.join(repositoryRoot, "dashboard");
  const targetDashboard = path.join(root, "dashboard");
  fs.mkdirSync(targetDashboard, { recursive: true });
  fs.copyFileSync(
    path.join(sourceDashboard, "package-lock.json"),
    path.join(targetDashboard, "package-lock.json"),
  );
  for (const closure of Object.values(closures)) {
    for (const file of closure.files) {
      const target = path.join(targetDashboard, path.relative(sourceDashboard, file.source));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(file.source, target);
    }
  }
  return closures;
}

function collectRelativeFiles(root) {
  const files = [];
  function visit(candidate) {
    if (!fs.existsSync(candidate)) return;
    const metadata = fs.lstatSync(candidate);
    if (metadata.isDirectory()) {
      for (const name of fs.readdirSync(candidate)) visit(path.join(candidate, name));
    } else if (metadata.isFile()) {
      files.push(path.relative(root, candidate).replaceAll(path.sep, "/"));
    }
  }
  visit(root);
  return files.sort();
}

function createStandaloneStagingFixture(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const standalone = path.join(root, "dashboard", ".next-desktop", "standalone");
  fs.mkdirSync(standalone, { recursive: true });
  fs.writeFileSync(path.join(standalone, "server.js"), "// built\n");
  const closures = seedCompilerRuntimeClosures(root);
  return { root, standalone, closures };
}

function removeDirectoryLink(candidate) {
  const metadata = fs.lstatSync(candidate);
  assert.equal(metadata.isSymbolicLink(), true);
  fs.unlinkSync(candidate);
}

test("an unchanged standalone build is reusable and source edits invalidate it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-dashboard-cache-"));
  const dashboard = path.join(root, "dashboard");
  const source = path.join(dashboard, "src", "app.ts");
  const server = path.join(dashboard, ".next-desktop", "standalone", "server.js");
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.mkdirSync(path.dirname(server), { recursive: true });
  fs.writeFileSync(source, "export const value = 1;\n");
  fs.writeFileSync(path.join(dashboard, "package.json"), "{}\n");
  fs.writeFileSync(server, "// built\n");
  seedCompilerRuntimeClosures(root);

  try {
    writeDashboardBuildManifest(root);
    assert.deepEqual(reusableDashboardBuild(root), {
      reusable: true,
      reason: "dashboard inputs are unchanged",
    });

    // Public files are refreshed independently and do not force webpack.
    const publicAsset = path.join(dashboard, "public", "asset.txt");
    fs.mkdirSync(path.dirname(publicAsset), { recursive: true });
    fs.writeFileSync(publicAsset, "current public asset\n");
    assert.equal(reusableDashboardBuild(root).reusable, true);
    refreshStandaloneDashboardAssets(root);
    assert.equal(
      fs.readFileSync(
        path.join(dashboard, ".next-desktop", "standalone", "public", "asset.txt"),
        "utf8",
      ),
      "current public asset\n",
    );

    fs.writeFileSync(source, "export const value = 2;\n");
    assert.deepEqual(availableDashboardBuild(root), {
      available: true,
      current: false,
      reason: "dashboard inputs changed",
      builtAt: assertBuildTimestamp(availableDashboardBuild(root).builtAt),
    });
    assert.deepEqual(reusableDashboardBuild(root), {
      reusable: false,
      reason: "dashboard inputs changed",
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("standalone refresh stages an exact runnable esbuild closure", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-dashboard-esbuild-"));
  const dashboard = path.join(root, "dashboard");
  const standalone = path.join(dashboard, ".next-desktop", "standalone");
  const server = path.join(standalone, "server.js");
  fs.mkdirSync(path.dirname(server), { recursive: true });
  fs.writeFileSync(server, "// built\n");
  const closures = seedCompilerRuntimeClosures(root);

  try {
    refreshStandaloneDashboardAssets(root);
    const stagedFiles = collectRelativeFiles(path.join(standalone, "node_modules"))
      .filter((relative) =>
        relative.startsWith("esbuild/") ||
        relative.startsWith("@esbuild/") ||
        relative.startsWith("three/") ||
        relative.startsWith("typescript/"));
    assert.deepEqual(
      stagedFiles,
      Object.values(closures).flatMap((closure) => closure.files).map((file) => file.relative
        .replaceAll(path.sep, "/")
        .replace(/^node_modules\//u, "")).sort(),
    );
    assert.equal(stagedFiles.includes("esbuild/bin/esbuild"), false);

    const receipt = JSON.parse(fs.readFileSync(
      path.join(standalone, "breadboard-runtime-dependencies.json"),
      "utf8",
    ));
    assert.equal(receipt.version, 1);
    assert.equal(receipt.dependencies.esbuild.version, closures.esbuild.version);
    assert.equal(receipt.dependencies.esbuild.platform, process.platform);
    assert.equal(receipt.dependencies.esbuild.arch, process.arch);
    assert.equal(receipt.dependencies.esbuild.files.length, 5);
    assert.equal(stagedFiles.includes("esbuild/LICENSE.md"), true);
    const binaryReceipt = receipt.dependencies.esbuild.files.find((file) =>
      file.path === `node_modules/${closures.esbuild.platformPackage}/${
        process.platform === "win32" ? "esbuild.exe" : "bin/esbuild"
      }`);
    assert.ok(binaryReceipt);
    assert.equal(binaryReceipt.sha256, closures.esbuild.binarySha256);
    assert.equal(receipt.dependencies.typescript.version, closures.typescript.version);
    assert.equal(receipt.dependencies.typescript.files.length, 4);
    assert.equal(receipt.dependencies.three.version, closures.three.version);
    assert.equal(receipt.dependencies.three.files.length, 4);
    assert.equal(
      [
        ...receipt.dependencies.esbuild.files,
        ...receipt.dependencies.typescript.files,
        ...receipt.dependencies.three.files,
      ].every((file) =>
        Number.isSafeInteger(file.bytes) && file.bytes > 0 && /^[a-f0-9]{64}$/u.test(file.sha256)),
      true,
    );
    const validated = assertStandaloneDashboardRuntimeDependencies(root);
    assert.equal(validated.esbuild.version, closures.esbuild.version);
    assert.equal(validated.receipt.dependencies.esbuild.files.length, 5);

    const stagedHermesSource = path.join(standalone, "worker-src", "lib", "hermes");
    fs.mkdirSync(stagedHermesSource, { recursive: true });
    for (const name of [
      "interactive-visualizer-custom.ts",
      "interactive-visualizer-config.ts",
      "interactive-visualizer-types.ts",
    ]) {
      fs.copyFileSync(
        path.join(repositoryRoot, "dashboard", "src", "lib", "hermes", name),
        path.join(stagedHermesSource, name),
      );
    }
    const probeSource = path.join(standalone, "worker-src", "compiler-probe.ts");
    fs.mkdirSync(path.dirname(probeSource), { recursive: true });
    fs.writeFileSync(
      probeSource,
      [
        'import { bundleCustomInteractiveVisualizer } from "./lib/hermes/interactive-visualizer-custom.ts";',
        "const result = await bundleCustomInteractiveVisualizer({",
        '  manifest: { mode: "3d", title: "Staged compiler probe" },',
        "  files: {",
        '    "index.html": "<main id=\\"app\\"><canvas></canvas></main><script src=\\"main.js\\"></script>",',
        '    "styles.css": "canvas{display:block}",',
        '    "main.js": "const scene=new THREE.Scene();void scene;",',
        "  },",
        "});",
        'if (!result.html.includes("breadboard:interactive-visualizer:v1")) process.exit(2);',
        "",
      ].join("\n"),
      "utf8",
    );
    const attemptDirectory = path.join(root, "private-runtime-attempt");
    fs.mkdirSync(attemptDirectory, { recursive: true });
    const probe = spawnSync(
      process.execPath,
      [probeSource],
      { cwd: attemptDirectory, encoding: "utf8", windowsHide: true },
    );
    assert.equal(probe.status, 0, `${probe.stderr ?? ""}\n${probe.stdout ?? ""}`.trim());
    const unreviewed = path.join(standalone, "node_modules", "three", "unreviewed.js");
    fs.writeFileSync(unreviewed, "export {};\n");
    assert.throws(
      () => assertStandaloneDashboardRuntimeDependencies(root),
      /missing or unreviewed files/u,
    );
    fs.unlinkSync(unreviewed);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("esbuild staging fails closed on platform-version drift", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-dashboard-esbuild-drift-"));
  const standalone = path.join(root, "dashboard", ".next-desktop", "standalone");
  fs.mkdirSync(standalone, { recursive: true });
  const closures = seedCompilerRuntimeClosures(root);
  const platformMetadata = closures.esbuild.files.find((file) =>
    file.relative.replaceAll(path.sep, "/").endsWith(`${closures.esbuild.platformPackage}/package.json`));
  assert.ok(platformMetadata);
  const target = path.join(
    root,
    "dashboard",
    path.relative(path.join(repositoryRoot, "dashboard"), platformMetadata.source),
  );
  const metadata = JSON.parse(fs.readFileSync(target, "utf8"));
  fs.writeFileSync(target, `${JSON.stringify({ ...metadata, version: "0.0.0-drift" })}\n`, "utf8");

  try {
    assert.throws(
      () => refreshStandaloneDashboardAssets(root),
      /does not match esbuild/u,
    );
    assert.throws(
      () => resolveEsbuildRuntimeClosure(root, { platform: "plan9", arch: "x64" }),
      /No reviewed esbuild runtime closure/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("esbuild staging rejects a native binary that differs from package provenance", () => {
  const { root, closures } = createStandaloneStagingFixture("bb-dashboard-esbuild-digest-");
  const sourceDashboard = path.join(repositoryRoot, "dashboard");
  const binary = closures.esbuild.files.find((file) => file.relative
    .replaceAll(path.sep, "/")
    .endsWith(process.platform === "win32" ? "/esbuild.exe" : "/bin/esbuild"));
  assert.ok(binary);
  const target = path.join(root, "dashboard", path.relative(sourceDashboard, binary.source));
  const bytes = fs.readFileSync(target);
  bytes[0] ^= 0xff;
  fs.writeFileSync(target, bytes);

  try {
    assert.throws(
      () => stageStandaloneDashboardRuntimeDependencies(root),
      /does not match esbuild's trusted digest/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("compiler staging rejects a linked node_modules ancestor without touching its target", () => {
  const { root, standalone } = createStandaloneStagingFixture("bb-dashboard-linked-parent-");
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "bb-dashboard-outside-parent-"));
  const marker = path.join(outside, "outside-marker.txt");
  const linkedModules = path.join(standalone, "node_modules");
  fs.writeFileSync(marker, "outside parent marker\n");
  fs.symlinkSync(outside, linkedModules, process.platform === "win32" ? "junction" : "dir");

  try {
    assert.throws(
      () => stageStandaloneDashboardRuntimeDependencies(root),
      /symbolic link or junction/u,
    );
    assert.equal(fs.readFileSync(marker, "utf8"), "outside parent marker\n");
    assert.deepEqual(fs.readdirSync(outside), ["outside-marker.txt"]);
  } finally {
    if (fs.existsSync(linkedModules)) removeDirectoryLink(linkedModules);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("compiler staging rejects a linked managed target without touching its target", () => {
  const { root, standalone } = createStandaloneStagingFixture("bb-dashboard-linked-target-");
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "bb-dashboard-outside-target-"));
  const marker = path.join(outside, "outside-marker.txt");
  const nodeModules = path.join(standalone, "node_modules");
  const linkedEsbuild = path.join(nodeModules, "esbuild");
  fs.mkdirSync(nodeModules);
  fs.writeFileSync(marker, "outside target marker\n");
  fs.symlinkSync(outside, linkedEsbuild, process.platform === "win32" ? "junction" : "dir");

  try {
    assert.throws(
      () => stageStandaloneDashboardRuntimeDependencies(root),
      /symbolic link or junction/u,
    );
    assert.equal(fs.readFileSync(marker, "utf8"), "outside target marker\n");
    assert.deepEqual(fs.readdirSync(outside), ["outside-marker.txt"]);
  } finally {
    if (fs.existsSync(linkedEsbuild)) removeDirectoryLink(linkedEsbuild);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("compiler staging rejects a hard-linked receipt without changing the outside file", () => {
  const { root, standalone } = createStandaloneStagingFixture("bb-dashboard-hardlink-target-");
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "bb-dashboard-outside-hardlink-"));
  const marker = path.join(outside, "outside-marker.txt");
  const receipt = path.join(standalone, "breadboard-runtime-dependencies.json");
  fs.writeFileSync(marker, "outside hard-link marker\n");
  fs.linkSync(marker, receipt);

  try {
    assert.throws(
      () => stageStandaloneDashboardRuntimeDependencies(root),
      /hard-linked file/u,
    );
    assert.equal(fs.readFileSync(marker, "utf8"), "outside hard-link marker\n");
  } finally {
    if (fs.existsSync(receipt)) fs.unlinkSync(receipt);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("a process-killed compiler swap recovers the complete previous closure", () => {
  const { root, standalone } = createStandaloneStagingFixture("bb-dashboard-compiler-kill-");
  stageStandaloneDashboardRuntimeDependencies(root);
  const receipt = path.join(standalone, "breadboard-runtime-dependencies.json");
  const esbuildLibrary = path.join(standalone, "node_modules", "esbuild", "lib", "main.js");
  const previousReceipt = fs.readFileSync(receipt);
  const previousLibrary = fs.readFileSync(esbuildLibrary);
  const replacementSource = path.join(root, "dashboard", "node_modules", "esbuild", "lib", "main.js");
  fs.appendFileSync(replacementSource, "\n// interrupted replacement marker\n");

  const moduleUrl = pathToFileURL(path.join(
    repositoryRoot,
    "desktop",
    "scripts",
    "dashboard-build-cache.mjs",
  )).href;
  const childSource = [
    `import { stageStandaloneDashboardRuntimeDependencies } from ${JSON.stringify(moduleUrl)};`,
    `stageStandaloneDashboardRuntimeDependencies(${JSON.stringify(root)}, {`,
    "  onCommitStep(step) {",
    '    if (step === "dependency-installed:esbuild") process.exit(73);',
    "  },",
    "});",
  ].join("\n");

  try {
    const killed = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", childSource],
      { encoding: "utf8", windowsHide: true },
    );
    assert.equal(killed.status, 73, `${killed.stderr ?? ""}\n${killed.stdout ?? ""}`.trim());
    assert.equal(fs.existsSync(receipt), false, "receipt must remain withdrawn before commit");
    assert.equal(
      fs.existsSync(path.join(standalone, ".breadboard-runtime-dependencies-stage")),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(standalone, ".breadboard-runtime-dependencies-rollback")),
      true,
    );

    assert.equal(recoverInterruptedDashboardRuntimeDependencyStaging(root), true);
    assert.deepEqual(fs.readFileSync(receipt), previousReceipt);
    assert.deepEqual(fs.readFileSync(esbuildLibrary), previousLibrary);
    assert.equal(
      fs.existsSync(path.join(standalone, ".breadboard-runtime-dependencies-stage")),
      false,
    );
    assert.equal(
      fs.existsSync(path.join(standalone, ".breadboard-runtime-dependencies-rollback")),
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an interrupted rebuild restores the last complete standalone artifact", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-dashboard-rollback-"));
  const dashboard = path.join(root, "dashboard");
  const source = path.join(dashboard, "src", "app.ts");
  const server = path.join(dashboard, ".next-desktop", "standalone", "server.js");
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.mkdirSync(path.dirname(server), { recursive: true });
  fs.writeFileSync(source, "export const value = 1;\n");
  fs.writeFileSync(server, "// last complete\n");

  try {
    writeDashboardBuildManifest(root);
    assert.equal(beginDashboardBuild(root), true);
    fs.mkdirSync(path.dirname(server), { recursive: true });
    fs.writeFileSync(server, "// partial replacement\n");
    assert.equal(recoverInterruptedDashboardBuild(root), true);
    assert.equal(fs.readFileSync(server, "utf8"), "// last complete\n");

    assert.equal(beginDashboardBuild(root), true);
    fs.mkdirSync(path.dirname(server), { recursive: true });
    fs.writeFileSync(server, "// completed replacement\n");
    writeDashboardBuildManifest(root);
    completeDashboardBuild(root);
    assert.equal(recoverInterruptedDashboardBuild(root), false);
    assert.equal(fs.readFileSync(server, "utf8"), "// completed replacement\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an interrupted first build leaves no unvalidated standalone tree", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-dashboard-first-build-"));
  const output = path.join(root, "dashboard", ".next-desktop");
  const server = path.join(output, "standalone", "server.js");
  fs.mkdirSync(path.dirname(server), { recursive: true });
  fs.writeFileSync(server, "// unvalidated first build\n");

  try {
    assert.equal(recoverInterruptedDashboardBuild(root), true);
    assert.equal(fs.existsSync(output), false);
    assert.deepEqual(availableDashboardBuild(root), {
      available: false,
      current: false,
      reason: "standalone server is absent",
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function assertBuildTimestamp(value) {
  assert.equal(typeof value, "string");
  assert.ok(!Number.isNaN(Date.parse(value)));
  return value;
}
