import { test } from "node:test";
import assert from "node:assert/strict";
import { groupTabs, moveGroupedTab, moveTabGroup, normalizeTabGroups } from "../src/main/tab-groups";
import { isTabsCommand } from "../src/shared/ipc-contract";
import { type TabGroup, readTabGroups } from "../src/shared/tab-groups";

const fresh = (id = "g"): TabGroup => ({ id, name: "", color: "blue", collapsed: false });
const host = () => ({ tabs: [1, 2, 3, 4].map(id => ({ id, groupId: undefined as string | undefined })), groups: [] as TabGroup[] });

test("dropping onto a tab creates a contiguous group at the target and joining cleans up an empty source group", () => {
  const state = host();
  assert.equal(groupTabs(state, 4, 2, fresh()), true);
  assert.deepEqual(state.tabs.map(tab => tab.id), [1, 2, 4, 3]);
  assert.deepEqual(state.tabs.filter(tab => tab.groupId === "g").map(tab => tab.id), [2, 4]);
  assert.equal(groupTabs(state, 1, 3, fresh("h")), true);
  assert.equal(groupTabs(state, 2, 3, fresh("unused")), true);
  assert.equal(groupTabs(state, 4, 3, fresh("unused")), true);
  assert.deepEqual(state.groups.map(group => group.id), ["h"]);
  assert.deepEqual(state.tabs.map(tab => tab.id), [3, 1, 2, 4]);
});

test("reordering within a group, dragging out, and deleting its final member leave no ghost groups", () => {
  const state = host();
  groupTabs(state, 3, 2, fresh());
  moveGroupedTab(state, 3, 1, "g");
  assert.deepEqual(state.tabs.map(tab => tab.id), [1, 3, 2, 4]);
  moveGroupedTab(state, 3, 3, null);
  assert.equal(state.tabs[3]?.groupId, undefined);
  state.tabs = state.tabs.filter(tab => tab.id !== 2);
  normalizeTabGroups(state);
  assert.deepEqual(state.groups, []);
});

test("an insertion cannot split a group or reference a missing group", () => {
  const state = host();
  groupTabs(state, 3, 2, fresh());
  moveGroupedTab(state, 1, 1, null);
  assert.deepEqual(state.tabs.map(tab => tab.id), [2, 3, 1, 4]);
  assert.equal(moveGroupedTab(state, 1, 0, "missing"), false);
  assert.equal(groupTabs(state, 2, 3, fresh("unused")), false);
});

test("whole groups move in both directions without changing members or group settings", () => {
  const state = host();
  groupTabs(state, 3, 2, { ...fresh(), name: "Research", color: "purple", collapsed: true });
  const members = state.tabs.filter(tab => tab.groupId === "g");
  const groups = structuredClone(state.groups);
  assert.equal(moveTabGroup(state, "g", 0), true);
  assert.deepEqual(state.tabs.map(tab => tab.id), [2, 3, 1, 4]);
  assert.equal(moveTabGroup(state, "g", 2), true);
  assert.deepEqual(state.tabs.map(tab => tab.id), [1, 4, 2, 3]);
  assert.equal(state.tabs[2], members[0], "keeps the existing tab objects");
  assert.equal(state.tabs[3], members[1]);
  assert.deepEqual(state.groups, groups);
  assert.equal(moveTabGroup(state, "g", 2), true);
  assert.deepEqual(state.tabs.map(tab => tab.id), [1, 4, 2, 3]);
});

test("moving a group cannot split or merge another group, and invalid moves do nothing", () => {
  const state = host();
  groupTabs(state, 2, 1, fresh("g"));
  groupTabs(state, 4, 3, fresh("h"));
  assert.equal(moveTabGroup(state, "g", 1), true);
  assert.deepEqual(state.tabs.map(tab => tab.id), [3, 4, 1, 2]);
  assert.deepEqual(state.tabs.map(tab => tab.groupId), ["h", "h", "g", "g"]);
  const before = structuredClone(state);
  for (const [id, index] of [["missing", 0], ["g", NaN], ["g", Infinity], ["g", 0.5]] as const) {
    assert.equal(moveTabGroup(state, id, index), false);
    assert.deepEqual(state, before);
  }
});

test("group IPC rejects invalid names, colors, ids and coordinates", () => {
  assert.equal(isTabsCommand({ type: "group-tabs", id: 1, targetId: 2 }), true);
  assert.equal(isTabsCommand({ type: "move", id: 1, index: 0, groupId: null }), true);
  assert.equal(isTabsCommand({ type: "group-move", groupId: "g", index: 0 }), true);
  assert.equal(isTabsCommand({ type: "group-update", groupId: "g", color: "cyan", collapsed: true }), true);
  for (const command of [
    { type: "group-move", groupId: "../bad", index: 0 },
    { type: "group-move", groupId: "g", index: -1 },
    { type: "group-move", groupId: "g", index: 0.5 },
    { type: "group-move", groupId: "g", index: Infinity },
    { type: "group-move", groupId: "g" },
    { type: "group-tabs", id: 1, targetId: 1 }, { type: "group-tabs", id: 1, targetId: -1 },
    { type: "group-update", groupId: "g", color: "__proto__" },
    { type: "group-update", groupId: "g", name: "x".repeat(81) },
    { type: "group-update", groupId: "../bad", collapsed: true },
    { type: "group-menu", x: NaN, y: 20 }, { type: "group-menu-resize", height: Infinity },
    { type: "group-action", groupId: "g", action: "unknown" },
  ]) assert.equal(isTabsCommand(command), false, JSON.stringify(command));
  assert.deepEqual(readTabGroups([fresh(), fresh(), { ...fresh("bad"), color: "__proto__" }]), [fresh()]);
});
