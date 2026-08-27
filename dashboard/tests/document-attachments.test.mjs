// Documents that survive the attachment pipeline, and are read as documents.
//
// Two failures are being pinned down here, and both were silent — which is why
// they lasted. A .docx was read at send time and the file thrown away, so no
// agent could ever mark one up and a regenerated turn ran against a list of
// filenames. And the reading itself was `stripXml`, so a table arrived as a
// run-on sentence, an equation arrived with its structure removed, and a figure
// arrived as nothing at all.
//
// Every assertion below is one of those, stated as the behaviour that replaced
// it. The fixtures are built here rather than committed: a .docx is a zip, and
// a binary fixture nobody can read in a diff is a fixture nobody maintains.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboard = path.resolve(here, "..");

const { readDocx, readXlsx, readPptx } = await import("../src/lib/document-structure/index.ts");
const { parseXml, textContent, descendants } = await import(
  "../src/lib/document-structure/xml.ts"
);
const { ommlToLatex } = await import("../src/lib/document-structure/omml.ts");
const {
  describeDocumentSummary,
  documentAttachmentFormat,
  isDocumentBlobId,
  normalizeDocumentSummary,
} = await import("../src/lib/document-attachments.ts");
const {
  chatAttachmentHref,
  chatMessageAttachments,
  reusableChatAttachments,
  normalizeChatMessageAttachments,
} = await import("../src/lib/chat-attachments.ts");

// ── Fixtures ─────────────────────────────────────────────────────────

const WORD_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

