import { test } from "node:test";
import assert from "node:assert/strict";
import type { MenuItemConstructorOptions } from "electron";
import { browserMenuTemplate, browserMenuShortcut, savedPageFilename, type BrowserMenuAction } from "../src/main/browser-menu";
import { isTabsCommand } from "../src/shared/ipc-contract";
import { tabShortcutFor } from "../src/main/tab-model";

function flatten(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap(item => [item, ...(Array.isArray(item.submenu) ? flatten(item.submenu) : [])]);
}

test("every browser menu action is wired and the menu reports the actual page zoom", () => {
  const calls: BrowserMenuAction[] = [];
  const items = flatten(browserMenuTemplate({ profileLabel: "One & Two", hasPage: true, zoomPercent: 150, fullscreen: true }, action => calls.push(action)));
  assert.equal(items[0]!.label, "One && Two");
  assert.ok(items.some(item => item.label === "Zoom · 150%"));
  assert.equal(items.find(item => item.id === "fullscreen")!.checked, true);
  const actions = items.filter(item => item.id);
  for (const item of actions) {
    assert.equal(typeof item.click, "function", item.id);
    assert.equal(item.registerAccelerator, false, "shortcuts are handled by the focused browser page");
    item.click!({} as never, {} as never, {} as never);
  }
  assert.deepEqual(new Set(calls), new Set(actions.map(item => item.id)));
  assert.equal(new Set(calls).size, actions.length);
  assert.deepEqual(items.slice(2, 6).map(item => item.id), ["new-tab", "new-window", "new-private-tab", "new-private-window"]);
});

test("page-only commands are unavailable on browser home and zoom stays within its bounds", () => {
  const home = flatten(browserMenuTemplate({ profileLabel: "Profile", hasPage: false, zoomPercent: 100, fullscreen: false }, () => {}));
  for (const id of ["print", "save", "translate", "find", "zoom-in", "zoom-out", "zoom-reset", "developer-tools", "copy-link", "picture-in-picture"]) {
    assert.equal(home.find(item => item.id === id)!.enabled, false, id);
  }
  assert.equal(home.find(item => item.id === "downloads")!.enabled, true);
  const maximum = flatten(browserMenuTemplate({ profileLabel: "Profile", hasPage: true, zoomPercent: 300, fullscreen: false }, () => {}));
  assert.equal(maximum.find(item => item.id === "zoom-in")!.enabled, false);
});

test("browser shortcuts and IPC reject malformed commands", () => {
  const key = { type: "keyDown", key: "j", control: true, meta: false, shift: false, alt: false, isAutoRepeat: false };
  assert.equal(browserMenuShortcut(key), "downloads");
  assert.equal(browserMenuShortcut({ ...key, key: "P" }), "print");
  assert.equal(browserMenuShortcut({ ...key, key: "f" }), "find");
  assert.equal(browserMenuShortcut({ ...key, key: "o", shift: true }), "bookmarks");
  assert.equal(browserMenuShortcut({ ...key, key: "p", shift: true }), "new-private-tab");
  assert.equal(browserMenuShortcut({ ...key, key: "n", shift: true }), "new-private-window");
  assert.equal(browserMenuShortcut({ ...key, isAutoRepeat: true }), null);
  assert.equal(browserMenuShortcut({ ...key, control: false }), null);
  assert.equal(browserMenuShortcut({ ...key, key: "p", control: false, alt: true }), "picture-in-picture");
  assert.equal(browserMenuShortcut({ ...key, key: "p", control: false, alt: true, shift: true }), null);
  assert.equal(browserMenuShortcut({ ...key, key: "p", control: false, alt: true, type: "keyUp" }), null);
  assert.equal(browserMenuShortcut({ ...key, key: "p", control: false, alt: true, isAutoRepeat: true }), null);
  assert.deepEqual(tabShortcutFor({ ...key, key: "+", shift: true }), { type: "zoom", direction: "in" });
  assert.equal(isTabsCommand({ type: "browser-menu", x: 100, y: 60, profileLabel: "Profile" }), true);
  for (const invalid of [{ type: "browser-menu", x: -1, y: 60, profileLabel: "Profile" }, { type: "browser-menu", x: 100, y: NaN, profileLabel: "Profile" }, { type: "browser-find", text: "x".repeat(1001) }, { type: "browser-find", text: "text", forward: "true" }]) {
    assert.equal(isTabsCommand(invalid), false);
  }
  assert.equal(isTabsCommand({ type: "browser-find", text: "text", forward: false, findNext: true }), true);
});

test("Save Page produces valid Windows filenames without accepting paths", () => {
  assert.equal(savedPageFilename("CON"), "Saved page.html");
  assert.equal(savedPageFilename("..\\folder/page: test?"), ".. folder page  test.html");
  assert.equal(savedPageFilename("Breadboard guide"), "Breadboard guide.html");
});
