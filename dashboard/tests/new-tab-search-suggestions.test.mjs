import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { normalizeSearchHistory, newTabSearchSuggestions, webSearchUrl, webDestinationUrl } from "../src/lib/new-tab-search-suggestions.ts";
import { readSearchHistory, updateSearchHistory } from "../src/lib/new-tab-search-history.ts";

test("history preserves search destinations and filenames, while bounding and cleaning entries", () => {
  assert.deepEqual(normalizeSearchHistory([
    { query: " lecture.pdf ", scope: "breadboard" }, { query: "LECTURE.pdf", scope: "breadboard" },
    { query: "lecture.pdf", scope: "web" }, { query: "", scope: "web" },
    null, "bad", { query: "secret", scope: "unknown" }, { scope: "breadboard" },
  ]), [{ query: "lecture.pdf", scope: "breadboard" }, { query: "lecture.pdf", scope: "web" }]);
  assert.equal(normalizeSearchHistory(Array.from({ length: 100 }, (_, i) => ({ query: `${i}`, scope: "web" }))).length, 80);
  assert.equal(normalizeSearchHistory([{ query: "x".repeat(300), scope: "web" }])[0].query.length, 200);
});

test("suggestions show recent searches first and always offer both Breadboard and web search", () => {
  const history = Array.from({ length: 80 }, (_, i) => ({ query: `Fourier ${i}`, scope: i % 2 ? "web" : "breadboard" }));
  const results = Array.from({ length: 20 }, (_, i) => ({ id: `note:${i}`, type: "note", title: `Fourier note ${i}`, context: "Math 1", href: `/note/${i}`, snippet: "", score: 100 - i }));
  const suggestions = newTabSearchSuggestions("Fourier", history, results);
  assert.equal(suggestions.length, 8);
  assert.equal(suggestions.filter(item => item.source === "history").length, 4);
  assert.equal(suggestions[1].scope, "web");
  assert.equal(suggestions[4].detail, "Search Breadboard");
  assert.equal(suggestions[5].detail, "Search the web");
  assert.equal(suggestions[5].scope, "web");
  assert.equal(suggestions[6].result.href, "/note/0");
  assert.equal(newTabSearchSuggestions("", history, results).length, 4);
  assert.deepEqual(newTabSearchSuggestions("", [], results), []);
  assert.equal(newTabSearchSuggestions("nonmatching", history, []).length, 2);
  const url = new URL(webSearchUrl("  example.com & Fourier + π?  "));
  assert.equal(url.origin, "https://www.google.com");
  assert.equal(url.pathname, "/search");
  assert.equal(url.searchParams.get("q"), "example.com & Fourier + π?");
  assert.equal([...url.searchParams].length, 1);
});

test("persisted searches are isolated by account and removals preserve the other destination", t => {
  const db = new Database(":memory:");
  t.after(() => db.close());
  db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES (1), (2)");
  assert.deepEqual(readSearchHistory(db, 1), []);
  updateSearchHistory(db, 1, { query: "Fourier", scope: "breadboard" });
  updateSearchHistory(db, 1, { query: "Fourier", scope: "web" });
  updateSearchHistory(db, 2, { query: "Private project", scope: "breadboard" });
  updateSearchHistory(db, 1, { query: "FOURIER", scope: "breadboard" });
  assert.deepEqual(readSearchHistory(db, 1), [{ query: "FOURIER", scope: "breadboard" }, { query: "Fourier", scope: "web" }]);
  updateSearchHistory(db, 1, { query: "fourier", scope: "breadboard" }, true);
  assert.deepEqual(readSearchHistory(db, 1), [{ query: "Fourier", scope: "web" }]);
  assert.deepEqual(readSearchHistory(db, 2), [{ query: "Private project", scope: "breadboard" }]);
  db.prepare("UPDATE new_tab_search_history SET entries = ? WHERE user_id = 1").run("broken json");
  assert.deepEqual(readSearchHistory(db, 1), []);
  updateSearchHistory(db, 1, { query: "Recovered", scope: "breadboard" });
  assert.equal(readSearchHistory(db, 1)[0].query, "Recovered");
});

test("Terminal restores search terms using the standalone browser's search cleanup", () => {
  const searches = ["Physics formulas", "https://example.com/library?course=physics#week-2",
    "https://www.google.com/search?q=physics+lecture&tracking=old", "physics formulas", "example.com"];
  const history = [{ query: "Physics formulas", scope: "web" }, { query: "https://example.com/old", scope: "web" }];
  const suggestions = newTabSearchSuggestions("physics", history, [], searches);
  assert.deepEqual(suggestions.filter(item => item.source === "history").map(item => item.label), ["Physics formulas", "physics lecture"]);
  assert.ok(suggestions.every(item => !item.href), "suggestions rerun the search instead of reopening a visited URL");
  assert.equal(webDestinationUrl(suggestions[0].value), webSearchUrl("Physics formulas"));
  assert.equal(webDestinationUrl("example.com"), "https://example.com/");
  assert.equal(webDestinationUrl("physics formulas"), webSearchUrl("physics formulas"));
  assert.equal(newTabSearchSuggestions("", history, [], searches).length, 2);
  assert.equal(searches.length, 5, "reading suggestions does not rewrite saved data");
  assert.deepEqual(newTabSearchSuggestions("", [], [], ["one", "two", "three", "four", "five"]).map(item => item.value), ["one", "two", "three", "four"]);
});
