// The Advanced image mode: the local ComfyUI behind the post studio.
//
// Two kinds of assertion, for two kinds of risk. The graph and the option
// clamping are exercised directly, because a workflow that names an input
// wrongly fails inside ComfyUI's validator with a message about "node 5" and
// nothing here would have caught it. The wiring is source-level, for the same
// reason as socials-manager-integration.test.mjs: the path crosses a panel, the
// studio and a shared route, and what matters is that they still meet.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  COMFYUI_DEFAULT_NEGATIVE,
  COMFYUI_LIMITS,
  buildTextToImageWorkflow,
  normalizeRenderOptions,
  resolveSeed,
} from "../src/lib/comfyui/workflow.ts";
import { resolveComfyUiConfig } from "../src/lib/comfyui/config.ts";

const source = (relativePath) =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const fallback = { checkpoint: "model.safetensors", samplerName: "euler", scheduler: "normal" };

test("the workflow is the graph ComfyUI's own nodes accept", () => {
  const options = normalizeRenderOptions(
    { prompt: "a lighthouse at dusk", checkpoint: "sdxl.safetensors" },
    fallback,
  );
  const graph = buildTextToImageWorkflow({ ...options, seed: 42 }, "breadboard");

  // Node class names and input keys are ComfyUI's, not ours: they are matched
  // against `comfyui/nodes.py` INPUT_TYPES, so a rename upstream fails loudly.
  assert.equal(graph["1"].class_type, "CheckpointLoaderSimple");
  assert.equal(graph["1"].inputs.ckpt_name, "sdxl.safetensors");
  assert.deepEqual(Object.keys(graph["2"].inputs).sort(), ["batch_size", "height", "width"]);
  assert.equal(graph["5"].class_type, "KSampler");
  assert.deepEqual(Object.keys(graph["5"].inputs).sort(), [
    "cfg",
    "denoise",
    "latent_image",
    "model",
    "negative",
    "positive",
    "sampler_name",
    "scheduler",
    "seed",
    "steps",
  ]);

  // The wiring itself: positive and negative are two different text encodes,
  // and the sampler's latent comes from the empty latent rather than anywhere
  // else. Getting these crossed renders something plausible but wrong.
  assert.deepEqual(graph["5"].inputs.positive, ["3", 0]);
  assert.deepEqual(graph["5"].inputs.negative, ["4", 0]);
  assert.deepEqual(graph["5"].inputs.latent_image, ["2", 0]);
  assert.deepEqual(graph["3"].inputs.clip, ["1", 1]);
  assert.deepEqual(graph["6"].inputs.vae, ["1", 2]);
  assert.deepEqual(graph["7"].inputs.images, ["6", 0]);
  assert.equal(graph["7"].class_type, "SaveImage");
});

test("settings are clamped rather than refused", () => {
  const options = normalizeRenderOptions(
    { prompt: "x", steps: 5_000, cfg: -4, width: 100, height: 99_999 },
    fallback,
  );
  assert.equal(options.steps, COMFYUI_LIMITS.steps.max);
  assert.equal(options.cfg, COMFYUI_LIMITS.cfg.min);
  assert.equal(options.width, COMFYUI_LIMITS.size.min);
  assert.equal(options.height, COMFYUI_LIMITS.size.max);
});

test("sizes land on ComfyUI's latent step, so the asked-for size is delivered", () => {
  const options = normalizeRenderOptions({ prompt: "x", width: 1023, height: 769 }, fallback);
  assert.equal(options.width % COMFYUI_LIMITS.size.step, 0);
  assert.equal(options.height % COMFYUI_LIMITS.size.step, 0);
});

test("an unset seed means a fresh one, and a set seed is honoured exactly", () => {
  const random = normalizeRenderOptions({ prompt: "x" }, fallback);
  assert.equal(random.seed, null);
  const drawn = resolveSeed(null);
  assert.ok(Number.isInteger(drawn) && drawn >= 0 && drawn < 2 ** 32);

  const pinned = normalizeRenderOptions({ prompt: "x", seed: 1234 }, fallback);
  assert.equal(pinned.seed, 1234);
  assert.equal(resolveSeed(1234), 1234);
});

test("missing settings fall back to what the server said it can do", () => {
  const options = normalizeRenderOptions({ prompt: "x" }, fallback);
  assert.equal(options.checkpoint, fallback.checkpoint);
  assert.equal(options.samplerName, fallback.samplerName);
  assert.equal(options.scheduler, fallback.scheduler);
  assert.equal(options.negativePrompt, COMFYUI_DEFAULT_NEGATIVE);
});

