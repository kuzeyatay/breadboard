import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createDetachedGardenMutation,
  disposeDetachedGardenMutation,
  fingerprintPublishedGarden,
  promoteDetachedGardenMutation,
} from "../src/lib/garden-mutation-transaction.ts";
import {
  generatedVisualPublicationPointersMatch,
  legacyVisualPublicationPointersMatch,
} from "../src/lib/generated-visual-publication-coherence.ts";
import {
  acquireGardenLearnLease,
  acquireGardenLearnLock,
  LOCK_STALE_MS,
  releaseGardenLearnLock,
} from "../src/lib/learn-atomic-promotion.ts";

const roots = [];
test.after(() => {
  for (const root of roots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function fixtureGarden(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  roots.push(root);
  const gardenDir = path.join(root, "electromagnetics-1");
  const artifactDir = path.join(
    gardenDir,
    ".breadboard",
    "visuals",
    "field-lines",
  );
  fs.mkdirSync(path.join(artifactDir, "versions", "1"), { recursive: true });
  const manifest = {
    id: "field-lines",
    version: 1,
    sourceHash: "source-v1",
    compiledHash: "compiled-v1",
  };
  fs.writeFileSync(path.join(gardenDir, "lesson.md"), "visual field-lines v1\n");
  fs.writeFileSync(path.join(artifactDir, "manifest.json"), `${JSON.stringify(manifest)}\n`);
  fs.writeFileSync(
    path.join(artifactDir, "versions", "1", "manifest.json"),
    `${JSON.stringify(manifest)}\n`,
  );
  fs.writeFileSync(
    path.join(artifactDir, "current.json"),
    `${JSON.stringify({ id: "field-lines", version: 1, manifest: "versions/1/manifest.json" })}\n`,
  );
  fs.writeFileSync(
    path.join(gardenDir, ".breadboard", "visual-index.json"),
    `${JSON.stringify({
      "field-lines": {
        id: "field-lines",
        kind: "generated_module",
        version: 1,
        artifactPath: ".breadboard/visuals/field-lines",
        sourceHash: "source-v1",
        compiledHash: "compiled-v1",
      },
    })}\n`,
  );
  return { root, gardenDir, artifactDir };
}

function writeCandidateV2(stagingGardenDir) {
  const artifactDir = path.join(
    stagingGardenDir,
    ".breadboard",
    "visuals",
    "field-lines",
  );
  const manifest = {
    id: "field-lines",
    version: 2,
    sourceHash: "source-v2",
    compiledHash: "compiled-v2",
  };
  fs.writeFileSync(path.join(stagingGardenDir, "lesson.md"), "visual field-lines v2\n");
  fs.writeFileSync(path.join(artifactDir, "manifest.json"), `${JSON.stringify(manifest)}\n`);
  fs.writeFileSync(
    path.join(artifactDir, "current.json"),
    `${JSON.stringify({ id: "field-lines", version: 2, manifest: "versions/2/manifest.json" })}\n`,
  );
  fs.writeFileSync(
    path.join(stagingGardenDir, ".breadboard", "visual-index.json"),
    `${JSON.stringify({
      "field-lines": {
        id: "field-lines",
        kind: "generated_module",
        version: 2,
        artifactPath: ".breadboard/visuals/field-lines",
        sourceHash: "source-v2",
        compiledHash: "compiled-v2",
      },
    })}\n`,
  );
  fs.mkdirSync(path.join(artifactDir, "versions", "2"), { recursive: true });
  fs.writeFileSync(
    path.join(artifactDir, "versions", "2", "manifest.json"),
    `${JSON.stringify(manifest)}\n`,
  );
}

function legacySpec(version) {
  return {
    id: "legacy-field-lines",
    type: "function_plot",
    title: "Electric field strength",
    sourceAnchors: [],
    conceptTargets: ["electric field"],
    pedagogicalPurpose: "Show how field strength changes with distance.",
    props: {
      family: "reciprocal",
      parameters: { a: 1, b: 1, c: 0, d: 0 },
      xMin: 1,
      xMax: 10,
      expressionLatex: "E(r)=kQ/r^2",
    },
    regenerationPrompt: "Improve the electric-field explorer.",
    createdAt: "2026-08-24T00:00:00.000Z",
    ...(version > 1 ? { updatedAt: "2026-08-24T00:01:00.000Z" } : {}),
    version,
  };
}

function writeLegacyVisualState(gardenDir, spec) {
  const markdown = `# Electric field\n\n\`\`\`breadboard-visual\n${JSON.stringify(spec, null, 2)}\n\`\`\`\n`;
  const visualDir = path.join(gardenDir, ".breadboard", "visuals");
  fs.mkdirSync(visualDir, { recursive: true });
  fs.writeFileSync(path.join(gardenDir, "legacy.md"), markdown);
  fs.writeFileSync(
    path.join(visualDir, `${spec.id}.json`),
    JSON.stringify(spec, null, 2),
  );
  fs.writeFileSync(
    path.join(gardenDir, ".breadboard", "visual-index.json"),
    JSON.stringify(
      {
        [spec.id]: {
          id: spec.id,
          pageSlug: "legacy",
          type: spec.type,
          title: spec.title,
          version: spec.version,
          updatedAt: spec.updatedAt ?? spec.createdAt,
        },
      },
      null,
      2,
    ),
  );
}

test("a lease lost after candidate v2 generation leaves every live v1 pointer and Markdown byte-exact", async () => {
  const { gardenDir, artifactDir } = fixtureGarden("visual-candidate-lost-lease");
  const liveFingerprint = fingerprintPublishedGarden(gardenDir);
  const mutation = createDetachedGardenMutation(gardenDir, "visual-regeneration");
  writeCandidateV2(mutation.stagingGardenDir);

  const original = acquireGardenLearnLease(gardenDir, {
    gardenSlug: "electromagnetics-1",
    jobId: "regenerate-v2",
    buildId: "regenerate-v2",
  });
  assert.equal(original.acquired, true);
  if (!original.acquired) return;

  const takeover = acquireGardenLearnLock(
    gardenDir,
    {
      gardenSlug: "electromagnetics-1",
      jobId: "new-owner",
      buildId: "new-owner",
    },
    Date.now() + LOCK_STALE_MS + 1,
  );
  assert.equal(takeover.acquired, true);

  try {
    const promotion = await promoteDetachedGardenMutation({
      mutation,
      destinationGardenDir: gardenDir,
      lease: original.lease,
      recoveryOwnerId: "regenerate-v2",
    });
    assert.equal(promotion.promoted, false);
    assert.match(promotion.reason, /destination changed|untouched/i);
    assert.equal(fingerprintPublishedGarden(gardenDir), liveFingerprint);
    assert.equal(fs.readFileSync(path.join(gardenDir, "lesson.md"), "utf8"), "visual field-lines v1\n");
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(artifactDir, "current.json"), "utf8")),
      { id: "field-lines", version: 1, manifest: "versions/1/manifest.json" },
    );
    assert.deepEqual(
      JSON.parse(
        fs.readFileSync(path.join(gardenDir, ".breadboard", "visual-index.json"), "utf8"),
      )["field-lines"],
      {
        id: "field-lines",
        kind: "generated_module",
        version: 1,
        artifactPath: ".breadboard/visuals/field-lines",
        sourceHash: "source-v1",
        compiledHash: "compiled-v1",
      },
    );
    assert.equal(fs.existsSync(path.join(artifactDir, "versions", "2")), false);
  } finally {
    disposeDetachedGardenMutation(mutation);
    original.lease.release();
    releaseGardenLearnLock(gardenDir, "new-owner");
  }
});

