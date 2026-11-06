import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import * as dashboard from "../src/lib/desktop-tab-groups.ts";
import * as desktop from "../../desktop/src/shared/tab-groups.ts";

const group = (id, parentId, collapsed = false) => ({
  id, parentId, collapsed, name: id, color: "blue",
});

for (const [name, { tabGroupPath, isInTabGroup, isTabGroupHidden }] of [
  ["dashboard", dashboard],
  ["desktop", desktop],
]) {
  test(`${name} preserves nested ancestry and inherits collapsed visibility`, () => {
    const groups = [group("root"), group("child", "root", true), group("leaf", "child"), group("other")];
    assert.deepEqual(tabGroupPath(groups, "leaf"), [groups[0], groups[1], groups[2]]);
    assert.equal(isInTabGroup(groups, "leaf", "root"), true);
    assert.equal(isInTabGroup(groups, "leaf", "child"), true);
    assert.equal(isInTabGroup(groups, "leaf", "leaf"), true);
    assert.equal(isInTabGroup(groups, "root", "leaf"), false);
    assert.equal(isInTabGroup(groups, "leaf", "other"), false);
    assert.equal(isTabGroupHidden(groups, "leaf"), true);
    assert.equal(isTabGroupHidden(groups, "child"), true);
    assert.equal(isTabGroupHidden(groups, "root"), false);
    assert.equal(isTabGroupHidden(groups, "other"), false);
    groups[1].collapsed = false;
    assert.equal(isTabGroupHidden(groups, "leaf"), false);
    groups[0].collapsed = true;
    assert.equal(isTabGroupHidden(groups, "leaf"), true);
  });

  test(`${name} handles absent groups, stale parents, and cycles`, () => {
    const groups = [group("orphan", "missing"), group("self", "self"), group("a", "b"), group("b", "a", true)];
    for (const id of [undefined, "missing"]) {
      assert.deepEqual(tabGroupPath(groups, id), []);
      assert.equal(isInTabGroup(groups, id, "missing"), false);
      assert.equal(isTabGroupHidden(groups, id), false);
    }
    assert.deepEqual(tabGroupPath([], "a"), []);
    assert.deepEqual(tabGroupPath(groups, "orphan"), [groups[0]]);
    assert.equal(isInTabGroup(groups, "orphan", "missing"), false);
    assert.deepEqual(tabGroupPath(groups, "self"), [groups[1]]);
    assert.deepEqual(tabGroupPath(groups, "a"), [groups[3], groups[2]]);
    assert.equal(isInTabGroup(groups, "a", "b"), true);
    assert.equal(isTabGroupHidden(groups, "a"), true);
  });
}

test("the dashboard tab-group runtime stays inside the Turbopack project root", async () => {
  const dashboardRoot = fileURLToPath(new URL("../", import.meta.url));
  const result = await build({
    absWorkingDir: dashboardRoot,
    entryPoints: ["src/lib/desktop-tab-groups.ts"],
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    metafile: true,
  });
  for (const input of Object.keys(result.metafile.inputs)) {
    const relative = path.relative(dashboardRoot, path.resolve(dashboardRoot, input));
    assert.ok(relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
      `Runtime dependency escaped the dashboard root: ${input}`);
  }
});
