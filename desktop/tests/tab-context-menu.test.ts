import { test } from "node:test";
import assert from "node:assert/strict";
import { tabContextMenuTemplate } from "../src/main/tab-context-menu";
import { isTabsCommand } from "../src/shared/ipc-contract";

test("tab menus protect anchors and disable unavailable actions", () => {
  const items = tabContextMenuTemplate({ anchored: true, private: false, hasLink: false,
    canCloseOthers: false, canCloseRight: false, canReopen: false }, () => {});
  assert.equal(items.find(item => item.id === "anchor")?.label, "Unanchor tab");
  for (const id of ["copy-link", "close", "close-others", "close-right", "reopen"]) {
    assert.equal(items.find(item => item.id === id)?.enabled, false, id);
  }
  assert.equal(items.find(item => item.id === "duplicate")?.enabled, true);
  const privateItems = tabContextMenuTemplate({ anchored: false, private: true, hasLink: true,
    canCloseOthers: true, canCloseRight: true, canReopen: false }, () => {});
  assert.equal(privateItems.find(item => item.id === "anchor")?.enabled, false);
});

test("tab-menu IPC requires a tab id and finite bounded coordinates", () => {
  const command = { type: "tab-menu", id: 3, x: 150.5, y: 20 };
  assert.ok(isTabsCommand(command));
  for (const id of [undefined, "3", -1, 1.5, Infinity]) assert.ok(!isTabsCommand({ ...command, id }));
  for (const value of [undefined, "4", -1, NaN, Infinity, 20_001]) {
    assert.ok(!isTabsCommand({ ...command, x: value }));
    assert.ok(!isTabsCommand({ ...command, y: value }));
  }
});
