import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  externalRuntimeAccess,
  externalRuntimeCopyFile,
  externalRuntimeCopyFileAsync,
  externalRuntimeCopyTree,
  externalRuntimeFilesystem,
  externalRuntimeLstat,
  externalRuntimePathExists,
  externalRuntimeReadFile,
  externalRuntimeReadFileAsync,
  externalRuntimeReadDirectory,
  externalRuntimeReadDirectoryEntries,
  externalRuntimeReadDirectoryEntriesAsync,
  externalRuntimeReadUtf8,
  externalRuntimeReadUtf8Async,
  externalRuntimePortableRealpath,
  externalRuntimeRealpath,
  externalRuntimeStat,
  externalRuntimeStatAsync,
  externalRuntimeStatIfPresent,
} from "../src/lib/external-runtime-filesystem.ts";
import { externalRuntimePath } from "../src/lib/external-runtime-path.ts";
import { openRuntimeSqliteDatabase } from "../src/lib/runtime-sqlite-database.ts";

const dashboardRoot = path.resolve(import.meta.dirname, "..");

const externalCloneModules = [
  "src/lib/resource2skill/runtime.ts",
  "src/lib/resource2skill/setup.ts",
  "src/lib/matraix/runtime.ts",
  "src/lib/matraix/setup.ts",
  "src/lib/deer-flow/runtime.ts",
  "src/lib/deep-tutor/runtime.ts",
  "src/lib/vibe-trading/runtime.ts",
  "src/lib/stock-analyst/runtime.ts",
  "src/lib/career-ops/runtime.ts",
  "src/lib/career-ops/commands.ts",
  "src/lib/career-ops/run-manager.ts",
  "src/lib/career-ops/skill-prompt.ts",
  "src/lib/openmontage/runtime.ts",
  "src/lib/openmontage/prompt.ts",
  "src/lib/hyperframes/runtime.ts",
  "src/lib/hyperframes/prompt.ts",
  "src/lib/hyperframes/setup.ts",
  "src/lib/hyperframes/workspace.ts",
  "src/lib/ruflo/runtime.ts",
  "src/lib/opencode/run-manager.ts",
  "src/lib/nango/catalog.ts",
  "src/lib/hermes/agency-agents.ts",
  "src/lib/aris/agent.ts",
  "src/lib/tradingagents/runtime.ts",
  "src/lib/shaper/source.ts",
  "src/lib/subsai/runtime.ts",
  "src/lib/subsai/transcribe.ts",
  "src/lib/bolt-slides/runtime.ts",
  "src/lib/bolt-slides/author.ts",
  "src/lib/bolt-slides/kit-digest.ts",
  "src/lib/bolt-slides/workspace.ts",
  "src/lib/video-use/runtime.ts",
  "src/lib/video-use/plan.ts",
  "src/lib/wardrobe/runtime.ts",
  "src/lib/classroom/runtime.ts",
  "src/lib/gods-eye/runtime.ts",
  "src/lib/shorts/runtime.ts",
  "src/lib/codex/run-manager.ts",
];

const opaqueRuntimePathModules = [
  "src/lib/aris/agent.ts",
  "src/lib/codex/run-manager.ts",
  "src/lib/code-index/index-service.ts",
  "src/lib/code-index/launcher.ts",
  "src/lib/code-index/runtime-build.ts",
  "src/lib/garden-mutation-lease.ts",
  "src/lib/hermes/agency-agents.ts",
  "src/lib/hermes/capability-policy.ts",
  "src/lib/hermes/config.ts",
  "src/lib/nango/catalog.ts",
  "src/lib/opencode/run-manager.ts",
  "src/lib/ruflo/run-manager.ts",
  "src/lib/runtime-sqlite-database.ts",
  "src/lib/runtime-paths.ts",
  "src/lib/telegram/config.ts",
  "src/lib/whatsapp/config.ts",
];

