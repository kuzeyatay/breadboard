import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");

const terminal = source("src/app/components/hermes/dashboard-agent-terminal.tsx");
const sidebar = source("src/app/components/hermes/terminal-sidebar.tsx");

test("a Recents refresh that fails keeps the chats it last loaded", () => {
  // The rail polls every ten seconds and its list starts empty. Swallowing a
  // failed poll left that empty list standing, and an empty list renders as
  // "No chats yet" — so one missed request erased every conversation from view
  // while they sat untouched in brain.db.
  const refresh = terminal.match(
    /void loadHermesSessionSummaries\("dashboard_terminal"[\s\S]*?\n {4}\};/,
  );
  assert.ok(refresh, "the Recents refresh must be findable");
  assert.doesNotMatch(
    refresh[0],
    /\.catch\(\(\) => undefined\)/,
    "a failed Recents refresh must be reported, not swallowed",
  );
  assert.match(refresh[0], /setHistoryError\(HISTORY_REFRESH_FAILED\)/);
  // Nothing in the failure path may clear or replace the list.
  const failureBranch = refresh[0].match(/\.catch\(\([\s\S]*?\n {8}\}\)/);
  assert.ok(failureBranch);
  assert.doesNotMatch(failureBranch[0], /setHistory\(/);
});

test("a refresh that lands retracts the failure note and nothing else", () => {
  assert.match(
    terminal,
    /setHistoryError\(\(current\) =>\s*current === HISTORY_REFRESH_FAILED \? null : current,\s*\)/,
    "a successful refresh must not clear an unrelated error, such as a failed delete",
  );
});

test('"No chats yet" is only said when a load actually came back empty', () => {
  const emptyRecents = sidebar.match(/recents\.length === 0 \?[\s\S]*?\) : \(/);
  assert.ok(emptyRecents, "the empty-Recents branch must be findable");
  assert.match(
    emptyRecents[0],
    /error \? null : \(/,
    "an empty list caused by a failed request must not be reported as an empty account",
  );
});
