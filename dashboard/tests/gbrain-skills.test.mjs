import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Curated Breadboard GBrain skillpack: visibility split + capability restrictions.
const packDir = path.resolve(process.cwd(), "..", "openharness-skills", "breadboard-gbrain");
const manifest = JSON.parse(fs.readFileSync(path.join(packDir, "manifest.json"), "utf8"));

function frontmatter(slug) {
  const raw = fs.readFileSync(path.join(packDir, slug, "SKILL.md"), "utf8");
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  assert.ok(m, `${slug} must have YAML frontmatter`);
  return { raw, fm: m[1] };
}

const VISIBLE = ["garden-research", "capture-to-garden", "knowledge-health"];
const INTERNAL = [
  "cross-source-synthesis",
  "source-ingestion-guidance",
  "meeting-ingestion",
  "citation-audit",
  "frontmatter-guard",
];

test("exactly three skills are user-visible in the palette", () => {
  const visible = manifest.skills.filter((s) => s.visible === true).map((s) => s.slug).sort();
  assert.deepEqual(visible, [...VISIBLE].sort());
});

test("the remaining five skills are internal (hidden from the palette) but present", () => {
  const internal = manifest.skills.filter((s) => s.visible === false).map((s) => s.slug).sort();
  assert.deepEqual(internal, [...INTERNAL].sort());
  for (const s of manifest.skills.filter((s) => s.visible === false)) {
    assert.equal(s.internal, true, `${s.slug} must be marked internal: true`);
  }
});

test("every skill folder referenced by the manifest exists with a SKILL.md", () => {
  for (const s of manifest.skills) {
    assert.ok(fs.existsSync(path.join(packDir, s.slug, "SKILL.md")), `${s.slug}/SKILL.md must exist`);
  }
});

test("no curated skill grants writes or coding mode (capability restriction)", () => {
  for (const s of manifest.skills) {
    const { fm } = frontmatter(s.slug);
    assert.match(fm, /writes:\s*false/, `${s.slug} must declare writes: false`);
    assert.match(fm, /mode:\s*knowledge/, `${s.slug} must be a knowledge-mode skill`);
  }
  // The manifest's global posture is also restrictive.
  assert.equal(manifest.writes, false);
  assert.equal(manifest.activatesCodingMode, false);
  assert.deepEqual(manifest.compatibleModes, ["knowledge"]);
});

test("curated skills are restricted to Garden Chat and Terminal (never anonymous Quartz)", () => {
  assert.deepEqual([...manifest.compatibleSurfaces].sort(), ["dashboard_terminal", "garden_chat"]);
  for (const s of manifest.skills) {
    const { fm } = frontmatter(s.slug);
    assert.ok(!/quartz/i.test(fm), `${s.slug} must not target Quartz`);
  }
});

test("the full upstream GBrain skillpack is explicitly NOT installed", () => {
  const excluded = manifest.excludedUpstreamSkills.join(" ").toLowerCase();
  for (const forbidden of ["cron", "dream-cycle", "skill-creator", "schema", "gstack", "capture (direct gbrain write)"]) {
    assert.ok(excluded.includes(forbidden), `${forbidden} must be listed as excluded`);
  }
});
