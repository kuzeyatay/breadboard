import assert from "node:assert/strict";
import test from "node:test";
import esbuild from "esbuild";
import { fileURLToPath } from "node:url";

const bundle = await esbuild.build({
  stdin: { contents: `export { downloadPdf } from './src/lib/pdf-download-client'; export { exportFolderPdf } from './src/lib/folder-pdf-export-client';`, resolveDir: fileURLToPath(new URL("..", import.meta.url)) },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { downloadPdf, exportFolderPdf } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const blob = new Blob(["%PDF-1.7\nfixture\n%%EOF"]);

function windowFixture(t, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value });
  t.after(() => previous ? Object.defineProperty(globalThis, "window", previous) : delete globalThis.window);
}

test("folder export waits for the desktop save before reporting the actual filename", async t => {
  let finish;
  let saving;
  const started = new Promise(resolve => { saving = resolve; });
  windowFixture(t, { breadboardDesktop: { savePdfDownload: request => {
    assert.equal(request.filename, "notes.pdf");
    assert.equal(new TextDecoder().decode(request.data), "%PDF-1.7\nfixture\n%%EOF");
    saving();
    return new Promise(resolve => { finish = resolve; });
  } } });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url !== "/api/markdown-to-pdf") return Response.json({
      success: true, content: "# First", sourceSlug: "demo/first", folderTitle: "Chapter One",
    });
    assert.equal(JSON.parse(options.body).documents[0].folderTitle, "Chapter One");
    return new Response(blob, { headers: { "Content-Disposition": 'attachment; filename="notes.pdf"' } });
  });
  let settled = false;
  const pending = exportFolderPdf({ requestId: "export-1", cluster: "demo", documents: [{ slug: "demo/first" }] })
    .then(result => { settled = true; return result; });
  await started;
  assert.equal(settled, false);
  finish({ ok: true, filename: "notes (1).pdf", savePath: "C:/Users/example/Downloads/notes (1).pdf" });
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.message, "Saved: notes (1).pdf");
});

test("folder save failures reach the dialog instead of a false success", async t => {
  windowFixture(t, { breadboardDesktop: { savePdfDownload: async () => ({ ok: false, error: "Disk is full" }) } });
  t.mock.method(globalThis, "fetch", async url => url === "/api/markdown-to-pdf"
    ? new Response(blob)
    : Response.json({ success: true, content: "# First" }));
  const result = await exportFolderPdf({ requestId: "export-2", cluster: "demo", documents: [{ slug: "first" }] });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Disk is full");
  assert.equal(result.message, undefined);
});

test("old desktop bridge requests a restart instead of silently falling back to the broken path", async t => {
  windowFixture(t, { breadboardDesktop: {} });
  await assert.rejects(downloadPdf(blob, "notes.pdf"), /Restart Breadboard/);
});

test("cancelling the native save dialog reports cancellation without a save or failure claim", async t => {
  windowFixture(t, { breadboardDesktop: { savePdfDownload: async () => ({ ok: false, cancelled: true, error: "Download cancelled." }) } });
  assert.equal(await downloadPdf(blob, "notes.pdf"), "Download cancelled.");
});

test("ordinary browser starts a download without claiming a confirmed disk save", async t => {
  let clicked = false, removed = false, appended = false;
  let revoke;
  windowFixture(t, { setTimeout: callback => { revoke = callback; } });
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  const anchor = { click() { clicked = true; }, remove() { removed = true; } };
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement: () => anchor, body: { appendChild: () => { appended = true; } },
  } });
  t.after(() => previous ? Object.defineProperty(globalThis, "document", previous) : delete globalThis.document);
  assert.equal(await downloadPdf(blob, "notes.pdf"), "PDF download started. Check your browser's downloads.");
  assert.ok(clicked && removed && appended);
  assert.equal(anchor.download, "notes.pdf");
  revoke();
});