const opaqueDataFilesystemModules = [
  "src/app/actions/clusters.ts",
  "src/app/api/chat-attachments/audio/[blobId]/route.ts",
  "src/app/api/chat-attachments/documents/[blobId]/route.ts",
  "src/app/api/chat-attachments/documents/route.ts",
  "src/app/api/chat-attachments/videos/[blobId]/route.ts",
  "src/app/api/deer-flow/runs/[runId]/artifacts/[artifactId]/route.ts",
  "src/app/api/documents/[slug]/route.ts",
  "src/app/api/documents/[slug]/source-pdf/history/route.ts",
  "src/app/api/documents/[slug]/source-pdf/route.ts",
  "src/app/api/gardens/[gardenId]/learn/events/route.ts",
  "src/app/api/gardens/[gardenId]/learn/validation-report/route.ts",
  "src/app/api/gardens/[gardenId]/visualizations/[visualId]/regenerate/route.ts",
  "src/app/api/gardens/[gardenId]/visualizations/[visualId]/rollback/route.ts",
  "src/app/api/generate-notes/route.ts",
  "src/app/api/hermes/artifacts/[artifactId]/download/route.ts",
  "src/app/api/hermes/artifacts/[artifactId]/genoffice/route.ts",
  "src/app/api/hermes/artifacts/[artifactId]/preview/route.ts",
  "src/app/api/hermes/artifacts/images/route.ts",
  "src/app/api/hermes/tools/workspace/route.ts",
  "src/app/api/markdown-edit/route.ts",
  "src/app/api/markdown-images/route.ts",
  "src/app/api/markdown-to-pdf/route.ts",
  "src/app/api/markdown-videos/route.ts",
  "src/app/api/open-gym/exercises/[exerciseId]/animation/route.ts",
  "src/app/api/openscience/runs/[runId]/deliverables/route.ts",
  "src/app/api/pdfjs/[...path]/route.ts",
  "src/app/api/quartz-graph-preview/route.ts",
  "src/app/api/tag-markdowns/route.ts",
  "src/app/api/visualizations/migrate/route.ts",
  "src/lib/bolt-slides/workspace.ts",
  "src/lib/cad/blob-store.ts",
  "src/lib/cliproxy/config.ts",
  "src/lib/conversations/audio-blob-store.ts",
  "src/lib/conversations/document-blob-store.ts",
  "src/lib/conversations/model-blob-store.ts",
  "src/lib/conversations/video-blob-store.ts",
  "src/lib/deer-flow/artifact.ts",
  "src/lib/deep-tutor/home.ts",
  "src/lib/deep-tutor/materials.ts",
  "src/lib/document-skills/service.ts",
  "src/lib/document-skills/store.ts",
  "src/lib/document-skills/validate.ts",
  "src/lib/garden-markdown-assets.ts",
  "src/lib/goal-mode.ts",
  "src/lib/garden-transfer/archive.ts",
  "src/lib/garden-transfer/export.ts",
  "src/lib/garden-transfer/import.ts",
  "src/lib/hermes/artifact-image-service.ts",
  "src/lib/hermes/artifact-renderers.ts",
  "src/lib/hermes/artifact-store.ts",
  "src/lib/hermes/bullshit-skills-source.ts",
  "src/lib/hermes/design-skills-source.ts",
  "src/lib/hermes/engineering-skills-source.ts",
  "src/lib/hermes/hallmark-skills-source.ts",
  "src/lib/hermes/interactive-visualizer-browser.ts",
  "src/lib/hermes/local-mcp-approved-profile.ts",
  "src/lib/hermes/mcp-connections.ts",
  "src/lib/hermes/office-skills-source.ts",
  "src/lib/hermes/omh-skills-source.ts",
  "src/lib/hermes/reverse-skills-source.ts",
  "src/lib/hermes/scientific-skills-source.ts",
  "src/lib/hermes/skills.ts",
  "src/lib/hermes/skills-catalog-store.ts",
  "src/lib/hermes/workspace.ts",
  "src/lib/hyperframes/runtime.ts",
  "src/lib/hyperframes/workspace.ts",
  "src/lib/knowledge.ts",
  "src/lib/legal/runtime.ts",
  "src/lib/learn-build-workspace.ts",
  "src/lib/meeting-notes/uploads.ts",
  "src/lib/loopx/state.ts",
  "src/lib/office/contract.ts",
  "src/lib/office/runtime-v2.ts",
  "src/lib/openscience/runtime.ts",
  "src/lib/openscience/config.ts",
  "src/lib/openscience/run-manager.ts",
  "src/lib/openscience/setup.ts",
  "src/lib/openmontage/workspace.ts",
  "src/lib/quartz-garden-index.ts",
  "src/lib/agent-edits/runtime-client.ts",
  "src/lib/opencode/repository.ts",
  "src/lib/ruflo/runtime.ts",
  "src/lib/openwork/setup.ts",
  "src/lib/openwork/runtime-service.ts",
  "src/lib/openwork/runtime.ts",
  "src/lib/runtime-v2/learn-binding.ts",
  "src/lib/socials-manager/local-state.ts",
  "src/lib/speech/voicebox-client.ts",
  "src/lib/telegram/credentials.ts",
  "src/lib/tradingagents/credentials.ts",
  "src/lib/video-use/session.ts",
  "src/lib/whatsapp/status.ts",
];

