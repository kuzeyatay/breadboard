// God's Eye: the parts of a run that are decided before the clone is called,
// and the boundaries that fail silently when they drift.
//
// The first boundary is the clone. The whole integration stands on
// gods-eye-view's share-link hash — a run's answer is a set of URL parameters
// its `src/sharelink.js` restores a scene from — and nothing would fail to
// compile if upstream renamed one; the globe would just open somewhere else.
// So this file reads the clone and asserts the parameter names. The second is
// the view itself: a model writes it and a URL carries it, so the validator
// has to clamp and refuse rather than trust. The third is the event protocol
// between the run manager and the inline card.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  GODS_EYE_AGENT_ID,
  GODS_EYE_COMMAND,
  godsEyeRunLabel,
  godsEyeUserMessage,
  taskFromGodsEyeCommand,
} from "../src/lib/gods-eye/identity.ts";
import {
  attachGodsEyeView,
  godsEyeOpenPath,
  godsEyeShareHash,
  GODS_EYE_STYLES,
  normalizeGodsEyeView,
  parseGodsEyeResult,
} from "../src/lib/gods-eye/view.ts";
import {
  godsEyeSummary,
  parseViewAnswer,
} from "../src/lib/gods-eye/run-manager.ts";
import {
  resolveGodsEyeRoot,
  viteEntry,
} from "../src/lib/gods-eye/runtime.ts";
import { serviceEnvironment } from "../src/lib/gods-eye/service.ts";
import {
  EXTERNAL_AGENT_RUN_FIELD_BY_KIND,
  EXTERNAL_AGENT_RUN_KINDS,
  parseExternalAgentRun,
} from "../src/lib/conversations/external-agent-runs.ts";
import { RUNTIME_AGENT_PROFILES } from "../src/lib/hermes/capability-combinations.ts";
import { RUNTIME_AGENT_BRIEFS } from "../src/lib/hermes/runtime-agent-briefs.ts";

const dashboardRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");
const cloneRoot = path.join(dashboardRoot, "..", "gods-eye-view");
const cloneSource = (relative) => fs.readFileSync(path.join(cloneRoot, relative), "utf8");
const cloneAvailable = fs.existsSync(path.join(cloneRoot, "package.json"));

const VIEW = {
  label: "Istanbul",
  lat: 41.0082,
  lon: 28.9784,
  altM: 12_000,
  headingDeg: 0,
  pitchDeg: -35,
  style: "flir",
};

test("the command parser recognises the token, keeps stacked tokens, and leaves prose alone", () => {
  assert.equal(taskFromGodsEyeCommand("hello"), null);
  assert.equal(taskFromGodsEyeCommand("show flights over Istanbul"), null);
  assert.equal(taskFromGodsEyeCommand("/agents:gods-eye"), "");
  assert.equal(
    taskFromGodsEyeCommand("/agents:gods-eye  flights over Istanbul"),
    "flights over Istanbul",
  );
  assert.equal(
    taskFromGodsEyeCommand("/tokenjuice /agents:gods-eye ships off Rotterdam"),
    "/tokenjuice ships off Rotterdam",
  );
  assert.equal(godsEyeUserMessage(" x "), `${GODS_EYE_COMMAND} x`);
  assert.equal(godsEyeUserMessage("  "), GODS_EYE_COMMAND);
  assert.equal(godsEyeRunLabel(`${"a".repeat(130)}`).length, 118);
  assert.ok(godsEyeRunLabel(`${"a".repeat(130)}`).endsWith("…"));
});

test("the view validator clamps what it can and refuses what it cannot", () => {
  const view = normalizeGodsEyeView({ ...VIEW, altM: 3, pitchDeg: 40, headingDeg: 725 });
  assert.ok(view);
  assert.equal(view.altM, 120, "altitude clamps to the floor");
  assert.equal(view.pitchDeg, -5, "pitch clamps below the horizon");
  assert.equal(view.headingDeg, 5, "heading wraps into [0, 360)");
  assert.equal(view.style, "flir");

  assert.equal(normalizeGodsEyeView({ ...VIEW, lat: 91 }), null, "off-planet latitude refuses");
  assert.equal(normalizeGodsEyeView({ ...VIEW, lon: Number.NaN }), null);
  assert.equal(normalizeGodsEyeView(null), null);
  assert.equal(normalizeGodsEyeView([VIEW]), null);
  assert.equal(
    normalizeGodsEyeView({ ...VIEW, style: "matrix" })?.style,
    "normal",
    "an unknown style falls back rather than refusing the view",
  );
  assert.equal(
    normalizeGodsEyeView({ ...VIEW, label: "x".repeat(300) })?.label.length,
    120,
  );
});

