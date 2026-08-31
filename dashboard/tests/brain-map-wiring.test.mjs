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
const graphService = read("src/lib/profile/brain-graph.ts");
const gardenSource = read("src/lib/profile/brain-graph-sources/gardens.ts");
const overviewRoute = read("src/app/api/profile/brain-graph/route.ts");
const expandRoute = read("src/app/api/profile/brain-graph/expand/route.ts");
const publicProfile = read("src/app/profile/[username]/page.tsx");

test("the private profile deep-links a lazy Thought Topology without touching the public profile", () => {
  assert.match(profilePage, /initialBrainScope/);
  assert.match(profilePage, /rawTab === "knowledge" \|\| rawTab === "brain"/);
  assert.match(profileClient, /\["profile", "knowledge"\]/);
  assert.match(profileClient, /<BrainMapPanel/);
  // An organization-scoped map is still reachable — by link, and from the
  // map's own scope picker — but the profile no longer carries a third tab
  // that points at one.
  assert.doesNotMatch(profileClient, /OrganizationPanel/);
  assert.match(brainClient, /dynamic\(\(\) => import\("\.\/brain-map-canvas\.tsx"\)/);
  assert.match(brainClient, />Thought Topology</);
  assert.match(brainClient, /Private Thought Topology/);
  assert.doesNotMatch(publicProfile, /BrainMap|brain-graph|Knowledge Map/);
});

test("Thought Topology fetches start only inside the mounted tab and stale work is aborted", () => {
  assert.match(brainClient, /fetch\(`\/api\/profile\/brain-graph\?/);
  assert.match(brainClient, /fetchRef\.current\?\.abort\(\)/);
  assert.match(brainClient, /expansionRef\.current\?\.abort\(\)/);
  assert.match(brainClient, /mergeBrainGraphResponse/);
  assert.match(brainClient, /setSelectedIds\(\[\]\)/, "scope changes clear hidden selection state");
  assert.match(brainClient, /setSelectedEdgeId\(null\)/, "scope changes clear connection selection state");
  assert.match(brainClient, /chatDraftKey\("dashboard_terminal", null\)/);
  assert.doesNotMatch(brainClient, /<Inspector/);
  assert.doesNotMatch(brainClient, /GBrainClient|better-sqlite3|contentIndex\.json/);
});

test("the profile graph reads Thought Topology artifacts rather than the retired map", () => {
  assert.match(gardenSource, /readThoughtTopology/);
  assert.match(gardenSource, /kind: "folder"/);
  assert.match(gardenSource, /semanticRelation: edge\.relationType/);
  assert.match(gardenSource, /folderIdByTopologyId\.get\(page\.folderId\)/);
  assert.doesNotMatch(gardenSource, /scanClusterKnowledge|GBrainClient/);
  assert.doesNotMatch(graphService, /gbrainBrainSource|resolveGBrainConfig/);
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

test("the renderer uses the Thought Topology force and interaction model", () => {
  assert.match(renderer, /const QUARTZ_CHARGE = -230/);
  assert.match(renderer, /const QUARTZ_CENTER_STRENGTH = 0\.04/);
  assert.match(renderer, /const QUARTZ_LINK_DISTANCE = 165/);
  assert.match(renderer, /const QUARTZ_ALPHA_DECAY = 0\.018/);
  assert.match(renderer, /const QUARTZ_VELOCITY_DECAY = 0\.5/);
  assert.match(renderer, /forceSimulation/);
  assert.match(renderer, /new Application\(\)/);
  assert.match(renderer, /scaleExtent\(\[0\.25, 4\]\)/);
  assert.match(renderer, /hoveredId/);
  assert.match(renderer, /hoveredEdgeId/);
  assert.match(renderer, /onSelectEdge/);
  assert.match(renderer, /width: 14 \/ Math\.max/, "connections have a practical pointer target");
  assert.match(renderer, /restingWidth = 0\.8 \+ normalizedWeight \* 4\.4/, "weights visibly change line thickness");
  assert.match(renderer, /event\.button === 2/, "right drag changes a node's permanent home");
  assert.match(renderer, /returnTargets\.set\(state\.node\.id, \{/, "left drag springs home");
  assert.match(renderer, /lastRightClick/, "a second right click opens a node");
  assert.match(renderer, /profile-thought-topology-callout/, "details float with nodes and lines");
  assert.match(renderer, /katex\.render/, "floating details render formulas");
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
  assert.match(brainClient, /Show everything/);
  assert.doesNotMatch(brainClient, /Inspector/);
  assert.match(brainCanvas, /controllerRef\.current\?\.destroy\(\)/);
});
