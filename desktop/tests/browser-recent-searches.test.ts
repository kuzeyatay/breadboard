import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import {
  BROWSER_RECENT_SEARCHES_STATE_FILE,
  readBrowserRecentSearches,
  writeBrowserRecentSearches,
} from "../src/main/browser-recent-searches";
import { isBrowserRecentSearches, IPC_CHANNELS } from "../src/shared/ipc-contract";
import { createDesktopApi } from "../src/preload/preload";

test("recent searches survive separate processes per profile, including removals and clearing", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "bb-recent-searches-"));
  const modulePath = require.resolve("../src/main/browser-recent-searches");
  function processCall(code: string) {
    const result = spawnSync(process.execPath, ["-e", `const store = require(${JSON.stringify(modulePath)}); ${code}`, fixture], { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  }
  try {
    assert.equal(readBrowserRecentSearches(fixture, "one@example.com"), null);
    processCall(`
      store.writeBrowserRecentSearches(process.argv[1], "one@example.com", ["coffee nearby", "garden design"]);
      store.writeBrowserRecentSearches(process.argv[1], "two@example.com", ["train times"]);
    `);
    const read = () => JSON.parse(processCall(`console.log(JSON.stringify([
      store.readBrowserRecentSearches(process.argv[1], "one@example.com"),
      store.readBrowserRecentSearches(process.argv[1], "two@example.com"),
      store.readBrowserRecentSearches(process.argv[1], "three@example.com")
    ]));`));
    assert.deepEqual(read(), [["coffee nearby", "garden design"], ["train times"], null]);
    writeBrowserRecentSearches(fixture, "one@example.com", ["garden design"]);
    assert.deepEqual(read(), [["garden design"], ["train times"], null]);
    writeBrowserRecentSearches(fixture, "one@example.com", []);
    assert.deepEqual(read(), [[], ["train times"], null]);
  } finally {
    assert.equal(path.dirname(path.resolve(fixture)), path.resolve(os.tmpdir()));
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("recent-search payloads are bounded, unique, nonempty strings", () => {
  assert.equal(isBrowserRecentSearches([]), true);
  assert.equal(isBrowserRecentSearches(["coffee nearby", "garden design"]), true);
  for (const invalid of [null, {}, [1], [""], [" "], [" coffee"], ["x".repeat(301)], ["coffee", "coffee"], Array.from({ length: 81 }, (_, i) => `query ${i}`)]) {
    assert.equal(isBrowserRecentSearches(invalid), false);
  }
});

test("unreadable recent-search files are preserved when a read or write fails", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "bb-recent-searches-corrupt-"));
  try {
    const file = path.join(fixture, BROWSER_RECENT_SEARCHES_STATE_FILE);
    for (const contents of ['{"owners":', '{"owners":{"one@example.com":[42]}}']) {
      fs.writeFileSync(file, contents);
      assert.throws(() => readBrowserRecentSearches(fixture, "one@example.com"));
      assert.throws(() => writeBrowserRecentSearches(fixture, "one@example.com", []));
      assert.equal(fs.readFileSync(file, "utf8"), contents);
    }
  } finally {
    assert.equal(path.dirname(path.resolve(fixture)), path.resolve(os.tmpdir()));
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("the preload forwards recent-search reads and writes with their owner", async () => {
  const calls: unknown[][] = [];
  const api = createDesktopApi({
    on: () => undefined,
    invoke: async (channel, ...args) => {
      calls.push([channel, ...args]);
      return channel === IPC_CHANNELS.getBrowserRecentSearches ? ["coffee"] : true;
    },
  });
  assert.deepEqual(await api.getBrowserRecentSearches("one@example.com"), ["coffee"]);
  assert.equal(await api.setBrowserRecentSearches("one@example.com", []), true);
  assert.deepEqual(calls, [
    [IPC_CHANNELS.getBrowserRecentSearches, "one@example.com"],
    [IPC_CHANNELS.setBrowserRecentSearches, "one@example.com", []],
  ]);
});