/** A one-pixel PNG, so the figure path has real bytes to lift. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function buildDocx(bodyXml, options = {}) {
  const zip = new AdmZip();
  zip.addFile(
    "word/document.xml",
    Buffer.from(`<?xml version="1.0"?><w:document ${WORD_NS}><w:body>${bodyXml}</w:body></w:document>`),
  );
  zip.addFile(
    "word/_rels/document.xml.rels",
    Buffer.from(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="image" Target="media/image1.png"/></Relationships>`,
    ),
  );
  zip.addFile("word/media/image1.png", PNG);
  if (options.comments) zip.addFile("word/comments.xml", Buffer.from(options.comments));
  return zip.toBuffer();
}

const paragraph = (text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const heading = (level, text) =>
  `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

// ── The XML reader ───────────────────────────────────────────────────

test("the reader keeps nesting, which is the whole point of not using a regex", () => {
  const root = parseXml(
    '<w:tbl xmlns:w="x"><w:tr><w:tc><w:p><w:r><w:t>Cell A</w:t></w:r></w:p></w:tc>' +
      "<w:tc><w:p><w:r><w:t>Cell B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>",
  );
  assert.equal(root.local, "tbl");
  assert.equal(descendants(root, "tc").length, 2);
  assert.equal(textContent(descendants(root, "tc")[1]), "Cell B");
});

test("entities and self-closing tags do not derail the reader", () => {
  const root = parseXml('<a><b val="1"/><c>Smith &amp; Co &lt;x&gt; &#65;</c></a>');
  assert.equal(root.children.length, 2);
  assert.equal(textContent(root), "Smith & Co <x> A");
});

test("a malformed part degrades instead of throwing", () => {
  assert.doesNotThrow(() => parseXml("<a><b></a>"));
  assert.equal(parseXml(""), null);
});

// ── Formulas ─────────────────────────────────────────────────────────

test("an equation becomes LaTeX rather than its characters run together", () => {
  // The old extractor turned this into "x2", which is a different number and
  // impossible to spot downstream.
  const superscript = parseXml(
    '<m:oMath xmlns:m="m"><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e>' +
      "<m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath>",
  );
  assert.equal(ommlToLatex(superscript), "x^2");

  const fraction = parseXml(
    '<m:oMath xmlns:m="m"><m:f><m:num><m:r><m:t>a+b</m:t></m:r></m:num>' +
      "<m:den><m:r><m:t>c</m:t></m:r></m:den></m:f></m:oMath>",
  );
  assert.equal(ommlToLatex(fraction), "\\frac{a+b}c");

  const sum = parseXml(
    '<m:oMath xmlns:m="m"><m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr>' +
      "<m:sub><m:r><m:t>i=1</m:t></m:r></m:sub><m:sup><m:r><m:t>n</m:t></m:r></m:sup>" +
      "<m:e><m:sSub><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sub><m:r><m:t>i</m:t></m:r></m:sub></m:sSub></m:e>" +
      "</m:nary></m:oMath>",
  );
  assert.equal(ommlToLatex(sum), "\\sum_{i=1}^n x_i");

  const root = parseXml(
    '<m:oMath xmlns:m="m"><m:rad><m:deg><m:r><m:t>3</m:t></m:r></m:deg>' +
      "<m:e><m:r><m:t>x</m:t></m:r></m:e></m:rad></m:oMath>",
  );
  assert.equal(ommlToLatex(root), "\\sqrt[3]x");
});

test("an unrecognised construct falls back to its text instead of vanishing", () => {
  const exotic = parseXml('<m:oMath xmlns:m="m"><m:weird><m:r><m:t>q</m:t></m:r></m:weird></m:oMath>');
  assert.equal(ommlToLatex(exotic), "q");
});

// ── Word ─────────────────────────────────────────────────────────────

test("a table survives as a table", () => {
  const table =
    "<w:tbl>" +
    "<w:tr><w:tc><w:p><w:r><w:t>Party</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Shares</w:t></w:r></w:p></w:tc></w:tr>" +
    "<w:tr><w:tc><w:p><w:r><w:t>Acme</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>4,500,000</w:t></w:r></w:p></w:tc></w:tr>" +
    "</w:tbl>";
  const structure = readDocx(buildDocx(table));
  assert.match(structure.markdown, /\| Party \| Shares \|/);
  assert.match(structure.markdown, /\| --- \| --- \|/);
  assert.match(structure.markdown, /\| Acme \| 4,500,000 \|/);
  assert.equal(structure.summary.tableCount, 1);
});

test("a figure is lifted out with its caption, not silently dropped", () => {
  const drawing =
    "<w:p><w:r><w:drawing><wp:inline><wp:docPr id=\"1\" name=\"Picture 1\" descr=\"Revenue by quarter\"/>" +
    '<a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill></pic:pic>' +
    "</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>";
  const caption = '<w:p><w:pPr><w:pStyle w:val="Caption"/></w:pPr><w:r><w:t>Figure 1: Revenue.</w:t></w:r></w:p>';
  const structure = readDocx(buildDocx(heading(1, "Results") + drawing + caption));

  assert.equal(structure.figures.length, 1);
  assert.equal(structure.figures[0].extension, "png");
  assert.ok(structure.figures[0].bytes.length > 0, "the figure has real bytes");
  assert.equal(structure.figures[0].caption, "Figure 1: Revenue.");
  assert.equal(structure.figures[0].altText, "Revenue by quarter");
  assert.equal(structure.figures[0].location, "Results", "a figure knows where it sits");
  // And the markdown points at the file, so a reader can open it.
  assert.match(structure.markdown, /!\[Revenue by quarter\]\(figure-1\.png\)/);
  assert.equal(structure.summary.figureCount, 1);
});

test("the default shape name is not mistaken for alt text", () => {
  const drawing =
    '<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="Picture 3"/>' +
    '<a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill></pic:pic>' +
    "</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>";
  const structure = readDocx(buildDocx(drawing));
  assert.equal(structure.figures[0].altText, "");
});

test("a struck-out clause is marked, not quoted as though it were in force", () => {
  // The failure this prevents: advising on a clause the parties already deleted.
  const body =
    '<w:p><w:r><w:t xml:space="preserve">May assign </w:t></w:r>' +
    '<w:del w:id="1" w:author="Counsel"><w:r><w:delText xml:space="preserve">without consent </w:delText></w:r></w:del>' +
    '<w:ins w:id="2" w:author="Counsel"><w:r><w:t xml:space="preserve">only with consent </w:t></w:r></w:ins>' +
    "<w:r><w:t>of the seller.</w:t></w:r></w:p>";
  const structure = readDocx(buildDocx(body));
  assert.match(structure.markdown, /May assign ~~without consent~~ only with consent of the seller\./);
  assert.equal(structure.summary.trackedChangeCount, 2);
});

test("bold survives, because in an agreement the bold words are the defined ones", () => {
  const body =
    "<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Purchase Price</w:t></w:r>" +
    '<w:r><w:t xml:space="preserve"> means the amount payable.</w:t></w:r></w:p>';
  assert.match(readDocx(buildDocx(body)).markdown, /\*\*Purchase Price\*\* means/);
});

test("headings and list levels come through as structure", () => {
  const body =
    heading(1, "Agreement") +
    heading(2, "3. Consideration") +
    '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>First</w:t></w:r></w:p>' +
    '<w:p><w:pPr><w:numPr><w:ilvl w:val="1"/></w:numPr></w:pPr><w:r><w:t>Nested</w:t></w:r></w:p>';
  const markdown = readDocx(buildDocx(body)).markdown;
  assert.match(markdown, /^# Agreement$/m);
  assert.match(markdown, /^## 3\. Consideration$/m);
  assert.match(markdown, /^- First$/m);
  assert.match(markdown, /^ {2}- Nested$/m);
});

test("comments are gathered, because a reviewer's open question is part of the file", () => {
  const comments =
    '<?xml version="1.0"?><w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:comment w:id="1" w:author="Jane" w:date="2026-03-01T00:00:00Z">' +
    "<w:p><w:r><w:t>Is this cap market standard?</w:t></w:r></w:p></w:comment></w:comments>";
  const structure = readDocx(buildDocx(paragraph("Body"), { comments }));
  assert.match(structure.markdown, /## Comments/);
  assert.match(structure.markdown, /\*\*Jane\*\* \(2026-03-01\): Is this cap market standard\?/);
  assert.equal(structure.summary.commentCount, 1);
});

test("a file that is not a document comes back with a warning, never a throw", () => {
  const structure = readDocx(Buffer.from("not a zip"));
  assert.equal(structure.markdown, "");
  assert.equal(structure.warnings.length, 1);
});

// ── Workbooks ────────────────────────────────────────────────────────

function buildXlsx() {
  const zip = new AdmZip();
  zip.addFile(
    "xl/workbook.xml",
    Buffer.from(
      '<?xml version="1.0"?><workbook xmlns:r="r"><sheets><sheet name="Model" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
  );
  zip.addFile(
    "xl/_rels/workbook.xml.rels",
    Buffer.from(
      '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
  );
  zip.addFile(
    "xl/sharedStrings.xml",
    Buffer.from('<?xml version="1.0"?><sst><si><t>Revenue</t></si><si><t>Margin</t></si></sst>'),
  );
  zip.addFile(
    "xl/worksheets/sheet1.xml",
    Buffer.from(
      '<?xml version="1.0"?><worksheet><sheetData>' +
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
        '<row r="2"><c r="A2"><v>1200000</v></c><c r="B2"><f>(A2-700000)/A2</f><v>0.4167</v></c></row>' +
        '<row r="3"><c r="A3"><f>SUM(A2:A2)</f></c><c r="B3" t="e"><v>#REF!</v></c></row>' +
        "</sheetData></worksheet>",
    ),
  );
  return zip.toBuffer();
}

test("a workbook's formulas are read, not just the numbers they produced", () => {
  // The one question a model is usually attached to answer.
  const structure = readXlsx(buildXlsx());
  assert.equal(structure.summary.cellFormulaCount, 2);
  assert.match(structure.markdown, /`Model!B2` = `=\(A2-700000\)\/A2`/);
  assert.match(structure.markdown, /`Model!A3` = `=SUM\(A2:A2\)`/);
  // The cached value is what the grid shows.
  assert.match(structure.markdown, /\| 1200000 \| 0\.4167 \|/);
  // A formula with no cached value shows the formula rather than an empty cell.
  assert.match(structure.markdown, /\| =SUM\(A2:A2\) \| #REF! \|/);
  assert.equal(structure.summary.sheetCount, 1);
});

test("an error value in a workbook is reported rather than passed off as data", () => {
  const structure = readXlsx(buildXlsx());
  assert.ok(structure.warnings.some((warning) => /error value/.test(warning)));
});

// ── Decks ────────────────────────────────────────────────────────────

test("a deck keeps its slide boundaries and its speaker notes", () => {
  const zip = new AdmZip();
  const slide = (text) =>
    `<?xml version="1.0"?><p:sld xmlns:a="a"><p:cSld><p:spTree>` +
    `<p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>` +
    `</p:spTree></p:cSld></p:sld>`;
  zip.addFile("ppt/slides/slide1.xml", Buffer.from(slide("FY26 Outlook")));
  zip.addFile("ppt/slides/slide2.xml", Buffer.from(slide("Risks")));
  zip.addFile(
    "ppt/notesSlides/notesSlide1.xml",
    Buffer.from('<?xml version="1.0"?><p:notes xmlns:a="a"><a:t>Excludes the disposal.</a:t></p:notes>'),
  );
  const structure = readPptx(zip.toBuffer());
  assert.equal(structure.summary.slideCount, 2);
  assert.match(structure.markdown, /## Slide 1: FY26 Outlook/);
  assert.match(structure.markdown, /\*\*Speaker notes:\*\* Excludes the disposal\./);
  assert.match(structure.markdown, /## Slide 2: Risks/);
});

// ── The attachment kind ──────────────────────────────────────────────

test("a document attachment keeps its pointer through a save and a retry", () => {
  const attachment = {
    type: "document",
    name: "spa.docx",
    blobId: `doc_${"a".repeat(32)}`,
    format: "docx",
    sizeBytes: 51_200,
    text: "# Share Purchase Agreement",
    summary: { figureCount: 2, tableCount: 3 },
    figures: ["figure-1.png", "figure-2.png"],
  };

  // Saved with the turn: the pointer survives, the text deliberately does not.
  const [saved] = chatMessageAttachments([attachment]);
  assert.equal(saved.type, "document");
  assert.equal(saved.blobId, attachment.blobId);
  assert.equal(saved.text, undefined, "a transcript never carries the words");
  assert.deepEqual(saved.figures, ["figure-1.png", "figure-2.png"]);
  assert.equal(saved.summary.figureCount, 2);

  // Restored from the transcript, and reusable for a regenerated turn — which
  // is exactly what a retry could not do before: it was handed a filename.
  const [restored] = normalizeChatMessageAttachments([saved]);
  assert.equal(restored.blobId, attachment.blobId);
  const [reused] = reusableChatAttachments([restored]);
  assert.equal(reused.type, "document");
  assert.equal(reused.blobId, attachment.blobId);
  assert.equal(reused.text, "", "the server re-reads the words from the blob");
});

test("a forged pointer or figure name is dropped rather than carried", () => {
  const [saved] = chatMessageAttachments([
    {
      type: "document",
      name: "x.docx",
      blobId: "doc_not-a-real-id",
      format: "docx",
      text: "",
    },
  ]);
  assert.equal(saved.type, "file", "an invalid blob id is not a document");

  const [withFigures] = chatMessageAttachments([
    {
      type: "document",
      name: "x.docx",
      blobId: `doc_${"b".repeat(32)}`,
      format: "docx",
      text: "",
      figures: ["figure-1.png", "../../etc/passwd", "figure-2.svg"],
    },
  ]);
  assert.deepEqual(
    withFigures.figures,
    ["figure-1.png", "figure-2.svg"],
    "a name that is not one of ours never reaches a path or a URL",
  );
});

test("the format and id helpers agree with what the store writes", () => {
  assert.equal(documentAttachmentFormat("Agreement FINAL.DOCX"), "docx");
  assert.equal(documentAttachmentFormat("model.xlsx"), "xlsx");
  assert.equal(documentAttachmentFormat("notes.txt"), null);
  assert.ok(isDocumentBlobId(`doc_${"0".repeat(32)}`));
  assert.ok(!isDocumentBlobId("vid_" + "0".repeat(32)));
});

test("a summary describes the file in the words a person would use", () => {
  assert.equal(
    describeDocumentSummary(
      normalizeDocumentSummary({ pageCount: 12, tableCount: 3, figureCount: 1, formulaCount: 2 }),
    ),
    "12 pages · 3 tables · 1 figure · 2 formulas",
  );
  assert.equal(normalizeDocumentSummary({ figureCount: 0 }), null, "all-zero says nothing");
  assert.equal(describeDocumentSummary(null), "");
});

// ── The blob store ───────────────────────────────────────────────────

test("a stored document belongs to one account and figures cannot escape it", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "document-blob-test-"));
  try {
    const store = await import("../src/lib/conversations/document-blob-store.ts");
    const bytes = buildDocx(paragraph("Hello"));
    const blob = await store.writeDocumentBlob({
      userId: 7,
      format: "docx",
      body: new Blob([bytes]).stream(),
      root,
    });
    assert.ok(store.isDocumentBlobId?.(blob.blobId) ?? blob.blobId.startsWith("doc_"));
    assert.equal(fs.readFileSync(blob.path).length, bytes.length);

    // Another account asking for the same id gets the same answer as for one
    // that does not exist.
    assert.ok(store.findDocumentBlob({ userId: 7, blobId: blob.blobId, root }));
    assert.equal(store.findDocumentBlob({ userId: 8, blobId: blob.blobId, root }), null);

    store.writeDocumentFigures({
      userId: 7,
      blobId: blob.blobId,
      figures: [{ extension: "png", bytes: PNG }],
      root,
    });
    assert.deepEqual(store.listDocumentFigures({ userId: 7, blobId: blob.blobId, root }), [
      "figure-1.png",
    ]);
    assert.ok(store.readDocumentFigure({ userId: 7, blobId: blob.blobId, name: "figure-1.png", root }));
    for (const name of ["../../../secret", "figure-1.png/../../x", "..\\x.png"]) {
      assert.equal(
        store.readDocumentFigure({ userId: 7, blobId: blob.blobId, name, root }),
        null,
        `${name} must not resolve`,
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── The Legal Agent's workspace ──────────────────────────────────────

test("the Legal Agent is given the original file, not a description of it", async () => {
  const blobRoot = fs.mkdtempSync(path.join(os.tmpdir(), "legal-doc-blob-"));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "legal-doc-state-"));
  process.env.BREADBOARD_CHAT_DOCUMENT_DIR = blobRoot;
  process.env.LEGAL_AGENT_STATE_DIR = stateDir;
  try {
    const store = await import("../src/lib/conversations/document-blob-store.ts");
    const { prepareWorkspace } = await import("../src/lib/legal/workspace.ts");
    const bytes = buildDocx(heading(1, "Deed") + paragraph("Operative text."));
    const blob = await store.writeDocumentBlob({
      userId: 3,
      format: "docx",
      body: new Blob([bytes]).stream(),
    });
    store.writeDocumentFigures({
      userId: 3,
      blobId: blob.blobId,
      figures: [{ extension: "png", bytes: PNG }],
    });

    const workspace = prepareWorkspace({
      runId: "legal_doc_test",
      userId: 3,
      attachments: [
        {
          type: "document",
          name: "deed.docx",
          blobId: blob.blobId,
          format: "docx",
          text: "# Deed\n\nOperative text.",
          figures: ["figure-1.png"],
        },
      ],
    });

    // The original, under its real name and byte-for-byte — which is what the
    // docx skill's redline and comment scripts need to open.
    const original = path.join(workspace.documentsDir, "deed.docx");
    assert.ok(fs.existsSync(original), "the original .docx must be staged");
    assert.deepEqual(fs.readFileSync(original), bytes);

    // The structured reading beside it, under a name the harness's `read` tool
    // will not hand to pandoc.
    const extracted = path.join(workspace.documentsDir, "deed.extracted.md");
    assert.ok(fs.existsSync(extracted));
    assert.match(fs.readFileSync(extracted, "utf8"), /# Deed/);

    // And the figures, as real files the agent can open.
    assert.ok(fs.existsSync(path.join(workspace.documentsDir, "deed.figures", "figure-1.png")));

    const [staged] = workspace.staged;
    assert.equal(staged.filename, "deed.docx");
    assert.equal(staged.extractedFilename, "deed.extracted.md");
    assert.deepEqual(staged.figureFilenames, ["deed.figures/figure-1.png"]);
    assert.equal(staged.editable, true, "a .docx can be rewritten in place");
  } finally {
    delete process.env.BREADBOARD_CHAT_DOCUMENT_DIR;
    delete process.env.LEGAL_AGENT_STATE_DIR;
    fs.rmSync(blobRoot, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("the bridge tells the agent which file is the original it may rewrite", () => {
  const bridge = fs.readFileSync(
    path.resolve(dashboard, "..", "scripts", "legal-bridge.py"),
    "utf8",
  );
  // Staging the original is only half of it: an agent that is not told the file
  // is the original writes a fresh document instead of marking this one up.
  assert.match(bridge, /original file - edit this one in place to mark it up|original file .* edit this one in place/);
  assert.match(bridge, /redline\.py/);
  assert.match(bridge, /extracted\.md/);
});

// ── Every consumer ───────────────────────────────────────────────────

test("every path that reads an attachment's text reads a document's too", () => {
  // A consumer that matches only `type === "text"` silently ignores a document,
  // and the model is handed a message with no document in it.
  const consumers = [
    "src/lib/agent-runtime/adapters/hermes.ts",
    "src/lib/conversations/direct-turn-service.ts",
    "src/app/api/chat/route.ts",
    "src/app/api/knowledge-chat/route.ts",
  ];
  for (const relative of consumers) {
    const source = fs.readFileSync(path.join(dashboard, relative), "utf8");
    assert.match(
      source,
      /type === ["']text["'] \|\| \w+\.type === ["']document["']/,
      `${relative} must read a document's text alongside a text file's`,
    );
  }
});

test("every server entry point re-reads a document the request did not carry", () => {
  const entryPoints = [
    "src/app/api/hermes/sessions/[sessionId]/direct/route.ts",
    "src/app/api/hermes/sessions/[sessionId]/messages/route.ts",
    "src/lib/hermes/garden-chat-adapter.ts",
  ];
  for (const relative of entryPoints) {
    const source = fs.readFileSync(path.join(dashboard, relative), "utf8");
    assert.match(
      source,
      /resolveDocumentAttachments\(/,
      `${relative} must resolve a reused document's text from its blob`,
    );
    // The same three entry points, for the same reason: an entry point that
    // resolves but never retrieves quietly sends whole documents while the
    // other two send pages, and nothing else in the system would notice.
    assert.match(
      source,
      /await retrieveDocumentAttachments\(/,
      `${relative} must narrow an indexed document to the pages the question is about`,
    );
  }
});

// ── Opening one ──────────────────────────────────────────────────────

test("a stored document opens; a file that was never stored cannot", () => {
  const pdf = {
    type: "document",
    name: "blood results.pdf",
    blobId: "doc_0123456789abcdef0123456789abcdef",
    format: "pdf",
  };
  // The name is shown, so it travels; the blob id is what is looked up.
  assert.equal(
    chatAttachmentHref(pdf),
    "/attachments/doc_0123456789abcdef0123456789abcdef/pdf?name=blood%20results.pdf",
  );
  // A Word file has no renderer, but it does have a reading, and that reading
  // is what its own viewer shows. Which viewer is the only difference.
  assert.equal(
    chatAttachmentHref({ ...pdf, name: "contract.docx", format: "docx" }),
    "/attachments/doc_0123456789abcdef0123456789abcdef/document?name=contract.docx",
  );

  // Everything else kept a name and no bytes, and a chip that links nowhere is
  // worse than a chip that is plainly a label.
  assert.equal(chatAttachmentHref({ type: "file", name: "notes.txt" }), "");
  assert.equal(
    chatAttachmentHref({ type: "image", name: "shot.png", dataUrl: "data:image/png;base64,AA" }),
    "",
  );
  assert.equal(chatAttachmentHref(undefined), "");
});

test("both viewer pages read only the caller's own blob", () => {
  // Ownership is the lookup: findDocumentBlob only looks under the caller's own
  // directory, so somebody else's id is simply not there — the same answer as
  // one that never existed.
  for (const relative of [
    "src/app/attachments/[blobId]/pdf/page.tsx",
    "src/app/attachments/[blobId]/document/page.tsx",
  ]) {
    const page = fs.readFileSync(path.join(dashboard, relative), "utf8");
    assert.match(
      page,
      /findDocumentBlob\(\{ userId, blobId \}\)/,
      `${relative} must scope the blob to the caller`,
    );
  }

  // An attachment is the file the person sent; there is nowhere to write an
  // edited copy back to, so the PDF reader opens read-only and the document
  // reader offers the original as a download and nothing more.
  const pdfPage = fs.readFileSync(
    path.join(dashboard, "src/app/attachments/[blobId]/pdf/page.tsx"),
    "utf8",
  );
  assert.match(pdfPage, /blob\.format !== "pdf"/);
  assert.match(pdfPage, /readOnly/);

  // A PDF that lands on the document page is a stale link, not a document to
  // flatten into markdown.
  const documentPage = fs.readFileSync(
    path.join(dashboard, "src/app/attachments/[blobId]/document/page.tsx"),
    "utf8",
  );
  assert.match(documentPage, /blob\.format === "pdf"/);
  assert.match(documentPage, /redirect\(/);
});

test("every surface that names an attachment uses the shared linked renderer", () => {
  const renderer = fs.readFileSync(
    path.join(dashboard, "src/app/components/chat-message-attachments.tsx"),
    "utf8",
  );
  assert.match(renderer, /chatAttachmentHref\(/);

  const gardenAssistant = fs.readFileSync(
    path.join(dashboard, "src/app/garden/garden-assistant.tsx"),
    "utf8",
  );
  assert.match(gardenAssistant, /import ChatMessageAttachments/);
  assert.match(gardenAssistant, /<ChatMessageAttachments[\s\S]*?attachments=\{message\.attachments\}/);
});
