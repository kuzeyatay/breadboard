import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  conversationOriginLabel,
  gardenChatOriginLabel,
} from "../src/lib/conversations/origin-label.ts";

test("the garden rail names each chat's source the way the Terminal does, minus the garden", () => {
  assert.equal(gardenChatOriginLabel({ surface: "garden_chat", historySurface: "garden_chat" }), "Workspace");
  assert.equal(gardenChatOriginLabel({ originLabel: "Code", surface: "garden_chat" }), "Code");
  assert.equal(gardenChatOriginLabel({ originLabel: "PDF", surface: "dashboard_terminal" }), "PDF Assistant");
  assert.equal(gardenChatOriginLabel({ surface: "garden_chat", historySurface: "assistant" }), "Explore Assistant");
});

test("the Terminal calls the Quartz reader's Assistant the Explore Assistant", () => {
  assert.equal(
    conversationOriginLabel({ surface: "garden_chat", gardenName: "EM", historySurface: "assistant" }),
    "EM: Explore Assistant",
  );
  assert.equal(conversationOriginLabel({ surface: "garden_chat", gardenName: "EM" }), "EM: Workspace");
});

test("the garden rail lists the garden's Explore and PDF Assistant chats with their prefixes", () => {
  const route = readFileSync(new URL("../src/app/api/chat-sessions/route.ts", import.meta.url), "utf8");
  assert.match(route, /linkedChats: readLinkedGardenChats\(access\.id, userId\)/);
  assert.match(route, /c\.origin_label IN \('PDF', 'PDF Assistant'\)/);
  const client = readFileSync(new URL("../src/app/gardens/[clusterSlug]/workspace-client.tsx", import.meta.url), "utf8");
  assert.match(client, /titlePrefix: session\.originLabel \?\? WORKSPACE_ORIGIN_LABEL/);
  assert.match(client, /titlePrefix: chat\.originLabel/);
});
