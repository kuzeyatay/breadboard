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
  assert.match(client, /prefetchHermesSessionDetail/);
  assert.match(client, /DETAIL_CACHE_FRESH_MS = 5_000/);
  assert.match(client, /detailFreshUntil\.get\(key\)/);
  assert.match(presentation, /const \{ metadata, \.\.\.presentedMessage \} = presented/);
  assert.match(presentation, /\.\.\.presentedMessage/);
  assert.doesNotMatch(presentation, /\.\.\.presented,/);
});

test("chat detail prefetch reuses cached and in-flight transcripts", async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let calls = 0;
  let now = 1_000;
  Date.now = () => now;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ session: { id: "prefetch-regression" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = await import("../src/lib/hermes/session-client.ts?prefetch-regression");
    const first = await client.prefetchHermesSessionDetail(
      "dashboard_terminal",
      "prefetch-regression",
    );
    const cached = await client.prefetchHermesSessionDetail(
      "dashboard_terminal",
      "prefetch-regression",
    );
    assert.equal(calls, 1);
    assert.strictEqual(cached, first);
    const opened = await client.loadHermesSessionDetail(
      "dashboard_terminal",
      "prefetch-regression",
      { reuseRecentPrefetch: true },
    );
    assert.equal(calls, 1);
    assert.strictEqual(opened, first);

    now += 5_001;
    const refreshed = await client.prefetchHermesSessionDetail(
      "dashboard_terminal",
      "prefetch-regression",
    );
    assert.equal(calls, 2, "an expired transcript must be fetched again");
    assert.notStrictEqual(refreshed, first);

    client.invalidateHermesSessionDetail("dashboard_terminal", "prefetch-regression");
    const selected = client.loadHermesSessionDetail(
      "dashboard_terminal",
      "prefetch-regression",
    );
    const joined = client.prefetchHermesSessionDetail(
      "dashboard_terminal",
      "prefetch-regression",
    );
    const [selectedResult, joinedResult] = await Promise.all([selected, joined]);
    assert.equal(calls, 3);
    assert.strictEqual(joinedResult, selectedResult);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
  }
});

test("local development defaults to Turbopack and history rows prefetch details", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  const terminal = source("app/components/hermes/dashboard-agent-terminal.tsx");
  const garden = source("app/components/hermes/garden-agent-chat.tsx");
  const sidebar = source("app/components/hermes/terminal-sidebar.tsx");

  assert.equal(packageJson.scripts.dev, "next dev");
  assert.equal(packageJson.scripts["dev:webpack"], "next dev --webpack");
  assert.match(terminal, /prefetchHermesSessionDetail\("dashboard_terminal", chat\.id\)/);
  assert.match(garden, /prefetchHermesSessionDetail\("garden_chat", item\.id\)/);
  assert.match(sidebar, /onMouseEnter=\{showIntent\}/);
  assert.match(sidebar, /onPointerDown=/);
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
