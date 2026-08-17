import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { listFirstPartySkills } from "../src/lib/hermes/skills.ts";
import {
  imageTo3dCommandText,
  IMAGE_TO_3D_SKILL,
} from "../src/lib/hermes/image-3d-intent.ts";
import {
  decodeImageAttachment,
  mergeImages,
  reconstructableFromAttachments,
  reconstructableImages,
  renderImageTo3dContext,
  selectImage,
} from "../src/lib/sf3d/images.ts";
import {
  parseSf3dOptions,
  runImageTo3d,
  Sf3dServiceError,
} from "../src/lib/sf3d/service.ts";
import { readSf3dConfig, TEXTURE_RESOLUTIONS } from "../src/lib/sf3d/config.ts";
import { allowedToolsForSurface } from "../src/lib/hermes/tool-scopes.ts";
import { availableArtifactRenderers } from "../src/lib/hermes/artifact-renderers.ts";

function source(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

/** A 1×1 PNG, so the attachment tests carry real bytes rather than a stub string. */
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const attachment = (name, dataUrl = PNG_DATA_URL) => ({ type: "image", name, dataUrl });
const userMessage = (...attachments) => ({
  role: "user",
  metadata: JSON.stringify({ attachments }),
});

test("Image to 3D is a ready prebuilt skill on both conversational surfaces", () => {
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    const skill = listFirstPartySkills(surface).find(
      (candidate) => candidate.slug === IMAGE_TO_3D_SKILL,
    );
    assert.ok(skill, `expected the skill on ${surface}`);
    assert.equal(skill.availability, "ready");
    assert.equal(skill.category, "Featured");
    assert.deepEqual(skill.capabilityContract?.requiredTools, ["image_to_3d"]);
  }

  // Quartz is the public frontend; a local GPU job must never be reachable there.
  const quartz = listFirstPartySkills("quartz_ai").find(
    (candidate) => candidate.slug === IMAGE_TO_3D_SKILL,
  );
  assert.ok(quartz);
  assert.notEqual(quartz.availability, "ready");
});

test("the tool is authorized on both chat surfaces and on neither public one", () => {
  assert.ok(allowedToolsForSurface("dashboard_terminal").includes("image_to_3d"));
  assert.ok(allowedToolsForSurface("garden_chat").includes("image_to_3d"));
  assert.ok(!allowedToolsForSurface("quartz_ai").includes("image_to_3d"));
});

test("the model artifact kind the skill declares really has a renderer", () => {
  // The skill declares `requiredArtifactKinds: [model]`; without a registered
  // renderer of that kind the skill resolves unavailable for a reason that has
  // nothing to do with Stable Fast 3D.
  assert.ok(availableArtifactRenderers().some((renderer) => renderer.kind === "model"));
});

test("the tool is registered everywhere the runtime actually reads", () => {
  const manifest = source("../hermes-agent/plugins/breadboard/plugin.yaml");
  const plugin = source("../hermes-agent/plugins/breadboard/__init__.py");
  const route = source("src/app/api/hermes/tools/image-to-3d/route.ts");
  const broker = source("src/lib/hermes/capability-broker.ts");

  assert.match(manifest, /^\s+- image_to_3d$/m);
  assert.match(plugin, /"image_to_3d",\s*\n\s*"\/api\/hermes\/tools\/image-to-3d",/);
  // The route reads `body.args` and `body.toolCallId`, which only the
  // action-shaped payload branch produces.
  assert.match(plugin, /route_kind in \{[^}]*"image_to_3d"[^}]*\}/);
  assert.match(plugin, /_IMAGE_TO_3D_REQUEST_TIMEOUT_SECONDS/);
  assert.match(broker, /IMAGE_TO_3D_TOOLS/);
  assert.match(route, /selectedConditionalSkills\.includes\(IMAGE_TO_3D_SKILL\)/);
});

test("a request for a 3D thing with a picture selects the skill", () => {
  const base = {
    surface: "garden_chat",
    authenticated: true,
    hasImageAttachment: true,
  };
  for (const text of [
    "convert this image to 3d",
    "can you turn this into a 3D model?",
    "make a mesh from this",
    "3d model of this please",
    "I want a 3D printable version of this",
    "generate a glb",
  ]) {
    const selection = imageTo3dCommandText({ ...base, text });
    assert.equal(selection.automatic, true, text);
    assert.equal(selection.text, `/${IMAGE_TO_3D_SKILL} ${text}`);
  }
});

test("an ordinary picture question does not start a GPU job", () => {
  const base = {
    surface: "garden_chat",
    authenticated: true,
    hasImageAttachment: true,
  };
  for (const text of [
    "what is wrong with this screenshot?",
    "summarize this chart",
    "how do I make a 3d model from a photo?",
    "what is a 3D mesh?",
    "explain the difference between a mesh and a point cloud",
    "which 3d printer should I buy",
    "read the text in this image",
  ]) {
    assert.equal(imageTo3dCommandText({ ...base, text }).automatic, false, text);
  }
});

