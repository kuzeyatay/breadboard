import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Skills uses the live compact catalog with every required view", () => {
  const ui = read("src/app/components/hermes/skills-catalog-panel.tsx");
  const cache = read("src/lib/hermes/skills-catalog-client-cache.ts");
  assert.match(ui, /Search every public skill/);
  assert.match(ui, /"all"[\s\S]*"featured"[\s\S]*"scientific"[\s\S]*"coding"[\s\S]*"trending"[\s\S]*"hot"[\s\S]*"official"[\s\S]*"installed"[\s\S]*"updates"[\s\S]*"audited"[\s\S]*"unreviewed"/);
  assert.match(cache, /\/api\/hermes\/skills\?/);
  assert.match(cache, /\/api\/hermes\/skills\/search/);
  assert.match(ui, /loadCachedSkillsCatalog/);
  assert.match(ui, /Previous[\s\S]*Next/);
  assert.match(ui, /divide-y divide-\[var\(--line\)\]/);
});

test("Skills exposes one compact accessible filter menu with OpenCode and review views", () => {
  const ui = read("src/app/components/hermes/skills-catalog-panel.tsx");
  assert.match(ui, /<FilterIcon \/>/);
  assert.match(ui, /aria-haspopup="menu"/);
  assert.match(ui, /aria-expanded=\{filterMenuOpen\}/);
  assert.match(ui, /aria-controls=\{filterMenuId\}/);
  assert.match(ui, /role="menu"/);
  assert.match(ui, /role="menuitemradio"/);
  assert.match(ui, /aria-checked=\{selectedFilter\}/);
  assert.doesNotMatch(ui, /role="tablist"[\s\S]*Skill catalog views/);
  assert.match(ui, /\{ id: "coding", label: "OpenCode" \}/);
  assert.match(ui, /\{ id: "audited", label: "Audited" \}/);
  assert.match(ui, /\{ id: "unreviewed", label: "Unreviewed" \}/);
});

