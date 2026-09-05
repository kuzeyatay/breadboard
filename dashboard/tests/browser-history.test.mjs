import test from "node:test";
import assert from "node:assert/strict";
import { browserHistoryRows, filterBrowserHistory } from "../src/app/browser/browser-history.ts";

test("history displays full page URLs and retains previous searches without duplicate search-result rows", () => {
  const pages = [
    { url: "https://chatgpt.com/c/example?model=test#message", title: "Example chat", visitedAt: 5 },
    { url: "https://www.google.com/search?q=coffee&start=10", title: "Coffee - Google Search", visitedAt: 4 },
  ];
  const rows = browserHistoryRows(pages, ["coffee", "old search"]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].url, pages[0].url);
  assert.equal(rows[2].url, "https://www.google.com/search?q=old%20search");
  assert.deepEqual(filterBrowserHistory(rows, "MODEL=TEST#message"), [rows[0]]);
  assert.deepEqual(filterBrowserHistory(rows, "example CHAT"), [rows[0]]);
  assert.deepEqual(filterBrowserHistory(rows, "missing"), []);
});
