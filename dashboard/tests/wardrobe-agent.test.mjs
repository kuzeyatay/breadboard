// The Wardrobe agent's own coverage.
//
// The shared suites already walk every agent for the two promises that break
// silently (a card that survives a reload, artifacts bound to one chat). What is
// left is what only this agent has: a command whose input is the attachment tray
// rather than the sentence, a settings translation that must not leak the panel's
// vocabulary into a run, and — the part with the most room to drift — the fact
// that the runtime is somebody else's app. Its endpoints, its stage names and its
// review gates are read straight out of the clone here, so a pull that renames
// one fails the suite instead of the next import.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboard = path.resolve(here, "..");
const repositoryRoot = path.resolve(dashboard, "..");

const {
  WARDROBE_COMMAND,
  WARDROBE_AGENT_ID,
  WARDROBE_AGENT_NAME,
  DEFAULT_MAX_ITEMS_PER_PHOTO,
  DEFAULT_WARDROBE_REQUEST,
  parseWardrobeRequest,
  taskFromWardrobeCommand,
  wardrobeRunLabel,
  wardrobeUserMessage,
} = await import("../src/lib/wardrobe/identity.ts");

const { DEFAULT_WARDROBE_SETTINGS, requestDefaultsFrom, wardrobeSettingsFrom } = await import(
  "../src/lib/wardrobe/settings.ts"
);

const { summarizeImport } = await import("../src/lib/wardrobe/run-manager.ts");

const clone = path.join(repositoryRoot, "wardrobe");
const cloneApiSource = fs.readFileSync(
  path.join(clone, "scripts", "import-job-api.mjs"),
  "utf8",
);
const clientSource = fs.readFileSync(
  path.join(dashboard, "src", "lib", "wardrobe", "client.ts"),
  "utf8",
);
const serviceSource = fs.readFileSync(
  path.join(dashboard, "src", "lib", "wardrobe", "service.ts"),
  "utf8",
);
const bridgeSource = fs.readFileSync(
  path.join(dashboard, "src", "lib", "wardrobe", "bridge.ts"),
  "utf8",
);
const runsRouteSource = fs.readFileSync(
  path.join(dashboard, "src", "app", "api", "wardrobe", "runs", "route.ts"),
  "utf8",
);

// ── The command ──────────────────────────────────────────────────────

test("the token is recognised, and prose after it is direction", () => {
  assert.equal(WARDROBE_COMMAND, `/agents:${WARDROBE_AGENT_ID}`);
  assert.equal(WARDROBE_AGENT_NAME, "Wardrobe");
  assert.equal(
    taskFromWardrobeCommand("/agents:wardrobe keep the logo readable"),
    "keep the logo readable",
  );
  // A bare token is a complete request here — the photos are the input — so it
  // parses to an empty direction rather than to null.
  assert.equal(taskFromWardrobeCommand("/agents:wardrobe"), "");
  assert.equal(taskFromWardrobeCommand("  /agents:wardrobe   these are all coats "), "these are all coats");
  assert.equal(taskFromWardrobeCommand("/AGENTS:WARDROBE loud pattern"), "loud pattern");
  // Not this agent's message.
  assert.equal(taskFromWardrobeCommand("import my clothes"), null);
  assert.equal(taskFromWardrobeCommand("/agents:wardrobe-planner do a thing"), null);
  assert.equal(
    wardrobeUserMessage("keep the logo"),
    "/agents:wardrobe keep the logo",
  );
  assert.equal(wardrobeUserMessage("   "), "/agents:wardrobe");
});

test("a stacked token in front is preserved so the resolver still sees it", () => {
  assert.equal(taskFromWardrobeCommand("/skill:x /agents:wardrobe go"), null);
  const stacked = parseWardrobeRequest("/skill:hallmark make it nice");
  assert.equal(stacked.direction, "/skill:hallmark make it nice");
});

// ── Flags and defaults ───────────────────────────────────────────────

test("flags are read out of the message and the rest stays as direction", () => {
  const request = parseWardrobeRequest("--items 3 keep the buttons --quality medium");
  assert.equal(request.maxItemsPerPhoto, 3);
  assert.equal(request.quality, "medium");
  assert.equal(request.direction, "keep the buttons");
});

test("a flag in the message beats the stored default", () => {
  const defaults = requestDefaultsFrom(
    wardrobeSettingsFrom({ maxItemsPerPhoto: 8, quality: "low" }),
  );
  assert.equal(parseWardrobeRequest("", defaults).maxItemsPerPhoto, 8);
  assert.equal(parseWardrobeRequest("--items 2", defaults).maxItemsPerPhoto, 2);
  assert.equal(parseWardrobeRequest("--quality high", defaults).quality, "high");
});

