import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { clearLearnDatabaseRecords } from "../src/lib/learn-clear-database.ts";
import { clearGeneratedLearnState } from "../src/lib/learn-clear.ts";
import { copyGardenFolderContents } from "../src/lib/garden-folder-copy.ts";

function temporaryGarden() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-learn-clear-"));
}

function write(root, relPath, content = "fixture") {
  const target = path.join(root, ...relPath.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
  return target;
}

function readJson(root, relPath) {
  return JSON.parse(fs.readFileSync(path.join(root, ...relPath.split("/")), "utf8"));
}

function exists(root, relPath) {
  return fs.existsSync(path.join(root, ...relPath.split("/")));
}

function learnerMarkdown({ title, unitId, visualIds = [], generatedBy = true }) {
  return [
    "---",
    `title: ${JSON.stringify(title)}`,
    "knowledge_type: learning-page",
    `learningUnitId: ${JSON.stringify(unitId)}`,
    `pageId: ${JSON.stringify(`page:${unitId}`)}`,
    ...(generatedBy ? ["generatedBy: learn_button"] : []),
    `visualIds: ${JSON.stringify(visualIds)}`,
    "---",
    "",
    `# ${title}`,
    "",
  ].join("\n");
}

test("Learn clear preserves reader copies after rename, including their shared visuals", () => {
  const garden = temporaryGarden();
  try {
    const lesson = learnerMarkdown({ title: "Fields", unitId: "U1", visualIds: ["shared-field"] });
    write(garden, "learning/_index.md", "---\ntitle: Learning\ngeneratedBy: learn_button\n---\n");
    write(garden, "learning/1. Fields/lesson.md", lesson);
    write(garden, "learning/1. Fields/_index.md", "---\ntitle: Fields\ngenerated_by: learn_button\n---\n");
    write(garden, "learning/1. Fields/plain.md", "# My addition\n");
    write(garden, ".breadboard/visual-index.json", JSON.stringify({
      "shared-field": { id: "shared-field", pageId: "page:U1" },
    }));
    const visual = write(garden, ".breadboard/visuals/shared-field.json", '{"id":"shared-field","pageId":"page:U1"}');
    copyGardenFolderContents(garden, "learning", "learning-copy", value => value.toLowerCase());
    fs.renameSync(path.join(garden, "learning-copy"), path.join(garden, "my-revision"));
    const paths = ["_index.md", "1. Fields/_index.md", "1. Fields/lesson-copy.md", "1. Fields/plain-copy.md"];
    const before = paths.map(file => fs.readFileSync(path.join(garden, "my-revision", file), "utf8"));
    for (const content of before) assert.match(content, /^garden_copy: true$/m);
    assert.equal(fs.readFileSync(path.join(garden, "learning/1. Fields/lesson.md"), "utf8"), lesson);

    // Pre-marker copies must also survive clearing the original generation.
    write(garden, "learning-copy-2/1. Fields/lesson-copy-2.md", lesson);
    const result = clearGeneratedLearnState(garden);
    assert.equal(exists(garden, "learning"), false);
    paths.forEach((file, i) => assert.equal(fs.readFileSync(path.join(garden, "my-revision", file), "utf8"), before[i]));
    assert.equal(fs.readFileSync(path.join(garden, "learning-copy-2/1. Fields/lesson-copy-2.md"), "utf8"), lesson);
    assert.deepEqual(result.removedLearnerPagePaths.filter(file => !file.startsWith("learning/")), []);
    assert.deepEqual(result.removedVisualIds, []);
    assert.equal(fs.existsSync(visual), true);
    assert.ok(readJson(garden, ".breadboard/visual-index.json")["shared-field"]);
  } finally {
    fs.rmSync(garden, { recursive: true, force: true });
  }
});

test("full Learn filesystem clear preserves durable inputs and prunes only learner-owned state", () => {
  const garden = temporaryGarden();
  try {
    write(garden, "sources/paper.md", "---\nknowledge_type: source-document\n---\nSource\n");
    write(garden, "assets/source-visuals/crop.png", "source crop");
    write(garden, "assets/paper-page-001.png", "source page");
    write(garden, "notes/manual.md", "---\ntitle: Manual note\n---\nKeep me.\n");
    write(garden, "_index.md", "---\ntitle: Garden\n---\nKeep the garden shell.\n");
    write(garden, ".breadboard/source-anchors.json", '{"sourceTextConceptAnchors":[]}\n');
    write(garden, ".breadboard/build-workspace.json", '{"stage":"fixture"}\n');

    write(
      garden,
      "learning/1. Section/1.1 Lesson.md",
      learnerMarkdown({ title: "Lesson", unitId: "U1", visualIds: ["learn-only", "shared-manual"] }),
    );
    write(garden, "learning/1. Section/_index.md", "---\ntitle: Section\n---\n# Section\n");
    write(
      garden,
      "notes/generated.md",
      learnerMarkdown({ title: "Generated outside tree", unitId: "U9", visualIds: ["outside-learn"] }),
    );
    write(
      garden,
      "archive/canonical-page.md",
      learnerMarkdown({ title: "Canonical generated page", unitId: "U10", visualIds: ["canonical-learn"], generatedBy: false }),
    );

    write(garden, ".breadboard/source-visuals.json", `${JSON.stringify([
      {
        sourceVisualId: "S1.P1.F1",
        sourceId: "paper",
        pageNumber: 1,
        type: "figure",
        caption: "Preserved extraction",
        pageImagePath: "/garden/assets/paper-page-001.png",
        croppedImagePath: "/garden/assets/source-visuals/crop.png",
        bbox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
        usageStatus: "assigned",
        conceptUsage: "embedded_and_explained",
        cropStatus: "embedded",
        assignedPageId: "learning/1. Section/1.1 Lesson",
        assignedSectionId: "learning/1. Section",
        skipReason: "stale assignment",
      },
      {
        sourceVisualId: "S1.P2.F1",
        sourceId: "paper",
        pageNumber: 2,
        type: "diagram",
        caption: "Already unassigned",
        usageStatus: "unused",
      },
    ], null, 2)}\n`);

    const index = {
      "learn-only": { id: "learn-only", pageSlug: "learning/1. Section/1.1 Lesson", type: "diagram" },
      "outside-learn": { id: "outside-learn", pageSlug: "notes/generated", type: "diagram" },
      "canonical-learn": { id: "canonical-learn", pageId: "page:U10", type: "diagram" },
      "shared-manual": { id: "shared-manual", pageSlug: "notes/manual", type: "diagram" },
      "manual-only": { id: "manual-only", pageSlug: "notes/manual", type: "diagram" },
    };
    write(garden, ".breadboard/visual-index.json", `${JSON.stringify(index, null, 2)}\n`);
    for (const [id, pageId] of [
      ["learn-only", "learning/1. Section/1.1 Lesson"],
      ["outside-learn", "notes/generated"],
      ["canonical-learn", "page:U10"],
      ["shared-manual", "notes/manual"],
      ["manual-only", "notes/manual"],
    ]) {
      write(garden, `.breadboard/visuals/${id}.json`, `${JSON.stringify({ id, pageId })}\n`);
    }
    write(
      garden,
      ".breadboard/visuals/orphan-learn/versions/1/manifest.json",
      '{"id":"orphan-learn","targetPage":"learning/2. Section/2.1 Orphan.md"}\n',
    );
    write(
      garden,
      ".breadboard/visuals/manual-module/versions/1/manifest.json",
      '{"id":"manual-module","targetPage":"notes/manual.md"}\n',
    );

    write(garden, ".breadboard/events.jsonl", [
      JSON.stringify({ type: "learn_page_written", pageId: "page:U1" }),
      JSON.stringify({ type: "visualization_created", pageId: "learning/1. Section/1.1 Lesson", visualId: "learn-only" }),
      JSON.stringify({ type: "source_figure_linked", visualId: "outside-learn" }),
      JSON.stringify({ type: "visual_route_selected", jobId: "learn_job_fixture", visualizationId: "ownerless-route" }),
      JSON.stringify({ type: "manual_note_updated", pageId: "notes/manual" }),
      JSON.stringify({ type: "manual_visual_updated", visualizationId: "manual-only" }),
      "not-json-but-preserved",
      "",
    ].join("\n"));

    for (const relPath of [
      ".breadboard/planning/Source Map.md",
      ".breadboard/learn-run-snapshots/job/manifest.json",
      ".breadboard/canonical-shadow/accepted-snapshot.json",
      ".breadboard/learning-unit-contract.json",
      ".breadboard/visual-necessity-decisions.json",
      ".breadboard/visual-necessity-decisions.md",
      ".breadboard/visual-decision-records.json",
      ".breadboard/visual-contract-executability-reviews.json",
      ".breadboard/formula-assignment-plan.json",
      ".breadboard/formula-identities.json",
      ".breadboard/render-manifest.json",
      ".breadboard/validation-report.md",
      ".breadboard/scoped-repair.json",
      ".breadboard/visualization-coverage.md",
      ".breadboard/visualization-events.json",
      ".breadboard/learn-build.lock.json",
    ]) write(garden, relPath);

    const result = clearGeneratedLearnState(garden);

    assert.equal(exists(garden, "learning"), false);
    assert.equal(exists(garden, "notes/generated.md"), true);
    assert.equal(exists(garden, "archive/canonical-page.md"), true);
    assert.equal(exists(garden, "notes/manual.md"), true);
    assert.equal(exists(garden, "_index.md"), true);
    assert.equal(exists(garden, "sources/paper.md"), true);
    assert.equal(exists(garden, "assets/source-visuals/crop.png"), true);
    assert.equal(exists(garden, ".breadboard/source-anchors.json"), false);
    assert.equal(exists(garden, ".breadboard/build-workspace.json"), false);
    assert.equal(exists(garden, ".breadboard/formula-identities.json"), false);
    assert.equal(exists(garden, ".breadboard/visual-necessity-decisions.json"), false);
    assert.equal(exists(garden, ".breadboard/visual-necessity-decisions.md"), false);
    assert.equal(exists(garden, ".breadboard/visual-decision-records.json"), false);
    assert.equal(exists(garden, ".breadboard/visual-contract-executability-reviews.json"), false);
    assert.equal(exists(garden, ".breadboard/learn-build.lock.json"), false);

    const sourceVisuals = readJson(garden, ".breadboard/source-visuals.json");
    assert.deepEqual(sourceVisuals[0], {
      sourceVisualId: "S1.P1.F1",
      sourceId: "paper",
      pageNumber: 1,
      type: "figure",
      caption: "Preserved extraction",
      pageImagePath: "/garden/assets/paper-page-001.png",
      croppedImagePath: "/garden/assets/source-visuals/crop.png",
      bbox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      usageStatus: "unused",
    });
    assert.equal(sourceVisuals[1].usageStatus, "unused");
    assert.equal(result.resetSourceVisualCount, 1);

    const nextIndex = readJson(garden, ".breadboard/visual-index.json");
    assert.deepEqual(Object.keys(nextIndex).sort(), ["canonical-learn", "manual-only", "outside-learn", "shared-manual"]);
    assert.equal(exists(garden, ".breadboard/visuals/learn-only.json"), false);
    assert.equal(exists(garden, ".breadboard/visuals/outside-learn.json"), true);
    assert.equal(exists(garden, ".breadboard/visuals/canonical-learn.json"), true);
    assert.equal(exists(garden, ".breadboard/visuals/orphan-learn"), false);
    assert.equal(exists(garden, ".breadboard/visuals/shared-manual.json"), true);
    assert.equal(exists(garden, ".breadboard/visuals/manual-only.json"), true);
    assert.equal(exists(garden, ".breadboard/visuals/manual-module"), true);
    assert.deepEqual(result.removedVisualIds, ["learn-only", "orphan-learn"]);

    const eventLines = fs.readFileSync(path.join(garden, ".breadboard/events.jsonl"), "utf8").trim().split("\n");
    assert.equal(result.removedEventCount, 3);
    assert.equal(eventLines.length, 4);
    assert.match(eventLines[0], /source_figure_linked/);
    assert.match(eventLines[1], /manual_note_updated/);
    assert.match(eventLines[2], /manual_visual_updated/);
    assert.equal(eventLines[3], "not-json-but-preserved");

    assert.deepEqual(result.modifiedPaths, [
      ".breadboard/events.jsonl",
      ".breadboard/source-visuals.json",
      ".breadboard/visual-index.json",
    ]);
    assert.ok(result.removedPaths.includes("learning"));
    assert.ok(!result.removedPaths.includes("notes/generated.md"));
    assert.ok(!result.removedPaths.includes("archive/canonical-page.md"));
    assert.ok(result.removedPaths.includes(".breadboard/planning"));
    assert.ok(result.removedPaths.includes(".breadboard/learn-run-snapshots"));
    assert.ok(result.removedPaths.includes(".breadboard/learn-build.lock.json"));
    assert.ok(result.removedPaths.includes(".breadboard/build-workspace.json"));
    assert.ok(result.removedPaths.includes(".breadboard/source-anchors.json"));
    assert.ok(result.removedPaths.includes(".breadboard/render-manifest.json"));
    assert.ok(result.removedPaths.includes(".breadboard/visualization-coverage.md"));
    assert.ok(result.removedPaths.includes(".breadboard/visualization-events.json"));
    assert.deepEqual(result.removedLearnerPagePaths, [
      "learning/1. Section/_index.md",
      "learning/1. Section/1.1 Lesson.md",
    ]);

    const idempotent = clearGeneratedLearnState(garden);
    assert.deepEqual(idempotent, {
      removedPaths: [],
      modifiedPaths: [],
      removedLearnerPagePaths: [],
      removedVisualIds: [],
      removedEventCount: 0,
      resetSourceVisualCount: 0,
    });
  } finally {
    fs.rmSync(garden, { recursive: true, force: true });
  }
});

test("schema-versioned visual indexes are filtered without discarding manual entries", () => {
  const garden = temporaryGarden();
  try {
    write(
      garden,
      "learning/generated.md",
      learnerMarkdown({ title: "Generated", unitId: "U2", visualIds: ["schema-learn"], generatedBy: false }),
    );
    write(garden, "notes/manual.md", "---\ntitle: Manual\n---\nKeep.\n");
    write(garden, ".breadboard/visual-index.json", `${JSON.stringify({
      schemaVersion: 1,
      visuals: [
        { id: "schema-learn", pageId: "page:U2", type: "diagram" },
        { id: "schema-manual", pageId: "notes/manual", type: "diagram" },
      ],
    }, null, 2)}\n`);
    write(garden, ".breadboard/visuals/schema-learn.json", '{"id":"schema-learn","canonicalPageId":"page:U2"}\n');
    write(garden, ".breadboard/visuals/schema-manual.json", '{"id":"schema-manual","pageId":"notes/manual"}\n');

    const result = clearGeneratedLearnState(garden);
    const index = readJson(garden, ".breadboard/visual-index.json");

    assert.equal(index.schemaVersion, 1);
    assert.deepEqual(index.visuals.map((entry) => entry.id), ["schema-manual"]);
    assert.deepEqual(result.removedVisualIds, ["schema-learn"]);
    assert.deepEqual(result.modifiedPaths, [".breadboard/visual-index.json"]);
    assert.equal(exists(garden, ".breadboard/visuals/schema-learn.json"), false);
    assert.equal(exists(garden, ".breadboard/visuals/schema-manual.json"), true);
    assert.equal(exists(garden, "notes/manual.md"), true);
  } finally {
    fs.rmSync(garden, { recursive: true, force: true });
  }
});

test("database clear deletes only the selected garden's Learn history", () => {
  const database = new Database(":memory:");
  try {
    database.exec(`
      CREATE TABLE learn_jobs (id TEXT PRIMARY KEY, garden_id TEXT NOT NULL);
      CREATE TABLE learn_job_token_usage (job_id TEXT PRIMARY KEY);
      CREATE TABLE learn_maps (id TEXT PRIMARY KEY, garden_id TEXT NOT NULL);
      CREATE TABLE learn_versions (id TEXT PRIMARY KEY, garden_id TEXT NOT NULL);
    `);
    const insertJob = database.prepare("INSERT INTO learn_jobs (id, garden_id) VALUES (?, ?)");
    const insertUsage = database.prepare("INSERT INTO learn_job_token_usage (job_id) VALUES (?)");
    for (const [jobId, gardenId] of [
      ["target-job-1", "target"],
      ["target-job-2", "target"],
      ["other-job", "other"],
    ]) {
      insertJob.run(jobId, gardenId);
      insertUsage.run(jobId);
    }
    database.prepare("INSERT INTO learn_maps (id, garden_id) VALUES (?, ?)").run("target-map", "target");
    database.prepare("INSERT INTO learn_maps (id, garden_id) VALUES (?, ?)").run("other-map", "other");
    database.prepare("INSERT INTO learn_versions (id, garden_id) VALUES (?, ?)").run("target-version", "target");
    database.prepare("INSERT INTO learn_versions (id, garden_id) VALUES (?, ?)").run("other-version", "other");

    const result = database.transaction(() =>
      clearLearnDatabaseRecords(database, "target"))();

    assert.deepEqual(result, {
      deletedJobs: 2,
      deletedTokenUsageRows: 2,
      deletedMaps: 1,
      deletedVersions: 1,
    });
    assert.deepEqual(database.prepare("SELECT id FROM learn_jobs ORDER BY id").all(), [
      { id: "other-job" },
    ]);
    assert.deepEqual(database.prepare("SELECT job_id FROM learn_job_token_usage").all(), [
      { job_id: "other-job" },
    ]);
    assert.deepEqual(database.prepare("SELECT id FROM learn_maps").all(), [
      { id: "other-map" },
    ]);
    assert.deepEqual(database.prepare("SELECT id FROM learn_versions").all(), [
      { id: "other-version" },
    ]);
  } finally {
    database.close();
  }
});
