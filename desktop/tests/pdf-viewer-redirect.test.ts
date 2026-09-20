import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  breadboardPdfViewerPath,
  breadboardVideoPlayerPath,
  isInlinePdfResponse,
  isInlineVideoResponse,
  pdfViewerRedirectFor,
} from "../src/main/pdf-viewer-redirect";

const origin = "http://127.0.0.1:52225";
const pdfHeaders = {
  "Content-Type": ["application/pdf"],
  "Content-Disposition": ['inline; filename="book.pdf"'],
};
const videoHeaders = {
  "Content-Type": ["video/mp4"],
  "Content-Disposition": ['inline; filename="lecture.mp4"'],
};

test("a raw PDF response is one the frame would display, not save", () => {
  assert.ok(isInlinePdfResponse(pdfHeaders));
  assert.ok(isInlinePdfResponse({ "content-type": "application/pdf; charset=binary" }));
  assert.ok(isInlinePdfResponse({ "content-type": ["application/x-pdf"] }));
  assert.ok(!isInlinePdfResponse({ "content-type": ["text/html; charset=utf-8"] }));
  assert.ok(!isInlinePdfResponse({
    "content-type": ["application/pdf"],
    "content-disposition": ['attachment; filename="book.pdf"'],
  }));
  assert.ok(!isInlinePdfResponse(undefined));
});

test("endpoints with a viewer of their own get that viewer", () => {
  assert.equal(
    breadboardPdfViewerPath(new URL(
      `${origin}/api/documents/optical-fiber-communications-gerd-keiser/source-pdf?clusterSlug=telecom-1`,
    )),
    "/gardens/telecom-1/pdf/optical-fiber-communications-gerd-keiser",
  );
  assert.equal(
    breadboardPdfViewerPath(new URL(`${origin}/api/chat-attachments/documents/doc_abc123#page=4`)),
    "/attachments/doc_abc123/pdf#page=4",
  );
  assert.equal(
    breadboardPdfViewerPath(new URL(
      `${origin}/api/hermes/artifacts/art_9/preview?conversationId=conv_1&version=2`,
    )),
    "/artifacts/art_9/pdf?conversationId=conv_1&version=2",
  );
});

test("any other dashboard address opens the generic reader on that address", () => {
  assert.equal(
    breadboardPdfViewerPath(new URL(`${origin}/api/hermes/uploads/up_1/content?preview=1`)),
    "/pdf?src=%2Fapi%2Fhermes%2Fuploads%2Fup_1%2Fcontent%3Fpreview%3D1",
  );
  assert.equal(
    breadboardPdfViewerPath(new URL(`${origin}/api/files/gerd%20keiser.pdf`)),
    "/pdf?src=%2Fapi%2Ffiles%2Fgerd%2520keiser.pdf&name=gerd+keiser.pdf",
  );
  // The source-pdf route without its cluster cannot name a garden viewer.
  assert.equal(
    breadboardPdfViewerPath(new URL(`${origin}/api/documents/slug/source-pdf`)),
    "/pdf?src=%2Fapi%2Fdocuments%2Fslug%2Fsource-pdf",
  );
});

test("only the dashboard origin's inline PDFs are redirected", () => {
  const raw = `${origin}/api/documents/slug/source-pdf?clusterSlug=telecom-1`;
  assert.equal(pdfViewerRedirectFor(raw, pdfHeaders, origin), `${origin}/gardens/telecom-1/pdf/slug`);
  assert.equal(pdfViewerRedirectFor(raw, pdfHeaders, null), null);
  assert.equal(pdfViewerRedirectFor(raw, pdfHeaders, "http://127.0.0.1:4303"), null);
  assert.equal(pdfViewerRedirectFor("http://127.0.0.1:4303/garden/assets/a.pdf", pdfHeaders, origin), null);
  assert.equal(pdfViewerRedirectFor(raw, { "content-type": ["text/html"] }, origin), null);
  assert.equal(pdfViewerRedirectFor("not a url", pdfHeaders, origin), null);
});

test("a raw video response is one the frame would play, not save", () => {
  assert.ok(isInlineVideoResponse(videoHeaders));
  assert.ok(isInlineVideoResponse({ "content-type": ["video/webm"] }));
  assert.ok(!isInlineVideoResponse({ "content-type": ["application/octet-stream"] }));
  assert.ok(!isInlineVideoResponse({
    "content-type": ["video/mp4"],
    "content-disposition": ['attachment; filename="clip.mp4"'],
  }));
  assert.ok(!isInlineVideoResponse(undefined));
});

test("a video artifact gets its own player; anything else gets the generic one", () => {
  assert.equal(
    breadboardVideoPlayerPath(new URL(
      `${origin}/api/hermes/artifacts/art_7/preview?conversationId=conv_2&version=3`,
    )),
    "/artifacts/art_7/video?conversationId=conv_2&version=3",
  );
  assert.equal(
    breadboardVideoPlayerPath(new URL(`${origin}/api/files/lecture%201.mp4`)),
    "/video?src=%2Fapi%2Ffiles%2Flecture%25201.mp4&name=lecture+1.mp4",
  );
  assert.equal(
    breadboardVideoPlayerPath(new URL(`${origin}/api/gardens/em1/media/clip`)),
    "/video?src=%2Fapi%2Fgardens%2Fem1%2Fmedia%2Fclip",
  );
});