test("the share hash speaks the clone's URL dialect", () => {
  const hash = godsEyeShareHash(VIEW);
  const params = new URLSearchParams(hash);
  assert.equal(params.get("lat"), "41.0082");
  assert.equal(params.get("lon"), "28.9784");
  assert.equal(params.get("alt"), "12000");
  assert.equal(params.get("heading"), "0");
  assert.equal(params.get("pitch"), "-35");
  assert.equal(params.get("style"), "flir");
  assert.equal(params.get("hud"), "tactical");
  assert.equal(params.get("hv"), "1");
  assert.equal(params.get("map"), "photoreal");
});

test("the clone still parses every parameter the hash carries", { skip: !cloneAvailable }, () => {
  const sharelink = cloneSource(path.join("src", "sharelink.js"));
  for (const name of ["lat", "lon", "alt", "heading", "pitch", "style", "hud", "hv", "map"]) {
    assert.match(
      sharelink,
      new RegExp(`params\\.get\\('${name}'\\)`),
      `the clone's sharelink.js no longer reads '${name}'`,
    );
  }
  // Every style token the validator can emit must be a URL style upstream knows.
  for (const style of GODS_EYE_STYLES) {
    assert.match(
      sharelink,
      new RegExp(`'${style}'`),
      `the clone's sharelink.js no longer knows the '${style}' style token`,
    );
  }
  // The open route suppresses the first-run card with ?welcome=0.
  assert.match(
    cloneSource(path.join("src", "firstRunExperience.js")),
    /welcome=0/,
    "the clone's first-run suppression query changed",
  );
});

test("the open path carries only validated view parameters", () => {
  const open = godsEyeOpenPath(VIEW);
  assert.ok(open.startsWith("/api/gods-eye/open?"));
  const params = new URLSearchParams(open.split("?")[1]);
  assert.equal(params.get("lat"), "41.0082");
  assert.equal(params.get("style"), "flir");
  assert.equal(params.get("label"), "Istanbul");
});

test("a summary carries its view invisibly and parses back losslessly", () => {
  const summary = godsEyeSummary({ view: VIEW, summary: "Watching approach traffic." });
  assert.match(summary, /On station over Istanbul/);
  assert.doesNotMatch(summary, /Open the live view|\/api\/gods-eye\/open\?/);
  const parsed = parseGodsEyeResult(summary);
  assert.ok(parsed.view);
  assert.equal(parsed.view.lat, VIEW.lat);
  assert.equal(parsed.view.style, "flir");
  assert.doesNotMatch(parsed.content, /GODS_EYE_VIEW/, "the marker never reaches Markdown");

  // The bare-marker legacy form (comment delimiters stripped by a handoff).
  const bare = attachGodsEyeView("body", VIEW).replace("<!--", "").replace("-->", "");
  const reparsed = parseGodsEyeResult(bare);
  assert.ok(reparsed.view);
  assert.doesNotMatch(reparsed.content, /GODS_EYE_VIEW/);

  const legacyLink = attachGodsEyeView(
    "The aircraft layer is live.\n\n[Open the live aircraft view](http://127.0.0.1:49781/api/gods-eye/open?lat=52.2\\&lon=5.3\\&alt=220000)",
    VIEW,
  ).replace("<!--GODS_EYE_VIEW:", "<!--\nGODS_EYE_VIEW:");
  const legacyParsed = parseGodsEyeResult(legacyLink);
  assert.equal(legacyParsed.content, "The aircraft layer is live.");
  assert.ok(legacyParsed.view);
});

test("the shared Markdown renderer strips God's Eye control metadata", () => {
  const markdown = source("src/app/components/chat-markdown.tsx");
  assert.match(markdown, /parseGodsEyeResult\(content\)\.content/);
});

test("the model's answer is accepted fenced, bare, or wrapped in prose — and refused when unusable", () => {
  const object = JSON.stringify({ ...VIEW, summary: "Live traffic inbound." });
  for (const shape of [
    object,
    `\`\`\`json\n${object}\n\`\`\``,
    `Here is the view:\n${object}\nEnjoy.`,
    `<think>reasoning</think>${object}`,
  ]) {
    const answer = parseViewAnswer(shape);
    assert.ok(answer, `rejected: ${shape.slice(0, 40)}`);
    assert.equal(answer.view.label, "Istanbul");
    assert.equal(answer.summary, "Live traffic inbound.");
  }
  assert.equal(parseViewAnswer("I cannot help with that."), null);
  assert.equal(parseViewAnswer('{"lat": 91, "lon": 0}'), null);
});

test("the run kind is registered, addressable, and round-trips its descriptor", () => {
  assert.ok(EXTERNAL_AGENT_RUN_KINDS.includes("gods_eye"));
  assert.equal(EXTERNAL_AGENT_RUN_FIELD_BY_KIND.gods_eye, "godsEyeRun");
  const parsed = parseExternalAgentRun({
    kind: "gods_eye",
    runId: "gerun_abc",
    task: "flights over Istanbul",
    quiet: true,
  });
  assert.deepEqual(parsed, {
    kind: "gods_eye",
    runId: "gerun_abc",
    task: "flights over Istanbul",
    quiet: true,
  });
  assert.equal(parseExternalAgentRun({ kind: "gods_eye", runId: "r", task: "" }), null);
});

