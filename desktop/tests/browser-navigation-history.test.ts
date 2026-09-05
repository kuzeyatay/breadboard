import { test } from "node:test";
import assert from "node:assert/strict";
import { browserNavigationTargetIndex } from "../src/main/browser-navigation-history";

test("browser history skips iframe entries that leave the top-level URL unchanged", () => {
  const entries = [
    { url: "https://example.test/one" },
    { url: "https://example.test/one" },
  ];
  assert.equal(browserNavigationTargetIndex(entries, 1, entries[1]!.url, "back"), null);
});

test("browser history selects the nearest visibly different page", () => {
  const entries = [
    { url: "https://example.test/one" },
    { url: "https://example.test/one" },
    { url: "https://example.test/two" },
    { url: "https://example.test/two" },
  ];
  assert.equal(browserNavigationTargetIndex(entries, 3, entries[3]!.url, "back"), 1);
  assert.equal(browserNavigationTargetIndex(entries, 1, entries[1]!.url, "forward"), 2);
});
