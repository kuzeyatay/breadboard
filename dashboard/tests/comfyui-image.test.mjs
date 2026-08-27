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
import path from "node:path";
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

test("managed ComfyUI has no dashboard process-launch fallback", () => {
  const server = source("src/lib/comfyui/server.ts");
  assert.doesNotMatch(server, /function launch\(|__breadboardComfyUiStart|comfyUiReachable/);
  const service = source("src/lib/comfyui/service.ts");
  assert.match(service, /Managed ComfyUI requires the Breadboard Runtime service owner/);
});

test("setup is an authenticated Runtime job and reports through the existing status file", () => {
  const server = source("src/lib/comfyui/server.ts");
  const route = source("src/app/api/comfyui/route.ts");
  assert.doesNotMatch(server, /node:child_process|\bspawn\s*\(|detached:/);
  assert.match(server, /writeSetupStatus\(config, "queued"/);
  assert.match(server, /!isRuntimeV2ServiceControlConfigured\(\)/);
  assert.match(route, /submitManagedSetupJob\(\{/);
  assert.match(route, /serviceId: "comfyui"/);
  assert.match(route, /signal: request\.signal/);
  // Nothing may install or start as a side effect of asking how things are.
  const service = source("src/lib/comfyui/service.ts");
  const statusStart = service.indexOf("export async function comfyUiStatus");
  const statusEnd = service.indexOf("export interface ComfyUiRenderResult");
  assert.ok(statusStart > 0 && statusEnd > statusStart);
  assert.doesNotMatch(service.slice(statusStart, statusEnd), /beginSetup|ensureComfyUiRunning/);
});

test("ComfyUI stays stopped at app startup and starts only for an explicit operation", () => {
  const instrumentation = source("src/instrumentation-runtime.ts");
  const service = source("src/lib/comfyui/service.ts");
  const route = source("src/app/api/comfyui/route.ts");

  // Opening Breadboard or its background coordinator must not wake a local
  // diffusion model. A real render and the existing explicit Start action both
  // keep their automatic first-operation behavior.
  assert.doesNotMatch(instrumentation, /autostartComfyUi|comfyui\/autostart/);
  assert.match(service, /renderComfyUiImage[\s\S]*acquireManagedComfyUiLease\("image-render"\)/);
  assert.match(service, /startComfyUi[\s\S]*acquireManagedComfyUiLease\("explicit-start"\)/);
  assert.match(route, /body\.action === "start"[\s\S]*startComfyUi\(config\)/);
});

test("the settings name is honoured over the browser's claim about models", () => {
  const service = source("src/lib/comfyui/service.ts");
  assert.match(service, /comfyui_checkpoint_missing/);
  assert.match(service, /capabilities\.checkpoints\.includes\(normalized\.checkpoint\)/);
});

test("managed configuration is sealed by Runtime V2 while explicit external mode is HTTP-only", () => {
  const config = resolveComfyUiConfig({});
  assert.equal(config.baseUrl, "http://127.0.0.1:8188");
  assert.ok(config.cloneRoot.endsWith("comfyui"));
  assert.equal(config.enabled, true);
  assert.equal(config.managed, true);

  const ignoredLegacyOverrides = resolveComfyUiConfig({
    COMFYUI_URL: "http://10.0.0.4:9000/",
    COMFYUI_PORT: "9000",
    COMFYUI_ROOT: path.resolve("untrusted-comfyui"),
    COMFYUI_ENV_DIR: path.resolve("untrusted-environment"),
    COMFYUI_RUNTIME_DIR: path.resolve("untrusted-runtime"),
  });
  assert.equal(ignoredLegacyOverrides.baseUrl, "http://127.0.0.1:8188");
  assert.equal(ignoredLegacyOverrides.port, 8188);
  assert.ok(ignoredLegacyOverrides.cloneRoot.endsWith("comfyui"));
  assert.ok(ignoredLegacyOverrides.envDir.endsWith(path.join(".runtime", "comfyui-venv")));

  const external = resolveComfyUiConfig({
    COMFYUI_URL: "http://10.0.0.4:9000/",
    COMFYUI_MANAGED: "false",
  });
  assert.equal(external.baseUrl, "http://10.0.0.4:9000");
  assert.equal(external.managed, false);
  assert.throws(() =>
    resolveComfyUiConfig({
      COMFYUI_URL: "http://user:secret@10.0.0.4:9000",
      COMFYUI_MANAGED: "false",
    }),
  );

  const runtimeManaged = resolveComfyUiConfig({
    BREADBOARD_RUNTIME_V2_ACTIVE: "true",
    COMFYUI_MANAGED: "true",
    COMFYUI_URL: "http://127.0.0.1:43128",
    COMFYUI_PORT: "43128",
    COMFYUI_ROOT: path.resolve("comfyui"),
    COMFYUI_ENV_DIR: path.resolve(".runtime/comfyui-venv"),
    COMFYUI_RUNTIME_DIR: path.resolve(".runtime/comfyui"),
  });
  assert.equal(runtimeManaged.port, 43128);
  assert.throws(() =>
    resolveComfyUiConfig({
      BREADBOARD_RUNTIME_V2_ACTIVE: "true",
      COMFYUI_MANAGED: "true",
      COMFYUI_URL: "http://10.0.0.4:43128",
      COMFYUI_PORT: "43128",
      COMFYUI_ROOT: path.resolve("comfyui"),
      COMFYUI_ENV_DIR: path.resolve(".runtime/comfyui-venv"),
      COMFYUI_RUNTIME_DIR: path.resolve(".runtime/comfyui"),
    }),
  );
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
