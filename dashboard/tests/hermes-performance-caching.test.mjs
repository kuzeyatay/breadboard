import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (relativePath) =>
  fs.readFileSync(new URL(`../src/${relativePath}`, import.meta.url), "utf8");

test("chat rails receive summaries and selected chats receive transcripts", () => {
  const listRoute = source("app/api/hermes/sessions/route.ts");
  const detailRoute = source("app/api/hermes/sessions/[sessionId]/route.ts");
  const presentation = source("lib/hermes/session-presentation.ts");
  const client = source("lib/hermes/session-client.ts");

  assert.match(listRoute, /presentHermesSessionSummary/);
  assert.doesNotMatch(listRoute, /listConversationMessages/);
  assert.match(detailRoute, /presentHermesSessionDetail/);
  assert.match(presentation, /listConversationMessages\(conversation\.id\)/);
  assert.match(client, /SUMMARY_TTL_MS = 5_000/);
  assert.match(client, /detailRequests/);
});

test("history polling is bounded, visibility-aware, and cannot overlap", () => {
  for (const file of [
    "app/components/hermes/dashboard-agent-terminal.tsx",
    "app/components/hermes/garden-agent-chat.tsx",
  ]) {
    const component = source(file);
    assert.match(component, /let inFlight = false/);
    assert.match(component, /document\.visibilityState === "hidden"/);
    assert.match(component, /10_000/);
    assert.doesNotMatch(component, /2_500/);
  }
});

test("stable model and capability catalogs are shared and prewarmed", () => {
  const models = source("lib/assistant-model-catalog-client.ts");
  const agency = source("lib/hermes/agency-agents-client.ts");
  const skills = source("lib/hermes/skills-catalog-client-cache.ts");
  const commandsRoute = source("app/api/hermes/commands/route.ts");
  const commandHub = source("app/components/hermes/command-hub.tsx");

  assert.match(models, /cachedRows/);
  assert.match(models, /inFlight/);
  assert.match(agency, /cached\.expiresAt > Date\.now\(\)/);
  assert.match(skills, /SKILLS_CATALOG_CACHE_TTL_MS = 5 \* 60_000/);
  assert.match(commandsRoute, /includeAgencyAgents: false/);
  assert.match(commandHub, /loadAgencyAgentsClientCatalog\(\{ force \}\)/);
  assert.match(commandHub, /loadCachedSkillsCatalog\(skillsCatalogUrl\(\{ surface \}\)\)/);
  assert.match(commandHub, /window\.setTimeout\(\(\) => \{/);
  assert.doesNotMatch(commandHub, /loadedOutcomeRef/);
});
