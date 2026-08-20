import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const profilePage = read("src/app/profile/page.tsx");
const profileClient = read("src/app/profile/profile-client.tsx");
const brainClient = read("src/app/profile/brain-map-client.tsx");
const brainCanvas = read("src/app/profile/brain-map-canvas.tsx");
const renderer = read("src/lib/quartz-brain-graph/renderer.ts");
const overviewRoute = read("src/app/api/profile/brain-graph/route.ts");
const expandRoute = read("src/app/api/profile/brain-graph/expand/route.ts");
const publicProfile = read("src/app/profile/[username]/page.tsx");

test("the private profile deep-links a lazy Knowledge tab without touching the public profile", () => {
  assert.match(profilePage, /initialBrainScope/);
  assert.match(profilePage, /rawTab === "knowledge" \|\| rawTab === "brain"/);
  assert.match(profileClient, /\["profile", "knowledge"\]/);
  assert.match(profileClient, /<BrainMapPanel/);
  // An organization-scoped map is still reachable — by link, and from the
  // map's own scope picker — but the profile no longer carries a third tab
  // that points at one.
  assert.doesNotMatch(profileClient, /OrganizationPanel/);
  assert.match(brainClient, /dynamic\(\(\) => import\("\.\/brain-map-canvas\.tsx"\)/);
  assert.doesNotMatch(publicProfile, /BrainMap|brain-graph|Knowledge Map/);
});

test("Brain graph fetches start only inside the mounted tab and stale work is aborted", () => {
  assert.match(brainClient, /fetch\(`\/api\/profile\/brain-graph\?/);
  assert.match(brainClient, /fetchRef\.current\?\.abort\(\)/);
  assert.match(brainClient, /expansionRef\.current\?\.abort\(\)/);
  assert.match(brainClient, /mergeBrainGraphResponse/);
  assert.match(brainClient, /setSelectedIds\(\[\]\)/, "scope changes clear hidden inspector state");
  assert.match(brainClient, /setSelectedEdgeId\(null\)/, "scope changes clear connection inspector state");
  assert.match(brainClient, /chatDraftKey\("dashboard_terminal", null\)/);
  assert.doesNotMatch(brainClient, /GBrainClient|better-sqlite3|contentIndex\.json/);
});

test("authenticated APIs fail closed and forbid public caching", () => {
  for (const route of [overviewRoute, expandRoute]) {
    assert.match(route, /requireUserId\(\)/);
    assert.match(route, /buildBrainGraphAccessContext\(userId\)/);
    assert.match(route, /Cache-Control": "private, no-store/);
    assert.match(route, /Vary: "Cookie"/);
    assert.doesNotMatch(route, /searchParams\.get\(["']user(?:Id)?["']\)/);
  }
  assert.match(expandRoute, /rawDepth < 1 \|\| rawDepth > 2/);
  assert.doesNotMatch(expandRoute, /sourceId|authorizedSourceIds/);
});

test("the renderer keeps the current Quartz global-graph force and interaction model", () => {
  assert.match(renderer, /const QUARTZ_CHARGE = -230/);
  assert.match(renderer, /const QUARTZ_CENTER_STRENGTH = 0\.04/);
  assert.match(renderer, /const QUARTZ_LINK_DISTANCE = 165/);
  assert.match(renderer, /const QUARTZ_ALPHA_DECAY = 0\.018/);
  assert.match(renderer, /const QUARTZ_VELOCITY_DECAY = 0\.5/);
  assert.match(renderer, /forceSimulation/);
  assert.match(renderer, /new Application\(\)/);
  assert.match(renderer, /scaleExtent\(\[0\.25, 4\]\)/);
  assert.match(renderer, /hoveredId/);
  assert.match(renderer, /onSelectEdge/);
  assert.match(renderer, /width: 14/, "connections have a practical pointer target");
  assert.match(renderer, /event\.subject\.fx/);
  assert.match(renderer, /simulation\.alpha\(0\.28\)\.restart\(\)/);
  assert.match(renderer, /simulation\.stop\(\)/);
  assert.match(renderer, /resizeObserver\.disconnect\(\)/);
  assert.match(renderer, /app\.destroy\(true/);
  assert.doesNotMatch(renderer, /contentIndex|fetch\(/);
});

test("WebGL loss, reduced motion, cleanup, filters, and list fallback are first-class", () => {
  assert.match(renderer, /prefers-reduced-motion/);
  assert.match(renderer, /webglcontextlost/);
  assert.match(renderer, /webglcontextrestored/);
  assert.match(brainClient, /setFallback\(true\)/);
  assert.match(brainClient, /<GraphList/);
  assert.match(brainClient, /Explicit only/);
  assert.match(brainClient, /Find path/);
  assert.match(brainClient, /Selected connection endpoints/);
  assert.match(brainClient, /Show everything/);
  assert.match(brainCanvas, /controllerRef\.current\?\.destroy\(\)/);
});
