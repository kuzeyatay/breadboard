import { test } from "node:test";
import assert from "node:assert/strict";
import { splitTabs, splitMembers, splitPaneBounds } from "../src/main/tab-split";
import { moveGroupedTab, normalizeTabGroups } from "../src/main/tab-groups";
import { ensureAiTabGroup, readTabGroups, type TabGroup } from "../src/shared/tab-groups";
import { isTabsCommand } from "../src/shared/ipc-contract";

const fresh = (id = "pair"): TabGroup => ({ id, name: "", color: "green", collapsed: false });
const host = () => ({ tabs: [1, 2, 3, 4].map(id => ({ id, groupId: undefined as string | undefined })), groups: [] as TabGroup[], activeId: 2 });

test("splitting AI tabs makes a subgroup so later AI pages can still join the default group", () => {
  const state = host();
  const ai = ensureAiTabGroup(state);
  state.tabs[1]!.groupId = state.tabs[3]!.groupId = ai.id;
  assert.equal(splitTabs(state, 4, 2, "left", fresh()), true);
  assert.equal(ai.split, undefined);
  assert.equal(state.groups.find(group => group.split)?.parentId, ai.id);
  ensureAiTabGroup(state);
  assert.deepEqual(splitMembers(state).map(tab => tab.id), [4, 2]);
});

test("split creates an ordered pair and preserves the actual tabs", () => {
  const state = host(), source = state.tabs[3], target = state.tabs[1];
  assert.equal(splitTabs(state, 4, 2, "left", fresh()), true);
  assert.deepEqual(splitMembers(state), [source, target]);
  assert.deepEqual(state.tabs.map(tab => tab.id), [1, 4, 2, 3]);
  assert.equal(state.groups[0]?.split, true);
  state.activeId = 4;
  assert.deepEqual(splitMembers(state).map(tab => tab.id), [4, 2]);
  state.activeId = 1;
  assert.deepEqual(splitMembers(state), []);
});

test("splitting members of larger groups creates a pair without taking unrelated tabs", () => {
  const state = host();
  state.groups = [fresh("old")];
  for (const tab of state.tabs) tab.groupId = "old";
  splitTabs(state, 4, 2, "right", fresh());
  assert.deepEqual(splitMembers(state).map(tab => tab.id), [2, 4]);
  assert.deepEqual(state.tabs.filter(tab => tab.groupId === "old").map(tab => tab.id), [1, 3]);
  const pair = state.groups.find(group => group.split)!;
  pair.name = "Reading";
  splitTabs(state, 4, 2, "left", fresh("unused"));
  assert.equal(state.groups.length, 2);
  assert.equal(state.groups.find(group => group.split)?.name, "Reading");
});

test("closing, dragging out or adding a member ends the split; persisted pairs retain their layout", () => {
  for (const action of ["close", "move", "add"]) {
    const state = host();
    splitTabs(state, 4, 2, "right", fresh());
    assert.equal(readTabGroups(state.groups)[0]?.split, true);
    if (action === "close") state.tabs = state.tabs.filter(tab => tab.id !== 4);
    if (action === "move") moveGroupedTab(state, 4, 0, null);
    if (action === "add") state.tabs[0]!.groupId = "pair";
    normalizeTabGroups(state);
    assert.deepEqual(splitMembers(state), []);
    assert.equal(state.groups[0]?.split, undefined);
  }
});

test("split command validation and pane geometry reject bad input and never overlap", () => {
  assert.equal(isTabsCommand({ type: "split-tabs", id: 1, targetId: 2, side: "left" }), true);
  for (const command of [
    { type: "split-tabs", id: 1, targetId: 1, side: "right" },
    { type: "split-tabs", id: 1, targetId: 2, side: "top" },
    { type: "split-tabs", id: 1, targetId: NaN, side: "left" },
    { type: "tab-drag", active: "yes" },
    { type: "group-update", groupId: "pair", split: "yes" },
  ]) assert.equal(isTabsCommand(command), false);
  for (const width of [640, 1001, 1600]) {
    const left = splitPaneBounds(width, 900, 136, 0), right = splitPaneBounds(width, 900, 136, 1);
    assert.equal(left.x + left.width + 8, right.x);
    assert.equal(right.x + right.width, width);
    assert.equal(left.height, 764);
  }
});
