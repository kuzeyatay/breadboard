import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  availableDashboardBuild,
  beginDashboardBuild,
  completeDashboardBuild,
  recoverInterruptedDashboardBuild,
  refreshStandaloneDashboardAssets,
  reusableDashboardBuild,
  writeDashboardBuildManifest,
} from "../scripts/dashboard-build-cache.mjs";

test("an unchanged standalone build is reusable and source edits invalidate it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-dashboard-cache-"));
  const dashboard = path.join(root, "dashboard");
  const source = path.join(dashboard, "src", "app.ts");
  const server = path.join(dashboard, ".next-desktop", "standalone", "dashboard", "server.js");
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.mkdirSync(path.dirname(server), { recursive: true });
  fs.writeFileSync(source, "export const value = 1;\n");
  fs.writeFileSync(path.join(dashboard, "package.json"), "{}\n");
  fs.writeFileSync(server, "// built\n");

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
        path.join(dashboard, ".next-desktop", "standalone", "dashboard", "public", "asset.txt"),
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

test("an interrupted rebuild restores the last complete standalone artifact", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-dashboard-rollback-"));
  const dashboard = path.join(root, "dashboard");
  const source = path.join(dashboard, "src", "app.ts");
  const server = path.join(dashboard, ".next-desktop", "standalone", "dashboard", "server.js");
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

function assertBuildTimestamp(value) {
  assert.equal(typeof value, "string");
  assert.ok(!Number.isNaN(Date.parse(value)));
  return value;
}
