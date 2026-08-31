// The map tools, wired into the Hermes agent Breadboard already runs.
//
// The failure this file guards is the one this repo has hit before: a tool
// built on the Breadboard side but never registered with the runtime, so the
// model is never offered it. It also pins the architectural rule the whole
// feature rests on — the map is drawn from structured state, never parsed out
// of what the assistant wrote.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { MAP_TOOLS, allowedToolsForSurface } from "../src/lib/hermes/tool-scopes.ts";
import { BROKERED_TOOLS } from "../src/lib/hermes/capability-broker.ts";
import { MAP_OPERATIONS } from "../src/lib/map/operations.ts";
import { MAP_TOOL_NAMES } from "../src/lib/map/grounding.ts";
import { resolveMapConfig } from "../src/lib/map/config.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), "utf8");

const plugin = read("hermes-agent", "plugins", "breadboard", "__init__.py");
const manifest = read("hermes-agent", "plugins", "breadboard", "plugin.yaml");
const toolRoute = read(
  "dashboard", "src", "app", "api", "hermes", "tools", "map", "route.ts",
);
const mapClient = read("dashboard", "src", "app", "map", "map-client.tsx");
const inlineMap = read(
  "dashboard", "src", "app", "components", "hermes", "inline-conversation-map.tsx",
);
const runtimePanel = read(
  "dashboard", "src", "app", "components", "hermes", "agent-runtime-panel.tsx",
);
const systemPrompts = read("dashboard", "src", "lib", "hermes", "system-prompts.ts");
const turnService = read("dashboard", "src", "lib", "conversations", "turn-service.ts");
const eventStream = read("dashboard", "src", "lib", "hermes", "event-stream.ts");

/* ------------------------------------------------------------------ */
/* One tool list, everywhere                                           */
/* ------------------------------------------------------------------ */

test("the tool scope, the operations and the grounding list agree", () => {
  const expected = [
    "map_get_current_location",
    "map_get_selected_place",
    "map_get_viewport",
    "map_nearby",
    "map_place_details",
    "map_reverse",
    "map_route",
    "map_search",
  ];
  assert.deepEqual([...MAP_TOOLS].sort(), expected);
  assert.deepEqual([...MAP_OPERATIONS].sort(), expected);
  assert.deepEqual([...MAP_TOOL_NAMES].sort(), expected);
});

test("every map tool is registered with the runtime, in all three places", () => {
  const manifestEntries = manifest
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());

  for (const tool of MAP_TOOLS) {
    assert.ok(manifestEntries.includes(tool), `${tool} missing from plugin.yaml provides_tools`);
    assert.ok(plugin.includes(`"${tool}"`), `${tool} missing from _TOOLS in __init__.py`);
  }
  assert.ok(plugin.includes('"/api/hermes/tools/map"'), "the plugin has no map route");
  assert.ok(
    fs.existsSync(
      path.join(repoRoot, "dashboard", "src", "app", "api", "hermes", "tools", "map", "route.ts"),
    ),
    "the route the plugin posts to must exist",
  );
});

test('the "map" route kind carries a tool/args payload and its own timeout', () => {
  // An unrecognized route_kind falls through to a payload the map route does not
  // understand, which would only fail at call time.
  const payloadBlock = plugin.slice(
    plugin.indexOf("def _request_payload"),
    plugin.indexOf("def _call_breadboard"),
  );
  assert.match(payloadBlock, /"worldmonitor",\s*\n\s*"map",/);
  assert.match(plugin, /_MAP_REQUEST_TIMEOUT_SECONDS = \d+/);
  assert.match(plugin, /if route_kind == "map"/);
});

