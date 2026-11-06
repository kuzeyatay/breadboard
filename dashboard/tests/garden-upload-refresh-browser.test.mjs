import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";

test("upload rows survive refresh and a new tab, follow progress, and settle without resubmitting", { timeout: 45_000 }, async t => {
  const root = path.resolve(import.meta.dirname, "..");
  const bundle = await build({
    absWorkingDir: root,
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React, {useState, useSyncExternalStore} from 'react';
      import {createRoot} from 'react-dom/client';
      import {useGardenRestoredUploads} from './src/app/components/use-garden-restored-uploads';
      import {RestoredGardenUploadRows} from './src/app/components/restored-garden-upload-rows';
      import {startGardenUploadTask, subscribeGardenUploads, gardenUploadTasksSnapshot} from './src/lib/garden-upload-store';
      import * as recovery from './src/lib/runtime-v2/ingest-recovery-client';
      window.recovery = recovery;
      function Garden({garden}) {
        const [settled, setSettled] = useState(0);
        const uploads = useGardenRestoredUploads(garden, {onEvent: () => {}, onSettled: () => setSettled(n => n + 1)});
        const tasks = useSyncExternalStore(subscribeGardenUploads, gardenUploadTasksSnapshot);
        return <section><h2>Documents</h2><RestoredGardenUploadRows uploads={uploads}/>
          <output>{settled}</output>
          {tasks.filter(t => t.clusterSlug === garden && t.state === 'uploading').map(t => <div data-testid="live-upload" key={t.id}>{t.files[0].name}: Uploading…</div>)}
          <button onClick={() => startGardenUploadTask({clusterSlug:garden,files:[new File(['test'],'lab.pdf')],options:{label:'',handwriting:false,parseWithVlm:false,parseWithAnydoc:false,generateMap:true}})}>Upload</button>
        </section>;
      }
      function App() {
        const [garden,setGarden] = useState('telecom-1');
        return <><button onClick={() => setGarden(g => g === 'telecom-1' ? 'other' : 'telecom-1')}>Switch garden</button><Garden key={garden} garden={garden}/></>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
  });
  let submissions = 0, connections = 0, unavailable = false, step = "Reading page 2 of 8", terminal = null;
  const streams = new Set();
  const send = (response, event) => response.write(`data: ${JSON.stringify(event)}\n\n`);
  const server = http.createServer(async (request, response) => {
    if (request.url === "/bundle.js") {
      response.writeHead(200, { "Content-Type": "text/javascript" });
      response.end(bundle.outputFiles[0].text);
    } else if (request.url === "/api/ingest" || request.url === "/api/ingest/jobs/job_test/events") {
      if (request.url === "/api/ingest") {
        for await (const _chunk of request) { /* receive upload */ }
        submissions++;
      } else {
        connections++;
        if (unavailable) { response.writeHead(503); response.end(); return; }
      }
      response.writeHead(200, { "Content-Type": "text/event-stream", "X-Breadboard-Runtime-Job-Id": "job_test", "X-Breadboard-Runtime-Job-State": terminal ? "succeeded" : "running" });
      if (terminal) { send(response, terminal); response.end(); return; }
      streams.add(response);
      response.on("close", () => streams.delete(response));
      send(response, { type: "progress", step });
    } else {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end('<div id="root"></div><script src="/bundle.js"></script>');
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const context = await browser.newContext();
  const errors = [];
  context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
  let page = await context.newPage();
  await page.goto(origin);
  await page.getByText("Upload", { exact: true }).click();
  await page.waitForFunction(() => window.recovery.runtimeIngestRecoveries()[0]?.jobId === 'job_test');
  assert.equal(await page.getByTestId("live-upload").count(), 1);
  await page.getByText("Switch garden").click();
  await page.getByText("Switch garden").click();
  assert.equal(await page.getByTestId("restored-uploads").count(), 0, "live engine already owns the row");
  assert.equal(connections, 0, "navigation does not double-attach to a live upload");

  unavailable = true;
  await page.reload();
  await page.getByRole("status").filter({ hasText: "Uploading…" }).waitFor();
  assert.match(await page.getByTestId("restored-uploads").textContent(), /lab\.pdf/, "an unavailable status endpoint does not hide the upload");
  unavailable = false;
  await page.getByRole("status").filter({ hasText: "Uploading… · Reading page 2 of 8" }).waitFor();
  assert.match(await page.getByTestId("restored-uploads").textContent(), /lab\.pdf/);
  assert.equal(await page.getByTestId("live-upload").count(), 0, "reload really replaced the in-memory store");
  step = "Generating the map";
  for (const stream of streams) send(stream, { type: "progress", step });
  await page.getByRole("status").filter({ hasText: step }).waitFor();

  await page.close();
  page = await context.newPage();
  await page.goto(origin);
  assert.equal(await page.evaluate(() => sessionStorage.length), 0, "a reopened tab has no tab-local metadata");
  await page.getByRole("status").filter({ hasText: "Uploading… · Generating the map" }).waitFor();
  assert.equal(submissions, 1, "restoration never re-uploads or restarts the file");
  assert.equal(await page.getByTestId("restored-uploads").count(), 1);
  await page.getByText("Switch garden").click();
  assert.equal(await page.getByTestId("restored-uploads").count(), 0);
  await page.getByText("Switch garden").click();
  await page.getByRole("status").filter({ hasText: "Uploading… · Generating the map" }).waitFor();

  terminal = { type: "result", success: true, slug: "lab" };
  for (const stream of streams) { send(stream, terminal); stream.end(); }
  await page.waitForFunction(() => document.querySelector('output').textContent === '1');
  assert.equal(await page.getByTestId("restored-uploads").count(), 0);
  assert.deepEqual(await page.evaluate(() => window.recovery.runtimeIngestRecoveries()), []);
  const completedConnections = connections;
  await page.reload();
  await page.getByText("Upload", { exact: true }).waitFor();
  assert.equal(await page.getByTestId("restored-uploads").count(), 0);
  assert.equal(connections, completedConnections, "completed uploads do not reappear");

  // Existing tab-local uploads migrate and remain scoped to their garden.
  terminal = null;
  await page.evaluate(() => {
    const record = {protocolVersion:1,requestId:'legacy_upload',jobId:'job_test',clusterSlug:'other',filename:'legacy.pdf',fileKey:'legacy.pdf-4',purpose:'documents',startedAt:Date.now(),model:null,cancelRequested:false};
    sessionStorage.setItem(window.recovery.runtimeIngestRecoveryStorageKeyForTests, JSON.stringify([record]));
  });
  await page.reload();
  await page.getByText("Upload", { exact: true }).waitFor();
  assert.equal(await page.getByTestId("restored-uploads").count(), 0, "other gardens' uploads stay hidden");
  await page.getByText("Switch garden").click();
  await page.getByRole("status").filter({ hasText: "Uploading…" }).waitFor();
  assert.match(await page.getByTestId("restored-uploads").textContent(), /legacy\.pdf/);
  assert.equal(await page.evaluate(() => sessionStorage.length), 0, "migration retires the legacy copy");
  for (const stream of streams) { send(stream, {type:'error',error:'The source could not be read'}); stream.end(); }
  await page.getByRole("status").filter({ hasText: "The source could not be read" }).waitFor();
  assert.equal(await page.locator('[data-testid="restored-uploads"] .animate-spin').count(), 0, "failed uploads stop spinning");
  assert.deepEqual(await page.evaluate(() => window.recovery.runtimeIngestRecoveries()), []);
  assert.deepEqual(errors, []);
});
