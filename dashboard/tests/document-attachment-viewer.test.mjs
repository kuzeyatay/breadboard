// The viewer an attached .docx, .xlsx or .pptx opens in.
//
// A PDF has a renderer; a Word file does not, and there is no honest way to
// draw one in a browser. What this page shows instead is the structural reading
// the attachment pipeline already performs — the same reading the model was
// answering from — laid out in the PDF viewer's shape so that opening either
// kind of attachment feels like the same act.
//
// The claims worth pinning down are the ones a reader of the source cannot
// check: that a table survives as a table rather than as run-together numbers,
// that a figure lifted out of the file is pointed at where it actually lives,
// and that the outline names the document's own sections. So this renders the
// component rather than reading it.

import assert from "node:assert/strict";
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

const dashboardRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");

fs.mkdirSync(path.join(dashboardRoot, "node_modules", ".cache"), { recursive: true });
const outDirectory = fs.mkdtempSync(
  path.join(dashboardRoot, "node_modules", ".cache", "breadboard-document-viewer-"),
);

after(() => {
  fs.rmSync(outDirectory, { recursive: true, force: true });
});

// The component asks the router to go back. Nothing here has a router, and
// mounting one to prove a document renders would be a test of Next rather
// than of this page.
const routerStub = path.join(outDirectory, "router-stub.js");
fs.writeFileSync(
  routerStub,
  `export const useRouter = () => ({ back() {}, push() {}, replace() {}, prefetch() {} });
   export const usePathname = () => "/";
   export const useSearchParams = () => new URLSearchParams();
   export const redirect = () => {};
   export const notFound = () => {};
`,
  "utf8",
);

const entry = path.join(outDirectory, "entry.jsx");
fs.writeFileSync(
  entry,
  `export { default as DocumentViewerClient } from "@/app/attachments/[blobId]/document/document-viewer-client";
   export { withResolvedFigureUrls, attachmentDisplayName } from "@/lib/document-attachments";
   export { chatAttachmentHref } from "@/lib/chat-attachments";\n`,
  "utf8",
);

const bundle = path.join(outDirectory, "bundle.cjs");
await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  outfile: bundle,
  format: "cjs",
  platform: "node",
  target: "node20",
  jsx: "automatic",
  loader: { ".ts": "ts", ".tsx": "tsx" },
  alias: { "@": path.join(dashboardRoot, "src"), "next/navigation": routerStub },
  external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
  logLevel: "silent",
});

const require = module.createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const {
  DocumentViewerClient,
  withResolvedFigureUrls,
  attachmentDisplayName,
  chatAttachmentHref,
} = require(bundle);

const SOURCE_URL = "/api/chat-attachments/documents/doc_0123456789abcdef0123456789abcdef";

/** What `readDocx` gives back for a report with a table and a picture in it. */
const REPORT = [
  "# Quarterly report",
  "",
  "Revenue held up through the quarter.",
  "",
  "## Regional split",
  "",
  "| Region | Revenue |",
  "| --- | --- |",
  "| North | 1,240 |",
  "| South | 980 |",
  "",
  "![Revenue by region](figure-1.png)",
  "",
  "## Outlook",
  "",
  "Growth is expected to continue.",
].join("\n");

function render(props) {
  return renderToStaticMarkup(
    React.createElement(DocumentViewerClient, {
      fileName: "quarterly report.docx",
      kicker: "Word",
      description: "1 figure and 1 table",
      markdown: REPORT,
      warnings: [],
      sourceUrl: SOURCE_URL,
      ...props,
    }),
  );
}

test("a document that is not a PDF still opens in a reader, not a download prompt", () => {
  const markup = render();

  // The header names the file the way the PDF viewer names a PDF.
  assert.match(markup, /Word attachment/);
  assert.match(markup, /quarterly report\.docx/);
  assert.match(markup, /Contains 1 figure and 1 table/);

  // The prose is on the page rather than behind a download.
  assert.match(markup, /Revenue held up through the quarter/);
  assert.match(markup, /Growth is expected to continue/);
});

