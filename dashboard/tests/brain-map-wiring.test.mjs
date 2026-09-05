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
const topologyAdapter = read("src/lib/quartz-brain-graph/topology-adapter.ts");
const renderer = read(
  "../quartz/quartz/components/scripts/thoughtTopologyRenderer.ts",
);
const rendererBridge = read("src/vendor/quartz-thought-topology/renderer.ts");
const generatedRenderer = read(
  "src/vendor/quartz-thought-topology/renderer.generated.js",
);
const rendererSync = read("scripts/sync-quartz-thought-topology.mjs");
const globals = read("src/app/globals.css");
const packageJson = read("package.json");
const graphService = read("src/lib/profile/brain-graph.ts");
const graphAuth = read("src/lib/profile/brain-graph-auth.ts");
const gardenSource = read("src/lib/profile/brain-graph-sources/gardens.ts");
const crossGardenSource = read("src/lib/profile/brain-graph-cross-garden.ts");
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
  assert.match(
    brainClient,
    /dynamic\(\(\) => import\("\.\/brain-map-canvas\.tsx"\)/,
  );
  assert.match(brainCanvas, />Thought Topology</);
  assert.match(brainCanvas, /Private Thought Topology/);
  assert.match(
    profilePage,
    /: "all";/,
    "the Knowledge tab opens at All accessible",
  );
  assert.doesNotMatch(publicProfile, /BrainMap|brain-graph|Knowledge Map/);
});