test("the selection needs a picture, an authenticated private surface, and no explicit command", () => {
  const text = "convert this image to 3d";
  assert.equal(
    imageTo3dCommandText({
      text,
      surface: "garden_chat",
      authenticated: true,
      hasImageAttachment: false,
    }).automatic,
    false,
  );
  // A follow-up arrives with no attachment of its own; the earlier picture counts.
  assert.equal(
    imageTo3dCommandText({
      text: "now make it a quad mesh",
      surface: "garden_chat",
      authenticated: true,
      hasImageAttachment: false,
      hasRecentImageAttachment: true,
    }).automatic,
    true,
  );
  assert.equal(
    imageTo3dCommandText({
      text,
      surface: "quartz_ai",
      authenticated: true,
      hasImageAttachment: true,
    }).automatic,
    false,
  );
  assert.equal(
    imageTo3dCommandText({
      text,
      surface: "garden_chat",
      authenticated: false,
      hasImageAttachment: true,
    }).automatic,
    false,
  );
  const explicit = imageTo3dCommandText({
    text: "/watch something",
    surface: "dashboard_terminal",
    authenticated: true,
    hasImageAttachment: true,
  });
  assert.equal(explicit.automatic, false);
  assert.equal(explicit.text, "/watch something");
});

test("attachments resolve to bytes, and unreconstructable ones do not", () => {
  const decoded = decodeImageAttachment(attachment("chair.png"));
  assert.ok(decoded);
  assert.equal(decoded.name, "chair.png");
  assert.ok(decoded.bytes.byteLength > 0);
  assert.equal(decoded.mimeType, "image/png");

  // An animated GIF has no single frame to reconstruct from.
  assert.equal(
    decodeImageAttachment(attachment("loop.gif", "data:image/gif;base64,R0lGODlhAQABAAAAACw=")),
    null,
  );
  assert.equal(decodeImageAttachment(attachment("x.png", "/tmp/x.png")), null);
});

test("a picture stays reachable for follow-up turns, newest first and deduplicated", () => {
  const images = reconstructableImages([
    userMessage(attachment("chair.png")),
    { role: "assistant", metadata: null },
    userMessage(attachment("lamp.png")),
    userMessage(),
  ]);
  assert.deepEqual(images.map((image) => image.name), ["lamp.png", "chair.png"]);
  assert.equal(images[0].carriedForward, true, "no picture came with the newest message");

  const merged = mergeImages(
    reconstructableFromAttachments([attachment("lamp.png"), { type: "text", text: "x", name: "n.txt" }]),
    images,
  );
  assert.deepEqual(merged.map((image) => image.name), ["lamp.png", "chair.png"]);
});

test("the named picture is the one reconstructed, forgivingly matched", () => {
  const images = reconstructableImages([
    userMessage(attachment("chair.png"), attachment("lamp.jpeg")),
  ]);
  assert.equal(selectImage(images, "lamp.jpeg").name, "lamp.jpeg");
  assert.equal(selectImage(images, "LAMP.JPEG").name, "lamp.jpeg");
  assert.equal(selectImage(images, "lamp").name, "lamp.jpeg");
  assert.equal(selectImage(images, undefined).name, "chair.png");
  assert.equal(selectImage(images, "sofa.png"), null);
  assert.equal(selectImage([], undefined), null);
});

test("the context block names the exact argument and the single-view caveat", () => {
  const block = renderImageTo3dContext(
    reconstructableImages([userMessage(attachment("chair.png"))]),
  );
  assert.match(block, /image_to_3d image: chair\.png/);
  assert.match(block, /inferred from a single view/);
  assert.doesNotMatch(block, /data:image/, "the data URL must never reach the prompt");
  assert.equal(renderImageTo3dContext([]), "");
});

test("run options are bounded, and a vertex target implies a remesher", () => {
  const defaults = parseSf3dOptions({});
  assert.ok(TEXTURE_RESOLUTIONS.includes(defaults.textureResolution));
  assert.equal(defaults.remesh, "none");
  assert.equal(defaults.targetVertexCount, -1);
  assert.equal(defaults.removeBackground, true);

  assert.equal(parseSf3dOptions({ textureResolution: 2048 }).textureResolution, 2048);
  assert.equal(parseSf3dOptions({ removeBackground: false }).removeBackground, false);

  // A vertex budget expressed through no remesher would be silently ignored,
  // which reads as the tool lying about what it did.
  const budgeted = parseSf3dOptions({ targetVertexCount: 5_000 });
  assert.equal(budgeted.remesh, "triangle");
  assert.equal(budgeted.targetVertexCount, 5_000);

  for (const bad of [
    { textureResolution: 4096 },
    { textureResolution: 1023 },
    { remesh: "marching-cubes" },
    { targetVertexCount: 10 },
    { targetVertexCount: 5_000_000 },
    { targetVertexCount: 1.5 },
  ]) {
    assert.throws(
      () => parseSf3dOptions(bad),
      (error) =>
        error instanceof Sf3dServiceError && error.code === "sf3d_invalid_arguments",
      JSON.stringify(bad),
    );
  }
});

