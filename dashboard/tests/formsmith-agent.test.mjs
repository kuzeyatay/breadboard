import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(dashboardRoot, "..");
const read = (relative, root = dashboardRoot) => fs.readFileSync(path.join(root, relative), "utf8");

const identity = await import("../src/lib/shaper/identity.ts");
const uploads = await import("../src/lib/shaper/uploads.ts");
const source = await import("../src/lib/shaper/source.ts");
const artifacts = await import("../src/lib/hermes/artifact-import.ts");

test("Formsmith has one canonical identity and accepts only a bare command", () => {
  assert.equal(identity.FORMSMITH_AGENT_ID, "formsmith");
  assert.equal(identity.FORMSMITH_AGENT_NAME, "Formsmith");
  assert.equal(identity.FORMSMITH_COMMAND, "/agents:formsmith");
  assert.equal(identity.isFormsmithCommand(" /agents:formsmith "), true);
  assert.equal(identity.isFormsmithCommand("/agents:formsmith make a chair"), false);
});

test("the typed request contains one server upload id and no prompt", () => {
  const request = {
    uploadId: "a".repeat(32),
    filename: "lamp.webp",
    sizeBytes: 1234,
  };
  const validated = identity.validateFormsmithRequest(request);
  assert.equal(validated.ok, true);
  assert.deepEqual(Object.keys(validated.request).sort(), ["filename", "sizeBytes", "uploadId"]);
  assert.doesNotMatch(JSON.stringify(validated.request), /prompt|caption|path/i);
  assert.match(identity.formsmithUserMessage(validated.request), /lamp\.webp/);
  assert.doesNotMatch(identity.formsmithUserMessage(validated.request), /a{32}/);
  for (const bad of ["../secret", "a".repeat(31), "A".repeat(32), "a/b"]) {
    assert.equal(identity.validateFormsmithRequest({ ...request, uploadId: bad }).ok, false);
  }
});

test("only JPEG, PNG and WebP names cross the browser and server boundaries", () => {
  for (const good of ["object.jpg", "object.jpeg", "object.png", "object.webp", "OBJECT.PNG"]) {
    assert.equal(uploads.isSupportedImageName(good), true, good);
  }
  for (const bad of ["model.glb", "document.pdf", "movie.mp4", "photo.gif", "photo.svg", "photo.png.exe"]) {
    assert.equal(uploads.isSupportedImageName(bad), false, bad);
  }
  const form = read("src/app/components/hermes/formsmith-request-form.tsx");
  assert.match(form, /type="file"/);
  assert.match(form, /FORMSMITH_IMAGE_ACCEPT/);
  assert.match(form, /multiple=\{false\}/);
  assert.doesNotMatch(form, /type="text"|textarea|video\//);
  const route = read("src/app/api/shaper/uploads/route.ts");
  assert.match(route, /isSupportedImageName/);
  assert.doesNotMatch(route, /accept.*pdf|accept.*video/i);
});

test("upload ids are user-scoped and cannot become paths", () => {
  assert.equal(uploads.resolveFormsmithUpload(999_999, "../../secret"), null);
  assert.equal(uploads.resolveFormsmithUpload(999_999, "b".repeat(32)), null);
  const source = read("src/lib/shaper/uploads.ts");
  assert.match(source, /userRoot\(userId\)/);
  assert.match(source, /hasSupportedMagic/);
});

test("the local checkout and bridge are discovered without a configured path", () => {
  const found = source.resolveShapeRRoot({});
  assert.ok(found);
  assert.equal(path.resolve(found.root), path.join(repositoryRoot, "ShapeR"));
  assert.equal(source.isShapeRClone(found.root), true);
  assert.equal(path.resolve(source.shapeRBridgePath()), path.join(repositoryRoot, "scripts", "shaper-bridge.py"));
});

test("the bridge and card agree on every streamed stage", () => {
  const bridge = read("scripts/shaper-bridge.py", repositoryRoot);
  const manager = read("src/lib/shaper/run-manager.ts");
  const card = read("src/app/components/hermes/inline-formsmith-run.tsx");
  for (const stage of ["prepare", "depth", "reconstruct"]) {
    assert.match(bridge, new RegExp(`[\"']${stage}[\"']`));
    assert.match(card, new RegExp(`key: "${stage}"`));
  }
  for (const event of ["run.started", "stage.updated", "run.completed", "run.failed", "run.aborted"]) {
    assert.ok(manager.includes(`"${event}"`), `manager never publishes ${event}`);
    assert.ok(card.includes(`"${event}"`), `card never observes ${event}`);
  }
  assert.match(bridge, /workaround_dataproc\.py/);
  assert.match(bridge, /infer_shape\.py/);
});

test("a valid GLB imports as a previewable 3D model and impostors are rejected", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-formsmith-glb-"));
  try {
    const valid = path.join(root, "shape.glb");
    const bytes = Buffer.alloc(12);
    bytes.write("glTF", 0, "ascii");
    bytes.writeUInt32LE(2, 4);
    bytes.writeUInt32LE(12, 8);
    fs.writeFileSync(valid, bytes);
    assert.deepEqual(artifacts.inspectArtifactImport(valid, "model"), {
      rendererId: "model-file",
      mimeType: "model/gltf-binary",
      extension: ".glb",
      previewAvailable: true,
    });

    const fake = path.join(root, "fake.glb");
    fs.writeFileSync(fake, Buffer.from("not a model"));
    assert.throws(() => artifacts.inspectArtifactImport(fake, "model"), /does not match/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("both chat surfaces persist the Formsmith run descriptor", () => {
  const terminal = read("src/app/components/hermes/dashboard-agent-terminal.tsx");
  const garden = read("src/app/gardens/[clusterSlug]/workspace-client.tsx");
  const registry = read("src/lib/conversations/external-agent-runs.ts");
  assert.match(terminal, /kind: "formsmith"/);
  for (const source of [terminal, garden]) {
    assert.match(source, /formsmithRun/);
    assert.match(source, /\/api\/shaper\/runs/);
    assert.match(source, /onSubmitFormsmith/);
  }
  assert.match(registry, /formsmithRun/);
  assert.match(registry, /formsmith: "Formsmith"/);
});