test("one successful detached commit switches Markdown, current.json, and visual-index together", async () => {
  const { gardenDir, artifactDir } = fixtureGarden("visual-candidate-success");
  const mutation = createDetachedGardenMutation(gardenDir, "visual-regeneration");
  writeCandidateV2(mutation.stagingGardenDir);
  const leaseResult = acquireGardenLearnLease(gardenDir, {
    gardenSlug: "electromagnetics-1",
    jobId: "regenerate-v2",
    buildId: "regenerate-v2",
  });
  assert.equal(leaseResult.acquired, true);
  if (!leaseResult.acquired) return;

  try {
    const promotion = await promoteDetachedGardenMutation({
      mutation,
      destinationGardenDir: gardenDir,
      lease: leaseResult.lease,
      recoveryOwnerId: "regenerate-v2",
      verifyCandidate: (candidateGardenDir) =>
        fs.readFileSync(path.join(candidateGardenDir, "lesson.md"), "utf8").includes("v2"),
    });
    assert.equal(promotion.promoted, true);
    assert.equal(fs.readFileSync(path.join(gardenDir, "lesson.md"), "utf8"), "visual field-lines v2\n");
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(artifactDir, "current.json"), "utf8")).version,
      2,
    );
    assert.equal(
      JSON.parse(
        fs.readFileSync(path.join(gardenDir, ".breadboard", "visual-index.json"), "utf8"),
      )["field-lines"].version,
      2,
    );
    assert.equal(
      generatedVisualPublicationPointersMatch({
        gardenDir,
        id: "field-lines",
        version: 2,
        sourceHash: "source-v2",
        compiledHash: "compiled-v2",
      }),
      true,
    );
  } finally {
    disposeDetachedGardenMutation(mutation);
    leaseResult.lease.release();
  }
});

