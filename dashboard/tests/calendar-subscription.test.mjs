import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSubscriptionUrl } from "../src/lib/calendar/ics.ts";
import { fetchSubscriptionIcs } from "../src/lib/calendar/subscription.ts";

const TIMEEDIT_URL =
  "https://cloud.timeedit.net/nl_tue/web/stud01/example-timetable-token.ics";

test("TimeEdit subscription addresses are accepted without rewriting their path", async () => {
  let requested = "";
  const ics = await fetchSubscriptionIcs(TIMEEDIT_URL, async (input) => {
    requested = String(input);
    return new Response("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n", {
      status: 200,
      headers: { "content-type": "text/calendar; charset=UTF-8" },
    });
  });

  assert.equal(requested, TIMEEDIT_URL);
  assert.match(ics, /^BEGIN:VCALENDAR/);
});

test("webcal links use HTTPS while ordinary HTTPS links stay intact", () => {
  assert.equal(
    normalizeSubscriptionUrl("webcal://calendar.example.edu/schedule.ics").toString(),
    "https://calendar.example.edu/schedule.ics",
  );
  assert.equal(normalizeSubscriptionUrl(TIMEEDIT_URL).toString(), TIMEEDIT_URL);
});
