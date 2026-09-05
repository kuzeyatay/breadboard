import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("the learning map owns the single Explore action", () => {
  const graph = read("src/app/components/knowledge-graph.tsx");
  const workspace = read("src/app/gardens/[clusterSlug]/workspace-client.tsx");

  assert.match(graph, />\s*Explore\s*</);
  assert.match(graph, /aria-label="Explore"/);
  assert.match(graph, /import LinkContextMenu from ['"]\.\/link-context-menu['"]/);
  assert.match(
    graph,
    /<LinkContextMenu\s+href=\{graphHref\(clusterSlug\)\}\s+label="Explore learning map"\s*>[\s\S]*?aria-label="Explore"[\s\S]*?<\/LinkContextMenu>/,
    "the Explore target should expose the shared link context menu",
  );
  assert.match(
    graph,
    /px-3 py-1\.5 text-xs font-medium[\s\S]*?>\s*Explore\s*</,
    "the Explore button should use the larger compact-button sizing",
  );
  assert.match(
    graph,
    /graph\.nodes\.length === 0 \? \([\s\S]*?\) : \([\s\S]*?<\/>\s*\)\}\s*<LinkContextMenu[\s\S]*?aria-label="Explore"/,
    "the Explore action should remain outside the empty/non-empty preview branches",
  );
  assert.doesNotMatch(graph, /Open Quartz|Open Quartz Learning Map/);
  assert.doesNotMatch(workspace, />\s*Explore\s*</);
});

test("the collapsed learning-map rail has a working open button", () => {
  const graph = read("src/app/components/knowledge-graph.tsx");

  assert.match(
    graph,
    /<button\s+type="button"\s+onClick=\{map\.toggle\}\s+aria-label="Open learning map"/,
  );
  assert.doesNotMatch(
    graph,
    /\{resizeHandle\}\s*<svg[\s\S]*?d="M3\.75 5\.25h16\.5M3\.75 12h16\.5M3\.75 18\.75h16\.5M8\.25 8\.25 4\.5 12l3\.75 3\.75"/,
  );
});

test("the Quartz preview preserves the browser host and reports real canvas readiness", () => {
  const route = read("src/app/api/quartz-graph-preview/route.ts");
  const graph = read("src/app/components/knowledge-graph.tsx");
  const quartzGraph = read(
    "../quartz/quartz/components/scripts/graph.inline.ts",
  );
  const quartzTheme = read(
    "../quartz/quartz/components/scripts/darkmode.inline.ts",
  );

  assert.match(route, /request\.headers\.get\('host'\)/);
  assert.match(route, /browserRequestOrigin\(request\)/);
  assert.match(route, /graph\.home-knowledge-graph > \.graph-outer canvas/);
  assert.match(route, /breadboard:quartz-graph-preview/);
  assert.match(
    route,
    /window\.parent\.document\.documentElement\.dataset\.theme/,
  );
  assert.match(route, /window\.localStorage\.setItem\("theme", theme\)/);
  assert.match(
    route,
    /requestedTheme === "dark" \|\| requestedTheme === "light"/,
  );
  assert.match(route, /classList\.add\("quartz-graph-preview"\)/);
  assert.match(route, /requestAnimationFrame\(\(\) => requestAnimationFrame/);
  assert.match(route, /config\.repelForce = Math\.max/);
  assert.match(route, /config\.fontSize = Math\.min/);
  assert.match(
    route,
    /const headInjection = \[\s*PREVIEW_THEME_SCRIPT,[\s\S]*PREVIEW_LAYOUT_SCRIPT,/,
  );
  assert.match(route, /config\.mode = topology\.mode/);
  assert.match(
    route,
    /thought_topology_enabled === 1 \? 'thought-topology' : 'links'/,
  );
  assert.match(route, /title\.match\(\/\\\.\[a-z0-9\]\{2,5\}\$\/i\)/);
  assert.match(graph, /embed: 'graph'/);
  assert.match(graph, /theme,/);
  assert.match(graph, /ref=\{previewHostRef\}/);
  assert.match(graph, /style=\{\{ height: previewHeight \}\}/);
  assert.match(graph, /new ResizeObserver\(resizePreview\)/);
  assert.doesNotMatch(graph, /block h-64/);
  assert.match(graph, /pointer-events-none/);
  assert.match(graph, /colorScheme: previewTheme \?\? 'light'/);
  assert.match(
    graph,
    /event\.source !== previewFrameRef\.current\?\.contentWindow/,
  );
  assert.match(
    graph,
    /previewStatus === 'ready' \? 'opacity-100' : 'opacity-0'/,
  );
  assert.match(graph, /Preview unavailable\./);
  assert.match(
    quartzGraph,
    /const height = Math\.max\(graph\.offsetHeight, 1\)/,
  );
  assert.match(quartzGraph, /isSparseOverview \? 68 : 44/);
  assert.match(quartzGraph, /function compactGraphLabel/);
  assert.match(quartzGraph, /compactGraphLabel\(n\.text\)/);
  // Thought Topology has its own renderer; the compact preview keeps only the
  // Garden, folder anchors, a few high-value pages, and the strongest bridges.
  assert.match(
    quartzGraph,
    /return renderThoughtTopology\(graph, fullSlug, cfg, topology/,
  );
  const topologyLayout = read(
    "../quartz/quartz/components/scripts/thoughtTopologyLayout.ts",
  );
  const topologyRenderer = read(
    "../quartz/quartz/components/scripts/thoughtTopologyRenderer.ts",
  );
  assert.match(topologyLayout, /edge\.structural/);
  assert.match(topologyLayout, /previewPageBudget \?\? 10/);
  assert.match(topologyLayout, /previewBridgeBudget \?\? 6/);
  assert.match(topologyRenderer, /quartz-graph-preview/);
  assert.match(topologyRenderer, /eventMode: interactive \? "static" : "none"/);
  assert.match(topologyRenderer, /const calloutRoot = interactive \?/);
  assert.match(
    topologyRenderer,
    /const sourceColor = node\.sourceKind \? colors\.source\[node\.sourceKind\] : null/,
  );
  assert.match(
    quartzTheme,
    /new URLSearchParams\(window\.location\.search\)\.get\("theme"\)/,
  );
  assert.doesNotMatch(graph, /setPreviewReady|Preparing preview/);
});

test("the Learning Map refreshes from server state even when the workspace is idle", () => {
  const graph = read("src/app/components/knowledge-graph.tsx");
  const graphRoute = read("src/app/api/knowledge-graph/route.ts");
  const previewRoute = read("src/app/api/quartz-graph-preview/route.ts");

  assert.match(graphRoute, /gardenContentFingerprint/);
  assert.match(graphRoute, /revisionOnly/);
  assert.match(graphRoute, /'Cache-Control': 'private, no-store'/);
  assert.match(graph, /MAP_PREVIEW_FRESHNESS_POLL_MS = 5_000/);
  assert.match(graph, /revisionOnly: '1'/);
  assert.match(graph, /\/api\/thought-topology\?clusterSlug=/);
  assert.match(graph, /asset: 'revision'/);
  assert.match(graph, /build\?\.contentFingerprint === gardenRevision/);
  assert.match(graph, /publishedRevision !== 'pending'/);
  assert.match(previewRoute, /asset === 'revision'/);
  assert.match(previewRoute, /publishedQuartzRevision/);
  assert.match(graph, /window\.setInterval\(checkFreshness/);
  assert.match(graph, /window\.addEventListener\('focus', checkFreshness\)/);
  assert.match(graph, /window\.addEventListener\('online', checkFreshness\)/);
  assert.match(graph, /document\.addEventListener\('visibilitychange', checkWhenVisible\)/);
  assert.match(graph, /refresh: hashString\(`\$\{refreshKey\}:\$\{serverRefreshKey\}`\)/);
  assert.match(
    graph,
    /src=\{quartzLease\.ready && previewFreshnessReady \? quartzPreviewUrl : undefined\}/,
  );
});

test("library pages bridge each scoped Garden into one aggregate Thought Topology", () => {
  const libraryClient = read("src/app/garden/library-garden-client.tsx");
  const quartzGraph = read(
    "../quartz/quartz/components/scripts/graph.inline.ts",
  );
  const topologyLayout = read(
    "../quartz/quartz/components/scripts/thoughtTopologyLayout.ts",
  );

  assert.match(
    libraryClient,
    /data\.type === ["']breadboard:thought-topology-request["']/,
  );
  assert.match(
    libraryClient,
    /\/api\/thought-topology\?clusterSlug=\$\{encodeURIComponent\(clusterSlug\)\}/,
  );
  assert.match(quartzGraph, /requestAggregateThoughtTopology/);
  assert.match(quartzGraph, /Promise\.all\(/);
  assert.match(
    quartzGraph,
    /url\.searchParams\.set\("clusterSlug", clusterSlug\)/,
  );
  assert.match(topologyLayout, /aggregateThoughtTopologies/);
  assert.match(
    topologyLayout,
    /preserves the visible hierarchy as library -> Garden -> folder\/page/,
  );
});

test("Thought Topology rebuilds stay backgrounded and the right sidebar is folder text only", () => {
  const quartzGraph = read(
    "../quartz/quartz/components/scripts/graph.inline.ts",
  );
  const topologyRenderer = read(
    "../quartz/quartz/components/scripts/thoughtTopologyRenderer.ts",
  );

  assert.match(quartzGraph, /rememberTopologyProgress/);
  assert.match(quartzGraph, /topologyIsBuilding\(topology\)/);
  assert.match(quartzGraph, /topologyHasCompleteConnections/);
  assert.match(quartzGraph, /lastCompleteTopologyByGraph/);
  assert.match(quartzGraph, /requestedTopologyResult\.mode === "unavailable"/);
  assert.match(quartzGraph, /window\.setTimeout\(poll, TOPOLOGY_POLL_MS\)/);
  assert.match(quartzGraph, /await renderGraph\(graph, fullSlug\)/);
  assert.match(quartzGraph, /graphRoot\.dataset\.activeMode = "topology-pending"/);
  assert.match(quartzGraph, /topology\.sourceRevision !== "pending"/);
  assert.match(
    topologyRenderer,
    /folderLabelsOnly = !isGlobalGraph && Boolean\(graph\.closest\("\.right\.sidebar"\)\)/,
  );
  assert.match(topologyRenderer, /nodeLayer\.visible = !folderLabelsOnly/);
  assert.match(topologyRenderer, /linkLayer\.visible = !folderLabelsOnly/);
  assert.match(topologyRenderer, /preference: "webgl"/);
  assert.match(topologyRenderer, /webglcontextlost/);
  assert.match(topologyRenderer, /scheduleRecovery/);
  assert.match(topologyRenderer, /hideCallout\(\)/);
  assert.match(
    topologyRenderer,
    /folderLabelsOnly && node\.kind !== "folder"/,
  );
  assert.doesNotMatch(topologyRenderer, /waiting for its short explanation/);
});
