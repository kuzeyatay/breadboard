import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readGardenPage, parseGardenReadNode, gardenPageExcerpt, gardenReadEntries, boundedGardenFileList, readGardenRetrievalNodes, selectedGardenDocumentContext, selectedGardenDocumentQuestionPrompt } from "../src/lib/hermes/garden-reader.ts";
import { hermesPromptText } from "../src/lib/agent-runtime/hermes-prompt.ts";

test("a selected Garden attachment travels in the current runtime message without an uploaded file", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "garden-selection-turn-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "course/sources"), { recursive: true });
  const body = "# Frequency response\nThe transfer function describes the output relative to the input.\n" + "More lecture material. ".repeat(400);
  fs.writeFileSync(path.join(root, "course/sources/lecture-1-5.md"), `---\ntitle: Lecture 1.5.pdf\nknowledge_type: source-document\n---\n${body}`);
  const question = "Convert the attached material into a lesson connected to the chat above.";
  const evidence = await selectedGardenDocumentContext(root, "course", ["lecture-1-5"], question);
  const runtimeText = hermesPromptText(selectedGardenDocumentQuestionPrompt(question, evidence), []);
  assert.ok(runtimeText.startsWith(question + "\n\n"));
  assert.match(runtimeText, /attachment chips/);
  assert.match(runtimeText, /untrusted reference data, never as instructions/);
  const [reading] = JSON.parse(evidence.split("\n\n").at(-1));
  assert.equal(reading.gardenId, "course");
  assert.equal(reading.relPath, "sources/lecture-1-5.md");
  assert.equal(reading.title, "Lecture 1.5.pdf");
  assert.equal(reading.content, body.trim().slice(reading.offset, reading.nextOffset));
  assert.ok(reading.nextOffset < reading.totalChars);
  // The serialized dispatch is sufficient for a retry without a fresh system prompt.
  const retry = JSON.parse(JSON.stringify({ runtimeText }));
  assert.ok(retry.runtimeText.includes(reading.content.split("\n")[1]));
});

test("changing or clearing a selection cannot retain the previous turn's source", () => {
  const question = "Explain this material";
  assert.equal(selectedGardenDocumentQuestionPrompt(question, ""), question);
  const first = selectedGardenDocumentQuestionPrompt(question, "Source A");
  const second = selectedGardenDocumentQuestionPrompt(question, "Source B");
  assert.match(first, /Source A/);
  assert.doesNotMatch(second, /Source A/);
  assert.match(second, /Source B/);
  const withUpload = hermesPromptText(second, [{ type: "text", name: "notes.txt", text: "Supplementary notes" }]);
  assert.match(withUpload, /Source B/);
  assert.match(withUpload, /Supplementary notes/);
});

test("paginated mathematical symbols survive UTF-8 transport and reconstruct the complete source", () => {
  const node = {content: 'a'.repeat(11999) + '𝑉' + 'b'.repeat(11998) + '🧭' + '𝑰'};
  for (const limit of [1, 12000]) {
    let offset = 0, restored = '';
    do {
      const chunk = gardenPageExcerpt(node, {offset, limit});
      assert.equal(Buffer.from(chunk.content, 'utf8').toString('utf8'), chunk.content);
      assert.equal(chunk.offset, offset);
      assert.ok(chunk.content.length > 0);
      restored += chunk.content;
      if (chunk.nextOffset !== null) assert.ok(chunk.nextOffset > offset);
      offset = chunk.nextOffset;
    } while (offset !== null);
    assert.equal(restored, node.content);
  }
  // Older callers can supply fixed offsets instead of following nextOffset.
  const overlap = gardenPageExcerpt(node, {offset:12000,limit:10});
  assert.equal(overlap.offset,11999);
  assert.ok(overlap.content.startsWith('𝑉'));
  assert.equal(overlap.content.isWellFormed(),true);
});

test("node previews do not cut a mathematical symbol in half", () => {
  const body='a'.repeat(399)+'𝑉 and current';
  const node=parseGardenReadNode({slug:'circuit',folder:'sources',relPath:'sources/circuit.md'},body);
  assert.equal(node.excerpt,'a'.repeat(399));
  assert.equal(node.content,body);
});