test("a lost legacy regeneration lease cannot publish Markdown, spec, index, or event changes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-visual-lost-lease-"));
  roots.push(root);
  const gardenDir = path.join(root, "electromagnetics-1");
  fs.mkdirSync(gardenDir, { recursive: true });
  writeLegacyVisualState(gardenDir, legacySpec(1));
  const liveFingerprint = fingerprintPublishedGarden(gardenDir);
  const mutation = createDetachedGardenMutation(gardenDir, "legacy-visual-regeneration");
  writeLegacyVisualState(mutation.stagingGardenDir, legacySpec(2));
  fs.appendFileSync(
    path.join(mutation.stagingGardenDir, ".breadboard", "events.jsonl"),
    '{"type":"visualization_regenerated"}\n',
  );
  assert.equal(
    legacyVisualPublicationPointersMatch({
      gardenDir: mutation.stagingGardenDir,
      relativeMarkdownPath: "legacy.md",
      expectedSpec: legacySpec(2),
    }),
    true,
  );

  const original = acquireGardenLearnLease(gardenDir, {
    gardenSlug: "electromagnetics-1",
    jobId: "legacy-regenerate-v2",
    buildId: "legacy-regenerate-v2",
  });
  assert.equal(original.acquired, true);
  if (!original.acquired) return;
  const takeover = acquireGardenLearnLock(
    gardenDir,
    {
      gardenSlug: "electromagnetics-1",
      jobId: "new-legacy-owner",
      buildId: "new-legacy-owner",
    },
    Date.now() + LOCK_STALE_MS + 1,
  );
  assert.equal(takeover.acquired, true);

  try {
    const promotion = await promoteDetachedGardenMutation({
      mutation,
      destinationGardenDir: gardenDir,
      lease: original.lease,
      recoveryOwnerId: "legacy-regenerate-v2",
      verifyCandidate: (candidateGardenDir) =>
        legacyVisualPublicationPointersMatch({
          gardenDir: candidateGardenDir,
          relativeMarkdownPath: "legacy.md",
          expectedSpec: legacySpec(2),
        }),
    });
    assert.equal(promotion.promoted, false);
    assert.equal(fingerprintPublishedGarden(gardenDir), liveFingerprint);
    assert.match(fs.readFileSync(path.join(gardenDir, "legacy.md"), "utf8"), /"version": 1/);
    assert.equal(
      JSON.parse(
        fs.readFileSync(
          path.join(gardenDir, ".breadboard", "visuals", "legacy-field-lines.json"),
          "utf8",
        ),
      ).version,
      1,
    );
    assert.equal(
      JSON.parse(
        fs.readFileSync(path.join(gardenDir, ".breadboard", "visual-index.json"), "utf8"),
      )["legacy-field-lines"].version,
      1,
    );
    assert.equal(fs.existsSync(path.join(gardenDir, ".breadboard", "events.jsonl")), false);
  } finally {
    disposeDetachedGardenMutation(mutation);
    original.lease.release();
    releaseGardenLearnLock(gardenDir, "new-legacy-owner");
  }
});

