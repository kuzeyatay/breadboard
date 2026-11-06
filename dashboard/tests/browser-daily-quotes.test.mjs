import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BROWSER_DAILY_QUOTES,
  QUOTE_MOODS,
  browserDailyQuote,
  browserQuoteDateKey,
} from "../src/app/browser/browser-daily-quotes.ts";

test("the offline daily quote rotation is broad and stable for a date", () => {
  assert.ok(BROWSER_DAILY_QUOTES.length >= 60);
  assert.equal(new Set(BROWSER_DAILY_QUOTES.map((entry) => entry.quote)).size, BROWSER_DAILY_QUOTES.length);
  const date = new Date(2026, 8, 4, 8, 30);
  assert.equal(browserQuoteDateKey(date), "2026-09-04");
  assert.deepEqual(browserDailyQuote(date, "reader@example.test"), browserDailyQuote(date, "reader@example.test"));
});

test("different days draw from the date-seeded quote collection", () => {
  const first = browserDailyQuote(new Date(2026, 8, 4), "reader@example.test");
  const next = browserDailyQuote(new Date(2026, 8, 5), "reader@example.test");
  assert.notDeepEqual(first, next);
});

test("compact daily quotes remain complete and deterministic", () => {
  const date = new Date(2026, 8, 4);
  const first = browserDailyQuote(date, "reader@example.test", 42);
  assert.ok(first.quote.length <= 42);
  assert.deepEqual(first, browserDailyQuote(date, "reader@example.test", 42));
});

test("varied quotes include original unattributed lines and compact choices in every mood", () => {
  assert.equal(BROWSER_DAILY_QUOTES.length, 224);
  assert.equal(BROWSER_DAILY_QUOTES.filter(entry => entry.original).length, 160);
  assert.ok(BROWSER_DAILY_QUOTES.filter(entry => entry.original).every(entry => entry.author === ""));
  assert.deepEqual(BROWSER_DAILY_QUOTES.slice(0, QUOTE_MOODS.length).map(entry => entry.mood), [...QUOTE_MOODS]);
  for (const mood of QUOTE_MOODS) {
    assert.ok(BROWSER_DAILY_QUOTES.filter(entry => entry.mood === mood && entry.quote.length <= 42).length >= 5, mood);
  }
});

test("daily rotation covers every mood and keeps compact and full moods aligned across DST", () => {
  for (const owner of ["reader@example.test", "other@example.test"]) {
    const seen = new Set();
    for (let day = 23; day < 29; day++) {
      const date = new Date(2026, 9, day, 12);
      const full = browserDailyQuote(date, owner);
      const compact = browserDailyQuote(date, owner, 42);
      seen.add(full.mood);
      assert.equal(full.mood, compact.mood);
      assert.ok(compact.quote.length <= 42);
    }
    assert.deepEqual([...seen].sort(), [...QUOTE_MOODS].sort());
  }
});