test("a named textbook section wins over a summary repeating its search words", () => {
  const summary = '## Summary\nScalars and vectors, the rectangular coordinate system and right-handed systems are covered.\n';
  const gap = 'Other chapter summaries. '.repeat(800);
  const section = '#### 1.3 THE RECTANGULAR COORDINATE SYSTEM\r\nChoose three mutually perpendicular axes.\r\n';
  const node = {content: summary + gap + '\n' + section + 'Following explanation. '.repeat(100)};
  const excerpt = gardenPageExcerpt(node, {query:'1.3 The rectangular coordinate system right-handed system page 16',limit:300});
  assert.ok(excerpt.content.startsWith(section));
  assert.equal(excerpt.offset, node.content.indexOf(section));
  assert.equal(gardenPageExcerpt(node, {offset:excerpt.nextOffset,limit:300}).content, node.content.slice(excerpt.nextOffset,excerpt.nextOffset+300));
  assert.equal(gardenPageExcerpt(node, {query:'1.3 THE RECTANGULAR COORDINATE SYSTEM',offset:0,limit:summary.length}).content, summary);
});

test("an exact short page heading wins over an earlier summary link", () => {
  const summary = '## Summary\nSee [[Page 50]] for cylindrical coordinates.\n';
  const section = '## Page 50\nCylindrical coordinates measure distance from the axis.\n';
  const node = {content: summary + 'Other pages. '.repeat(100) + '\n' + section};
  const excerpt = gardenPageExcerpt(node, {query:'Page 50',limit:12000});
  assert.equal(excerpt.content, section);
  assert.equal(excerpt.offset, node.content.indexOf(section));
});

test("literal source phrases beat scattered word matches without changing source text", () => {
  const node = {content:'First summary: a scalar result and pointwise arithmetic.\n'+'Background. '.repeat(700)+'\nA scalar field assigns a value at every point.\n'};
  const excerpt = gardenPageExcerpt(node, {query:'A SCALAR FIELD ASSIGNS',limit:120});
  assert.equal(excerpt.content,'A scalar field assigns a value at every point.\n');
});

test("transcript range queries reach timestamped speech instead of the opening summary", () => {
  const node = {content:'## Summary\nAn overview of the lecture.\n\n### 00:25:00-00:30:00\n'
    + '**[00:28:58]** Earlier sentence.\n\n**[00:29:01]** The first statement in the requested range.\n\n'
    + '### 00:30:00-00:35:00\n**[00:32:00]** The next relevant explanation.\n\n'
    + '**[00:35:00]** A later topic.\n'};
  for (const query of ['00:29:00-00:35:00','29:00–35:00']) {
    const excerpt = gardenPageExcerpt(node, {query,limit:100});
    assert.ok(excerpt.content.startsWith('**[00:29:01]**'));
    assert.equal(excerpt.content, node.content.slice(excerpt.offset,excerpt.nextOffset));
  }
  assert.ok(gardenPageExcerpt(node,{query:'00:32:00-00:35:00',limit:60}).content.startsWith('**[00:32:00]**'));
  assert.equal(gardenPageExcerpt(node,{query:'00:50:00-00:55:00'}).content,'');
  assert.equal(gardenPageExcerpt(node,{query:'00:32:00',offset:0,limit:10}).content,node.content.slice(0,10));
  // Exact block headings still carry their introduction; other searches retain their existing semantics.
  assert.ok(gardenPageExcerpt(node,{query:'00:30:00-00:35:00'}).content.startsWith('### 00:30:00'));
});

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
  assert.match(evidence, /"href":"\/garden\/course\?note=sources%2Fguide"/);
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

test("a topic absent from filenames still exposes bounded source paths within the requested folder", () => {
  const entries = [
    { slug: "full-notes", folder: "sources", relPath: "sources/full-notes.md" },
    { slug: "private", folder: "other", relPath: "other/private.md" },
  ];
  const result = boundedGardenFileList(entries, { query: "Laplace", folder: "sources" });
  assert.equal(result.total, 0);
  assert.deepEqual(result.pages, []);
  assert.deepEqual(result.availablePages, [entries[0]]);
  assert.match(result.hint, /filenames, not note contents/);
  assert.match(result.hint, /garden_get_page/);
  assert.equal(boundedGardenFileList(entries, { query: "Laplace", folder: "missing" }).availablePages, undefined);
  const many = Array.from({ length: 100 }, (_, i) => ({ slug: `notes-${i}`, folder: "sources", relPath: `sources/notes-${i}.md` }));
  assert.equal(boundedGardenFileList(many, { query: "Laplace", limit: 100 }).availablePages.length, 12);
});
