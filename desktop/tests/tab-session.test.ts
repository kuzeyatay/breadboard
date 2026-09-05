import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readTabSession, restoredTabUrl, saveTab, TAB_SESSION_FILE, writeTabSession } from "../src/main/tab-session";
import { isTabsCommand } from "../src/shared/ipc-contract";

test("Clicky never restores automatically with Breadboard tabs", () => {
  for (const url of ["/clicky", "/clicky/", "/clicky?theme=light"]) {
    assert.equal(saveTab({ url: `http://127.0.0.1:3000${url}`, title: "Clicky", anchored: false }, "http://127.0.0.1:3000"), null);
    assert.equal(restoredTabUrl({ kind: "dashboard", url, title: "Clicky", anchored: false }, "http://127.0.0.1:4000"), null);
  }
});

test("internal paths follow the dashboard port while browser addresses retain their origin", () => {
  const tab = { url: "http://127.0.0.1:3000/garden?chat=hello#message", title: "Garden", anchored: true };
  const internal = saveTab(tab, "http://127.0.0.1:3000")!;
  assert.equal(internal.kind, "dashboard");
  assert.equal(restoredTabUrl(internal, "http://127.0.0.1:4000"), "http://127.0.0.1:4000/garden?chat=hello#message");
  const browser = saveTab({ ...tab, browser: {} }, "http://127.0.0.1:3000")!;
  assert.equal(restoredTabUrl(browser, "http://127.0.0.1:4000"), tab.url);
  assert.equal(saveTab({ ...tab, url: "file:///startup.html" }, "http://127.0.0.1:3000"), null);
  assert.equal(saveTab({ ...tab, url: "", browser: {} }, "http://127.0.0.1:3000")?.url, "");
});

test("session files retain duplicates, ordering, selected tabs and anchors, and tolerate corrupt data", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-session-store-"));
  const tab = { kind: "dashboard" as const, url: "/garden", title: "Garden", anchored: true };
  try {
    assert.deepEqual(readTabSession(dir).windows, []);
    const session = { version: 1 as const, windows: [{ tabs: [tab, tab], activeIndex: 1 }] };
    writeTabSession(dir, session);
    assert.deepEqual(readTabSession(dir), session);
    fs.writeFileSync(path.join(dir, TAB_SESSION_FILE), "{");
    assert.deepEqual(readTabSession(dir).windows, []);
    fs.writeFileSync(path.join(dir, TAB_SESSION_FILE), JSON.stringify({ version: 1, windows: [{
      tabs: [null, { ...tab, url: "//evil.example/path" }, { ...tab, url: "/\\evil.example" },
        { ...tab, kind: "browser", url: "javascript:alert(1)" }, tab], activeIndex: 4,
    }] }));
    assert.deepEqual(readTabSession(dir).windows, [{ tabs: [tab], activeIndex: 0 }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the anchor command requires a valid tab id", () => {
  assert.equal(isTabsCommand({ type: "anchor", id: 1 }), true);
  for (const id of [undefined, "1", -1, 1.5, NaN]) {
    assert.equal(isTabsCommand({ type: "anchor", id }), false);
  }
});
