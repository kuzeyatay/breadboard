import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// conversation_message_reads is a view that joins storage payloads and decodes
// every column through a JS function. SQLite cannot flatten such a view on the
// right of a LEFT JOIN, so it materializes the whole view (every message,
// decoded) per call. On a multi-GB database that took ~30 s per chat-session
// load and starved the event loop until the watchdog restarted the dashboard.
test("no query LEFT JOINs the conversation_message_reads view", () => {
  const root = new URL("../src/", import.meta.url);
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== "generated") walk(full); continue; }
      if (!/\.(ts|tsx|mjs)$/.test(entry.name) || /\.test\./.test(entry.name)) continue;
      const text = fs.readFileSync(full, "utf8");
      if (/LEFT\s+(OUTER\s+)?JOIN\s+conversation_message_reads\b/i.test(text)) offenders.push(full);
    }
  };
  walk(root.pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  assert.deepEqual(offenders, [], "use a primary-key lookup or a scalar subquery instead");
});
