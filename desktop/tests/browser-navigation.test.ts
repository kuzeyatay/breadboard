import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  BROWSER_NAVIGATION_STATE_FILE,
  readBrowserNavigationEnabled,
  writeBrowserNavigationEnabled,
} from "../src/main/browser-navigation";
import {
  BROWSER_RAIL_WIDTH,
  BROWSER_BOOKMARKS_HEIGHT,
  BROWSER_CONTENT_TOP_INSET,
  BROWSER_TOOLBAR_HEIGHT,
  BROWSER_TERMINAL_WIDTH,
  TAB_LOADING_SCENE_TOP_INSET,
  browserContentLeft,
  browserTerminalMaxWidth,
  browserContentTop,
  browserFaviconFromUpdate,
  browserFaviconUrl,
  browserSelectionBootstrapScript,
  browserSelectionText,
  browserUrlForInput,
  tabLoadingSceneTop,
} from "../src/main/tab-manager";
import { isTabsCommand } from "../src/shared/ipc-contract";

test("browser navigation is on until it is switched off, and stays off", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "bb-browser-navigation-"));
  try {
    assert.equal(readBrowserNavigationEnabled(fixture), true);

    writeBrowserNavigationEnabled(fixture, false);
    assert.equal(readBrowserNavigationEnabled(fixture), false);
    assert.deepEqual(
      JSON.parse(
        fs.readFileSync(path.join(fixture, BROWSER_NAVIGATION_STATE_FILE), "utf8"),
      ),
      { enabled: false },
    );

    writeBrowserNavigationEnabled(fixture, true);
    assert.equal(readBrowserNavigationEnabled(fixture), true);

    // Only an explicit `false` switches the tabs off.
    for (const contents of ["{}", '{"enabled":"no"}', "not json at all"]) {
      fs.writeFileSync(path.join(fixture, BROWSER_NAVIGATION_STATE_FILE), contents);
      assert.equal(readBrowserNavigationEnabled(fixture), true, contents);
    }
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("only well-formed tab commands are accepted from a page", () => {
  assert.ok(isTabsCommand({ type: "open", url: "http://127.0.0.1:3000/garden" }));
  assert.ok(isTabsCommand({ type: "open", url: "http://127.0.0.1:3000/", background: true }));
  assert.ok(isTabsCommand({ type: "new" }));
  assert.ok(isTabsCommand({ type: "activate", id: 3 }));
  assert.ok(isTabsCommand({ type: "close" }));
  assert.ok(isTabsCommand({ type: "close", id: 0 }));
  assert.ok(isTabsCommand({ type: "move", id: 2, index: 0 }));
  assert.ok(isTabsCommand({ type: "reopen" }));
  assert.ok(isTabsCommand({ type: "back" }));
  assert.ok(isTabsCommand({ type: "forward" }));
  assert.ok(isTabsCommand({ type: "reload" }));
  assert.ok(isTabsCommand({ type: "browser" }));
  assert.ok(isTabsCommand({ type: "browser", url: "https://example.com" }));
  assert.ok(isTabsCommand({ type: "browser", replaceCurrent: true }));
  assert.ok(isTabsCommand({ type: "browser-agent", runId: `job_${"a".repeat(64)}` }));
  assert.ok(isTabsCommand({ type: "browser-navigate", input: "example.com" }));
  assert.ok(isTabsCommand({ type: "browser-stop" }));
  assert.ok(isTabsCommand({ type: "browser-terminal", open: true }));
  assert.ok(isTabsCommand({ type: "browser-terminal", open: true, width: 620 }));
  assert.ok(isTabsCommand({ type: "browser-address-suggestions", open: true }));
  assert.ok(isTabsCommand({ type: "browser-address-suggestions", open: true, bottom: 174.5 }));
  assert.ok(isTabsCommand({ type: "browser-extension-load" }));
  assert.ok(isTabsCommand({ type: "browser-extension-reload", id: "a".repeat(32) }));
  assert.ok(isTabsCommand({ type: "browser-extension-remove", id: "p".repeat(32) }));

  assert.ok(!isTabsCommand(null));
  assert.ok(!isTabsCommand("open"));
  assert.ok(!isTabsCommand({ type: "open" }));
  assert.ok(!isTabsCommand({ type: "open", url: 4 }));
  assert.ok(!isTabsCommand({ type: "open", url: "x", background: "yes" }));
  assert.ok(!isTabsCommand({ type: "activate", id: "3" }));
  assert.ok(!isTabsCommand({ type: "activate", id: 1.5 }));
  assert.ok(!isTabsCommand({ type: "move", id: 2 }));
  assert.ok(!isTabsCommand({ type: "browser", url: 4 }));
  assert.ok(!isTabsCommand({ type: "browser", replaceCurrent: "yes" }));
  assert.ok(!isTabsCommand({ type: "browser-agent", runId: "run-forged" }));
  assert.ok(!isTabsCommand({ type: "browser-agent", runId: `job_${"a".repeat(64)}`, url: 4 }));
  assert.ok(!isTabsCommand({ type: "browser-navigate" }));
  assert.ok(!isTabsCommand({ type: "browser-navigate", input: 4 }));
  assert.ok(!isTabsCommand({ type: "browser-navigate", input: "x".repeat(8_193) }));
  assert.ok(!isTabsCommand({ type: "browser-terminal", open: "yes" }));
  assert.ok(!isTabsCommand({ type: "browser-terminal", open: true, width: 12 }));
  assert.ok(!isTabsCommand({ type: "browser-terminal", open: true, width: 620.5 }));
  assert.ok(!isTabsCommand({ type: "browser-address-suggestions", open: "yes" }));
  for (const bottom of [-1, NaN, Infinity, "174", 20_001]) {
    assert.ok(!isTabsCommand({ type: "browser-address-suggestions", open: true, bottom }));
  }
  assert.ok(!isTabsCommand({ type: "browser-extension-reload", id: "not-an-extension" }));
  assert.ok(!isTabsCommand({ type: "browser-extension-remove", id: "z".repeat(32) }));
  assert.ok(!isTabsCommand({ type: "detach" }));
});

test("browser selection messages and trusted rail bounds are narrow and validated", () => {
  assert.equal(BROWSER_TERMINAL_WIDTH, 640);
  assert.equal(BROWSER_CONTENT_TOP_INSET, 32 + BROWSER_TOOLBAR_HEIGHT + BROWSER_BOOKMARKS_HEIGHT);
  assert.equal(
    browserSelectionText("breadboard-selection://ask?text=selected%20words"),
    "selected words",
  );
  assert.equal(browserSelectionText("breadboard-selection://ask?text=%20%20"), null);
  assert.equal(browserSelectionText("https://example.com/?text=forged"), null);
  assert.match(browserSelectionBootstrapScript(), /breadboard-selection:\/\/ask\?text=/);
  assert.match(browserSelectionBootstrapScript(), /window\.getSelection\(\)/);
  assert.equal(browserContentLeft(1_280, false), BROWSER_RAIL_WIDTH);
  assert.equal(browserContentLeft(1_280, true), BROWSER_TERMINAL_WIDTH);
  assert.equal(browserTerminalMaxWidth(1_920), 960);
  assert.equal(browserContentLeft(1_920, true, 1_200), 960);
  assert.equal(browserContentLeft(1_280, true, 700), 640);
  assert.equal(browserContentLeft(640, true), 320);
  assert.equal(browserContentTop(false), BROWSER_CONTENT_TOP_INSET);
  assert.equal(browserContentTop(true, 174), 174, "two suggestions leave no unused strip");
  assert.equal(browserContentTop(true, 174.5), 175, "fractional edges never clip the dropdown");
  assert.equal(browserContentTop(true, 424), 424, "larger lists are not clipped at a fixed height");
  assert.equal(browserContentTop(false, 424), BROWSER_CONTENT_TOP_INSET);
  assert.equal(browserContentTop(true, 64), BROWSER_CONTENT_TOP_INSET);
  assert.equal(browserContentTop(true, 424, 300), 299, "resizing keeps the page within the window");
  assert.equal(
    tabLoadingSceneTop(true, false),
    TAB_LOADING_SCENE_TOP_INSET,
    "a cold browser loader meets the current navbar without reserving bookmarks",
  );
  assert.equal(
    tabLoadingSceneTop(true, true),
    BROWSER_CONTENT_TOP_INSET,
    "later webpage loads stay below painted browser chrome",
  );
});

test("browser favicon state accepts only display-safe image locations", () => {
  assert.equal(browserFaviconUrl("https://example.com/favicon.ico"), "https://example.com/favicon.ico");
  assert.equal(browserFaviconUrl("javascript:alert(1)"), null);
  assert.equal(browserFaviconUrl("file:///C:/secret.ico"), null);
  assert.equal(browserFaviconUrl("data:image/svg+xml,<svg onload=alert(1) />"), null);
  assert.equal(browserFaviconUrl("data:image/png;base64,aGVsbG8="), "data:image/png;base64,aGVsbG8=");
  assert.equal(
    browserFaviconFromUpdate("https://mail.google.com/favicon.ico", []),
    "https://mail.google.com/favicon.ico",
  );
  assert.equal(
    browserFaviconFromUpdate("https://old.example/favicon.ico", ["https://new.example/icon.png"]),
    "https://new.example/icon.png",
  );
});

test("browser address input distinguishes URLs, hosts, searches and unsafe schemes", () => {
  assert.equal(browserUrlForInput(" https://example.com/docs "), "https://example.com/docs");
  assert.equal(browserUrlForInput("example.com/docs"), "https://example.com/docs");
  assert.equal(browserUrlForInput("localhost:4310/status"), "http://localhost:4310/status");
  assert.equal(
    browserUrlForInput("green roof design"),
    "https://www.google.com/search?q=green%20roof%20design",
  );
  assert.equal(browserUrlForInput("javascript:alert(1)"), null);
  assert.equal(browserUrlForInput("file:///C:/secret.txt"), null);
  assert.equal(browserUrlForInput(""), null);
});