const opaqueLearnGardenModules = [
  "src/lib/critic-loop.ts",
  "src/lib/db.ts",
  "src/lib/final-garden-state.ts",
  "src/lib/formula-identity.ts",
  "src/lib/formula-usage-reconciliation.ts",
  "src/lib/garden-build/legacy-import.ts",
  "src/lib/garden-build/repair-adapters.ts",
  "src/lib/garden-build/scoped-files.ts",
  "src/lib/garden-build/shadow.ts",
  "src/lib/garden-directory.ts",
  "src/lib/garden-finalize.ts",
  "src/lib/garden-renderer/projection-validation.ts",
  "src/lib/garden-renderer/render-garden.ts",
  "src/lib/garden-semantics.ts",
  "src/lib/generated-visual-council-receipts.ts",
  "src/lib/generated-visuals.ts",
  "src/lib/humanizer/config.ts",
  "src/lib/learn-atomic-promotion.ts",
  "src/lib/learn-build-manifest.ts",
  "src/lib/learn-clear.ts",
  "src/lib/learn-humanizer.ts",
  "src/lib/learn-operation-runtime-v2.ts",
  "src/lib/learn-planning-checkpoints.ts",
  "src/lib/learn-planning-legacy-waiver.ts",
  "src/lib/learn-replan-recovery.ts",
  "src/lib/learn-scoped-repair.ts",
  "src/lib/learn-status-projection.ts",
  "src/lib/learn-structure-reconciliation.ts",
  "src/lib/learn-visual-rejected-attempt-audit.ts",
  "src/lib/learn.ts",
  "src/lib/model-source-anchor-ledger.ts",
  "src/lib/resilient-fs.ts",
  "src/lib/semantic-reconciliation.ts",
  "src/lib/source-visuals.ts",
  "src/lib/visual-necessity.ts",
  "src/lib/visualization-contract-executability.ts",
  "src/lib/visualization-opportunities.ts",
  "src/lib/visualization-registry.ts",
  "src/lib/visuals.ts",
  "src/lib/weak-anchor-self-healing.ts",
];

function source(relative) {
  return fs.readFileSync(path.join(dashboardRoot, relative), "utf8");
}