test("out-of-range and unknown values fall back rather than reaching the provider", () => {
  assert.equal(parseWardrobeRequest("--items 99").maxItemsPerPhoto, 8);
  assert.equal(parseWardrobeRequest("--items 0").maxItemsPerPhoto, 1);
  // An unrecognised quality is left in the direction, not sent as a setting.
  const request = parseWardrobeRequest("--quality gorgeous");
  assert.equal(request.quality, DEFAULT_WARDROBE_REQUEST.quality);
  assert.equal(request.direction, "--quality gorgeous");
  assert.deepEqual(wardrobeSettingsFrom({ quality: "ultra" }), DEFAULT_WARDROBE_SETTINGS);
  assert.deepEqual(wardrobeSettingsFrom(null), DEFAULT_WARDROBE_SETTINGS);
  assert.equal(DEFAULT_WARDROBE_SETTINGS.maxItemsPerPhoto, DEFAULT_MAX_ITEMS_PER_PHOTO);
});

test("there is no modeled switch, because one could only throw away a paid-for photo", () => {
  // Approving a cutout is what both files the piece and starts the modeled shot,
  // so a "skip the modeled photo" flag would arrive after the cost. Asserted
  // rather than commented: it is the reason the setting is absent.
  assert.equal("modeled" in parseWardrobeRequest("--modeled"), false);
  assert.equal(parseWardrobeRequest("--modeled").direction, "--modeled");
});

// ── The transcript label ─────────────────────────────────────────────

test("the run label says how many photos there were, and any direction", () => {
  assert.equal(wardrobeRunLabel({ photos: 1, direction: "" }), "1 photo");
  assert.equal(wardrobeRunLabel({ photos: 4, direction: "" }), "4 photos");
  assert.equal(
    wardrobeRunLabel({ photos: 2, direction: "keep the logo" }),
    "2 photos · keep the logo",
  );
  assert.ok(wardrobeRunLabel({ photos: 2, direction: "x".repeat(400) }).length <= 120);
});

// ── The written result ───────────────────────────────────────────────