test("this is the existing Hermes agent, not a second one", () => {
  // The map tools live in the same plugin, behind the same loopback callback and
  // the same capability token as every other Breadboard tool.
  assert.ok(plugin.includes("BREADBOARD_HERMES_TOOL_SECRET"));
  assert.match(toolRoute, /capabilityForInternalToolRequest/);
  assert.match(toolRoute, /verifyCapabilityToken/);
  assert.match(toolRoute, /getActiveCapabilityDecision/);
  // No new runtime, process, or agent is started anywhere in the map feature.
  const mapLib = fs
    .readdirSync(path.join(repoRoot, "dashboard", "src", "lib", "map"), { recursive: true })
    .filter((entry) => String(entry).endsWith(".ts"))
    .map((entry) => read("dashboard", "src", "lib", "map", String(entry)))
    .join("\n");
  for (const forbidden of [
    "child_process",
    "spawn(",
    "startRun(",
    "new Hermes",
    "AgentRuntime",
  ]) {
    assert.ok(!mapLib.includes(forbidden), `the map service must not ${forbidden}`);
  }
});

test("the authenticated surfaces get them; anonymous Quartz never does", () => {
  const quartz = allowedToolsForSurface("quartz_ai");
  for (const tool of MAP_TOOLS) {
    assert.ok(!quartz.includes(tool), `quartz_ai must not receive ${tool}`);
  }
  for (const surface of ["garden_chat", "dashboard_terminal"]) {
    const allowed = allowedToolsForSurface(surface);
    for (const tool of MAP_TOOLS) {
      assert.ok(allowed.includes(tool), `${surface} should receive ${tool}`);
    }
  }
});

test("every map tool is brokered, so none can be inherited by default", () => {
  for (const tool of MAP_TOOLS) {
    assert.ok(BROKERED_TOOLS.includes(tool), `${tool} must be in BROKERED_TOOLS`);
  }
});

/* ------------------------------------------------------------------ */
/* Grounding, wired end to end                                         */
/* ------------------------------------------------------------------ */

