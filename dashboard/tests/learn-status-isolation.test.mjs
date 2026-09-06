import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const dashboardRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sourceRoot = path.join(dashboardRoot, "src");

function read(relativePath) {
  return fs.readFileSync(path.join(dashboardRoot, relativePath), "utf8");
}

function writeSparseMarkdown(filePath, frontmatter, size) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const descriptor = fs.openSync(filePath, "w");
  try {
    fs.writeFileSync(descriptor, `${frontmatter.join("\n")}\n`, "utf8");
    fs.ftruncateSync(descriptor, size);
  } finally {
    fs.closeSync(descriptor);
  }
}

function runtimeImports(source) {
  const imports = [];
  for (const match of source.matchAll(/^\s*import\s+([\s\S]*?);/gm)) {
    const declaration = match[1].trim();
    if (declaration.startsWith("type ")) continue;
    const specifier = [...declaration.matchAll(/["']([^"']+)["']/g)].at(-1)?.[1];
    if (specifier) imports.push(specifier);
  }
  for (const match of source.matchAll(/^\s*export\s+(?!type\b)[^\n;]*?from\s+["']([^"']+)["']/gm)) {
    imports.push(match[1]);
  }
  for (const match of source.matchAll(/\b(?:import\s*\(|require\s*\()\s*["']([^"']+)["']/g)) {
    imports.push(match[1]);
  }
  return imports;
}

function resolveLocalImport(importer, specifier) {
  let base;
  if (specifier.startsWith("@/")) {
    base = path.join(sourceRoot, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(importer), specifier);
  } else {
    return null;
  }
  const candidates = path.extname(base)
    ? [base]
    : [
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.mjs`,
        `${base}.js`,
        path.join(base, "index.ts"),
      ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function runtimeClosure(entries) {
  const files = new Set();
  const externals = new Set();
  const queue = [...entries];
  while (queue.length > 0) {
    const current = path.resolve(queue.shift());
    if (files.has(current)) continue;
    files.add(current);
    const source = fs.readFileSync(current, "utf8");
    for (const specifier of runtimeImports(source)) {
      const resolved = resolveLocalImport(current, specifier);
      if (resolved) queue.push(resolved);
      else externals.add(specifier);
    }
  }
  return { files, externals };
}

test("both status runtime aliases use one lightweight in-process projection", () => {
  const development = read("src/lib/learn-status-runtime.dev.ts");
  const production = read("src/lib/learn-status-runtime.production.ts");
  const projection = read("src/lib/learn-status-projection.ts");
  const learn = read("src/lib/learn.ts");
  const nextConfig = read("next.config.ts");
  const desktopPackaging = read("../desktop/scripts/prepare-app-resources.mjs");

  for (const runtime of [development, production]) {
    assert.match(runtime, /from "@\/lib\/learn-status-projection"/);
    assert.match(runtime, /mergeRuntimeV2LearnStatus/);
    assert.doesNotMatch(runtime, /@\/lib\/learn(?:"|')/);
    assert.doesNotMatch(runtime, /learn-status-client|learn-status-worker/);
  }
  assert.equal(
    development.replace(/\s+/g, ""),
    production.replace(/\s+/g, ""),
    "development and production must execute the same status projection",
  );
  assert.match(learn, /projectLearnStatusSnapshot/);
  assert.doesNotMatch(learn, /collectLearnStatusContext/);
  assert.match(nextConfig, /learn-status-runtime\.dev\.ts/);
  assert.match(nextConfig, /learn-status-runtime\.production\.ts/);
  assert.doesNotMatch(desktopPackaging, /learn-status-worker|learn-status-client/);
  assert.equal(
    fs.existsSync(path.join(dashboardRoot, "src/lib/learn-status-client.ts")),
    false,
  );
  assert.equal(
    fs.existsSync(path.join(dashboardRoot, "scripts/learn-status-worker.mjs")),
    false,
  );

  assert.doesNotMatch(projection, /node:child_process|from ["']openai["']/);
  assert.doesNotMatch(projection, /\b(?:spawn|spawnSync|fork|execFile)\s*\(/);
  assert.doesNotMatch(
    projection,
    /\b(?:writeFileSync|appendFileSync|mkdirSync|renameSync|rmSync|unlinkSync)\s*\(/,
  );
  assert.doesNotMatch(projection, /__breadboard|globalThis|setInterval\s*\(/);
  const statusNode = projection.match(
    /interface StatusKnowledgeNode \{([\s\S]*?)\n\}/,
  )?.[1];
  assert.ok(statusNode);
  assert.doesNotMatch(statusNode, /\b(?:body|content)\s*:/);
  assert.match(projection, /const STATUS_SOURCE_CACHE_LIMIT = 128/);
  assert.match(projection, /const STATUS_METADATA_CACHE_LIMIT = 128/);
  assert.match(projection, /while \(cache\.size > limit\)/);
});

test("the route-facing runtime closure cannot reach Learn generation or a child process", () => {
  const entries = [
    path.join(sourceRoot, "lib/learn-status-runtime.dev.ts"),
    path.join(sourceRoot, "lib/learn-status-runtime.production.ts"),
  ];
  const closure = runtimeClosure(entries);
  const relativeFiles = [...closure.files].map((file) =>
    path.relative(dashboardRoot, file).replaceAll("\\", "/"),
  );

  for (const forbidden of [
    "src/lib/learn.ts",
    "src/lib/knowledge.ts",
    "src/lib/source-visuals.ts",
    "src/lib/council.ts",
    "src/lib/ai-models.ts",
    "src/lib/chatmock-providers.ts",
    "src/lib/hardware/compiler.ts",
    "src/lib/provider-usage.ts",
    "src/lib/provider-status.ts",
    "src/lib/repair-executor.ts",
  ]) {
    assert.equal(
      relativeFiles.includes(forbidden),
      false,
      `status runtime reached forbidden generation module ${forbidden}`,
    );
  }
  for (const specifier of closure.externals) {
    assert.notEqual(specifier, "openai");
    assert.notEqual(specifier, "typescript");
    assert.notEqual(specifier, "esbuild");
    assert.notEqual(specifier, "node:child_process");
    assert.notEqual(specifier, "child_process");
  }
  for (const file of closure.files) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(
      source,
      /from\s+["'](?:node:)?child_process["']|require\(["'](?:node:)?child_process["']\)/,
      `status runtime child-process import in ${file}`,
    );
    assert.doesNotMatch(
      source,
      /\bsetInterval\s*\(/,
      `status runtime persistent timer in ${file}`,
    );
  }
});

test("the in-process projection preserves the empty Learn status DTO", async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "learn-status-readonly-"));
  const dataPath = path.join(temporaryRoot, "data");
  const contentPath = path.join(temporaryRoot, "content");
  const gardenId = "status-garden";
  fs.mkdirSync(path.join(contentPath, gardenId, "sources"), { recursive: true });
  fs.writeFileSync(
    path.join(contentPath, gardenId, "sources", "reference.md"),
    [
      "---",
      'title: "Reference"',
      "knowledge_type: source-document",
      "source: upload",
      'source_file: "reference.pdf"',
      'date: "2026-01-02T03:04:05.000Z"',
      "---",
      "",
      "A compact source body.",
      "",
    ].join("\n"),
    "utf8",
  );
  process.env.BREADBOARD_DATA_DIR = dataPath;

  const aliasHooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      const importer = context.parentURL?.startsWith("file:")
        ? fileURLToPath(context.parentURL)
        : path.join(sourceRoot, "index.ts");
      const resolved = resolveLocalImport(importer, specifier);
      if (resolved) {
        return { shortCircuit: true, url: pathToFileURL(resolved).href };
      }
      return nextResolve(specifier, context);
    },
  });
  try {
    const projection = await import(
      `${pathToFileURL(path.join(sourceRoot, "lib/learn-status-projection.ts")).href}?test=${Date.now()}`
    );
    const snapshot = projection.getLearnStatusSnapshot({ gardenId, contentPath });
    assert.deepEqual(snapshot.job, null);
    assert.deepEqual(snapshot.publicationRecovery, null);
    assert.deepEqual(snapshot.proposedLearningMap, null);
    assert.equal(snapshot.hasSources, true);
    assert.equal(snapshot.sourceCount, 1);
    assert.deepEqual(snapshot.selectedSourceIds, ["reference"]);
    assert.equal(snapshot.selectedSourceCount, 1);
    assert.equal(snapshot.syllabusSourceId, null);
    assert.equal(snapshot.syllabusCoverage, null);
    assert.equal(snapshot.hasTextbook, false);
    assert.equal(snapshot.sourceSetChanged, false);
    assert.equal(snapshot.buttonLabel, "Learn");
    assert.equal(snapshot.validationReport, null);
    assert.equal(snapshot.scopedRepair, null);

    writeSparseMarkdown(
      path.join(contentPath, gardenId, "large-ordinary-note.md"),
      ["---", 'title: "Large ordinary note"', "knowledge_type: note", "---", "body"],
      96 * 1024 * 1024,
    );
    writeSparseMarkdown(
      path.join(contentPath, gardenId, "learning", "large-lesson.md"),
      [
        "---",
        'title: "Large lesson"',
        "knowledge_type: learning-page",
        "generated_by: learn_button",
        "---",
        "body",
      ],
      96 * 1024 * 1024,
    );

    const originalReadSync = fs.readSync;
    let bytesRead = 0;
    fs.readSync = (...args) => {
      const count = originalReadSync(...args);
      bytesRead += count;
      return count;
    };
    let boundedSnapshot;
    try {
      for (let poll = 0; poll < 30; poll += 1) {
        boundedSnapshot = projection.getLearnStatusSnapshot({ gardenId, contentPath });
      }
    } finally {
      fs.readSync = originalReadSync;
    }
    assert.equal(boundedSnapshot.hasTextbook, true);
    assert.equal(boundedSnapshot.sourceSetChanged, false);
    assert.ok(
      bytesRead < 512 * 1024,
      `30 polls read ${bytesRead} bytes from large ordinary/Learn-authored pages`,
    );

    writeSparseMarkdown(
      path.join(contentPath, gardenId, "sources", "oversized.md"),
      [
        "---",
        'title: "Oversized source"',
        "knowledge_type: source-document",
        'source_file: "oversized.pdf"',
        "---",
        "body",
      ],
      65 * 1024 * 1024,
    );
    bytesRead = 0;
    fs.readSync = (...args) => {
      const count = originalReadSync(...args);
      bytesRead += count;
      return count;
    };
    let oversizedSnapshot;
    try {
      oversizedSnapshot = projection.getLearnStatusSnapshot({ gardenId, contentPath });
    } finally {
      fs.readSync = originalReadSync;
    }
    assert.equal(oversizedSnapshot.sourceCount, 2);
    assert.equal(oversizedSnapshot.sourceSetChanged, true);
    assert.ok(
      bytesRead < 128 * 1024,
      `oversized source projection read ${bytesRead} bytes`,
    );

    writeSparseMarkdown(
      path.join(contentPath, gardenId, ".breadboard", "validation-report.md"),
      ["Generated: 2026-01-02T03:04:05.000Z", "Accepted: no", "", "Details"],
      2 * 1024 * 1024,
    );
    const report = projection.getLearnValidationReport({ gardenId, contentPath });
    assert.equal(report.accepted, false);
    assert.equal(report.generatedAt, "2026-01-02T03:04:05.000Z");
    assert.equal(report.truncated, true);
    assert.ok(report.markdown.length < 31 * 1024);

    writeSparseMarkdown(
      path.join(contentPath, gardenId, ".breadboard", "scoped-repair.json"),
      ['{"repairId":"oversized"}'],
      2 * 1024 * 1024,
    );
    assert.equal(
      projection.getLearnStatusSnapshot({ gardenId, contentPath }).scopedRepair,
      null,
    );

    const database = await import(
      pathToFileURL(path.join(sourceRoot, "lib/db.ts")).href
    );
    database.default.exec(`
      CREATE TABLE learn_jobs (
        id TEXT PRIMARY KEY,
        garden_id TEXT NOT NULL,
        status TEXT NOT NULL,
        mode TEXT NOT NULL,
        current_step TEXT,
        progress_percent INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    database.default.prepare(
      `INSERT INTO learn_jobs (
         id, garden_id, status, mode, current_step,
         progress_percent, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "legacy-job",
      gardenId,
      "complete",
      "generate",
      "completed",
      100,
      "2026-01-02T03:04:05.000Z",
      "2026-01-02T03:05:05.000Z",
    );
    const legacySnapshot = projection.getLearnStatusSnapshot({ gardenId, contentPath });
    assert.equal(legacySnapshot.job.id, "legacy-job");
    assert.equal(legacySnapshot.job.model, "gpt-5.6-sol");
    assert.deepEqual(legacySnapshot.job.sourceIds, []);

    database.default.exec(`
      CREATE TABLE learn_publication_retries (
        garden_id TEXT PRIMARY KEY,
        reason TEXT NOT NULL,
        last_error TEXT,
        requested_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    database.default.prepare(
      `INSERT INTO learn_publication_retries (
         garden_id, reason, last_error, requested_at, updated_at
       ) VALUES (?, ?, ?, ?, ?)`,
    ).run(
      gardenId,
      "abandoned Learn job recovery",
      "Publication pending",
      "2026-01-02T03:06:05.000Z",
      "2026-01-02T03:07:05.000Z",
    );
    const recoveringSnapshot = projection.getLearnStatusSnapshot({
      gardenId,
      contentPath,
    });
    assert.deepEqual(recoveringSnapshot.publicationRecovery, {
      active: true,
      requestedAt: "2026-01-02T03:06:05.000Z",
      updatedAt: "2026-01-02T03:07:05.000Z",
    });
  } finally {
    aliasHooks.deregister();
    try {
      const database = await import(
        `${pathToFileURL(path.join(sourceRoot, "lib/db.ts")).href}?close=${Date.now()}`
      );
      database.default.close();
    } catch {
      // The process will release the test-only connection on exit.
    }
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("legacy Learn recovery streams a bounded event ledger and fails closed", async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "learn-status-events-"));
  const breadboardDir = path.join(temporaryRoot, ".breadboard");
  const eventPath = path.join(breadboardDir, "events.jsonl");
  fs.mkdirSync(breadboardDir, { recursive: true });
  const recovery = await import(
    `${pathToFileURL(path.join(sourceRoot, "lib/learn-replan-recovery.ts")).href}?test=${Date.now()}`
  );
  try {
    fs.writeFileSync(
      eventPath,
      [
        JSON.stringify({
          type: "learn_source_formulas_reviewed",
          stage: "generation",
          jobId: "job-1",
          newlyReplacedFormulaIds: ["S1.P1.E1"],
        }),
        JSON.stringify({ type: "learn_failed", jobId: "job-1" }),
        "",
      ].join("\n"),
      "utf8",
    );
    assert.equal(
      recovery.failedGenerationRequiresReplanFromEvents({
        gardenDir: temporaryRoot,
        jobId: "job-1",
      }),
      true,
    );

    const descriptor = fs.openSync(eventPath, "w");
    try {
      fs.writeFileSync(descriptor, "{}\n", "utf8");
      fs.ftruncateSync(descriptor, 17 * 1024 * 1024);
    } finally {
      fs.closeSync(descriptor);
    }
    assert.equal(
      recovery.failedGenerationRequiresReplanFromEvents({
        gardenDir: temporaryRoot,
        jobId: "job-1",
      }),
      true,
      "an oversized authority ledger must require a safe replan",
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
