import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { SkillsCatalogStore } from "../src/lib/hermes/skills-catalog-store.ts";
import {
  OFFICE_SKILLS_SOURCE,
  getLocalOfficeSkill,
  localOfficeSkillsRepository,
  readLocalOfficeSkillFiles,
  synchronizeLocalOfficeSkillsCatalog,
} from "../src/lib/hermes/office-skills-source.ts";
import {
  getLocalReviewedSkill,
  isReviewedLocalSource,
  readLocalReviewedSkillFiles,
} from "../src/lib/hermes/local-skills-sources.ts";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");

function tempStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-office-catalog-"));
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
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-office-skills-"));
  const previousRoot = process.env.OFFICE_SKILLS_ROOT;
  try {
    const word = path.join(clone, "skills", "officecli-docx");
    const deck = path.join(clone, "skills", "officecli-pitch-deck");
    fs.mkdirSync(word, { recursive: true });
    fs.mkdirSync(deck, { recursive: true });
    fs.writeFileSync(
      path.join(word, "SKILL.md"),
      "---\nname: word\ndescription: >\n  Author Word documents with officecli,\n  in the order the layout depends on.\n---\n\n# Word\n",
      "utf8",
    );
    fs.writeFileSync(path.join(word, "REFERENCE.md"), "# Reference\n", "utf8");
    fs.writeFileSync(
      path.join(deck, "SKILL.md"),
      "---\nname: pitch-deck\ndescription: Build a fundraising deck.\n---\n",
      "utf8",
    );
    run({ fixture, clone });
  } finally {
    if (previousRoot === undefined) delete process.env.OFFICE_SKILLS_ROOT;
    else process.env.OFFICE_SKILLS_ROOT = previousRoot;
    fs.rmSync(clone, { recursive: true, force: true });
    fixture.cleanup();
  }
}

test("a cloned OfficeCLI repository overlays complete local metadata and files", () => {
  withClone(({ fixture, clone }) => {
    process.env.OFFICE_SKILLS_ROOT = clone;

    const result = synchronizeLocalOfficeSkillsCatalog({ store: fixture.store, force: true });
    assert.equal(result.total, 2);
    assert.equal(fixture.store.status().totalAvailable, 2);

    const stored = fixture.store.get(`${OFFICE_SKILLS_SOURCE}/officecli-docx`);
    assert.equal(stored.name, "word");
    assert.equal(
      stored.description,
      "Author Word documents with officecli, in the order the layout depends on.",
    );
    assert.equal(stored.sourceType, "local-git");
    assert.equal(stored.slashCommand, "office:officecli-docx");
    assert.ok(stored.files.some((file) => file.path === "REFERENCE.md"));

    const officeView = fixture.store.list({ source: OFFICE_SKILLS_SOURCE });
    assert.equal(officeView.total, 2);
    assert.deepEqual(
      officeView.skills.map((skill) => skill.slug).sort(),
      ["officecli-docx", "officecli-pitch-deck"],
    );

    const files = readLocalOfficeSkillFiles(stored.upstreamId);
    assert.equal(files.hash, stored.upstreamHash);
    assert.equal(getLocalOfficeSkill(stored.upstreamId).detail.hash, stored.upstreamHash);

    const second = synchronizeLocalOfficeSkillsCatalog({ store: fixture.store });
    assert.equal(second.skipped, true);
  });
});

test("OFFICE_SKILLS_ROOT may point at the skills tree instead of the repository", () => {
  withClone(({ fixture, clone }) => {
    process.env.OFFICE_SKILLS_ROOT = path.join(clone, "skills");
    const result = synchronizeLocalOfficeSkillsCatalog({ store: fixture.store, force: true });
    assert.equal(result.total, 2);
    assert.equal(path.basename(result.root), path.basename(clone));
  });
});

test("the office pack is a reviewed local source the shared registry resolves", () => {
  withClone(({ fixture, clone }) => {
    process.env.OFFICE_SKILLS_ROOT = clone;
    synchronizeLocalOfficeSkillsCatalog({ store: fixture.store, force: true });

    assert.equal(isReviewedLocalSource(OFFICE_SKILLS_SOURCE), true);
    const local = getLocalReviewedSkill(`${OFFICE_SKILLS_SOURCE}/officecli-pitch-deck`);
    assert.equal(local.source, OFFICE_SKILLS_SOURCE);
    assert.match(local.label, /OfficeCLI/);
    assert.equal(local.description, "Build a fundraising deck.");
    assert.ok(readLocalReviewedSkillFiles(`${OFFICE_SKILLS_SOURCE}/officecli-pitch-deck`).files["SKILL.md"]);
    assert.equal(getLocalReviewedSkill(`${OFFICE_SKILLS_SOURCE}/absent`), null);
  });
});

test("the catalog page lists the office pack under its own filter", () => {
  const registry = read("src/lib/hermes/local-skills-sources.ts");
  const catalogRoute = read("src/app/api/hermes/skills/route.ts");
  const ui = read("src/app/components/hermes/skills-catalog-panel.tsx");

  assert.match(registry, /synchronize: synchronizeLocalOfficeSkillsCatalog/);
  assert.match(catalogRoute, /"engineering", "office"/);
  assert.match(catalogRoute, /filter === "office"\s*\? OFFICE_SKILLS_SOURCE/);
  assert.match(ui, /\{ id: "office", label: "Office" \}/);
  assert.match(ui, /filter === "office"[\s\S]*skill\.source === "iOfficeAI\/OfficeCLI"/);
});

test("the vendored OfficeCLI clone is discovered without configuration", () => {
  const clone = path.join(dashboardRoot, "..", "OfficeCLI", "skills");
  // The clone is optional: checkouts without it fall back to the catalog only.
  if (!fs.existsSync(clone)) return;
  const previousRoot = process.env.OFFICE_SKILLS_ROOT;
  delete process.env.OFFICE_SKILLS_ROOT;
  try {
    const repository = localOfficeSkillsRepository();
    assert.equal(path.basename(repository), "OfficeCLI");
    // The whole point of pinning: every documented skill ships with the tree.
    const packs = fs.readdirSync(path.join(repository, "skills"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    assert.ok(packs.length >= 11, `expected the 11 upstream skills, found ${packs.length}`);
  } finally {
    if (previousRoot !== undefined) process.env.OFFICE_SKILLS_ROOT = previousRoot;
  }
});
