import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { SkillsCatalogStore } from "../src/lib/hermes/skills-catalog-store.ts";
import {
  ENGINEERING_SKILLS_SOURCE,
  getLocalEngineeringSkill,
  localEngineeringSkillsRepository,
  readLocalEngineeringSkillFiles,
  synchronizeLocalEngineeringSkillsCatalog,
} from "../src/lib/hermes/engineering-skills-source.ts";
import {
  getLocalReviewedSkill,
  isReviewedLocalSource,
  readLocalReviewedSkillFiles,
} from "../src/lib/hermes/local-skills-sources.ts";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");

function tempStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-engineering-catalog-"));
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
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-engineering-skills-"));
  const previousRoot = process.env.AGENT_SKILLS_ROOT;
  try {
    const tdd = path.join(clone, "skills", "test-driven-development");
    const refine = path.join(clone, "skills", "idea-refine");
    fs.mkdirSync(tdd, { recursive: true });
    fs.mkdirSync(path.join(refine, "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(tdd, "SKILL.md"),
      "---\nname: test-driven-development\ndescription: >\n  Drives development with tests.\n  Use when implementing any logic or fixing any bug.\n---\n\n# Test-Driven Development\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(refine, "SKILL.md"),
      "---\nname: idea-refine\ndescription: Refines a rough idea into a buildable plan.\n---\n",
      "utf8",
    );
    fs.writeFileSync(path.join(refine, "frameworks.md"), "# Frameworks\n", "utf8");
    fs.writeFileSync(path.join(refine, "scripts", "idea-refine.sh"), "#!/bin/sh\n", "utf8");
    // The pack ships agents and commands beside its skills; only skills/ is a source.
    fs.mkdirSync(path.join(clone, "agents"), { recursive: true });
    fs.writeFileSync(path.join(clone, "agents", "reviewer.md"), "# Reviewer\n", "utf8");
    run({ fixture, clone });
  } finally {
    if (previousRoot === undefined) delete process.env.AGENT_SKILLS_ROOT;
    else process.env.AGENT_SKILLS_ROOT = previousRoot;
    fs.rmSync(clone, { recursive: true, force: true });
    fixture.cleanup();
  }
}

test("a cloned agent-skills repository overlays complete local metadata and files", () => {
  withClone(({ fixture, clone }) => {
    process.env.AGENT_SKILLS_ROOT = clone;

    const result = synchronizeLocalEngineeringSkillsCatalog({ store: fixture.store, force: true });
    assert.equal(result.total, 2);
    assert.equal(fixture.store.status().totalAvailable, 2);

    const stored = fixture.store.get(`${ENGINEERING_SKILLS_SOURCE}/test-driven-development`);
    assert.equal(stored.name, "test-driven-development");
    assert.equal(
      stored.description,
      "Drives development with tests. Use when implementing any logic or fixing any bug.",
    );
    assert.equal(stored.sourceType, "local-git");
    assert.equal(stored.slashCommand, "eng:test-driven-development");

    const nested = fixture.store.get(`${ENGINEERING_SKILLS_SOURCE}/idea-refine`);
    assert.ok(nested.files.some((file) => file.path === "scripts/idea-refine.sh"));

    const engineeringView = fixture.store.list({ source: ENGINEERING_SKILLS_SOURCE });
    assert.equal(engineeringView.total, 2);
    assert.deepEqual(
      engineeringView.skills.map((skill) => skill.slug).sort(),
      ["idea-refine", "test-driven-development"],
    );

    const files = readLocalEngineeringSkillFiles(stored.upstreamId);
    assert.equal(files.hash, stored.upstreamHash);
    assert.equal(getLocalEngineeringSkill(stored.upstreamId).detail.hash, stored.upstreamHash);

    const second = synchronizeLocalEngineeringSkillsCatalog({ store: fixture.store });
    assert.equal(second.skipped, true);
  });
});

test("AGENT_SKILLS_ROOT may point at the skills tree instead of the repository", () => {
  withClone(({ fixture, clone }) => {
    process.env.AGENT_SKILLS_ROOT = path.join(clone, "skills");
    const result = synchronizeLocalEngineeringSkillsCatalog({ store: fixture.store, force: true });
    assert.equal(result.total, 2);
    assert.equal(path.basename(result.root), path.basename(clone));
  });
});

test("the engineering pack is a reviewed local source the shared registry resolves", () => {
  withClone(({ fixture, clone }) => {
    process.env.AGENT_SKILLS_ROOT = clone;
    synchronizeLocalEngineeringSkillsCatalog({ store: fixture.store, force: true });

    assert.equal(isReviewedLocalSource(ENGINEERING_SKILLS_SOURCE), true);
    const local = getLocalReviewedSkill(`${ENGINEERING_SKILLS_SOURCE}/idea-refine`);
    assert.equal(local.source, ENGINEERING_SKILLS_SOURCE);
    assert.match(local.label, /agent-skills/);
    assert.equal(local.description, "Refines a rough idea into a buildable plan.");
    assert.ok(readLocalReviewedSkillFiles(`${ENGINEERING_SKILLS_SOURCE}/idea-refine`).files["SKILL.md"]);
    assert.equal(getLocalReviewedSkill(`${ENGINEERING_SKILLS_SOURCE}/absent`), null);
  });
});

test("the catalog page lists the engineering pack under its own filter", () => {
  const registry = read("src/lib/hermes/local-skills-sources.ts");
  const catalogRoute = read("src/app/api/hermes/skills/route.ts");
  const ui = read("src/app/components/hermes/skills-catalog-panel.tsx");

  assert.match(registry, /synchronize: synchronizeLocalEngineeringSkillsCatalog/);
  assert.match(catalogRoute, /"design", "engineering"/);
  assert.match(catalogRoute, /filter === "engineering"\s*\? ENGINEERING_SKILLS_SOURCE/);
  assert.match(ui, /\{ id: "engineering", label: "Engineering" \}/);
  assert.match(ui, /filter === "engineering"[\s\S]*skill\.source === "addyosmani\/agent-skills"/);
});

test("the vendored agent-skills clone is discovered without configuration", () => {
  const clone = path.join(dashboardRoot, "..", "agent-skills", "skills");
  // The clone is optional: checkouts without it fall back to the catalog only.
  if (!fs.existsSync(clone)) return;
  const previousRoot = process.env.AGENT_SKILLS_ROOT;
  delete process.env.AGENT_SKILLS_ROOT;
  try {
    const repository = localEngineeringSkillsRepository();
    assert.equal(path.basename(repository), "agent-skills");
  } finally {
    if (previousRoot !== undefined) process.env.AGENT_SKILLS_ROOT = previousRoot;
  }
});