test("rollback and migration reject a held garden lease before writes or model dispatch", () => {
  const route = (relativePath) =>
    fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const rollback = route(
    "../src/app/api/gardens/[gardenId]/visualizations/[visualId]/rollback/route.ts",
  );
  const migration = route("../src/app/api/visualizations/migrate/route.ts");

  const rollbackLease = rollback.indexOf("acquireGardenLearnLease(gardenDir");
  const rollbackConflict = rollback.indexOf("if (!leaseResult.acquired)", rollbackLease);
  const rollbackMutation = rollback.indexOf("rollbackGeneratedVisualization({", rollbackConflict);
  assert.ok(rollbackLease >= 0 && rollbackConflict > rollbackLease && rollbackMutation > rollbackConflict);
  assert.match(rollback.slice(rollbackConflict, rollbackMutation), /status:\s*409/);
  assert.match(rollback, /finally \{[\s\S]*?disposeDetachedGardenMutation\(mutation\);[\s\S]*?lease\.release\(\);/);

  const migrationLease = migration.indexOf("acquireGardenLearnLease(gardenDir");
  const migrationConflict = migration.indexOf("if (!leaseResult.acquired)", migrationLease);
  const clientCreation = migration.indexOf("createChatmockClient(baseURL)", migrationConflict);
  const modelDispatch = migration.indexOf("migrateVisualPlaceholders(client", migrationConflict);
  const firstWrite = [
    migration.indexOf("fs.writeFileSync(filePath", migrationConflict),
    migration.indexOf("saveVisualSpec(stagedContentPath", migrationConflict),
    migration.indexOf("appendGardenEvent(stagedContentPath", migrationConflict),
  ].filter((index) => index >= 0).sort((left, right) => left - right)[0];
  assert.ok(
    migrationLease >= 0 &&
      migrationConflict > migrationLease &&
      clientCreation > migrationConflict &&
      modelDispatch > migrationConflict &&
      firstWrite > migrationConflict,
  );
  assert.match(migration.slice(migrationConflict, clientCreation), /status:\s*409/);
  assert.match(migration, /finally \{[\s\S]*?disposeDetachedGardenMutation\(mutation\);[\s\S]*?lease\.release\(\);/);
});

test("legacy regeneration writes only to a detached candidate before fenced promotion", () => {
  const route = fs.readFileSync(
    new URL(
      "../src/app/api/gardens/[gardenId]/visualizations/[visualId]/regenerate/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const legacyBranch = route.slice(route.indexOf("// Locate the markdown file carrying this visual block."));
  assert.match(legacyBranch, /createDetachedGardenMutation\([\s\S]*?'legacy-visual-regeneration'/);
  assert.match(legacyBranch, /saveVisualSpec\(\s*mutation\.temporaryRoot,/);
  assert.match(legacyBranch, /appendGardenEvent\(mutation\.temporaryRoot,/);
  assert.match(legacyBranch, /promoteDetachedGardenMutation\(\{/);
  assert.match(legacyBranch, /legacyVisualPublicationPointersMatch\(\{/);
  assert.doesNotMatch(legacyBranch, /fs\.writeFileSync\(filePath,/);
  assert.doesNotMatch(legacyBranch, /saveVisualSpec\(contentPath,/);
  assert.doesNotMatch(legacyBranch, /appendGardenEvent\(contentPath,/);
});
