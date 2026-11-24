// Office's "Create blank" files must open in their editors: real OOXML packages,
// and a PDF whose xref offsets point at its objects.

import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { blankOfficeFile } from "../src/lib/office/blank.ts";
import { OFFICE_KINDS, officeKindForName } from "../src/lib/office/types.ts";

test("every Office kind has a blank file", async () => {
  // A video has no blank: it is made in the Video editor and saved on its first export.
  for (const { kind } of OFFICE_KINDS.filter(info => info.kind !== "mp4")) assert.ok((await blankOfficeFile(kind, "Plan")).byteLength > 0, kind);
});

test("OOXML blanks are packages with their main part", async () => {
  const main = { docx: "word/document.xml", xlsx: "xl/workbook.xml", pptx: "ppt/presentation.xml" };
  for (const [kind, part] of Object.entries(main)) {
    const zip = await JSZip.loadAsync(await blankOfficeFile(kind, "Plan"));
    assert.ok(zip.file("[Content_Types].xml"), `${kind} content types`);
    assert.ok(zip.file(part), `${kind} ${part}`);
  }
});

test("blank PDF xref offsets land on their objects", async () => {
  const text = new TextDecoder().decode(await blankOfficeFile("pdf", "Plan"));
  const xref = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.ok(text.startsWith("xref", xref));
  const offsets = [...text.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map(match => Number(match[1]));
  assert.equal(offsets.length, 3);
  offsets.forEach((offset, index) => assert.ok(text.startsWith(`${index + 1} 0 obj`, offset)));
});

test("HTML and Markdown blanks carry an escaped title", async () => {
  const html = new TextDecoder().decode(await blankOfficeFile("html", "A <b> & C"));
  assert.match(html, /<title>A &lt;b&gt; &amp; C<\/title>/);
  assert.equal(new TextDecoder().decode(await blankOfficeFile("md", "Notes")), "# Notes\n\n");
});

test("file names map to the Office tab that lists them", () => {
  assert.equal(officeKindForName("Q3.XLSX")?.tab, "sheets");
  assert.equal(officeKindForName("deck.pptx")?.tab, "slides");
  assert.equal(officeKindForName("notes.markdown")?.tab, "markdown");
  assert.equal(officeKindForName("photo.png"), null);
});