test("a table arrives as a table and a heading as a heading", () => {
  const markup = render();

  // The failure this replaces is a term sheet arriving as a run-on sentence.
  assert.match(markup, /<table>/);
  assert.match(markup, /<th>Region<\/th>/);
  assert.match(markup, /<td>1,240<\/td>/);
  assert.match(markup, /<h1[^>]*>Quarterly report<\/h1>/);
  assert.match(markup, /<h2[^>]*>Regional split<\/h2>/);
});

test("the outline names the document's own sections, and counts them", () => {
  const markup = render();

  // Three headings, so the section counter opens at one of three — the
  // equivalent of a PDF's page count, which a .docx does not have.
  assert.match(markup, /Document outline/);
  assert.match(markup, /1 \/ 3/);
  // Each heading appears twice: once in the outline, once on the page.
  for (const title of ["Quarterly report", "Regional split", "Outlook"]) {
    const occurrences = markup.split(title).length - 1;
    assert.ok(
      occurrences >= 2,
      `"${title}" should be in the outline as well as the document`,
    );
  }
});

test("a figure lifted out of the file is pointed at where it was written", () => {
  // On its own, `figure-1.png` is a name beside the blob and nothing a browser
  // can fetch. The page resolves it before the markdown is ever rendered.
  const resolved = withResolvedFigureUrls(REPORT, SOURCE_URL);
  assert.match(resolved, /\]\(\/api\/chat-attachments\/documents\/doc_[0-9a-f]+\?figure=figure-1\.png\)/);

  const markup = renderToStaticMarkup(
    React.createElement(DocumentViewerClient, {
      fileName: "quarterly report.docx",
      kicker: "Word",
      description: "",
      markdown: resolved,
      warnings: [],
      sourceUrl: SOURCE_URL,
    }),
  );
  assert.match(markup, /<img[^>]+src="[^"]*\?figure=figure-1\.png"/);

  // An image the document itself carried is not one of ours to redirect.
  assert.equal(
    withResolvedFigureUrls("![logo](https://example.com/logo.png)", SOURCE_URL),
    "![logo](https://example.com/logo.png)",
  );
});

test("a file nothing could be read out of says so, and still offers the original", () => {
  const markup = render({
    markdown: "",
    warnings: ["That OpenDocument file could not be read: unsupported."],
  });

  assert.match(markup, /Nothing readable came out of this file/);
  assert.match(markup, /could not be read: unsupported/);
  // The bytes were kept, so the download is the one thing always on offer.
  assert.match(markup, /Download original/);
  assert.match(markup, new RegExp(`href="${SOURCE_URL}"`));
});

test("every stored document opens somewhere, and each kind at its own reader", () => {
  const blobId = "doc_0123456789abcdef0123456789abcdef";
  assert.equal(
    chatAttachmentHref({ type: "document", name: "a.pdf", blobId, format: "pdf" }),
    `/attachments/${blobId}/pdf?name=a.pdf`,
  );
  for (const format of ["docx", "xlsx", "pptx", "odt", "ods", "odp"]) {
    assert.equal(
      chatAttachmentHref({ type: "document", name: `a.${format}`, blobId, format }),
      `/attachments/${blobId}/document?name=a.${format}`,
      `a .${format} attachment must open in the document viewer`,
    );
  }
  // A text file's contents were never kept, only its name, so it opens nowhere.
  assert.equal(chatAttachmentHref({ type: "file", name: "notes.txt" }), "");
});

test("the name shown is the one the message kept, reduced to a name", () => {
  assert.equal(
    attachmentDisplayName("quarterly report.docx", "docx", "fallback.docx"),
    "quarterly report.docx",
  );
  // A name is a name: no paths, and the extension is the format's own.
  assert.equal(
    attachmentDisplayName("../../etc/passwd", "docx", "fallback.docx"),
    ".. .. etc passwd.docx",
  );
  assert.equal(attachmentDisplayName("", "xlsx", "fallback.xlsx"), "fallback.xlsx");
  assert.equal(attachmentDisplayName(undefined, "pptx", "fallback.pptx"), "fallback.pptx");
  assert.equal(attachmentDisplayName("x".repeat(400), "docx", "f.docx").length, 125);
});
