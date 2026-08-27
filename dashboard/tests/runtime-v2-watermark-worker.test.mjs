import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  runRuntimeV2WatermarkPython,
  validateRuntimeV2WatermarkRequest,
  validateRuntimeV2WatermarkScope,
} from "../scripts/runtime-v2-watermark-worker.mjs";
import {
  auditWatermarksViaRuntime,
  cleanWatermarkViaRuntime,
} from "../src/lib/runtime-v2/watermark-job.ts";
import { createWatermarkRuntimeFixture } from "./helpers/watermark-runtime-fixture.mjs";

test("the watermark worker accepts only its sealed conversation-scoped protocol", () => {
  assert.deepEqual(validateRuntimeV2WatermarkScope({
    userId: 7,
    gardenId: null,
    conversationId: "conversation-7",
  }), { userId: 7, gardenId: null, conversationId: "conversation-7" });
  assert.deepEqual(validateRuntimeV2WatermarkRequest({
    protocolVersion: 1,
    operation: "clean",
    mode: "auto",
    nfkc: false,
    aggressiveHomoglyphs: false,
    keepNonAiMetadata: false,
    strictExit: true,
  }).operation, "clean");
  assert.throws(() => validateRuntimeV2WatermarkRequest({
    protocolVersion: 1,
    operation: "clean",
    mode: "auto",
    nfkc: false,
    aggressiveHomoglyphs: false,
    keepNonAiMetadata: false,
    strictExit: true,
    executable: "python",
  }), /invalid/u);
  assert.throws(() => validateRuntimeV2WatermarkScope({
    userId: 7,
    gardenId: null,
    conversationId: null,
  }), /conversation scope/u);
});

test("Next owns no watermark interpreter and both artifact imports await the Runtime seam", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const scripts = fs.readFileSync(path.join(root, "src", "lib", "watermarks", "scripts.ts"), "utf8");
  const scrub = fs.readFileSync(path.join(root, "src", "lib", "watermarks", "scrub-file.ts"), "utf8");
  const store = fs.readFileSync(path.join(root, "src", "lib", "hermes", "artifact-store.ts"), "utf8");
  const route = fs.readFileSync(
    path.join(root, "src", "app", "api", "hermes", "tools", "watermarks", "route.ts"),
    "utf8",
  );
  assert.doesNotMatch(scripts, /node:child_process|\bspawn(?:Sync)?\s*\(/u);
  assert.doesNotMatch(scrub, /node:child_process|\bspawn(?:Sync)?\s*\(/u);
  assert.equal((store.match(/await scrubFileInPlaceViaRuntime\(temporary/g) ?? []).length, 2);
  assert.match(route, /inspectSource\([\s\S]*watermarkRuntime\)/u);
  assert.match(route, /auditWorkspace\([\s\S]*watermarkRuntime\)/u);
  assert.match(route, /cleanSource\([\s\S]*watermarkRuntime\)/u);
});

test("one clean submits one sealed blob and materializes the hash-fenced output", async () => {
  const runtime = createWatermarkRuntimeFixture();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "watermark-job-clean-"));
  const source = path.join(work, "draft.md");
  const output = path.join(work, "draft.cleaned.md");
  fs.writeFileSync(source, "Hello​world\n", "utf8");
  try {
    const result = await cleanWatermarkViaRuntime({
      scope: runtime.scope,
      sourcePath: source,
      outputPath: output,
      mode: "text",
      control: runtime.control,
    });
    assert.equal(result.ok, true);
    assert.equal(fs.readFileSync(output, "utf8"), "Helloworld\n");
    assert.equal(runtime.calls.reserves.length, 1);
    assert.equal(runtime.calls.uploads.length, 1);
    assert.equal(runtime.calls.submissions.length, 1);
    assert.equal(runtime.calls.submissions[0].submission.inputUploads.length, 1);
    assert.deepEqual(runtime.calls.submissions[0].submission.requestPayload, {
      protocolVersion: 1,
      operation: "clean",
      mode: "text",
      nfkc: false,
      aggressiveHomoglyphs: false,
      keepNonAiMetadata: false,
      strictExit: false,
    });
  } finally {
    runtime.cleanup();
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test("directory audit streams a private bundle and never gives Python the host path", async () => {
  const runtime = createWatermarkRuntimeFixture();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "watermark-job-audit-"));
  fs.mkdirSync(path.join(work, ".watermarks"));
  fs.writeFileSync(path.join(work, "marked.md"), "hidden​carrier\n", "utf8");
  fs.writeFileSync(path.join(work, ".watermarks", "ignored.md"), "ignored​carrier\n", "utf8");
  try {
    const report = await auditWatermarksViaRuntime({
      scope: runtime.scope,
      auditRoot: work,
      directory: ".",
      control: runtime.control,
    });
    assert.equal(report.root, ".");
    assert.match(JSON.stringify(report), /marked\.md/u);
    assert.doesNotMatch(JSON.stringify(report), /ignored\.md/u);
    assert.equal(runtime.calls.reserves[0].request.displayName, "watermark-audit.bundle");
    assert.equal(runtime.calls.submissions[0].submission.requestPayload.directory, ".");
    assert.doesNotMatch(JSON.stringify(runtime.calls.submissions[0]), new RegExp(
      work.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "u",
    ));
  } finally {
    runtime.cleanup();
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test("the observed Python child receives a closed environment and acknowledges cancellation", async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "watermark-child-env-"));
  const envProbe = path.join(work, "env-probe.js");
  const waitProbe = path.join(work, "wait-probe.js");
  fs.writeFileSync(envProbe, "process.stdout.write(JSON.stringify(process.env));\n", "utf8");
  fs.writeFileSync(waitProbe, "setInterval(() => {}, 1000);\n", "utf8");
  const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT || process.env.WINDIR;
  const env = {
    TEST_WATERMARK_ONLY: "yes",
    PATH: "",
    ...(systemRoot ? { SystemRoot: systemRoot, SYSTEMROOT: systemRoot, WINDIR: systemRoot } : {}),
  };
  const layout = { python: process.execPath, scripts: work, env };
  try {
    const completed = await runRuntimeV2WatermarkPython(
      layout,
      path.basename(envProbe),
      [],
      work,
      new AbortController().signal,
    );
    assert.equal(completed.code, 0, completed.stderr);
    const observed = JSON.parse(completed.stdout);
    assert.equal(observed.TEST_WATERMARK_ONLY, "yes");
    assert.equal(observed.PATH, "");
    assert.equal(observed.CHATMOCK_AUTH_FILE, undefined);

    const abort = new AbortController();
    const running = runRuntimeV2WatermarkPython(
      layout,
      path.basename(waitProbe),
      [],
      work,
      abort.signal,
    );
    setTimeout(() => abort.abort(new Error("cancelled by test")), 50).unref?.();
    const cancelled = await running;
    assert.notEqual(cancelled.code, 0);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});
