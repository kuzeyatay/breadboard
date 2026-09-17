import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { build } from "esbuild";
import { chromium } from "playwright";
import AdmZip from "adm-zip";
import { StreamingArchive } from "../src/lib/garden-transfer/stream-archive.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-export-browser-"));
const requests = [];
const bundle = await build({
  stdin: { contents: "import {exportGardenFile} from './src/lib/garden-transfer/client.ts'; document.querySelector('button').onclick = () => exportGardenFile('em1', 'EM1').catch(error => document.querySelector('p').textContent = error.message);", resolveDir: process.cwd() },
  bundle: true, write: false, format: "iife", platform: "browser",
});
let deny = false;
const server = http.createServer(async (request, response) => {
  if (request.url === "/app.js") {
    response.setHeader("Content-Type", "application/javascript");
    response.end(bundle.outputFiles[0].text);
  } else if (request.url === "/api/transfer/garden/em1") {
    requests.push(request.method);
    if (deny) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "Content-Type": "application/vnd.breadboard.garden+zip", "Content-Disposition": 'attachment; filename="em1.garden"' });
    if (request.method === "HEAD") { response.end(); return; }
    const archive = new StreamingArchive();
    archive.addFile("content/lecture.md", Buffer.from("# EM1\n"));
    await pipeline(archive.stream(), response).catch(() => {});
  } else {
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><button>Export EM1</button><p></p><script src="/app.js"></script>');
  }
});
let browser;
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(candidate => fs.existsSync(candidate));
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export EM1" }).click();
  const download = await pending;
  assert.equal(download.suggestedFilename(), "em1.garden");
  const saved = path.join(root, "em1.garden");
  await download.saveAs(saved);
  assert.equal(new AdmZip(saved).readAsText("content/lecture.md"), "# EM1\n");
  assert.deepEqual(requests, ["HEAD", "GET"]);
  deny = true;
  await page.getByRole("button", { name: "Export EM1" }).click();
  await page.getByText("Garden or cluster not found.").waitFor();
  assert.deepEqual(requests, ["HEAD", "GET", "HEAD"]);
  assert.deepEqual(errors, []);
  console.log("PASS: streamed browser download, filename, archive bytes, and inline preflight failure");
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
