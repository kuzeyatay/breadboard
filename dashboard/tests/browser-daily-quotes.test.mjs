import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BROWSER_DAILY_QUOTES,
  browserDailyQuote,
  browserQuoteAuthor,
  browserQuoteDateKey,
} from "../src/app/browser/browser-daily-quotes.ts";

test("the offline collection is inspirational and spans many named voices", () => {
  assert.ok(BROWSER_DAILY_QUOTES.length >= 60);
  assert.equal(new Set(BROWSER_DAILY_QUOTES.map(entry => entry.quote)).size, BROWSER_DAILY_QUOTES.length);
  assert.ok(BROWSER_DAILY_QUOTES.every(entry => entry.mood === "uplifting" && !entry.original));
  assert.ok(BROWSER_DAILY_QUOTES.every(entry => entry.source?.trim()), "retain attribution provenance");
  const authors = new Set(BROWSER_DAILY_QUOTES.map(entry => entry.author).filter(Boolean));
  assert.ok(authors.size >= 45);
  // Check a cross-section of the expanded range, rather than only Western writers.
  for (const author of ["Tu Youyou", "Wangari Maathai", "Wilma Mankiller", "César Chávez", "Helen Keller", "Billie Jean King", "Malala Yousafzai", "Mustafa Kemal Atatürk"]) {
    assert.ok(authors.has(author), author);
  }
});

test("unknown authors receive a caption without borrowing a famous attribution", () => {
  assert.equal(browserQuoteAuthor({author:""}), "Unnamed");
  assert.equal(browserQuoteAuthor({author:"  "}), "Unnamed");
  assert.equal(browserQuoteAuthor({author:"Helen Keller"}), "Helen Keller");
  for (const text of ["The secret of getting ahead is getting started.", "It is never too late to be what you might have been."]) {
    assert.equal(browserQuoteAuthor(BROWSER_DAILY_QUOTES.find(entry => entry.quote === text)), "Unnamed");
  }
  assert.ok(BROWSER_DAILY_QUOTES.some(entry => !entry.author && entry.quote.length <= 42));
});

test("local dates keep the same daily quote across tabs and times of day", () => {
  const morning = new Date(2026, 8, 4, 8, 30), evening = new Date(2026, 8, 4, 23, 59);
  assert.equal(browserQuoteDateKey(morning), "2026-09-04");
  for (const length of [42, Infinity]) {
    assert.deepEqual(browserDailyQuote(morning, "reader@example.test", length), browserDailyQuote(evening, "reader@example.test", length));
  }
});

test("full and compact rotations cover their entire collection before repeating, including DST", () => {
  for (const owner of ["reader@example.test", "other@example.test"]) {
    for (const length of [42, Infinity]) {
      const candidates = BROWSER_DAILY_QUOTES.filter(entry => entry.quote.length <= length);
      assert.ok(candidates.length >= 20);
      const seen = new Set();
      for (let offset = 0; offset < candidates.length; offset++) {
        const date = new Date(2026, 9, 23 + offset, 12);
        const entry = browserDailyQuote(date, owner, length);
        assert.ok(entry.quote.length <= length, "compact quotes are complete, not truncated");
        seen.add(entry.quote);
      }
      assert.equal(seen.size, candidates.length);
      assert.deepEqual(browserDailyQuote(new Date(2026,9,23,12),owner,length), browserDailyQuote(new Date(2026,9,23+candidates.length,12),owner,length));
    }
  }
});

test("an impossible length still returns a real quote", () => {
  assert.ok(BROWSER_DAILY_QUOTES.includes(browserDailyQuote(new Date(2026,10,6), "reader", 0)));
});
