import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { moveGroupedTab, moveTabGroup, normalizeTabGroups } from "../src/main/tab-groups";
import { isInTabGroup, tabGroupPath, type TabGroup } from "../src/shared/tab-groups";
import { isTabsCommand } from "../src/shared/ipc-contract";
import { readTabSession, writeTabSession } from "../src/main/tab-session";

const group = (id: string, parentId?: string): TabGroup => ({ id, name: id, color: "blue", collapsed: false, ...(parentId ? { parentId } : {}) });
const state = () => ({ groups: [group("root"), group("child", "root"), group("leaf", "child"), group("other")],
  tabs: [{ id: 1, groupId: "root" }, { id: 2, groupId: "leaf" }, { id: 3, groupId: "leaf" }, { id: 4, groupId: "child" }, { id: 5, groupId: "other" }, { id: 6, groupId: undefined as string | undefined }] });

test("normalization retains ancestors and orders complete subtrees without losing tabs", () => {
  const host = state();
  host.tabs = [host.tabs[2]!, host.tabs[5]!, host.tabs[4]!, host.tabs[0]!, host.tabs[1]!, host.tabs[3]!];
  normalizeTabGroups(host);
  assert.deepEqual(host.tabs.map(tab => tab.id), [3, 2, 4, 1, 6, 5]);
  assert.deepEqual(tabGroupPath(host.groups, "leaf").map(group => group.id), ["root", "child", "leaf"]);
  host.tabs = host.tabs.filter(tab => tab.groupId === "leaf");
  normalizeTabGroups(host);
  assert.deepEqual(host.groups.map(group => group.id), ["root", "child", "leaf"]);
  host.tabs = [];
  normalizeTabGroups(host);
  assert.deepEqual(host.groups, []);
});

test("moving, nesting and detaching a group carries every descendant and rejects cycles atomically", () => {
  const host = state();
  assert.equal(moveTabGroup(host, "child", 2, "other"), true);
  assert.deepEqual(host.tabs.map(tab => tab.id), [1, 5, 2, 3, 4, 6]);
  assert.equal(isInTabGroup(host.groups, "leaf", "other"), true);
  const before = structuredClone(host);
  for (const parent of ["child", "leaf", "missing"]) {
    assert.equal(moveTabGroup(host, "child", 0, parent), false);
    assert.deepEqual(host, before);
  }
  assert.equal(moveTabGroup(host, "child", 0, null), true);
  assert.deepEqual(host.tabs.map(tab => tab.id), [2, 3, 4, 1, 5, 6]);
  assert.equal(host.groups.find(group => group.id === "child")?.parentId, undefined);
  assert.equal(host.groups.find(group => group.id === "leaf")?.parentId, "child");
});

test("tab insertion cannot cut a child subtree or a root subtree in two", () => {
  const host = state();
  moveGroupedTab(host, 6, 2, "root");
  assert.deepEqual(host.tabs.map(tab => tab.id), [1, 2, 3, 4, 6, 5]);
  moveGroupedTab(host, 6, 2, null);
  assert.deepEqual(host.tabs.map(tab => tab.id), [1, 2, 3, 4, 6, 5]);
  assert.equal(host.tabs[4]?.groupId, undefined);
});

test("malformed cyclic and missing parents are repaired without discarding valid tabs", () => {
  const host = state();
  host.groups[0]!.parentId = "leaf";
  host.groups[3]!.parentId = "missing";
  normalizeTabGroups(host);
  for (const group of host.groups) assert.equal(isInTabGroup(host.groups, group.parentId, group.id), false);
  assert.equal(host.tabs.length, 6);
});

test("nested open and saved groups survive session round trips, including parents with no direct tabs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-nested-session-"));
  try {
    const groups = state().groups.slice(0, 3);
    const tabs = ["leaf", "child"].map((groupId, i) => ({ kind: "browser" as const, url: `https://example.com/${i}`, title: String(i), anchored: false, groupId }));
    writeTabSession(dir, { version: 1, windows: [{ tabs, groups, activeIndex: 1,
      savedGroups: [{ ...groups[0]!, groups: groups.slice(1), tabs }] }] });
    const restored = readTabSession(dir).windows[0]!;
    assert.deepEqual(restored.groups, groups);
    assert.deepEqual(restored.tabs, tabs);
    assert.equal(restored.activeIndex, 1);
    assert.deepEqual(restored.savedGroups?.[0]?.groups, groups.slice(1));
    assert.deepEqual(restored.savedGroups?.[0]?.tabs, tabs);
  } finally {
    assert.ok(path.resolve(dir).startsWith(path.join(path.resolve(os.tmpdir()), "bb-nested-session-")));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("nested group commands validate parent identifiers and subgroup creation", () => {
  assert.equal(isTabsCommand({ type: "group-action", groupId: "g", action: "new-subgroup" }), true);
  for (const parentId of ["parent", null, undefined]) assert.equal(isTabsCommand({ type: "group-move", groupId: "g", index: 0, parentId }), true);
  for (const parentId of ["../bad", "", 5, {}]) assert.equal(isTabsCommand({ type: "group-move", groupId: "g", index: 0, parentId }), false);
});
