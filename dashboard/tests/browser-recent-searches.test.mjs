import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRecentSearches,
  recentSearchFromInput,
} from "../src/app/browser/browser-recent-searches.ts";

test("recents keep searches and reject visited page addresses", () => {
  assert.equal(recentSearchFromInput("best coffee nearby"), "best coffee nearby");
  assert.equal(recentSearchFromInput("https://mail.google.com/mail/u/0/"), null);
  assert.equal(recentSearchFromInput("example.com/docs"), null);
  assert.equal(
    recentSearchFromInput("https://www.google.com/search?q=white+flowers"),
    "white flowers",
  );
});

test("legacy mixed history migrates to unique recent searches", () => {
  assert.deepEqual(
    normalizeRecentSearches([
      "https://contacts.google.com/widget/hovercard/",
      "white flowers",
      "https://www.google.com/search?q=garden+design",
      "white flowers",
      "https://mail.google.com/",
    ]),
    ["white flowers", "garden design"],
  );
});