test("the summary names every piece and never implies a rollback", () => {
  const summary = summarizeImport({
    imported: [
      { itemId: "import-1", name: "Navy Cardigan", part: "wholebody_up", color: "#172033", modeled: true, artifactIds: ["a", "b"] },
      { itemId: "import-2", name: "White Tee", part: "upperbody", color: "#ffffff", modeled: false, artifactIds: ["c"] },
    ],
    skipped: [{ name: "Scarf", reason: "the cutout could not be generated" }],
    galleryUrl: "http://127.0.0.1:5173",
    artifactsAvailable: true,
  });
  assert.match(summary, /2 pieces added to your wardrobe, 1 with a modeled photo\./);
  assert.match(summary, /Navy Cardigan\*\* — outer layer/);
  assert.match(summary, /White Tee\*\* — top, #ffffff \(cutout only\)/);
  assert.match(summary, /Left out: Scarf \(the cutout could not be generated\)\./);
  assert.match(summary, /http:\/\/127\.0\.0\.1:5173/);
});

test("a failure to save the pictures is said out loud rather than passing silently", () => {
  const summary = summarizeImport({
    imported: [
      { itemId: "import-1", name: "Tee", part: "upperbody", color: "#fff", modeled: true, artifactIds: [] },
    ],
    skipped: [],
    galleryUrl: "http://127.0.0.1:5173",
    artifactsAvailable: false,
  });
  assert.match(summary, /could not be saved to this chat's artifacts/);
});

test("an empty import says which of the two things happened", () => {
  assert.match(
    summarizeImport({ imported: [], skipped: [], galleryUrl: "", artifactsAvailable: true }),
    /No clothing was found/,
  );
  assert.match(
    summarizeImport({
      imported: [],
      skipped: [{ name: "Coat", reason: "the cutout could not be generated" }],
      galleryUrl: "",
      artifactsAvailable: true,
    }),
    /Nothing was added to the wardrobe\./,
  );
});

// ── The protocol boundary ────────────────────────────────────────────
//
// The runtime is the clone's own Vite plugin. Both halves are JavaScript but
// neither imports the other, so nothing would fail to compile if upstream
// renamed a route or a stage — the import would simply stop working. These read
// the clone.

test("every endpoint the client calls exists in the clone", () => {
  assert.match(cloneApiSource, /const API_ROOT = "\/api\/import\/jobs"/);
  assert.match(cloneApiSource, /"\/api\/import\/config"/);
  assert.match(cloneApiSource, /"\/api\/import\/wardrobe"/);
  assert.match(cloneApiSource, /\/\^\\\/api\\\/import\\\/jobs\\\//);
  for (const path of ["/api/import/config", "/api/import/jobs", "/api/import/wardrobe"]) {
    assert.ok(clientSource.includes(path), `the client no longer calls ${path}`);
  }
});

test("the three stages and the two decisions are the clone's own", () => {
  assert.match(cloneApiSource, /const STAGES = new Set\(\["crop", "garment", "modeled"\]\)/);
  assert.match(cloneApiSource, /const DECISIONS = new Set\(\["approve", "reject"\]\)/);
  assert.match(
    cloneApiSource,
    /action\.match\(\/\^stages\\\/\(crop\|garment\|modeled\)\\\/\(approve\|reject\|regenerate\)\$\/\)/,
  );
  assert.match(clientSource, /StageName = "crop" \| "garment" \| "modeled"/);
  assert.match(clientSource, /stages\/\$\{stage\}\/\$\{decision\}/);
});

test("approving the cutout is what files the piece, and it starts the modeled shot", () => {
  // The whole driving order rests on these two lines of the clone.
  assert.match(cloneApiSource, /await persistImported\(job, stageName === "modeled"\)/);
  assert.match(
    cloneApiSource,
    /const startModeled = stageName === "garment" && decision === "approve"/,
  );
});

test("the clone still gates every import on an identity photo", () => {
  // This is why the agent's health check requires one: without it the very first
  // POST is refused, so it is not an optional nicety on the modeled stage.
  assert.match(cloneApiSource, /ready: hasApiKey && hasModelReference/);
  assert.match(cloneApiSource, /if \(!setup\.ready\)/);
});

test("the clone still reads its model layer from OPENAI_API_BASE_URL", () => {
  // The bridge only works because both calls go through this one setting.
  assert.match(cloneApiSource, /setting\("OPENAI_API_BASE_URL", "https:\/\/api\.openai\.com\/v1"\)/);
  assert.match(cloneApiSource, /fetch\(`\$\{baseUrl\}\/images\/edits`/);
  assert.match(cloneApiSource, /fetch\(`\$\{baseUrl\}\/responses`/);
  assert.match(serviceSource, /OPENAI_API_BASE_URL: bridge\.baseUrl/);
  assert.match(serviceSource, /OPENAI_API_KEY: bridge\.apiKey/);
});

test("the bridge serves the endpoint the clone posts to, and forwards the rest", () => {
  assert.match(bridgeSource, /path === "\/images\/edits"/);
  // `image[]` is the clone's own field name for the reference list.
  assert.match(cloneApiSource, /form\.append\("image\[\]"/);
  assert.match(bridgeSource, /form\.getAll\("image\[\]"\)/);
  // The clone reads `data[0].b64_json`, so that is the shape the bridge answers.
  assert.match(cloneApiSource, /result\.data\?\.\[0\]\?\.b64_json/);
  assert.match(bridgeSource, /b64_json: generated\.buffer\.toString\("base64"\)/);
  // Everything else is relayed, which is what keeps `/responses` on ChatMock.
  assert.match(bridgeSource, /await forward\(request, raw, upstreamUrl, path, response\)/);
});

test("the bridge refuses a caller without its own token", () => {
  assert.match(bridgeSource, /if \(bearer\(request\) !== apiKey\)/);
  assert.match(bridgeSource, /randomBytes\(24\)/);
  assert.match(bridgeSource, /server\.listen\(0, "127\.0\.0\.1"/);
});

// ── The run route ────────────────────────────────────────────────────

test("the run route refuses a message with no photos, and one with no setup", () => {
  assert.match(runsRouteSource, /await requireUserId\(\)/);
  assert.match(runsRouteSource, /parseChatAttachments\(body\.attachments\)/);
  assert.match(runsRouteSource, /error: "no_photos"/);
  assert.match(runsRouteSource, /error: "wardrobe_unavailable"/);
  // ChatMock is resolved rather than read from the environment, or the
  // desktop/host split breaks.
  assert.match(runsRouteSource, /resolveChatmockBaseUrl\(request\)/);
  // Stored defaults are read, and the message still wins over them.
  assert.match(runsRouteSource, /agentSettingsFor\(userId, WARDROBE_AGENT_ID\)/);
  assert.match(runsRouteSource, /parseWardrobeRequest\(task, requestDefaultsFrom\(settings\)\)/);
});

test("the agent is registered everywhere a run has to be found again", async () => {
  const { EXTERNAL_AGENT_RUN_KINDS, EXTERNAL_AGENT_RUN_FIELD_BY_KIND, parseExternalAgentRun } =
    await import("../src/lib/conversations/external-agent-runs.ts");
  assert.ok(EXTERNAL_AGENT_RUN_KINDS.includes("wardrobe"));
  assert.equal(EXTERNAL_AGENT_RUN_FIELD_BY_KIND.wardrobe, "wardrobeRun");
  assert.deepEqual(
    parseExternalAgentRun({ kind: "wardrobe", runId: "wdrun_1", task: "3 photos" }),
    { kind: "wardrobe", runId: "wdrun_1", task: "3 photos" },
  );
  // A malformed row must not break an otherwise healthy transcript.
  assert.equal(parseExternalAgentRun({ kind: "wardrobe", runId: "wdrun_1" }), null);
  assert.equal(parseExternalAgentRun({ kind: "wardrobe", task: "3 photos" }), null);

  const cancelSource = fs.readFileSync(
    path.join(dashboard, "src", "lib", "conversations", "external-agent-cancel.ts"),
    "utf8",
  );
  assert.match(cancelSource, /wardrobe: async \(userId, runId\) =>/);
  assert.match(cancelSource, /import\("\.\.\/wardrobe\/run-manager\.ts"\)\)\.abortRun/);
});