test("an empty or oversized picture is refused before any process is launched", async () => {
  await assert.rejects(
    runImageTo3d({ image: Buffer.alloc(0), options: parseSf3dOptions({}) }),
    (error) => error instanceof Sf3dServiceError && error.code === "sf3d_invalid_image",
  );
  await assert.rejects(
    runImageTo3d({ image: Buffer.alloc(25 * 1024 * 1024), options: parseSf3dOptions({}) }),
    (error) => error instanceof Sf3dServiceError && error.code === "sf3d_invalid_image",
  );
});

test("the runtime is resolved from the repository, not from the working directory", () => {
  const config = readSf3dConfig();
  assert.match(config.cloneRoot, /stable-fast-3d$/);
  assert.match(config.bridgeScript, /sf3d-bridge\.py$/);
  assert.ok(fs.existsSync(config.bridgeScript), "the bridge script must be checked in");
  assert.match(config.pythonExecutable, /sf3d-venv/);
});

test("the skill manifest promises only what the tool can do", () => {
  const manifest = source("../hermes-skills/prebuilt/image-to-3d/SKILL.md");
  assert.match(manifest, /requiredTools:\s*\n\s*- image_to_3d/);
  assert.match(manifest, /surfaces: \[garden_chat, dashboard_terminal\]/);
  assert.match(manifest, /requiredArtifactKinds:\s*\n\s*- model/);
  // The mesh is published by the tool itself, so the skill has to name that as
  // its production path or it resolves unavailable for want of artifact_import.
  assert.match(manifest, /requiredRuntimes:\s*\n\s*- image-to-3d-runtime/);
  // The three sentences the skill exists to make the model say.
  assert.match(manifest, /never answer\s+that you cannot produce 3D files/i);
  assert.match(manifest, /inferred from a single view/);
  assert.match(manifest, /Do not claim measurements/);
  // And the one thing it must not do on the user's behalf.
  assert.match(manifest, /Do not run it yourself/);
});

test("the turn wires the selection and the context block to the same skill", () => {
  const turn = source("src/lib/conversations/turn-service.ts");
  assert.match(turn, /imageTo3dCommandText\(\{/);
  assert.match(turn, /text: watchSelection\.text/);
  // Its output feeds whatever link comes next — Audio Analysis today — and what
  // this asserts is that the chain is not cut here, not which skill is
  // downstream of it.
  assert.match(turn, /\(\{\s*\n\s*text: imageTo3dSelection\.text/);
  assert.match(
    turn,
    /decision\.selectedConditionalSkills\.includes\(IMAGE_TO_3D_SKILL\)/,
  );
  // An automatic selection must never cost the user their turn.
  assert.match(turn, /!watchSelection\.automatic &&\s*\n?\s*!imageTo3dSelection\.automatic/);
  assert.match(turn, /throw error;/);
});

test("Garden Chat's own pipeline selects the skill too", () => {
  // Garden Chat has a second intent chain of its own. Wiring only the canonical
  // one is how a feature silently works on the Terminal and nowhere else.
  const adapter = source("src/lib/hermes/garden-chat-adapter.ts");
  assert.match(adapter, /imageTo3dCommandText\(\{/);
  assert.match(adapter, /\(\{\s*\n\s*text: imageTo3dSelection\.text/);
  assert.match(
    adapter,
    /decision\.selectedConditionalSkills\.includes\(IMAGE_TO_3D_SKILL\)/,
  );
  assert.match(adapter, /if \(!imageTo3dSelection\.automatic[^)]*\) throw error;/);
  // The context block is conditional, so the joined prompt has to drop the
  // empty string rather than open with a blank line.
  assert.match(adapter, /\]\.filter\(Boolean\)\.join\("\\n\\n"\)/);
});

test("the intent check never decodes an attachment", () => {
  // This runs on every turn. Decoding to answer "is there a picture?" would
  // base64-decode megabytes per message in a conversation full of screenshots.
  const images = source("src/lib/sf3d/images.ts");
  const cheapCheck = images.slice(
    images.indexOf("export function isReconstructableAttachment"),
    images.indexOf("export function decodeImageAttachment"),
  );
  assert.ok(cheapCheck.length > 0);
  assert.doesNotMatch(cheapCheck, /Buffer\.from/);

  const turn = source("src/lib/conversations/turn-service.ts");
  assert.match(turn, /hasImageAttachment: hasReconstructableAttachment\(input\.attachments\)/);
  assert.match(turn, /hasRecentImageAttachment: hasReconstructableImages\(earlierMessages\)/);
});
