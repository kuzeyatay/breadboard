import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { conversationDisplayTitle } from "../src/lib/conversations/origin-label.ts";
import {
  conversationIsSameDay, messagingDayKey,
} from "../src/lib/conversations/messaging-days.ts";

test("daily reuse respects local midnight and DST instead of a rolling timeout", () => {
  const moduleUrl = new URL("../src/lib/conversations/messaging-days.ts", import.meta.url).href;
  for (const timezone of ["Europe/Amsterdam", "America/Los_Angeles", "Pacific/Auckland"]) {
    execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
      import assert from "node:assert/strict";
      import { conversationIsSameDay, messagingDayKey } from ${JSON.stringify(moduleUrl)};
      for (const [month, day] of [[8, 12], [2, 29], [9, 25], [2, 8], [10, 1]]) {
        const start = new Date(2026, month, day, 0, 1);
        const end = new Date(2026, month, day, 23, 59);
        const next = new Date(2026, month, day + 1, 0, 1);
        const sqlite = start.toISOString().replace("T", " ").slice(0, 19);
        assert.equal(conversationIsSameDay(sqlite, end), true);
        assert.equal(conversationIsSameDay(end.toISOString(), next), false);
        assert.equal(conversationIsSameDay(next.toISOString(), end), false);
        assert.equal(messagingDayKey(sqlite), messagingDayKey(start));
      }
    `], { env: { ...process.env, TZ: timezone }, stdio: "pipe" });
  }
  assert.equal(conversationIsSameDay("invalid", new Date()), false);
  assert.equal(conversationIsSameDay(new Date().toISOString(), new Date("invalid")), false);
  assert.equal(messagingDayKey("invalid"), null);
});

test("messaging chats retain their channel without a duplicated title prefix", () => {
  for (const channel of ["Telegram", "WhatsApp"]) {
    assert.equal(conversationDisplayTitle(`${channel}:Hello`, channel), `${channel}:Hello`);
    assert.equal(conversationDisplayTitle("Renamed", channel), `${channel}: Renamed`);
  }
});