test("Skills has a persistent Recent view ordered by actual command-hub use", () => {
  const ui = read("src/app/components/hermes/skills-catalog-panel.tsx");
  const cache = read("src/lib/hermes/skills-catalog-client-cache.ts");
  const hub = read("src/app/components/hermes/command-hub.tsx");
  const catalogRoute = read("src/app/api/hermes/skills/route.ts");

  assert.match(ui, /\{ id: "recent", label: "Recent" \}/);
  assert.match(cache, /recentSkillIds\.forEach\(\(id\) => parameters\.append\("id", id\)\)/);
  assert.match(ui, /No recently used skills yet\./);
  assert.match(hub, /recentSkillIds=\{recentSkillIds\}/);
  assert.match(hub, /rememberRecent\(`skill:\$\{skill\.upstreamId\}`/);
  assert.match(hub, /localStorage\.setItem\(RECENTS_KEY/);
  assert.match(catalogRoute, /CatalogFilter \| "recent"/);
  assert.match(catalogRoute, /url\.searchParams[\s\S]*\.getAll\("id"\)/);
  assert.match(catalogRoute, /recentIds[\s\S]*\.flatMap\(\(id\)/);
});

test("Skills filter selection preserves search, resets paging, and filters search results locally", () => {
  const ui = read("src/app/components/hermes/skills-catalog-panel.tsx");
  const selection = ui.slice(ui.indexOf("function selectCatalogFilter"), ui.indexOf("function onFilterTriggerKeyDown"));
  assert.match(selection, /setFilter\(nextFilter\)/);
  assert.match(selection, /setPage\(0\)/);
  assert.doesNotMatch(selection, /setQuery/);
  assert.match(ui, /query\.trim\(\) && filter !== "all"[\s\S]*applyClientFilter\(nextSkills, filter, recentSkillIds\)/);
  assert.match(ui, /filter === "coding"[\s\S]*requiresOpenCode === true[\s\S]*eligible_coding_conditional/);
  assert.match(ui, /filter === "audited"[\s\S]*skill\.audits\?\.length/);
  assert.match(ui, /filter === "unreviewed"[\s\S]*skill\.reviewStatus === "unreviewed"/);
});

test("catalog routes keep metadata-only records inspectable and preserve pagination", () => {
  const catalogRoute = read("src/app/api/hermes/skills/route.ts");
  const searchRoute = read("src/app/api/hermes/skills/search/route.ts");
  assert.match(catalogRoute, /isCatalogSkillInspectable\(skill\.classification\.classification\)/);
  assert.match(catalogRoute, /source:\s*filter === "scientific"\s*\? SCIENTIFIC_SKILLS_SOURCE/);
  assert.match(catalogRoute, /filter === "design"\s*\? DESIGN_SKILLS_SOURCE/);
  assert.match(catalogRoute, /total:\s*result\.total/);
  assert.match(
    catalogRoute,
    /filter === "coding"[\s\S]*eligible_coding_conditional[\s\S]*requiresOpenCode/,
  );
  assert.match(searchRoute, /isCatalogSkillInspectable\(classification\.classification\)/);
  assert.match(
    searchRoute,
    /requiresOpenCode:[\s\S]*eligible_coding_conditional/,
  );
});

test("catalog rows hydrate descriptions automatically without requiring a detail click", () => {
  const ui = read("src/app/components/hermes/skills-catalog-panel.tsx");
  const descriptionsRoute = read("src/app/api/hermes/skills/descriptions/route.ts");
  assert.match(ui, /hydrateDescriptions\(nextSkills\)/);
  assert.match(ui, /\/api\/hermes\/skills\/descriptions/);
  assert.match(ui, /Loading description…/);
  assert.doesNotMatch(ui, /Open to load skill details/);
  assert.match(descriptionsRoute, /MAX_DESCRIPTION_BATCH = 6/);
  assert.match(descriptionsRoute, /store\.saveDescription\(upstreamId, detail\)/);
});

test("Skills rows have no decorative icon circles or permanent star glyphs", () => {
  const ui = read("src/app/components/hermes/skills-catalog-panel.tsx");
  const rowsStart = ui.indexOf('<ul role="listbox"');
  const rows = ui.slice(rowsStart, ui.indexOf("</ul>", rowsStart));
  assert.ok(rowsStart >= 0);
  assert.doesNotMatch(rows, /<svg|★|☆|sparkle|rounded-full/iu);
  assert.match(ui, /FavoriteBox/);
  assert.match(ui, /font-mono text-sm/);
});

test("Skills exposes synchronization, stale, offline, details, and explicit lifecycle actions", () => {
  const ui = read("src/app/components/hermes/skills-catalog-panel.tsx");
  assert.match(ui, /Showing a stale last-known-good catalog/);
  assert.match(ui, /Catalog refresh failed/);
  assert.match(ui, /Refresh/);
  assert.match(ui, /Upstream ID[\s\S]*Upstream hash[\s\S]*Approved hash[\s\S]*Install URL/);
  assert.match(ui, /Review for install/);
  assert.match(ui, /Approve and install/);
  assert.match(ui, /Review update/);
  assert.match(ui, /Remove/);
  assert.match(ui, /Open source/);
  assert.doesNotMatch(ui, /Available for inspection, not installation/);
  assert.match(ui, /Software implementation guidance/);
  assert.match(ui, /Coding agent required/);
  assert.match(ui, /availability === "needs_review"/);
});

test("clicked skills expose products, every prerequisite, and actionable setup", () => {
  const ui = read("src/app/components/hermes/skills-catalog-panel.tsx");
  const hub = read("src/app/components/hermes/command-hub.tsx");
  assert.match(ui, />Produces</);
  assert.match(ui, />Requirements</);
  assert.match(ui, /selected\.requirements[\s\S]*\.map\(\(item\)/);
  assert.match(ui, /connect_mcp[\s\S]*onOpenConnections/);
  assert.match(ui, /configure_environment[\s\S]*navigator\.clipboard\.writeText/);
  assert.match(ui, /onPrepareWithOpenCode\(selected, item\)/);
  assert.match(ui, /stays in the chat where it was generated/);
  assert.match(hub, /onPrepareWithOpenCode=[\s\S]*onSelectOpenCode\(\)[\s\S]*chooseCatalogSkill\(skill\)/);
});

test("Skills supports keyboard navigation, focus return, narrow widths, and theme variables", () => {
  const ui = read("src/app/components/hermes/skills-catalog-panel.tsx");
  assert.match(ui, /ArrowDown/);
  assert.match(ui, /ArrowUp/);
  assert.match(ui, /event\.key === "Home"/);
  assert.match(ui, /event\.key === "End"/);
  assert.match(ui, /event\.key === "Enter"/);
  assert.match(ui, /event\.key === "Escape"/);
  assert.match(ui, /filterTriggerRef\.current\?\.focus/);
  assert.match(ui, /selectedButtonRef\.current\?\.focus/);
  assert.match(ui, /sm:grid-cols-2/);
  assert.match(ui, /var\(--paper-raised\)/);
  assert.match(ui, /var\(--ink\)/);
});

test("using an installed skill inserts its qualified slash command without submitting", () => {
  const catalog = read("src/app/components/hermes/skills-catalog-panel.tsx");
  const hub = read("src/app/components/hermes/command-hub.tsx");
  assert.match(catalog, /onUse\(selected\)/);
  assert.match(hub, /token: skill\.slashCommand/);
  assert.match(hub, /onSelect\(/);
  assert.doesNotMatch(catalog, /requestSubmit|\.submit\(/);
});