test("only the dashboard origin's inline video is redirected", () => {
  const raw = `${origin}/api/hermes/artifacts/art_7/preview?conversationId=conv_2`;
  assert.equal(
    pdfViewerRedirectFor(raw, videoHeaders, origin),
    `${origin}/artifacts/art_7/video?conversationId=conv_2`,
  );
  assert.equal(pdfViewerRedirectFor(raw, videoHeaders, null), null);
  assert.equal(pdfViewerRedirectFor(raw, videoHeaders, "http://127.0.0.1:4303"), null);
  assert.equal(
    pdfViewerRedirectFor(raw, { "content-type": ["video/mp4"], "content-disposition": ["attachment"] }, origin),
    null,
  );
});

test(
  "real Electron sends a frame that navigates to a raw PDF to the Breadboard viewer",
  { skip: process.platform !== "win32" },
  () => {
    const desktopRoot = path.resolve(__dirname, "..", "..");
    const electron = path.join(desktopRoot, "node_modules", "electron", "dist", "electron.exe");
    const module = path.join(desktopRoot, "dist", "main", "pdf-viewer-redirect.js");
    for (const required of [electron, module]) {
      assert.ok(fs.existsSync(required), `missing integration-test input: ${required}`);
    }

    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "bb-pdf-redirect-"));
    const resultFile = path.join(fixture, "result.json");
    fs.writeFileSync(path.join(fixture, "package.json"), JSON.stringify({ main: "main.cjs" }));
    fs.writeFileSync(
      path.join(fixture, "main.cjs"),
      `const fs = require("node:fs");
const http = require("node:http");
const { app, BrowserWindow, session } = require("electron");
const { installPdfViewerRedirect } = require(${JSON.stringify(module)});
const resultFile = ${JSON.stringify(resultFile)};
const served = [];
// A one-page PDF is enough for Chromium to pick its plugin for the response.
const pdf = Buffer.from("%PDF-1.4\\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\\ntrailer<</Root 1 0 R>>\\n%%EOF");
const server = http.createServer((request, response) => {
  served.push(request.url);
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname.endsWith("/source-pdf") || url.pathname === "/api/files/notes.pdf") {
    const disposition = url.searchParams.get("download") ? "attachment" : "inline";
    response.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": disposition + '; filename="book.pdf"' });
    response.end(pdf);
    return;
  }
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end("<!doctype html><title>viewer " + url.pathname + url.search + "</title><body>viewer</body>");
});
const loaded = (window) => new Promise((resolve) => window.webContents.once("did-finish-load", resolve));
app.whenReady().then(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  const other = http.createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "application/pdf" });
    response.end(pdf);
  });
  await new Promise((resolve) => other.listen(0, "127.0.0.1", resolve));
  const otherOrigin = "http://127.0.0.1:" + other.address().port;
  const log = [];
  installPdfViewerRedirect(session.defaultSession, { dashboardOrigin: () => origin, log: (line) => log.push(line) });

  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  await Promise.all([loaded(window), window.webContents.loadURL(origin + "/api/documents/keiser/source-pdf?clusterSlug=telecom-1")]);
  const garden = { url: window.webContents.getURL(), title: window.webContents.getTitle() };

  await Promise.all([loaded(window), window.webContents.loadURL(origin + "/api/files/notes.pdf#page=3")]);
  const generic = { url: window.webContents.getURL(), title: window.webContents.getTitle() };

  // The viewer's own fetch of the bytes is not a frame and must come back as PDF.
  const fetched = await window.webContents.executeJavaScript(
    "fetch(" + JSON.stringify(origin + "/api/documents/keiser/source-pdf?clusterSlug=telecom-1") + ").then((r) => r.headers.get('content-type'))",
  );

  // Another origin's PDF is not ours to re-route.
  await Promise.all([loaded(window), window.webContents.loadURL(otherOrigin + "/paper.pdf")]);
  const foreign = { url: window.webContents.getURL() };

  fs.writeFileSync(resultFile, JSON.stringify({ garden, generic, fetched, foreign, served, log }));
  window.destroy();
  server.close();
  other.close();
  app.quit();
}).catch((error) => {
  fs.writeFileSync(resultFile, JSON.stringify({ error: error.stack || String(error) }));
  app.exit(1);
});`,
    );

    const electronEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    };
    delete electronEnv["ELECTRON_RUN_AS_NODE"];
    const run = spawnSync(electron, [fixture], {
      cwd: fixture,
      encoding: "utf8",
      timeout: 30_000,
      env: electronEnv,
    });
    assert.equal(run.error, undefined, run.error?.message);
    assert.equal(run.status, 0, `electron stderr: ${run.stderr}`);
    const result = JSON.parse(fs.readFileSync(resultFile, "utf8")) as {
      error?: string;
      garden: { url: string; title: string };
      generic: { url: string; title: string };
      fetched: string | null;
      foreign: { url: string };
      served: string[];
      log: string[];
    };
    assert.equal(result.error, undefined, result.error);

    assert.match(result.garden.url, /\/gardens\/telecom-1\/pdf\/keiser$/);
    assert.equal(result.garden.title, "viewer /gardens/telecom-1/pdf/keiser");
    assert.match(result.generic.url, /\/pdf\?src=%2Fapi%2Ffiles%2Fnotes\.pdf&name=notes\.pdf#page=3$/);
    assert.equal(result.generic.title, "viewer /pdf?src=%2Fapi%2Ffiles%2Fnotes.pdf&name=notes.pdf");
    assert.equal(result.fetched, "application/pdf");
    assert.match(result.foreign.url, /\/paper\.pdf$/);
    assert.equal(result.log.length, 2, result.log.join("\n"));
    fs.rmSync(fixture, { recursive: true, force: true });
  },
);