test("any ComfyUI at the configured URL is used before the vendored one is started", () => {
  const server = source("src/lib/comfyui/server.ts");
  const reachable = server.indexOf("comfyUiReachable(config.baseUrl)");
  const managed = server.indexOf("!config.managed || !cloneInstalled(config)");
  assert.ok(reachable > 0 && managed > reachable, "reachability has to be checked first");
  // One start at a time: two servers on one port is a worse failure than a
  // slow first render.
  assert.match(server, /__breadboardComfyUiStart/);
});

test("setup is explicit, detached, and reports through the status file", () => {
  const server = source("src/lib/comfyui/server.ts");
  assert.match(server, /detached: true/);
  assert.match(server, /COMFYUI_STATUS_PATH: config\.statusFile/);
  // Nothing may install or start as a side effect of asking how things are.
  const service = source("src/lib/comfyui/service.ts");
  const statusStart = service.indexOf("export async function comfyUiStatus");
  const statusEnd = service.indexOf("export interface ComfyUiRenderResult");
  assert.ok(statusStart > 0 && statusEnd > statusStart);
  assert.doesNotMatch(service.slice(statusStart, statusEnd), /beginSetup|ensureComfyUiRunning/);
});

test("ComfyUI starts with the app, but only when there is one to start", () => {
  const autostart = source("src/lib/comfyui/autostart.ts");
  const instrumentation = source("src/instrumentation-node.ts");

  // Booted from the same place as the chat scheduler and the messaging
  // gateways, so it runs whether or not a page is open.
  assert.match(instrumentation, /autostartComfyUi\(\)/);

  // `stopped` is the only state it acts on: installed, managed, enabled, and
  // nothing already answering. Installing at boot, or starting a second server
  // next to one the user runs themselves, would both be worse than a slow
  // first render.
  assert.match(autostart, /status\.state !== "stopped"/);
  assert.doesNotMatch(autostart, /beginSetup/);
  assert.match(autostart, /!config\.enabled \|\| !config\.managed \|\| !config\.autostart/);
  // Never blocks boot on a Python start.
  assert.match(autostart, /setTimeout\(/);
});

test("the settings name is honoured over the browser's claim about models", () => {
  const service = source("src/lib/comfyui/service.ts");
  assert.match(service, /comfyui_checkpoint_missing/);
  assert.match(service, /capabilities\.checkpoints\.includes\(normalized\.checkpoint\)/);
});

test("configuration points at the vendored clone but can be sent elsewhere", () => {
  const config = resolveComfyUiConfig({});
  assert.equal(config.baseUrl, "http://127.0.0.1:8188");
  assert.ok(config.cloneRoot.endsWith("comfyui"));
  assert.equal(config.enabled, true);
  assert.equal(config.managed, true);

  const external = resolveComfyUiConfig({
    COMFYUI_URL: "http://10.0.0.4:9000/",
    COMFYUI_MANAGED: "false",
  });
  assert.equal(external.baseUrl, "http://10.0.0.4:9000");
  assert.equal(external.managed, false);
  assert.equal(resolveComfyUiConfig({}).autostart, true);
  assert.equal(resolveComfyUiConfig({ COMFYUI_AUTOSTART: "false" }).autostart, false);
});

test("Advanced is a fourth image mode in the post studio, not a separate window", () => {
  const studio = source("src/app/components/hermes/socials-manager-post-studio.tsx");
  assert.match(studio, /\["advanced", "Advanced"\]/);
  assert.match(studio, /<ComfyUiImagePanel/);
  // It ends where Generate and Upload end: an artifact staged onto the post.
  assert.match(studio, /operation: "comfyui"/);
  assert.match(studio, /stageCreated\(await createdArtifact\(response\)\)/);
});

test("a rendered image becomes an ordinary artifact, with the render kept alongside", () => {
  const route = source("src/app/api/hermes/artifacts/images/route.ts");
  assert.match(route, /body\.operation === "comfyui"/);
  assert.match(route, /importArtifactImage\(/);
  assert.match(route, /comfyui: rendered\.options/);
  // The same context/close discipline as every other way an image is imported.
  assert.match(route, /closeArtifactContext\(context, "completed"\)/);
});

test("the panel asks the server what state ComfyUI is in rather than guessing", () => {
  const panel = source("src/app/components/hermes/comfyui-image-panel.tsx");
  assert.match(panel, /fetch\("\/api\/comfyui"/);
  assert.match(panel, /act\("setup"\)/);
  assert.match(panel, /act\("start"\)/);
  // A multi-minute install in another process is only observable by re-asking.
  assert.match(panel, /status\?\.state !== "installing"/);
  assert.match(panel, /setInterval/);
});