test("Thought Topology fetches start only inside the mounted tab and stale work is aborted", () => {
  assert.match(brainClient, /fetch\(`\/api\/profile\/brain-graph\?/);
  assert.match(brainClient, /fetchRef\.current\?\.abort\(\)/);
  assert.match(brainClient, /query\.set\("mode", "full"\)/);
  assert.match(brainClient, /setRendererFailed\(false\)/);
  assert.doesNotMatch(
    brainClient,
    /mergeBrainGraphResponse|expand\/\?|selectedIds/,
  );
  assert.doesNotMatch(brainClient, /<Inspector/);
  assert.doesNotMatch(
    brainClient,
    /GBrainClient|better-sqlite3|contentIndex\.json/,
  );
});

test("the profile graph reads Thought Topology artifacts rather than the retired map", () => {
  assert.match(gardenSource, /readThoughtTopology/);
  assert.match(gardenSource, /kind: "folder"/);
  assert.match(gardenSource, /semanticRelation: edge\.relationType/);
  assert.match(gardenSource, /folderIdByTopologyId\.get\(page\.folderId\)/);
  assert.match(gardenSource, /“\$\{garden\.name\}” is waiting/);
  assert.match(gardenSource, /Thought Topology for “\$\{garden\.name\}”/);
  assert.doesNotMatch(gardenSource, /scanClusterKnowledge|GBrainClient/);
  assert.doesNotMatch(graphService, /gbrainBrainSource|resolveGBrainConfig/);
});

test("Knowledge derives and refreshes semantic links across Garden boundaries", () => {
  assert.match(gardenSource, /readThoughtTopologyCache/);
  assert.match(gardenSource, /buildCrossGardenEdges/);
  assert.match(crossGardenSource, /left\.gardenSlug === right\.gardenSlug/);
  assert.match(crossGardenSource, /embeddingCentering/);
  assert.match(crossGardenSource, /MAX_LINKS_PER_NODE = 2/);
  assert.match(crossGardenSource, /semanticRelation: "cross-garden-related"/);
  assert.match(brainClient, /KNOWLEDGE_REFRESH_INTERVAL_MS = 30_000/);
  assert.match(brainClient, /window\.addEventListener\("focus", refresh\)/);
  assert.match(brainClient, /document\.addEventListener\("visibilitychange", refresh\)/);
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

test("Knowledge mounts the exact Quartz Thought Topology renderer and hierarchy", () => {
  assert.match(brainCanvas, /renderThoughtTopology/);
  assert.match(brainCanvas, /projectBrainGraphToQuartzTopology/);
  assert.match(brainCanvas, /@\/vendor\/quartz-thought-topology\/renderer/);
  assert.match(rendererBridge, /renderer\.generated\.js/);
  assert.match(
    generatedRenderer,
    /Generated from \.\.\/quartz\/quartz\/components\/scripts\/thoughtTopologyRenderer\.ts/,
  );
  assert.match(rendererSync, /thoughtTopologyRenderer\.ts/);
  assert.match(packageJson, /"predev": "npm run sync:quartz-topology"/);
  assert.match(packageJson, /"prebuild": "npm run sync:quartz-topology"/);
  assert.match(
    topologyAdapter,
    /Quartz's Thought Topology deliberately describes Gardens/,
  );
  assert.match(topologyAdapter, /"internal-concept"/);
  assert.match(topologyAdapter, /STRUCTURAL_RELATIONS/);
  assert.match(renderer, /planThoughtTopology/);
  assert.match(renderer, /forceSimulation/);
  assert.match(renderer, /new Application\(\)/);
  assert.match(renderer, /scaleExtent/);
  assert.match(renderer, /hoveredNodeId/);
  assert.match(renderer, /hoveredEdgeId/);
  assert.match(renderer, /selectEdge/);
  assert.match(
    renderer,
    /distanceToEdge/,
    "connections have a practical pointer target",
  );
  assert.match(
    renderer,
    /event\.button === 2/,
    "right drag changes a node's permanent home",
  );
  assert.match(
    renderer,
    /returnTargets\.set\(member\.view\.node\.id/,
    "left drag springs home",
  );
  assert.match(
    renderer,
    /openNodeInspector\(view\)/,
    "one right click opens node connections",
  );
  assert.match(
    renderer,
    /permanentHomeIds\.has\(view\.node\.id\)\) releaseNode\(view\)[\s\S]*else pinNode\(view\)/,
    "the second right click toggles fixed and free",
  );
  assert.match(
    renderer,
    /visibleConnectionsFor/,
    "the inspector reads the filtered render plan",
  );
  assert.match(
    renderer,
    /withoutEmptyLessonPagesNotice/,
    "empty lesson scaffolding is removed from inspector titles and summaries",
  );
  assert.doesNotMatch(renderer, /thought-inspector-tab/);
  assert.doesNotMatch(renderer, /thought-node-state/);
  assert.doesNotMatch(renderer, /thought-filter-state/);
  assert.match(
    renderer,
    /obscureOverlayClose\(true\)/,
    "only the inspector close control is visible while the drawer is open",
  );
  assert.match(
    renderer,
    /topologyNavigationSlug\(rawSlug\)/,
    "left click opens the published slug",
  );
  assert.match(
    renderer,
    /thought-callout/,
    "details float with nodes and lines",
  );
  assert.match(renderer, /katex\.render/, "floating details render formulas");
  assert.match(renderer, /simulation\.stop\(\)/);
  assert.match(renderer, /resizeObserver\?\.disconnect\(\)/);
  assert.match(
    renderer,
    /app\.destroy\(\{ removeView: true \}\)/,
    "re-mounts remove the old canvas",
  );
  assert.doesNotMatch(renderer, /contentIndex|fetch\(/);
});

test("Knowledge restores Quartz's top-right graph enlargement control", () => {
  assert.match(
    brainCanvas,
    /className=\{expanded \? "global-graph-close" : "global-graph-icon"\}/,
  );
  assert.match(
    brainCanvas,
    /aria-label=\{expanded \? "Close Graph" : "Expand Graph"\}/,
  );
  assert.match(brainCanvas, /event\.key === "Escape"/);
  assert.match(
    globals,
    /\.profile-quartz-topology > \.graph-outer\[data-expanded="true"\] \{[\s\S]*?position:\s*fixed;[\s\S]*?inset:\s*var\(--breadboard-titlebar-height, 0px\) 0 0;/,
  );
  assert.match(
    globals,
    /\.profile-quartz-topology > \.graph-outer > \.global-graph-icon \{[\s\S]*?top:\s*0;[\s\S]*?right:\s*0;/,
  );
});

test("the divergent profile controls are absent and only accessible scopes remain", () => {
  assert.match(renderer, /prefers-reduced-motion/);
  assert.match(brainCanvas, /destroy\?\.\(\)/);
  assert.match(brainClient, /option\.kind !== "personal"/);
  assert.match(graphAuth, /id: "all", kind: "all", label: "All accessible"/);
  assert.doesNotMatch(graphAuth, /label: "Personal"/);
  assert.doesNotMatch(
    brainClient,
    /Show everything|Explicit only|Find path|GraphList|brain-search/,
  );
  assert.doesNotMatch(brainClient, /Inspector/);
});
