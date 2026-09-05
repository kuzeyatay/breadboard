import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeIndexAfterClose,
  cycleTabIndex,
  insertIndexForOpenedTab,
  isFullScreenShortcut,
  moveItem,
  nthTabIndex,
  tabShortcutFor,
  type ShortcutInput,
} from "../src/main/tab-model";

function key(
  key: string,
  modifiers: Partial<Pick<ShortcutInput, "control" | "meta" | "shift" | "alt">> = {},
  extra: Partial<ShortcutInput> = {},
): ShortcutInput {
  return {
    type: "keyDown",
    key,
    control: false,
    meta: false,
    shift: false,
    alt: false,
    isAutoRepeat: false,
    ...modifiers,
    ...extra,
  };
}

test("the tab keys are the ones a browser answers to", () => {
  assert.deepEqual(tabShortcutFor(key("t", { control: true })), { type: "new" });
  assert.deepEqual(tabShortcutFor(key("t", { meta: true })), { type: "new" });
  assert.deepEqual(tabShortcutFor(key("w", { control: true })), { type: "close" });
  assert.deepEqual(tabShortcutFor(key("F4", { control: true })), { type: "close" });
  assert.deepEqual(tabShortcutFor(key("Tab", { control: true })), { type: "next" });
  assert.deepEqual(tabShortcutFor(key("Tab", { control: true, shift: true })), {
    type: "previous",
  });
  assert.deepEqual(tabShortcutFor(key("PageDown", { control: true })), { type: "next" });
  assert.deepEqual(tabShortcutFor(key("PageUp", { control: true })), { type: "previous" });
  assert.deepEqual(tabShortcutFor(key("PageDown", { control: true, shift: true })), {
    type: "move",
    delta: 1,
  });
  assert.deepEqual(tabShortcutFor(key("PageUp", { control: true, shift: true })), {
    type: "move",
    delta: -1,
  });
  // Ctrl+Shift+T reaches the layout's uppercase letter.
  assert.deepEqual(tabShortcutFor(key("T", { control: true, shift: true })), {
    type: "reopen",
  });
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
    assert.deepEqual(tabShortcutFor(key(String(n), { control: true })), { type: "nth", n });
  }
  assert.deepEqual(tabShortcutFor(key("9", { control: true })), { type: "last" });
  assert.deepEqual(tabShortcutFor(key("ArrowLeft", { alt: true })), { type: "back" });
  assert.deepEqual(tabShortcutFor(key("ArrowRight", { alt: true })), { type: "forward" });
  assert.deepEqual(tabShortcutFor(key("r", { control: true })), { type: "reload" });
  assert.deepEqual(tabShortcutFor(key("F5")), { type: "reload" });
  assert.deepEqual(tabShortcutFor(key("=", { control: true })), {
    type: "zoom",
    direction: "in",
  });
  assert.deepEqual(tabShortcutFor(key("-", { control: true })), {
    type: "zoom",
    direction: "out",
  });
  assert.deepEqual(tabShortcutFor(key("0", { control: true })), {
    type: "zoom",
    direction: "reset",
  });
});

test("keys that are not tab keys are left to the page", () => {
  assert.equal(tabShortcutFor(key("t")), null);
  assert.equal(tabShortcutFor(key("w", { shift: true })), null);
  assert.equal(tabShortcutFor(key("w", { control: true, shift: true })), null);
  assert.equal(tabShortcutFor(key("ArrowLeft", { alt: true, control: true })), null);
  assert.equal(tabShortcutFor(key("ArrowLeft", { alt: true, shift: true })), null);
  assert.equal(tabShortcutFor(key("a", { control: true })), null);
  assert.equal(tabShortcutFor(key("t", { control: true }, { type: "keyUp" })), null);
});

test("a held key cycles but never creates or destroys", () => {
  const held = { isAutoRepeat: true };
  assert.deepEqual(tabShortcutFor(key("Tab", { control: true }, held)), { type: "next" });
  assert.equal(tabShortcutFor(key("t", { control: true }, held)), null);
  assert.equal(tabShortcutFor(key("w", { control: true }, held)), null);
  assert.equal(tabShortcutFor(key("T", { control: true, shift: true }, held)), null);
  assert.equal(tabShortcutFor(key("3", { control: true }, held)), null);
  assert.equal(tabShortcutFor(key("F5", {}, held)), null);
});

test("full screen keeps its own shortcut", () => {
  assert.ok(isFullScreenShortcut(key("F11")));
  assert.ok(isFullScreenShortcut(key("f", { control: true, shift: true })));
  assert.ok(!isFullScreenShortcut(key("f", { control: true })));
  assert.ok(!isFullScreenShortcut(key("F11", {}, { isAutoRepeat: true })));
});

test("cycling wraps at both ends and numbering does not round", () => {
  assert.equal(cycleTabIndex(0, 3, 1), 1);
  assert.equal(cycleTabIndex(2, 3, 1), 0);
  assert.equal(cycleTabIndex(0, 3, -1), 2);
  assert.equal(cycleTabIndex(0, 0, 1), -1);

  assert.equal(nthTabIndex(1, 3), 0);
  assert.equal(nthTabIndex(3, 3), 2);
  assert.equal(nthTabIndex(4, 3), -1);
  assert.equal(nthTabIndex("last", 3), 2);
  assert.equal(nthTabIndex("last", 0), -1);
});

test("closing the active tab moves right, or left from the end; a background close moves nothing", () => {
  // Tabs A B C, B active, B closed: C takes over at the same position.
  assert.equal(activeIndexAfterClose(1, 1, 3), 1);
  // C active and closed: B is the last one left.
  assert.equal(activeIndexAfterClose(2, 2, 3), 1);
  // A closed while C is active: C is still active, now at index 1.
  assert.equal(activeIndexAfterClose(0, 2, 3), 1);
  // C closed while A is active: A stays at 0.
  assert.equal(activeIndexAfterClose(2, 0, 3), 0);
  assert.equal(activeIndexAfterClose(0, 0, 1), -1);
});

test("a link opens beside its page in opening order; a blank tab goes to the end", () => {
  // Active at 0 of 3: the first link opened goes to 1, the next to 2.
  assert.equal(insertIndexForOpenedTab(0, 3, "link", 0), 1);
  assert.equal(insertIndexForOpenedTab(0, 4, "link", 1), 2);
  assert.equal(insertIndexForOpenedTab(2, 3, "link", 0), 3);
  assert.equal(insertIndexForOpenedTab(0, 3, "blank", 0), 3);
  assert.equal(insertIndexForOpenedTab(-1, 3, "link", 0), 3);
});

test("moving a tab clamps to the strip and leaves the original untouched", () => {
  const tabs = ["a", "b", "c", "d"];
  assert.deepEqual(moveItem(tabs, 0, 2), ["b", "c", "a", "d"]);
  assert.deepEqual(moveItem(tabs, 3, 0), ["d", "a", "b", "c"]);
  assert.deepEqual(moveItem(tabs, 1, 99), ["a", "c", "d", "b"]);
  assert.deepEqual(moveItem(tabs, 1, -5), ["b", "a", "c", "d"]);
  assert.deepEqual(moveItem(tabs, 9, 0), tabs);
  assert.deepEqual(tabs, ["a", "b", "c", "d"]);
});