test("the runtime profile and selection brief exist and agree on the id", () => {
  const profile = RUNTIME_AGENT_PROFILES.find((agent) => agent.id === GODS_EYE_AGENT_ID);
  assert.ok(profile, "gods-eye is missing from the runtime profiles");
  assert.equal(profile.command, GODS_EYE_COMMAND);
  assert.equal(profile.launchableByModel, true);
  assert.ok(RUNTIME_AGENT_BRIEFS[GODS_EYE_AGENT_ID], "gods-eye has no selection brief");
  assert.ok(RUNTIME_AGENT_BRIEFS[GODS_EYE_AGENT_ID].choose, "a launchable agent needs a choose line");
});

test("the globe is available without Google and only injects an optional key", () => {
  const runtime = source("src/lib/gods-eye/runtime.ts");
  const service = source("src/lib/gods-eye/service.ts");
  const settings = source("src/app/components/hermes/gods-eye-settings-dialog.tsx");

  assert.match(runtime, /available: Boolean\(root\) && installed,/);
  assert.doesNotMatch(runtime, /available:[^\n]*keyConfigured/);
  assert.doesNotMatch(runtime, /No Google Maps API key is configured/);
  assert.doesNotMatch(service, /if \(!key\) \{[\s\S]*?No Google Maps API key/);
  assert.match(settings, /Keyless OSM globe ready \(Google 3D optional\)/);

  const keyless = serviceEnvironment(null, {
    PATH: "test-path",
    GOOGLE_MAPS_API_KEY: "must-not-leak-from-the-parent",
  });
  assert.equal(keyless.PATH, "test-path");
  assert.equal(keyless.GOOGLE_MAPS_API_KEY, undefined);

  const enhanced = serviceEnvironment("optional-key", { PATH: "test-path" });
  assert.equal(enhanced.GOOGLE_MAPS_API_KEY, "optional-key");
});

test(
  "Windows child-process paths use normal absolute spelling",
  { skip: process.platform !== "win32" || !cloneAvailable },
  () => {
    const verbatimRoot = `\\\\?\\${cloneRoot}`;
    const env = {
      BREADBOARD_QA_MODE: "1",
      GODS_EYE_ROOT: verbatimRoot,
    };
    const root = resolveGodsEyeRoot(env);
    const entry = viteEntry(env);
    assert.equal(root, fs.realpathSync.native(cloneRoot));
    assert.equal(
      entry,
      fs.realpathSync.native(
        path.join(cloneRoot, "node_modules", "vite", "bin", "vite.js"),
      ),
    );
    assert.doesNotMatch(root, /^\\\\\?\\/);
    assert.doesNotMatch(entry, /^\\\\\?\\/);
  },
);

test("every event the run manager emits is a name the card subscribes to", () => {
  const manager = source("src/lib/gods-eye/run-manager.ts");
  const card = source("src/app/components/hermes/inline-gods-eye-run.tsx");
  const emitted = [...manager.matchAll(/emit\(run, "([^"]+)"/g)].map((match) => match[1]);
  assert.ok(emitted.length >= 5, "the run manager stopped emitting events");
  const subscribed = card.match(/const EVENTS = \[([\s\S]*?)\];/)?.[1] ?? "";
  for (const name of emitted) {
    assert.match(subscribed, new RegExp(`"${name}"`), `the card does not subscribe to ${name}`);
  }
  // Terminal events double as the finish routine's names.
  assert.match(manager, /"run\.completed"/);
  assert.match(manager, /"run\.aborted"/);
});

test("a delegated God's Eye stays visible as a quiet frame on both surfaces", () => {
  const panel = source("src/app/components/hermes/agent-runtime-panel.tsx");
  const workspace = source("src/app/gardens/[clusterSlug]/workspace-client.tsx");
  for (const [name, contents] of [["panel", panel], ["workspace", workspace]]) {
    assert.match(contents, /godsEyeRun/, `${name} never renders the God's Eye card`);
    assert.match(
      contents,
      /delegatedAgentRun[\s\S]{0,120}!(message|msg)\.godsEyeRun/,
      `${name} hides a delegated God's Eye turn instead of showing its frame`,
    );
    assert.match(
      contents,
      /storedMessage\.delegatedAgentRun === true &&\s*!storedMessage\.openGymRun &&\s*!storedMessage\.godsEyeRun &&\s*messages\[index \+ 1\]\?\.internalAgentContinuation === true/,
      `${name} drops the God's Eye row when the synthesis turn arrives`,
    );
  }
  const activity = source("src/lib/hermes/super-agent-activity.ts");
  assert.match(activity, /godsEyeRun/, "delegation presentation forgot God's Eye");
});
