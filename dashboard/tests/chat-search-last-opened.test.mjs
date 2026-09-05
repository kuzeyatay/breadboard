import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  readLastOpenedChats,
  recordLastOpenedChat,
} from "../src/lib/conversations/last-opened.ts";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("last-opened chats are ordered by access, deduplicated, capped, and scoped", () => {
  const storage = memoryStorage();

  recordLastOpenedChat(storage, "garden_chat", "11", "circuits");
  recordLastOpenedChat(storage, "garden_chat", "12", "circuits");
  recordLastOpenedChat(storage, "garden_chat", "13", "circuits");
  assert.deepEqual(
    readLastOpenedChats(storage, "garden_chat", "circuits"),
    ["13", "12"],
  );

  recordLastOpenedChat(storage, "garden_chat", "12", "circuits");
  assert.deepEqual(
    readLastOpenedChats(storage, "garden_chat", "circuits"),
    ["12", "13"],
  );
  assert.deepEqual(readLastOpenedChats(storage, "garden_chat", "biology"), []);
  assert.deepEqual(readLastOpenedChats(storage, "dashboard_terminal"), []);
});

test("search groups the last two opened chats above recents", () => {
  const dialog = source("../src/app/components/hermes/chat-search-dialog.tsx");
  const terminal = source("../src/app/components/hermes/dashboard-agent-terminal.tsx");
  const garden = source("../src/app/gardens/[clusterSlug]/workspace-client.tsx");

  assert.match(dialog, /section: "Last opened"/);
  assert.match(dialog, /section: "Recent"/);
  assert.match(dialog, /key: `last-opened:\$\{row\.id\}`/);
  assert.match(terminal, /recordLastOpenedChat\([\s\S]{0,140}"dashboard_terminal"/);
  assert.match(garden, /recordLastOpenedChat\([\s\S]{0,160}"garden_chat"[\s\S]{0,80}clusterSlug/);
});
