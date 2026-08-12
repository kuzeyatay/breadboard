import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  COMMAND_RESPONSE_CACHE_TTL_MS,
  commandResponseUrl,
  invalidateCommandResponseCache,
  loadCachedCommandResponse,
  peekCachedCommandResponse,
} from "../src/lib/hermes/command-client-cache.ts";
import {
  AGENCY_AGENTS_CACHE_TTL_MS,
  invalidateAgencyAgentsClientCache,
  loadAgencyAgentsClientCatalog,
} from "../src/lib/hermes/agency-agents-client.ts";
import {
  SKILLS_CATALOG_CACHE_TTL_MS,
  invalidateSkillsCatalogCache,
  loadCachedSkillsCatalog,
  peekCachedSkillsCatalog,
  skillsCatalogUrl,
} from "../src/lib/hermes/skills-catalog-client-cache.ts";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const agencyPayload = {
  ok: true,
  agents: [
    {
      id: "agency-agent:engineering:frontend",
      slug: "frontend",
      name: "Frontend Developer",
      description: "Builds accessible interfaces.",
      division: "engineering",
      divisionLabel: "Engineering",
      divisionIcon: "Code",
      divisionColor: "#3B82F6",
      services: [],
      source: "Agency Agents",
    },
  ],
  divisions: [
    { slug: "engineering", label: "Engineering", icon: "Code", color: "#3B82F6" },
  ],
  configuration: { status: "ready", message: null },
};

test("capability responses are cached for five minutes and concurrent reads share one request", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ version: calls });
  };

  try {
    invalidateCommandResponseCache();
    assert.equal(COMMAND_RESPONSE_CACHE_TTL_MS, 5 * 60_000);
    const url = commandResponseUrl({
      surface: "dashboard_terminal",
      sessionId: "chat-1",
      requestedOutcome: "/",
    });
    assert.equal(
      url,
      "/api/hermes/commands?surface=dashboard_terminal&sessionId=chat-1",
      "a bare slash must reuse the warmed overview entry",
    );

    const [first, concurrent] = await Promise.all([
      loadCachedCommandResponse(url),
      loadCachedCommandResponse(url),
    ]);
    assert.deepEqual(first, { version: 1 });
    assert.deepEqual(concurrent, { version: 1 });
    assert.deepEqual(peekCachedCommandResponse(url), { version: 1 });
    assert.deepEqual(await loadCachedCommandResponse(url), { version: 1 });
    assert.equal(calls, 1);

    assert.deepEqual(
      await loadCachedCommandResponse(url, { force: true }),
      { version: 2 },
    );
    assert.equal(calls, 2);
  } finally {
    invalidateCommandResponseCache();
    globalThis.fetch = originalFetch;
  }
});

test("the Agency roster is cached and can be explicitly refreshed", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json(agencyPayload);
  };

  try {
    invalidateAgencyAgentsClientCache();
    assert.equal(AGENCY_AGENTS_CACHE_TTL_MS, 5 * 60_000);
    const [first, concurrent] = await Promise.all([
      loadAgencyAgentsClientCatalog(),
      loadAgencyAgentsClientCatalog(),
    ]);
    assert.equal(first.agents.length, 1);
    assert.equal(concurrent.agents.length, 1);
    assert.equal(calls, 1);
    await loadAgencyAgentsClientCatalog();
    assert.equal(calls, 1);
    await loadAgencyAgentsClientCatalog({ force: true });
    assert.equal(calls, 2);
  } finally {
    invalidateAgencyAgentsClientCache();
    globalThis.fetch = originalFetch;
  }
});

test("the default Skills page is prefetchable and cached independently", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ skills: [{ upstreamId: "prebuilt:direct" }], version: calls });
  };

  try {
    invalidateSkillsCatalogCache();
    assert.equal(SKILLS_CATALOG_CACHE_TTL_MS, 5 * 60_000);
    const url = skillsCatalogUrl({ surface: "dashboard_terminal" });
    assert.equal(
      url,
      "/api/hermes/skills?filter=all&page=0&perPage=50&surface=dashboard_terminal",
    );
    const [first, concurrent] = await Promise.all([
      loadCachedSkillsCatalog(url),
      loadCachedSkillsCatalog(url),
    ]);
    assert.deepEqual(first, concurrent);
    assert.equal(calls, 1);
    assert.equal(peekCachedSkillsCatalog(url).version, 1);
  } finally {
    invalidateSkillsCatalogCache();
    globalThis.fetch = originalFetch;
  }
});

test("invalidation does not let an older in-flight response replace fresh capability data", async () => {
  const originalFetch = globalThis.fetch;
  const responses = [];
  globalThis.fetch = () => new Promise((resolve) => responses.push(resolve));

  try {
    invalidateCommandResponseCache();
    const url = commandResponseUrl({ surface: "dashboard_terminal" });
    const staleRequest = loadCachedCommandResponse(url);
    invalidateCommandResponseCache(url);
    const freshRequest = loadCachedCommandResponse(url);
    assert.equal(responses.length, 2);

    responses[1](Response.json({ version: "fresh" }));
    assert.deepEqual(await freshRequest, { version: "fresh" });
    responses[0](Response.json({ version: "stale" }));
    assert.deepEqual(await staleRequest, { version: "stale" });
    assert.deepEqual(peekCachedCommandResponse(url), { version: "fresh" });
  } finally {
    invalidateCommandResponseCache();
    globalThis.fetch = originalFetch;
  }
});

test("the capability palette warms both catalogs and paints cached data before revalidation", () => {
  const hub = source("../src/app/components/hermes/command-hub.tsx");
  const skills = source("../src/app/components/hermes/skills-catalog-panel.tsx");

  assert.match(hub, /window\.setTimeout\(\(\) => \{[\s\S]{0,600}loadCachedCommandResponse<CommandResponse>\(preloadUrl\)/);
  assert.match(hub, /window\.setTimeout\(\(\) => \{[\s\S]{0,900}loadCachedSkillsCatalog\(skillsCatalogUrl\(\{ surface \}\)\)/);
  assert.match(hub, /window\.setTimeout\(\(\) => \{[\s\S]{0,800}void loadAgencyAgents\(\)/);
  assert.match(hub, /peekCachedCommandResponse<CommandResponse>\(paletteUrl\)/);
  assert.match(hub, /loadCachedCommandResponse<CommandResponse>\(paletteUrl, \{ force: true \}\)/);
  assert.match(hub, /onPointerEnter=\{warmPalette\}/);
  assert.match(hub, /onFocus=\{warmPalette\}/);
  assert.match(hub, /loadAgencyAgentsClientCatalog\(\{ force \}\)/);
  assert.match(skills, /peekCachedSkillsCatalog<CatalogResponse>\([\s\S]{0,100}skillsCatalogUrl\(\{ surface \}\)/);
  assert.match(skills, /force: force \|\| hadCachedResponse/);
});
