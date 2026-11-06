import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { canUseSkill, documentSkillAvailability, installedSkillCompatibility, querySkillLibrary } from "../src/lib/hermes/skill-library.ts";
import { skillsCatalogUrl } from "../src/lib/hermes/skills-catalog-client-cache.ts";

const summary = (id, name = id) => ({
  id, name, slug: id.split("/").at(-1), description: `${name} guidance`, source: "local",
  enabled: true, healthy: true, classification: "eligible_general", category: "knowledge",
  availability: "ready", unavailableReasons: [], capabilityContract: null, compatibilityRequirements: [],
});
const document = (slug, status = "ready", userId = 7) => ({
  slug, title: slug, status, userId, contentHash: "hash", updatedAt: "2026-11-06", chapterCount: 3,
  origin: { kind: "upload", fileName: `${slug}.pdf` }, error: status === "failed" ? "Extraction failed" : null,
});
const catalog = (id) => ({
  upstreamId: id, name: id, slug: id.split("/").at(-1), slashCommand: id.split("/").at(-1),
  source: "publisher/repo", sourceType: "community", description: `${id} guidance`, files: null,
  installationStatus: "installed", updateStatus: "update_available", reviewStatus: "approved",
  upstreamStatus: "available", approvedHash: "approved", upstreamHash: "upstream", localHash: "local",
  installs: 10, pageUrl: "https://example.com/skill", installUrl: null, detailCheckedAt: "now",
});

const stubs = {
  "next/server": "export const NextResponse = Response;",
  "@/lib/server-auth": "export const requireUserId = async () => globalThis.__skillLibraryTest.userId;",
  "@/lib/hermes/route-helpers.ts": "export const requireEnabled = () => {};",
  "@/lib/hermes/mcp-connections.ts": "export const listMcpConnections = () => [];",
  "@/lib/document-skills/store.ts": "export const listSkills = userId => globalThis.__skillLibraryTest.documents.filter(d => d.userId === userId);",
  "@/lib/hermes/skills.ts": `
    export const listFirstPartySkills = () => globalThis.__skillLibraryTest.firstParty;
    export const listInstalledLocalSkills = () => globalThis.__skillLibraryTest.local;
    export const classifySkill = () => ({classification: 'eligible_general', category: 'knowledge', reasons: []});
    export const isCatalogSkillInspectable = () => true;`,
  "@/lib/hermes/skill-compatibility.ts": "export const resolveSkillCompatibility = () => ({availability: 'ready', reasons: [], contract: null, requirements: []});",
  "@/lib/hermes/skills-catalog-store.ts": `export const getSkillsCatalogStore = () => ({
    list: ({filter, page, perPage}) => {
      if (filter !== 'installed') throw new Error('Unexpected discovery read');
      const all = globalThis.__skillLibraryTest.catalog;
      return { skills: all.slice(page * perPage, (page + 1) * perPage), hasMore: (page + 1) * perPage < all.length };
    }
  });`,
  "@/lib/hermes/skills-catalog-sync.ts": `
    export const catalogSyncInProgress = () => false;
    export const synchronizeSkillsCatalog = () => { throw new Error('Public catalog offline'); };
    export const revalidateSkillsCatalogInBackground = () => { throw new Error('Unexpected sync'); };`,
  "@/lib/hermes/local-skills-sources.ts": `
    export const SCIENTIFIC_SKILLS_SOURCE = 'scientific', REVERSE_SKILLS_SOURCE = 'reverse',
      DESIGN_SKILLS_SOURCE = 'design', OMH_SKILLS_SOURCE = 'omh', ENGINEERING_SKILLS_SOURCE = 'engineering', OFFICE_SKILLS_SOURCE = 'office';
    export const isReviewedLocalSource = () => false;
    export const synchronizeLocalSkillsCatalogs = () => { throw new Error('Library must not sync'); };`,
};
const bundle = await build({
  absWorkingDir: fileURLToPath(new URL("..", import.meta.url)),
  entryPoints: ["src/app/api/hermes/skills/route.ts"], bundle: true, write: false,
  platform: "node", format: "cjs", packages: "external",
  plugins: [{ name: "library-sources", setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => args.path in stubs ? { path: args.path, namespace: "fixture" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path] }));
  } }],
});
const routeModule = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), routeModule, routeModule.exports);
async function readLibrary(parameters = {}) {
  const response = await routeModule.exports.GET(new Request(`http://localhost/api/hermes/skills?${new URLSearchParams(parameters)}`));
  assert.equal(response.status, 200);
  return response.json();
}
function reset() {
  globalThis.__skillLibraryTest = {
    userId: 7, firstParty: [summary("builtin/diagram", "Diagram")],
    local: [summary("publisher/repo/writing", "Writing"), summary("local/research", "Research")],
    catalog: [catalog("publisher/repo/writing")],
    documents: [document("Book"), document("Building", "building"), document("Failed", "failed"), document("Private", "ready", 8)],
  };
  return globalThis.__skillLibraryTest;
}

