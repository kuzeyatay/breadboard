import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  chatSearchResourceFromHits,
  generativeUiResourcesFromToolOutput,
  normalizeGenerativeUiResource,
} from "../src/lib/generative-ui/contracts.ts";
import { composeHermesSystemPrompt } from "../src/lib/hermes/system-prompts.ts";
import { allowedToolsForSurface } from "../src/lib/hermes/tool-scopes.ts";

const source = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const chatResource = {
  schemaVersion: 1,
  kind: "chat-search",
  renderer: "chat-search-results",
  id: "chat-search:test",
  title: "Chats found",
  createdAt: "2026-09-01T10:00:00.000Z",
  actions: ["open-chat"],
  data: {
    query: "Kirchhoff laws",
    surface: "dashboard_terminal",
    chats: [{
      id: "conv_circuit",
      title: "Circuit analysis",
      updatedAt: "2026-08-31T09:00:00.000Z",
      pinned: true,
      matchedOn: "message",
      snippet: "We derived Kirchhoff's current law for the junction.",
    }],
  },
};

test("chat_search alone can project the bounded chat navigation resource", () => {
  const normalized = normalizeGenerativeUiResource({
    ...chatResource,
    actions: ["open-chat", "delete-chat", "run-script"],
    href: "javascript:alert(document.cookie)",
  });
  assert.ok(normalized);
  assert.deepEqual(normalized.actions, ["open-chat"]);
  assert.equal("href" in normalized, false);
  assert.equal(normalized.data.chats[0].id, "conv_circuit");

  const output = JSON.stringify({ uiResources: [chatResource] });
  assert.equal(generativeUiResourcesFromToolOutput("chat_search", output).length, 1);
  assert.equal(generativeUiResourcesFromToolOutput("web_search", output).length, 0);
  assert.equal(generativeUiResourcesFromToolOutput("product_search", output).length, 0);
});

test("chat resources require a safe surface destination and at least one hit", () => {
  assert.equal(
    normalizeGenerativeUiResource({
      ...chatResource,
      data: { ...chatResource.data, surface: "admin" },
    }),
    null,
  );
  assert.equal(
    normalizeGenerativeUiResource({
      ...chatResource,
      data: { ...chatResource.data, chats: [] },
    }),
    null,
  );
  assert.equal(
    normalizeGenerativeUiResource({
      ...chatResource,
      data: {
        ...chatResource.data,
        surface: "garden_chat",
        gardenSlug: "../../admin",
        chats: [{ ...chatResource.data.chats[0], id: "12" }],
      },
    }),
    null,
  );

  const garden = chatSearchResourceFromHits({
    id: "chat-search:garden",
    query: "Fourier",
    createdAt: "2026-09-01T10:00:00.000Z",
    surface: "garden_chat",
    gardenSlug: "signal-processing",
    hits: [{
      id: "42",
      title: "Fourier series",
      updatedAt: "2026-08-30T08:00:00.000Z",
      pinned: false,
      matchedOn: "title",
      snippet: "",
    }],
  });
  assert.ok(garden);
  assert.equal(garden.data.gardenSlug, "signal-processing");
});

test("Hermes receives direct private chat search on signed-in chat surfaces", () => {
  assert.ok(allowedToolsForSurface("dashboard_terminal").includes("chat_search"));
  assert.ok(allowedToolsForSurface("garden_chat").includes("chat_search"));
  assert.ok(!allowedToolsForSurface("quartz_ai").includes("chat_search"));

  const decision = {
    mode: "knowledge",
    requestedOutcome: "Find an earlier chat",
    implementationRequired: false,
    decisionReason: "Knowledge task",
    decisionSource: "breadboard_server_policy_v1",
    authorizedRoots: [],
    authorizedPathPatterns: [],
    allowedTools: ["chat_search"],
    allowedOperations: ["knowledge_work"],
    allowedCommandPatterns: [],
    selectedConditionalSkills: [],
    selectedConnections: [],
    createdAt: "2026-09-01T10:00:00.000Z",
    expiresAt: null,
    revokedAt: null,
  };
  const prompt = composeHermesSystemPrompt({
    surface: "dashboard_terminal",
    decision,
    userText: "Where is the chat where we discussed Kirchhoff's laws?",
  });
  assert.match(prompt, /# native_chat_search/);
  assert.match(prompt, /call `chat_search`/i);
  assert.match(prompt, /compact chat-navigation widget/i);
});

test("the chat search tool excludes its current prompt and renders safe app routes", () => {
  const route = source("../src/app/api/hermes/tools/chat-search/route.ts");
  const renderer = source("../src/app/components/hermes/generative-ui-renderer.tsx");
  const widget = source("../src/app/components/hermes/chat-search-results.tsx");

  assert.match(route, /WHERE user_id = \? AND temporary = 0 AND surface = \? AND id <> \?/);
  assert.match(route, /default_garden_id = \? AND legacy_chat_session_id IS NOT NULL/);
  assert.match(route, /tokenAllows\(verified\.token, \{ tool: "chat_search" \}\)/);
  assert.match(route, /uiResources: uiResource \? \[uiResource\] : \[\]/);
  assert.match(renderer, /case "chat-search-results"/);
  assert.match(widget, /\/dashboard\?terminalChat=/);
  assert.match(widget, /\/gardens\/\$\{encodeURIComponent\(resource\.data\.gardenSlug\)\}\?chat=/);
  assert.doesNotMatch(widget, /dangerouslySetInnerHTML|eval\(|new Function/);
});
