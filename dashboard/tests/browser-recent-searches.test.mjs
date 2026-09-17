import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRecentSearches,
  recentSearchFromInput,
  searchSuggestions,
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

test("matching recents stay above a full set of Google suggestions", () => {
  const results = searchSuggestions(" fra ", ["Fragrant garden", "coffee", "France trip"], [
    "france", "frankrijk", "france football", "france national football team",
    "fragrantica", "france world cup", "france news", "france weather",
  ]);
  assert.equal(results.length, 8);
  assert.deepEqual(results.slice(0, 2), [
    { value: "Fragrant garden", label: "Fragrant garden", source: "history" },
    { value: "France trip", label: "France trip", source: "history" },
  ]);
  assert.ok(results.slice(2).every((entry) => entry.source === "google"));
  assert.equal(results[2].value, "fra");
});

test("duplicates keep the recent entry and its order regardless of casing", () => {
  const results = searchSuggestions("FRANCE", ["France football", "France", "france"], [
    "france", "france football", "France news", "france news",
  ]);
  assert.deepEqual(results, [
    { value: "France football", label: "France football", source: "history" },
    { value: "France", label: "France", source: "history" },
    { value: "France news", label: "France news", source: "google" },
  ]);
});

test("an empty query shows only recents and unmatched queries show only predictions", () => {
  assert.deepEqual(searchSuggestions(" ", ["coffee", "France"], ["unused prediction"]), [
    { value: "coffee", label: "coffee", source: "history" },
    { value: "France", label: "France", source: "history" },
  ]);
  assert.deepEqual(searchSuggestions("fra", ["coffee"], ["france"]).map((entry) => entry.value), ["fra", "france"]);
  assert.deepEqual(searchSuggestions("fra", ["coffee"], []).map((entry) => entry.value), ["fra"]);
  assert.deepEqual(searchSuggestions("example.com", ["coffee"], ["example domain"]), []);
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