test("My skills combines all owned sources while discovery is offline, without duplicates or other users' documents", async () => {
  reset();
  const result = await readLibrary();
  assert.equal(result.filter, "my");
  assert.equal(result.pagination.total, 6);
  assert.equal(new Set(result.skills.map(s => s.upstreamId)).size, 6);
  assert.equal(result.skills.some(s => s.name === "Private"), false);
  const installed = result.skills.find(s => s.upstreamId === "publisher/repo/writing");
  assert.equal(installed.updateStatus, "update_available");
  assert.equal(installed.pageUrl, "https://example.com/skill");
  assert.equal(canUseSkill(installed), true);
  assert.equal(canUseSkill(result.skills.find(s => s.name === "Book")), true);
  assert.equal(canUseSkill(result.skills.find(s => s.name === "Building")), false);
  assert.match(result.skills.find(s => s.name === "Failed").reasons[0], /Extraction failed/);
});

test("library search and totals cover every source and page", async () => {
  const state = reset();
  state.catalog = Array.from({ length: 105 }, (_, i) => catalog(`publisher/repo/entry-${i}`));
  state.local = state.catalog.map(s => summary(s.upstreamId));
  const first = await readLibrary({ q: "entry-", perPage: "60" });
  const second = await readLibrary({ q: "entry-", perPage: "60", page: "1" });
  assert.equal(first.pagination.total, 105);
  assert.equal(second.pagination.total, 105);
  assert.equal(first.skills.length, 60);
  assert.equal(second.skills.length, 45);
  assert.equal(first.pagination.hasMore, true);
  assert.equal(second.pagination.hasMore, false);
  assert.equal(new Set([...first.skills, ...second.skills].map(s => s.upstreamId)).size, 105);
  assert.equal((await readLibrary({ q: "diagram" })).skills[0].name, "Diagram");
  assert.equal((await readLibrary({ q: "book.pdf" })).skills[0].name, "Book");
});

test("Recent includes locally authored and document skills, and pinning orders before pagination", async () => {
  reset();
  const recent = await readLibrary(new URLSearchParams([['filter', 'recent'], ['id', 'document:Book'], ['id', 'local/research']]));
  assert.deepEqual(recent.skills.map(s => s.upstreamId), ["document:Book", "local/research"]);
  const pinned = await readLibrary({ pinnedId: "local/research", id: "document:Book", perPage: "1" });
  assert.equal(pinned.skills[0].upstreamId, "local/research");
  assert.equal(pinned.pagination.total, 6);
});

test("missing or modified installed files never advertise Use, and unsupported surfaces stay empty", async () => {
  const state = reset();
  state.local[0].healthy = false;
  const changed = (await readLibrary()).skills.find(s => s.upstreamId === "publisher/repo/writing");
  assert.equal(changed.availability, "needs_review");
  assert.equal(canUseSkill(changed), false);
  state.local = [];
  const missing = (await readLibrary()).skills.find(s => s.upstreamId === "publisher/repo/writing");
  assert.equal(missing.availability, "unavailable");
  assert.match(missing.reasons[0], /missing/);
  assert.equal((await readLibrary({ surface: "quartz_ai" })).skills.length, 0);
  assert.equal((await readLibrary({ filter: "documents", q: "Failed" })).skills[0].documentStatus, "failed");
});

