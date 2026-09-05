import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BROWSER_DAILY_QUOTES,
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