function unguardedRuntimeReads(contents) {
  const calls =
    /(?<![A-Za-z0-9_.])(?:fs\.|fsp\.|fsPromises\.)?(?:existsSync|lstatSync|statSync|realpathSync(?:\.native)?|readFileSync|readdirSync|readlinkSync|createReadStream|copyFile|readFile|readdir|lstat|stat|realpath)\s*\(([\s\S]{0,80})/gu;
  return [...contents.matchAll(calls)]
    .filter((match) => !match[1].trimStart().startsWith("/* turbopackIgnore: true */"))
    .map((match) => match[0].split(/\r?\n/u)[0]);
}

test("external Runtime V2 filesystem boundaries keep real runtime behavior", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-runtime-trace-"));
  const sourceDirectory = path.join(root, "source");
  const nested = path.join(sourceDirectory, "nested");
  const original = path.join(nested, "receipt.json");
  const copied = path.join(root, "copied.json");
  const copiedTree = path.join(root, "tree");
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(original, '{"ready":true}\n', "utf8");

  try {
    assert.equal(externalRuntimePathExists(original), true);
    assert.equal(externalRuntimeFilesystem.existsSync(original), true);
    assert.equal(externalRuntimePathExists(path.join(root, "missing")), false);
    assert.equal(externalRuntimeReadUtf8(original), '{"ready":true}\n');
    assert.equal(externalRuntimeReadFile(original).toString("utf8"), '{"ready":true}\n');
    assert.equal(externalRuntimeStat(original).isFile(), true);
    assert.equal(externalRuntimeStatIfPresent(original)?.isFile(), true);
    assert.equal(externalRuntimeStatIfPresent(path.join(root, "missing")), undefined);
    assert.equal(externalRuntimeLstat(sourceDirectory).isDirectory(), true);
    assert.equal(externalRuntimeRealpath(original), fs.realpathSync.native(original));
    assert.equal(
      externalRuntimePortableRealpath(original),
      process.platform === "win32"
        ? fs.realpathSync.native(original)
        : fs.realpathSync(original),
    );
    if (process.platform === "win32") {
      const extendedOriginal = `\\\\?\\${original}`;
      const canonical = externalRuntimePortableRealpath(extendedOriginal);
      assert.equal(canonical, fs.realpathSync.native(extendedOriginal));
      assert.match(canonical, /^[A-Za-z]:\\/u);
      assert.doesNotMatch(canonical, /^[A-Za-z]:$/u);
    }
    assert.doesNotThrow(() => externalRuntimeAccess(original, fs.constants.R_OK));
    assert.throws(
      () => externalRuntimeAccess(path.join(root, "missing"), fs.constants.R_OK),
      /ENOENT/u,
    );
    assert.deepEqual(externalRuntimeReadDirectory(sourceDirectory), ["nested"]);
    assert.equal(externalRuntimeReadDirectoryEntries(sourceDirectory)[0]?.isDirectory(), true);
    assert.equal(await externalRuntimeReadUtf8Async(original), '{"ready":true}\n');
    assert.equal((await externalRuntimeReadFileAsync(original)).toString("utf8"), '{"ready":true}\n');
    assert.equal((await externalRuntimeStatAsync(original)).isFile(), true);
    assert.equal(externalRuntimePath.join(root, "source"), sourceDirectory);
    assert.equal(externalRuntimePath.resolve(original), path.resolve(original));
    assert.equal(externalRuntimePath.basename(original), "receipt.json");
    assert.equal(
      (await externalRuntimeReadDirectoryEntriesAsync(sourceDirectory))[0]?.isDirectory(),
      true,
    );

    externalRuntimeCopyFile(original, copied);
    assert.equal(fs.readFileSync(copied, "utf8"), '{"ready":true}\n');
    const copiedAsync = path.join(root, "copied-async.json");
    await externalRuntimeCopyFileAsync(original, copiedAsync);
    assert.equal(fs.readFileSync(copiedAsync, "utf8"), '{"ready":true}\n');
    externalRuntimeCopyTree(sourceDirectory, copiedTree);
    assert.equal(
      fs.readFileSync(path.join(copiedTree, "nested", "receipt.json"), "utf8"),
      '{"ready":true}\n',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("every external filesystem leaf is excluded from Turbopack static tracing", () => {
  const boundary = source("src/lib/external-runtime-filesystem.ts");
  const calls = [
    "existsSync",
    "lstatSync",
    "statSync",
    "accessSync",
    "readFileSync",
    "readdirSync",
    "copyFileSync",
    "cpSync",
  ];
  for (const call of calls) {
    assert.match(
      boundary,
      new RegExp(`${call}\\(\\/\\* turbopackIgnore: true \\*\\/ candidate|${call}\\(\\/\\* turbopackIgnore: true \\*\\/ source`),
      `${call} must keep its real argument behind the Turbopack boundary`,
    );
  }
  assert.match(
    boundary,
    /realpathSync\.native\(\/\* turbopackIgnore: true \*\/ candidate\)/,
  );
  assert.match(
    boundary,
    /externalRuntimePortableRealpath[\s\S]*?process\.platform === "win32"[\s\S]*?realpathSync\.native/,
  );
  assert.match(boundary, /promises\.stat\(\/\* turbopackIgnore: true \*\/ candidate\)/);
  assert.match(boundary, /promises\.readFile\(\/\* turbopackIgnore: true \*\/ candidate/);
  assert.match(boundary, /promises\.copyFile\(\/\* turbopackIgnore: true \*\/ source/);
  assert.match(boundary, /promises\.readdir\(\/\* turbopackIgnore: true \*\/ candidate/);
  assert.doesNotMatch(boundary, /return\s+false\s*;/);
});

test("large service clones are discovered through the shared runtime boundary", () => {
  for (const relative of externalCloneModules) {
    assert.match(
      source(relative),
      /external-runtime-filesystem\.ts/,
      `${relative} must not expose its external checkout to the build tracer`,
    );
  }
});

test("route data files use the opaque filesystem value instead of a traceable Node import", () => {
  for (const relative of opaqueDataFilesystemModules) {
    const contents = source(relative);
    assert.match(
      contents,
      /externalRuntimeFilesystem(?:\s+as\s+fs)?/,
      `${relative} must keep mutable data paths behind the runtime filesystem boundary`,
    );
    assert.doesNotMatch(
      contents,
      /import\s+(?!type\b)[^;]*\sfrom\s+["'](?:node:fs|fs)["']/u,
      `${relative} must not expose mutable data paths through a direct filesystem value import`,
    );
    assert.doesNotMatch(
      contents,
      /import\s+(?!type\b)[^;]*\sfrom\s+["'](?:node:path|path)["']/u,
      `${relative} must not expose mutable data paths through a direct path builtin import`,
    );
  }
});

test("runtime-only path construction uses the opaque path builtin", () => {
  for (const relative of opaqueRuntimePathModules) {
    const contents = source(relative);
    assert.match(
      contents,
      /externalRuntimePath(?:\s+as\s+path)?/,
      `${relative} must keep mutable runtime paths behind the opaque path boundary`,
    );
    assert.doesNotMatch(
      contents,
      /import\s+(?!type\b)[^;]*\sfrom\s+["'](?:node:path|path)["']/u,
      `${relative} must not expose mutable runtime paths through a direct path builtin import`,
    );
  }
});

test("the Learn and Garden runtime closure cannot expose mutable paths to tracing", () => {
  for (const relative of opaqueLearnGardenModules) {
    const contents = source(relative);
    assert.match(
      contents,
      /external-runtime-filesystem\.ts/,
      `${relative} must use the opaque filesystem boundary`,
    );
    assert.match(
      contents,
      /external-runtime-path\.ts/,
      `${relative} must use the opaque path boundary`,
    );
    assert.doesNotMatch(
      contents,
      /import\s+(?!type\b)[^;]*\sfrom\s+["'](?:node:fs|fs)(?:\/promises)?["']/u,
      `${relative} must not expose Learn or Garden data through a direct filesystem value import`,
    );
    assert.doesNotMatch(
      contents,
      /import\s+(?!type\b)[^;]*\sfrom\s+["'](?:node:path|path)["']/u,
      `${relative} must not expose Learn or Garden data through a direct path value import`,
    );
  }
});

test("the PDF.js route has one closed static deployment closure", () => {
  const route = source("src/app/api/pdfjs/[...path]/route.ts");
  const config = source("next.config.ts");
  assert.match(route, /externalRuntimeFilesystem as fs/);
  assert.doesNotMatch(route, /import\s+fs\s+from\s+["'](?:node:fs|fs)["']/u);
  assert.match(config, /['"]\/api\/pdfjs\/\\\\\[\\\\\.\\\\\.\\\\\.path\\\\\]['"]:\s*\[/u);
  for (const required of [
    "node_modules/pdfjs-dist/legacy/build/pdf.mjs",
    "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    "node_modules/pdfjs-dist/legacy/web/pdf_viewer.mjs",
    "node_modules/pdfjs-dist/legacy/web/images/**/*",
  ]) {
    assert.ok(config.includes(`'${required}'`), required);
  }
});

test("the mutable database path crosses an opaque, authority-checked constructor", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-runtime-sqlite-"));
  const candidate = path.join(root, "probe.db");
  try {
    const database = openRuntimeSqliteDatabase({
      authorityRoot: root,
      candidate,
      filename: "probe.db",
    });
    database.exec("CREATE TABLE proof (id INTEGER PRIMARY KEY)");
    database.close();
    assert.equal(fs.statSync(candidate).isFile(), true);
    assert.throws(
      () =>
        openRuntimeSqliteDatabase({
          authorityRoot: root,
          candidate: path.join(root, "..", "escaped.db"),
          filename: "escaped.db",
        }),
      /outside its authority/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  const databaseSource = source("src/lib/db.ts");
  const boundarySource = source("src/lib/runtime-sqlite-database.ts");
  assert.doesNotMatch(databaseSource, /new\s+Database\s*\(/u);
  assert.match(databaseSource, /openRuntimeSqliteDatabase\(/u);
  assert.match(boundarySource, /Reflect\.construct\(Database, \[candidate\]\)/u);
});

test("route-reachable runtime and user-data reads cannot bypass the trace boundary", () => {
  const modules = [...new Set([
    ...externalCloneModules,
    "src/lib/agent-browser/browser-profile.ts",
    "src/lib/agent-browser/opencli-extension.ts",
    "src/lib/agent-browser/opencli-profile.ts",
    "src/lib/agent-browser/run-manager.ts",
    "src/lib/agent-reach/run-manager.ts",
    "src/lib/agent-reach/runtime.ts",
    "src/lib/agent-reach/skill-prompt.ts",
    "src/lib/agent-reach/spawn-plan.ts",
    "src/lib/bolt-slides/workspace.ts",
    "src/lib/codex/run-manager.ts",
    "src/lib/db.ts",
    "src/lib/generated-visuals.ts",
    "src/lib/hyperframes/prompt.ts",
    "src/lib/hyperframes/run-manager.ts",
    "src/lib/hyperframes/runtime-run-manager.ts",
    "src/lib/hyperframes/workspace.ts",
  ])];
  for (const relative of modules) {
    assert.deepEqual(
      unguardedRuntimeReads(source(relative)),
      [],
      `${relative} has a direct read-side filesystem call Turbopack can expand`,
    );
  }
});

test("esbuild is staged for the disposable compiler worker instead of traced by Next", () => {
  const config = source("next.config.ts");
  assert.doesNotMatch(config, /outputFileTracingIncludes[\s\S]*?esbuild/);
  const excludes = config.match(/const dataTraceExcludes = \[([\s\S]*?)\n\];/);
  assert.ok(excludes, "next.config.ts must declare the global trace exclusions");
  assert.match(excludes[1], /\*\*\/node_modules\/three\/\*\*/);
  assert.match(excludes[1], /\*\*\/node_modules\/@embedpdf\/pdfium\/\*\*/);
  assert.doesNotMatch(
    config,
    /['"]\/api\/ingest['"]:\s*\[[\s\S]*?node_modules\/(?:@napi-rs\/canvas|@firecrawl\/anydoc)/,
  );
  assert.doesNotMatch(config, /serverExternalPackages:\s*\[[\s\S]*?['"]three['"]/);
  assert.doesNotMatch(config, /serverExternalPackages:\s*\[[\s\S]*?['"]esbuild['"]/);
  assert.doesNotMatch(config, /mem0ai/);
  const buildCache = source("../desktop/scripts/dashboard-build-cache.mjs");
  assert.match(buildCache, /stageStandaloneDashboardRuntimeDependencies/);
  assert.match(buildCache, /resolveEsbuildRuntimeClosure/);
  assert.match(buildCache, /resolveThreeRuntimeClosure/);
  assert.match(buildCache, /resolveTypeScriptRuntimeClosure/);
  assert.match(buildCache, /files\.length|const files = \[/);
  assert.doesNotMatch(buildCache, /node_modules[\\/]esbuild[\\/]bin[\\/]esbuild/);
  assert.match(source("scripts/runtime-v2-mem0-service.mjs"), /from "mem0ai\/oss"/);
  assert.match(
    source("../desktop/runtime-v2/manifests/services.json"),
    /"id": "mem0-semantic-engine"/,
  );
  const visualizerService = source("src/lib/hermes/interactive-visualizer-service.ts");
  assert.match(visualizerService, /interactive-visualizer-plan\.ts/);
  assert.doesNotMatch(visualizerService, /interactive-visualizer-validator\.ts/);
  const generatedVisuals = source("src/lib/generated-visuals.ts");
  const generatedVisualCompiler = source("src/lib/generated-visual-compiler.ts");
  const generatedVisualBrowserTests = source(
    "src/lib/generated-visual-browser-tests.ts",
  );
  assert.doesNotMatch(generatedVisuals, /from\s+["']typescript["']|createRequire|runtimeTypeScript/);
  assert.doesNotMatch(generatedVisuals, /function\s+compileGeneratedVisualization\s*\(/);
  assert.doesNotMatch(generatedVisuals, /runObservedGeneratedVisualBrowserProcess/);
  assert.doesNotMatch(generatedVisuals, /generated-visual-browser-process/);
  assert.doesNotMatch(generatedVisuals, /browserTestRunner\?:/);
  assert.doesNotMatch(generatedVisuals, /input\.browserTestRunner\s*\?\?/);
  assert.match(generatedVisualCompiler, /^import\s+ts\s+from\s+["']typescript["']/mu);
  assert.match(
    generatedVisualBrowserTests,
    /runObservedGeneratedVisualBrowserProcess/,
  );
  const regeneration = source(
    "src/app/api/gardens/[gardenId]/visualizations/[visualId]/regenerate/route.ts",
  );
  assert.match(regeneration, /compileGeneratedVisualizationViaRuntime/);
  assert.match(regeneration, /compilerRunner:/);
  assert.match(regeneration, /runGeneratedVisualBrowserTestsViaRuntime/);
  assert.match(regeneration, /browserTestRunner:/);
  assert.doesNotMatch(regeneration, /generated-visual-compiler(?:\.ts)?["']/);
  const traceSafety = source("../desktop/scripts/dashboard-trace-safety.mjs");
  for (const workerOnly of ["esbuild", "@esbuild", "typescript", "three", "@embedpdf/pdfium"]) {
    assert.match(traceSafety, new RegExp(workerOnly.replace("/", "\\/")));
  }
});

test("the Quartz visual sandbox remains a live runtime read, not a traced source tree", () => {
  const visuals = source("src/lib/generated-visuals.ts");
  assert.match(visuals, /generatedVisualSandbox\.inline\.js/);
  assert.match(
    visuals,
    /existsSync\(\/\* turbopackIgnore: true \*\/ candidate\)/,
  );
  assert.match(
    visuals,
    /readFileSync\(\s*\/\* turbopackIgnore: true \*\/ sandboxRuntimePath\(\)/,
  );
});

test("Nango logos stay runtime-served without tracing the provider checkout", () => {
  const route = source("src/app/api/hermes/nango/integrations/logo/route.ts");
  const boundedFile = source("src/lib/bounded-runtime-file.ts");
  assert.match(route, /readBoundedDirectRuntimeFile\(/);
  assert.match(route, /allowedRoot: path\.dirname\(logoPath\)/);
  assert.doesNotMatch(route, /node:fs/);
  assert.match(boundedFile, /externalRuntimeFilesystem as fs/);
  assert.match(boundedFile, /fs\.constants\.O_NOFOLLOW/);
  assert.match(boundedFile, /file\.isSymbolicLink\(\)/);
  assert.match(boundedFile, /file\.nlink !== BIGINT_ONE/);
  assert.match(boundedFile, /handle\.stat\(\{ bigint: true \}\)/);
  assert.deepEqual(unguardedRuntimeReads(boundedFile), []);
  assert.match(route, /return new NextResponse\(Uint8Array\.from\(logo\),/);
});
