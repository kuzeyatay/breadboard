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
  assert.equal(gardenChatOriginLabel({ surface: "garden_chat", historySurface: "assistant" }), "Explore");
});

test("the Terminal calls the Quartz reader's Assistant Explore", () => {
  assert.equal(
    conversationOriginLabel({ surface: "garden_chat", gardenName: "EM", historySurface: "assistant" }),
    "EM: Explore",
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

test("Explore and PDF Assistant chats open in place, through the embedded Terminal", () => {
  const client = readFileSync(new URL("../src/app/gardens/[clusterSlug]/workspace-client.tsx", import.meta.url), "utf8");
  assert.match(client, /if \(isLinkedRailChat\(chatId\)\) \{[\s\S]{0,120}setLinkedChatId\(chatId\)/);
  assert.match(client, /presentation="embedded"\s+initialChatId=\{linkedChatId\}/);
  assert.match(client, /if \(linkedChatId\) url\.searchParams\.set\("chat", linkedChatId\)/);
  assert.doesNotMatch(client, /router\.push\(chat\.href\)/);
  const terminal = readFileSync(new URL("../src/app/components/hermes/dashboard-agent-terminal.tsx", import.meta.url), "utf8");
  // No bar, no rail, and no writes to the dock's restore-after-reload pointer.
  assert.match(terminal, /\{embeddedPresentation \? null : codePresentation \?/);
  assert.match(terminal, /codePresentation \|\| embeddedPresentation[^?]*\? null : \(\s*<TerminalSidebar/);
  assert.match(terminal, /if \(voicePresentation \|\| embeddedPresentation \|\| activeChatRestoreStartedRef\.current\) return;/);
});
