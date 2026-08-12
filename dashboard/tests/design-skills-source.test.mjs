import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { SkillsCatalogStore } from "../src/lib/hermes/skills-catalog-store.ts";
import {
  DESIGN_SKILLS_SOURCE,
  getLocalDesignSkill,
  localDesignSkillsRepository,
  readLocalDesignSkillFiles,
  synchronizeLocalDesignSkillsCatalog,
} from "../src/lib/hermes/design-skills-source.ts";
import {
  getLocalReviewedSkill,
  isReviewedLocalSource,
  readLocalReviewedSkillFiles,
} from "../src/lib/hermes/local-skills-sources.ts";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");

function tempStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-design-catalog-"));
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
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-design-skills-"));
  const previousRoot = process.env.DESIGN_SKILLS_ROOT;
  try {
    const animate = path.join(clone, "skills", "animate");
    const prototype = path.join(clone, "skills", "prototype");
    fs.mkdirSync(animate, { recursive: true });
    fs.mkdirSync(prototype, { recursive: true });
    fs.writeFileSync(
      path.join(animate, "SKILL.md"),
      "---\nname: animate\ndescription: >\n  Build an animation from scratch,\n  in the order that determines whether it feels right.\n---\n\n# Building Animations\n",
      "utf8",
    );
    fs.writeFileSync(path.join(animate, "RECIPES.md"), "# Recipes\n", "utf8");
    fs.writeFileSync(
      path.join(prototype, "SKILL.md"),
      "---\nname: prototype\ndescription: Prototype an interface fast.\n---\n",
      "utf8",
    );
    run({ fixture, clone });
  } finally {
    if (previousRoot === undefined) delete process.env.DESIGN_SKILLS_ROOT;
    else process.env.DESIGN_SKILLS_ROOT = previousRoot;
    fs.rmSync(clone, { recursive: true, force: true });
    fixture.cleanup();
  }
}

test("a cloned design skills repository overlays complete local metadata and files", () => {
  withClone(({ fixture, clone }) => {
    process.env.DESIGN_SKILLS_ROOT = clone;

    const result = synchronizeLocalDesignSkillsCatalog({ store: fixture.store, force: true });
    assert.equal(result.total, 2);
    assert.equal(fixture.store.status().totalAvailable, 2);

    const stored = fixture.store.get(`${DESIGN_SKILLS_SOURCE}/animate`);
    assert.equal(stored.name, "animate");
    assert.equal(
      stored.description,
      "Build an animation from scratch, in the order that determines whether it feels right.",
    );
    assert.equal(stored.sourceType, "local-git");
    assert.equal(stored.slashCommand, "design:animate");
    assert.ok(stored.files.some((file) => file.path === "RECIPES.md"));

    const designView = fixture.store.list({ source: DESIGN_SKILLS_SOURCE });
    assert.equal(designView.total, 2);
    assert.deepEqual(designView.skills.map((skill) => skill.slug).sort(), ["animate", "prototype"]);

    const files = readLocalDesignSkillFiles(stored.upstreamId);
    assert.equal(files.hash, stored.upstreamHash);
    assert.equal(getLocalDesignSkill(stored.upstreamId).detail.hash, stored.upstreamHash);

    const second = synchronizeLocalDesignSkillsCatalog({ store: fixture.store });
    assert.equal(second.skipped, true);
  });
});

test("DESIGN_SKILLS_ROOT may point at the skills tree instead of the repository", () => {
  withClone(({ fixture, clone }) => {
    process.env.DESIGN_SKILLS_ROOT = path.join(clone, "skills");
    const result = synchronizeLocalDesignSkillsCatalog({ store: fixture.store, force: true });
    assert.equal(result.total, 2);
    assert.equal(path.basename(result.root), path.basename(clone));
  });
});

test("the design pack is a reviewed local source the shared registry resolves", () => {
  withClone(({ fixture, clone }) => {
    process.env.DESIGN_SKILLS_ROOT = clone;
    synchronizeLocalDesignSkillsCatalog({ store: fixture.store, force: true });

    assert.equal(isReviewedLocalSource(DESIGN_SKILLS_SOURCE), true);
    const local = getLocalReviewedSkill(`${DESIGN_SKILLS_SOURCE}/prototype`);
    assert.equal(local.source, DESIGN_SKILLS_SOURCE);
    assert.match(local.label, /emilkowalski/);
    assert.equal(local.description, "Prototype an interface fast.");
    assert.ok(readLocalReviewedSkillFiles(`${DESIGN_SKILLS_SOURCE}/prototype`).files["SKILL.md"]);
    assert.equal(getLocalReviewedSkill(`${DESIGN_SKILLS_SOURCE}/absent`), null);
  });
});

test("the catalog page lists the design pack under its own filter", () => {
  const registry = read("src/lib/hermes/local-skills-sources.ts");
  const catalogRoute = read("src/app/api/hermes/skills/route.ts");
  const ui = read("src/app/components/hermes/skills-catalog-panel.tsx");

  assert.match(registry, /synchronize: synchronizeLocalDesignSkillsCatalog/);
  assert.match(catalogRoute, /"scientific", "reverse", "design"/);
  assert.match(catalogRoute, /filter === "design"\s*\? DESIGN_SKILLS_SOURCE/);
  assert.match(ui, /\{ id: "design", label: "Design" \}/);
  assert.match(ui, /filter === "design"[\s\S]*skill\.source === "emilkowalski\/skills"/);
});

test("the vendored design clone is discovered without configuration", () => {
  const clone = path.join(dashboardRoot, "..", "emilkowalski-skills", "skills");
  // The clone is optional: checkouts without it fall back to the catalog only.
  if (!fs.existsSync(clone)) return;
  const previousRoot = process.env.DESIGN_SKILLS_ROOT;
  delete process.env.DESIGN_SKILLS_ROOT;
  try {
    const repository = localDesignSkillsRepository();
    assert.equal(path.basename(repository), "emilkowalski-skills");
  } finally {
    if (previousRoot !== undefined) process.env.DESIGN_SKILLS_ROOT = previousRoot;
  }
});