test("library URLs keep scoped search, paging, recency, and pins out of the public search endpoint", () => {
  for (const filter of ["my", "installed", "documents", "recent"]) {
    const url = new URL(skillsCatalogUrl({ surface: "garden_chat", filter, query: "diagram", page: 2, recentSkillIds: ["one"], pinnedSkillIds: ["two"] }), "http://localhost");
    assert.equal(url.pathname, "/api/hermes/skills");
    assert.equal(url.searchParams.get("q"), "diagram");
    assert.equal(url.searchParams.get("page"), "2");
  }
  assert.match(skillsCatalogUrl({ surface: "garden_chat", filter: "all", query: "diagram" }), /skills\/search\?/);
});

test("availability and paging helpers preserve distinct identities and reject non-ready states", () => {
  for (const status of ["building", "failed", "ready"]) {
    assert.equal(canUseSkill({ installationStatus: "installed", ...documentSkillAvailability(status, null) }), status === "ready");
  }
  assert.equal(installedSkillCompatibility(undefined).availability, "unavailable");
  const skills = ["one/shared", "two/shared"].map(id => ({ ...summary(id), upstreamId: id, installationStatus: "installed" }));
  const result = querySkillLibrary({ skills, page: Infinity, perPage: NaN });
  assert.equal(result.pagination.total, 2);
  assert.equal(result.pagination.page, 0);
  assert.equal(result.pagination.perPage, 50);
});

test("skill details keep availability and routing tied to the reviewed local installation", async () => {
  const state = reset();
  const detailStubs = {
    ...stubs,
    "@/lib/hermes/route-helpers.ts": "export const requireEnabled = () => {}; export class ApiError extends Error {} export const apiErrorResponse = e => Response.json({error:e.message}, {status:500});",
    "@/lib/hermes/skills-sh-client.ts": "export class SkillsShClient {}",
    "@/lib/hermes/local-skills-sources.ts": stubs["@/lib/hermes/local-skills-sources.ts"].replace("throw new Error('Library must not sync');", "") + "\nexport const getLocalReviewedSkill = () => ({ detail: {}, binaryPaths: [], revision: '12345', label: 'fixture' });",
    "@/lib/hermes/skills-catalog-store.ts": "export const getSkillsCatalogStore = () => ({get: () => globalThis.__skillLibraryTest.catalog[0], saveDetail: () => globalThis.__skillLibraryTest.catalog[0]});",
  };
  const detailBundle = await build({
    absWorkingDir: fileURLToPath(new URL("..", import.meta.url)),
    entryPoints: ["src/app/api/hermes/skills/detail/route.ts"], bundle: true, write: false,
    platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "detail-sources", setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => args.path in detailStubs ? { path: args.path, namespace: "fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: detailStubs[args.path] }));
    } }],
  });
  const detailModule = { exports: {} };
  new Function("require", "module", "exports", detailBundle.outputFiles[0].text)(createRequire(import.meta.url), detailModule, detailModule.exports);
  const detail = async () => {
    const response = await detailModule.exports.GET(new Request("http://localhost/api/hermes/skills/detail?id=publisher/repo/writing"));
    assert.equal(response.status, 200);
    return (await response.json()).skill;
  };
  state.local[0].classification = "eligible_coding_conditional";
  state.local[0].slug = "qualified-writing";
  const ready = await detail();
  assert.equal(ready.requiresOpenCode, true);
  assert.equal(ready.command, "/qualified-writing");
  assert.equal(canUseSkill(ready), true);
  state.local[0].healthy = false;
  assert.equal((await detail()).availability, "needs_review");
  state.local = [];
  assert.equal((await detail()).availability, "unavailable");
});
