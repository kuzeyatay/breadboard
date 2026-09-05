import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  chatResponseCompletedAt,
  chatTimeSeparatorLabels,
  formatChatClockTime,
  formatChatTimeSeparator,
  parseChatTimestamp,
} from "../src/lib/chat-time-separators.ts";

const localIso = (year, month, day, hour, minute) =>
  new Date(year, month - 1, day, hour, minute).toISOString();

test("chat timestamps appear first and at least hourly from the last marker", () => {
  const now = new Date(2026, 6, 27, 12, 30).getTime();
  const labels = chatTimeSeparatorLabels(
    [
      { createdAt: localIso(2026, 7, 27, 9, 0) },
      { createdAt: localIso(2026, 7, 27, 9, 40) },
      { createdAt: localIso(2026, 7, 27, 10, 20) },
      { createdAt: localIso(2026, 7, 27, 10, 55) },
    ],
    now,
    "en-US",
  );

  assert.deepEqual(labels, [
    "Today 9:00 AM",
    null,
    "Today 10:20 AM",
    null,
  ]);
});

test("chat timestamps use today, yesterday, weekday, and calendar labels", () => {
  const now = new Date(2026, 6, 27, 12, 30).getTime();

  assert.equal(
    formatChatTimeSeparator(
      new Date(2026, 6, 27, 11, 37).getTime(),
      now,
      "en-US",
    ),
    "Today 11:37 AM",
  );
  assert.equal(
    formatChatTimeSeparator(
      new Date(2026, 6, 26, 20, 29).getTime(),
      now,
      "en-US",
    ),
    "Yesterday 8:29 PM",
  );
  assert.equal(
    formatChatTimeSeparator(
      new Date(2026, 6, 25, 20, 29).getTime(),
      now,
      "en-US",
    ),
    "Saturday 8:29 PM",
  );
  assert.equal(
    formatChatTimeSeparator(
      new Date(2026, 5, 10, 8, 5).getTime(),
      now,
      "en-US",
    ),
    "Jun 10 8:05 AM",
  );
});

test("SQLite UTC timestamps are interpreted as UTC rather than browser local time", () => {
  const timestamp = "2026-07-27 08:37:00";
  const now = Date.parse("2026-07-27T12:00:00.000Z");
  assert.equal(
    parseChatTimestamp(timestamp),
    Date.parse("2026-07-27T08:37:00.000Z"),
  );
  assert.deepEqual(
    chatTimeSeparatorLabels([{ createdAt: timestamp }], now, "en-US"),
    [
      formatChatTimeSeparator(
        Date.parse("2026-07-27T08:37:00.000Z"),
        now,
        "en-US",
      ),
    ],
  );
});

test("chat timestamp parsing preserves explicit offsets and rejects invalid input", () => {
  assert.equal(
    parseChatTimestamp("2026-07-27T08:37:00+03:00"),
    Date.parse("2026-07-27T08:37:00+03:00"),
  );
  assert.equal(parseChatTimestamp("not a timestamp"), null);
  assert.equal(parseChatTimestamp(undefined), null);
});

test("response action timestamps use the compact local clock format", () => {
  const timestamp = localIso(2026, 7, 27, 11, 35);
  assert.equal(formatChatClockTime(timestamp, "en-GB"), "11:35");
  assert.equal(formatChatClockTime(timestamp, "en-US"), "11:35 AM");
  assert.equal(formatChatClockTime("not a timestamp", "en-GB"), null);
});

test("response action timestamps are based on when streaming completed", () => {
  const startedAt = new Date(2026, 6, 27, 11, 35, 20).toISOString();
  const completedAt = chatResponseCompletedAt(startedAt, 61_250);

  assert.equal(
    completedAt,
    new Date(2026, 6, 27, 11, 36, 21, 250).toISOString(),
  );
  assert.equal(
    formatChatClockTime(completedAt, "en-GB"),
    "11:36",
  );
  assert.equal(chatResponseCompletedAt(startedAt, undefined), undefined);
  assert.equal(chatResponseCompletedAt(startedAt, -1), undefined);
  assert.equal(chatResponseCompletedAt("not a timestamp", 1_000), undefined);
});

test("all Breadboard chat transcripts render and persist message timestamps", () => {
  const sources = [
    "../src/app/components/hermes/agent-runtime-panel.tsx",
    "../src/app/components/knowledge-terminal.tsx",
    "../src/app/garden/garden-assistant.tsx",
    "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
  ].map((relativePath) =>
    readFileSync(new URL(relativePath, import.meta.url), "utf8"),
  );
  for (const source of sources) {
    assert.match(source, /<ChatTimeSeparator/);
    assert.match(
      source,
      /chatTimeSeparatorLabels\((?:visibleMessages|messages)\)/,
    );
    assert.match(source, /createdAt/);
  }

  const listRoute = readFileSync(
    new URL("../src/app/api/chat-sessions/route.ts", import.meta.url),
    "utf8",
  );
  const updateRoute = readFileSync(
    new URL(
      "../src/app/api/chat-sessions/[sessionId]/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    listRoute,
    /tool_calls,\s+runtime_status,\s+runtime_error,\s+created_at/,
  );
  assert.match(listRoute, /createdAt: message\.created_at/);
  assert.match(updateRoute, /message\.createdAt \?\? prior\?\.created_at/);
});