test("the geographic grounding prompt ships with the tools it names", () => {
  const promptPath = path.join(repoRoot, "hermes-config", "system", "geographic-grounding.md");
  assert.ok(fs.existsSync(promptPath), "the system section must exist");
  const prompt = fs.readFileSync(promptPath, "utf8");
  assert.match(prompt, /# geographic_grounding/);
  for (const tool of MAP_TOOLS) {
    assert.ok(prompt.includes(tool), `the prompt should name ${tool}`);
  }
  assert.match(prompt, /Never invent/);
  assert.match(prompt, /could not be verified/);
  assert.match(prompt, /ask the user/i);
  assert.match(prompt, /mode: "auto"/);
  assert.match(plugin, /"enum": \["auto", "walking", "driving", "cycling"\]/);

  // Composed only when the tools are actually on the turn, and added to the
  // existing prompt rather than replacing any of it.
  assert.match(systemPrompts, /decision\.allowedTools\.includes\("map_search"\)/);
  assert.match(systemPrompts, /readSystemPrompt\("geographic-grounding"\)/);
  for (const section of ["assistant", "response-style", "meta-prompting"]) {
    assert.ok(
      systemPrompts.includes(`readSystemPrompt("${section}")`),
      `the existing ${section} section must still be composed`,
    );
  }
});

test("the requirement is decided before dispatch and judged after", () => {
  assert.match(turnService, /requiresGeographicGroundingInContext/);
  assert.match(turnService, /renderGeographicGroundingDirective\(geographicGrounding\)/);
  // Recorded on the durable run, so the finished answer is measured against an
  // obligation fixed before a word of it existed.
  assert.match(turnService, /geographicGrounding: \{\s*\n\s*required: true,/);
  assert.match(eventStream, /geographicGrounding\?\.required === true/);
  assert.match(eventStream, /geographicGroundingRequired: geographicGroundingRequired\(\)/);
});

test("a chat turn's own location reaches the map tools", () => {
  // Otherwise "what's near me" has no anchor unless the map page is open. It is
  // recorded only on a turn that renderCurrentLocationContext already accepted,
  // so an unrelated message never writes where the user is.
  assert.match(turnService, /if \(currentLocationContext && tools\.map_search === true\)/);
  assert.match(turnService, /recordCurrentLocation\(/);
  assert.match(turnService, /source: "device"/);
});

/* ------------------------------------------------------------------ */
/* The forbidden direction                                             */
/* ------------------------------------------------------------------ */

test("the map is drawn from state, never parsed out of assistant text", () => {
  // The specific shapes this architecture forbids.
  for (const forbidden of [
    "parseCoordinatesFromHermes",
    "extractRouteFromLLM",
    "guessPlaceFromHermesText",
    "assistantText",
    "message.content",
    "JSON.parse(response.content",
  ]) {
    assert.ok(!mapClient.includes(forbidden), `the map UI must not use ${forbidden}`);
  }
  // It reads the structured context and hands the router's own geometry to
  // MapLibre untouched.
  assert.match(mapClient, /\/api\/map\/context/);
  assert.match(mapClient, /geometry: route\.geometry/);
  assert.match(mapClient, /formatDistance\(route\.distanceMeters\)/);
  assert.match(mapClient, /formatDuration\(route\.durationSeconds\)/);
  // And nowhere does it compute a duration itself.
  assert.ok(!/durationSeconds\s*=\s*[^;]*distanceMeters/.test(mapClient));
});

test("directions and place recommendations render the native map in chat", () => {
  assert.match(runtimePanel, /inlineMapKindForAssistant/);
  assert.match(runtimePanel, /"route", "distance", "travel_time"/);
  assert.match(runtimePanel, /"recommendation", "proximity"/);
  assert.match(runtimePanel, /<InlineConversationMap/);
  assert.match(inlineMap, /\/api\/map\/context/);
  assert.match(inlineMap, /geometry: route\.geometry/);
  assert.match(inlineMap, /formatDistance\(route\.distanceMeters\)/);
  assert.match(inlineMap, /formatDuration\(route\.durationSeconds\)/);
  assert.match(inlineMap, /Turn-by-turn directions/);
  assert.match(inlineMap, /step\.instruction/);
  assert.match(inlineMap, /context\.nearbyPlaceIds/);
  assert.match(inlineMap, /retrievedForRequest/);
  assert.match(runtimePanel, /requestedAt=\{inlineMapRequestStartedAt\}/);
  assert.match(mapClient, /useState<RouteModePreference>\("auto"\)/);
  assert.match(mapClient, /automaticTravelMode\(context\.currentLocation, selectedPlace\)/);
  assert.match(inlineMap, /attributionControl: \{ compact: true \}/);
  assert.match(inlineMap, /classList\.remove\("maplibregl-compact-show"\)/);
  assert.match(mapClient, /attributionControl: \{ compact: false \}/);
  assert.match(inlineMap, /route\.origin\.name\} to \{route\.destination\.name/);
  assert.match(mapClient, /route\.origin\.name\} to \{route\.destination\.name/);
  assert.match(
    mapClient,
    /status === DEVICE_LOCATION_ERROR && context\?\.currentLocation/,
  );
  for (const forbidden of [
    "assistantText",
    "message.content",
    "parseCoordinates",
    "extractRoute",
  ]) {
    assert.ok(!inlineMap.includes(forbidden), `inline map must not use ${forbidden}`);
  }
});

test("delegated research evidence cannot trigger an inline map", () => {
  // Max Research hands findings back as a hidden user-role continuation. Map
  // intent and its freshness timestamp must remain anchored to what the person
  // actually asked, not phrases such as "close to failure" inside the report.
  assert.match(
    runtimePanel,
    /const userIndex = retryTargetUserMessageIndex\(messages, assistantIndex\)/,
  );
  assert.match(
    runtimePanel,
    /message\.role === "user" && message\.internalAgentContinuation !== true/,
  );
  assert.match(
    runtimePanel,
    /messages\[retryTargetUserMessageIndex\(messages, index\)\][\s\S]{0,40}\?\.createdAt/,
  );
});

test("map overlays keep literal white text in the light theme", () => {
  assert.equal(
    (inlineMap.match(/text-\[#fff\]/g) ?? []).length,
    5,
    "semantic text-white resolves to dark ink in the light theme",
  );
});

test("autocomplete is debounced and never aimed at public Nominatim", () => {
  const suggestRoute = read("dashboard", "src", "app", "api", "map", "suggest", "route.ts");
  const service = read("dashboard", "src", "lib", "map", "service.ts");
  // Typing goes through the forward geocoder, which is Photon by construction —
  // Nominatim's usage policy forbids keystroke-rate querying, and it is wired to
  // reverse and details instead.
  assert.match(service, /geocoder: photon/);
  assert.match(service, /reverseGeocoder: nominatim/);
  assert.match(suggestRoute, /mapSearch/);
  assert.ok(
    !suggestRoute.includes("NominatimGeocoder") &&
      !suggestRoute.includes("reverseGeocoder"),
    "the suggest path must not reach the reverse geocoder",
  );
  assert.match(mapClient, /SUGGEST_DEBOUNCE_MS = \d+/);
  assert.match(mapClient, /window\.setTimeout\(/);
  // And typing does not select a place, move "there", or replace the
  // conversation's last search.
  assert.ok(!suggestRoute.includes("recordSelectedPlace"));
  assert.ok(!suggestRoute.includes("recordSearchResults"));
});

test("the tool route hands back the map service's own result", () => {
  assert.match(toolRoute, /executeMapOperation/);
  // The failure sentence is preserved rather than flattened, so "I could not
  // verify that" stays available as an answer.
  assert.match(toolRoute, /MapServiceError/);
  assert.match(toolRoute, /error: error\.message/);
});

test("provider endpoints are configuration, not hardcoded call sites", () => {
  const config = resolveMapConfig({
    MAP_GEOCODER_URL: "http://127.0.0.1:2322",
    MAP_REVERSE_GEOCODER_URL: "http://127.0.0.1:8080/",
    MAP_ROUTER_URL: "http://127.0.0.1:8002",
    MAP_OVERPASS_URL: "http://127.0.0.1:12345/api/interpreter",
  });
  assert.equal(config.geocoderUrl, "http://127.0.0.1:2322");
  assert.equal(config.reverseGeocoderUrl, "http://127.0.0.1:8080");
  assert.equal(config.routerUrl, "http://127.0.0.1:8002");
  assert.equal(config.overpassUrl, "http://127.0.0.1:12345/api/interpreter");
  assert.equal(resolveMapConfig({ MAP_ENABLED: "false" }).enabled, false);

  const envExample = read(".env.example");
  for (const key of [
    "MAP_GEOCODER_URL",
    "MAP_REVERSE_GEOCODER_URL",
    "MAP_ROUTER_URL",
    "MAP_OVERPASS_URL",
  ]) {
    assert.ok(envExample.includes(key), `${key} should be documented in .env.example`);
  }
});

test("the map page is behind auth and reachable", () => {
  const proxy = read("dashboard", "src", "proxy.ts");
  assert.match(proxy, /'\/map\/:path\*'/);
  const page = read("dashboard", "src", "app", "map", "page.tsx");
  assert.match(page, /getServerSession/);
  assert.match(page, /redirect\("\/auth\/login\?callbackUrl=\/map"\)/);
  const inlineMap = read(
    "dashboard",
    "src",
    "app",
    "components",
    "hermes",
    "inline-conversation-map.tsx",
  );
  assert.match(inlineMap, /const mapHref = `\/map\?conversation=\$\{encodeURIComponent\(conversationPublicId\)\}`/);
  assert.match(inlineMap, /href=\{mapHref\}/);
});
