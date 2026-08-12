import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { SkillsCatalogStore } from "../src/lib/hermes/skills-catalog-store.ts";
import { listFirstPartySkills } from "../src/lib/hermes/skills.ts";
import {
  HALLMARK_SKILLS_SOURCE,
  getLocalHallmarkSkill,
  localHallmarkSkillsRepository,
  readLocalHallmarkSkillFiles,
  synchronizeLocalHallmarkSkillsCatalog,
} from "../src/lib/hermes/hallmark-skills-source.ts";
import {
  getLocalReviewedSkill,
  isReviewedLocalSource,
  readLocalReviewedSkillFiles,
} from "../src/lib/hermes/local-skills-sources.ts";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");

function tempStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-hallmark-catalog-"));
  const store = new SkillsCatalogStore(path.join(root, "catalog.db"));
  return {
    store,
    cleanup() {
      store.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function withClone(run) {
  const fixture = tempStore();
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-hallmark-skills-"));
  const previousRoot = process.env.HALLMARK_SKILLS_ROOT;
  try {
    const hallmark = path.join(clone, "skills", "hallmark");
    fs.mkdirSync(path.join(hallmark, "references"), { recursive: true });
    fs.writeFileSync(
      path.join(hallmark, "SKILL.md"),
      "---\nname: hallmark\ndescription: \"Anti-AI-slop design skill for greenfield pages, audits, redesigns, and design extraction.\"\nversion: 1.1.0\n---\n\n# Hallmark\n",
      "utf8",
    );
    fs.writeFileSync(path.join(hallmark, "references", "slop-test.md"), "# Slop test\n", "utf8");
    run({ fixture, clone });
  } finally {
    if (previousRoot === undefined) delete process.env.HALLMARK_SKILLS_ROOT;
    else process.env.HALLMARK_SKILLS_ROOT = previousRoot;
    fs.rmSync(clone, { recursive: true, force: true });
    fixture.cleanup();
  }
}

test("the cloned hallmark repository overlays complete local metadata and files", () => {
  withClone(({ fixture, clone }) => {
    process.env.HALLMARK_SKILLS_ROOT = clone;

    const result = synchronizeLocalHallmarkSkillsCatalog({ store: fixture.store, force: true });
    assert.equal(result.total, 1);
    assert.equal(fixture.store.status().totalAvailable, 1);

    const stored = fixture.store.get(`${HALLMARK_SKILLS_SOURCE}/hallmark`);
    assert.equal(stored.name, "hallmark");
    assert.equal(
      stored.description,
      "Anti-AI-slop design skill for greenfield pages, audits, redesigns, and design extraction.",
    );
    assert.equal(stored.sourceType, "local-git");
    // One skill named after its pack — no namespace prefix.
    assert.equal(stored.slashCommand, "hallmark");
    assert.ok(stored.files.some((file) => file.path === "references/slop-test.md"));

    const hallmarkView = fixture.store.list({ source: HALLMARK_SKILLS_SOURCE });
    assert.equal(hallmarkView.total, 1);
    assert.deepEqual(hallmarkView.skills.map((skill) => skill.slug), ["hallmark"]);

    const files = readLocalHallmarkSkillFiles(stored.upstreamId);
    assert.equal(files.hash, stored.upstreamHash);
    assert.equal(getLocalHallmarkSkill(stored.upstreamId).detail.hash, stored.upstreamHash);

    const second = synchronizeLocalHallmarkSkillsCatalog({ store: fixture.store });
    assert.equal(second.skipped, true);
  });
});

test("HALLMARK_SKILLS_ROOT may point at the skills tree instead of the repository", () => {
  withClone(({ fixture, clone }) => {
    process.env.HALLMARK_SKILLS_ROOT = path.join(clone, "skills");
    const result = synchronizeLocalHallmarkSkillsCatalog({ store: fixture.store, force: true });
    assert.equal(result.total, 1);
    assert.equal(path.basename(result.root), path.basename(clone));
  });
});

test("the hallmark pack is a reviewed local source the shared registry resolves", () => {
  withClone(({ fixture, clone }) => {
    process.env.HALLMARK_SKILLS_ROOT = clone;
    synchronizeLocalHallmarkSkillsCatalog({ store: fixture.store, force: true });

    assert.equal(isReviewedLocalSource(HALLMARK_SKILLS_SOURCE), true);
    const local = getLocalReviewedSkill(`${HALLMARK_SKILLS_SOURCE}/hallmark`);
    assert.equal(local.source, HALLMARK_SKILLS_SOURCE);
    assert.match(local.label, /nutlope\/hallmark/);
    assert.match(local.description, /Anti-AI-slop/);
    assert.ok(readLocalReviewedSkillFiles(`${HALLMARK_SKILLS_SOURCE}/hallmark`).files["SKILL.md"]);
    assert.equal(getLocalReviewedSkill(`${HALLMARK_SKILLS_SOURCE}/absent`), null);
  });
});

test("the hallmark pack rides the All tab without a dedicated filter", () => {
  const registry = read("src/lib/hermes/local-skills-sources.ts");
  const catalogRoute = read("src/app/api/hermes/skills/route.ts");
  const ui = read("src/app/components/hermes/skills-catalog-panel.tsx");

  // Synchronizing through the shared registry is what lists it under "All".
  assert.match(registry, /synchronize: synchronizeLocalHallmarkSkillsCatalog/);
  assert.doesNotMatch(catalogRoute, /hallmark/i);
  assert.doesNotMatch(ui, /hallmark/i);
});

test("hallmark ships as a prebuilt skill enabled by default on every mode", () => {
  const prebuilt = path.join(dashboardRoot, "..", "hermes-skills", "prebuilt", "hallmark");
  if (!fs.existsSync(prebuilt)) return;
  const skill = listFirstPartySkills().find((entry) => entry.slug === "hallmark");
  assert.ok(skill, "hallmark missing from the first-party listing");
  assert.equal(skill.id, "breadboard:first-party/hallmark");
  assert.equal(skill.enabled, true);
  assert.equal(skill.healthy, true);
  assert.equal(skill.availability, "ready");
  // General eligibility is what keeps it usable beyond coding — documents,
  // garden work, plain chat — rather than gated behind OpenCode.
  assert.equal(skill.classification, "eligible_general");
  assert.deepEqual(skill.compatibleModes, ["knowledge", "technical_read", "scoped_implementation"]);
  assert.match(skill.instructions, /^---\s*\nname: hallmark/);
});

test("the prebuilt hallmark copy matches the vendored clone byte for byte", () => {
  const prebuilt = path.join(dashboardRoot, "..", "hermes-skills", "prebuilt", "hallmark");
  const clone = path.join(dashboardRoot, "..", "hallmark", "skills", "hallmark");
  if (!fs.existsSync(prebuilt) || !fs.existsSync(clone)) return;
  const digest = (root) => {
    const files = {};
    const visit = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(absolute);
        else if (entry.isFile()) {
          const relative = path.relative(root, absolute).replace(/\\/g, "/");
          files[relative] = crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
        }
      }
    };
    visit(root);
    return files;
  };
  assert.deepEqual(digest(prebuilt), digest(clone));
});

test("the vendored hallmark clone is discovered without configuration", () => {
  const clone = path.join(dashboardRoot, "..", "hallmark", "skills");
  // The clone is optional: checkouts without it fall back to the catalog only.
  if (!fs.existsSync(clone)) return;
  const previousRoot = process.env.HALLMARK_SKILLS_ROOT;
  delete process.env.HALLMARK_SKILLS_ROOT;
  try {
    const repository = localHallmarkSkillsRepository();
    assert.equal(path.basename(repository), "hallmark");
  } finally {
    if (previousRoot !== undefined) process.env.HALLMARK_SKILLS_ROOT = previousRoot;
  }
});
