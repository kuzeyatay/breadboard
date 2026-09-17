import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readGardenPage, gardenPageExcerpt, gardenReadEntries, boundedGardenFileList, readGardenRetrievalNodes, selectedGardenDocumentContext } from "../src/lib/hermes/garden-reader.ts";

test("Garden reads resolve published paths and return queryable body text past large metadata", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "garden-read-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "course/sources"), { recursive: true });
  const body = "# Introduction\n" + "Background material. ".repeat(400) + "\n# Assessment\nAttendance is compulsory for four laboratory exercises.\n";
  fs.writeFileSync(path.join(root, "course/sources/guide.md"), `---\ntitle: "Study guide"\nknowledge_type: "source-document"\ntopics: ${JSON.stringify(Array(1000).fill("metadata"))}\n---\n${body}`);
  for (const slug of ["guide", "sources/guide", "sources/guide.md", "/course/sources/guide#assessment", "course%2Fsources%2Fguide.md"]) {
    const { node } = await readGardenPage(root, "course", slug);
    assert.equal(node.title, "Study guide");
    assert.equal(node.content, body.trim());
    assert.match(gardenPageExcerpt(node, { query: "compulsory laboratory attendance" }).content, /Attendance is compulsory/);
    let text = "", offset = 0;
    do {
      const result = gardenPageExcerpt(node, { offset, limit: 1024 });
      text += result.content;
      offset = result.nextOffset;
    } while (offset !== null);
    assert.equal(text, body.trim());
  }
  const evidence = await selectedGardenDocumentContext(root, "course", ["guide"], "compulsory laboratory attendance");
  assert.match(evidence, /Attendance is compulsory/);
  assert.match(evidence, /untrusted reference data/);
  assert.doesNotMatch(evidence, /metadata/);
  await assert.rejects(readGardenPage(root, "course", "../secret"), /Invalid/);
  await assert.rejects(readGardenPage(root, "course", "%2e%2e%2fsecret"), /Invalid/);
});

test("missing or ambiguous slugs give exact alternatives and listings stay bounded", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "garden-list-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const folder of ["course/week-1", "course/week-2", "course/Internal", "course/.breadboard"]) fs.mkdirSync(path.join(root, folder), { recursive: true });
  for (const folder of ["week-1", "week-2"]) fs.writeFileSync(path.join(root, "course", folder, "lab.md"), "# Lab");
  for (let n = 0; n < 180; n++) fs.writeFileSync(path.join(root, `course/week-1/note-${n}.md`), "# Note");
  fs.writeFileSync(path.join(root, "course/Internal/private.md"), "internal");
  const ambiguous = await readGardenPage(root, "course", "lab");
  assert.equal(ambiguous.node, null);
  assert.equal(ambiguous.availableMatches.length, 2);
  const exact = await readGardenPage(root, "course", ambiguous.availableMatches[0].relPath);
  assert.equal(exact.node.content, "# Lab");
  const entries = await gardenReadEntries(root, "course");
  assert.equal(entries.length, 182);
  const first = boundedGardenFileList(entries, {});
  assert.equal(first.pages.length, 50);
  assert.equal(first.nextOffset, 50);
  const next = boundedGardenFileList(entries, { offset: first.nextOffset });
  assert.equal(next.pages.some((page) => first.pages.some((other) => other.relPath === page.relPath)), false);
  assert.equal(boundedGardenFileList(entries, { query: "LAB", folder: "week-2" }).pages.length, 1);
});

test("retrieval reads exclude old source ingests, drafts, and internal metadata", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "garden-nodes-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "course/sources"), { recursive: true });
  for (const [name, date, extra] of [["old", "2026-01-01", ""], ["current", "2026-09-01", ""], ["draft", "2027-01-01", 'draft: "true"\n']]) {
    fs.writeFileSync(path.join(root, `course/sources/${name}.md`), `---\ntitle: "Guide"\nsource_file: "guide.pdf"\nknowledge_type: "source-document"\ndate: "${date}"\n${extra}---\nAttendance rules`);
  }
  assert.deepEqual((await readGardenRetrievalNodes(root, "course")).map((node) => node.slug), ["current"]);
});
