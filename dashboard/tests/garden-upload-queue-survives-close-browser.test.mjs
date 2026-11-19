import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";

// Closing the app used to drop every queued file and strand the one in flight.
test("queued and interrupted uploads come back after the app closes", { timeout: 45_000 }, async t => {
  const root = path.resolve(import.meta.dirname, "..");
  const bundle = await build({
    absWorkingDir: root,
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React, {useSyncExternalStore} from 'react';
      import {createRoot} from 'react-dom/client';
      import {useGardenRestoredUploads} from './src/app/components/use-garden-restored-uploads';
      import {RestoredGardenUploadRows} from './src/app/components/restored-garden-upload-rows';
      import {startGardenUploadTask, subscribeGardenUploads, gardenUploadTasksSnapshot} from './src/lib/garden-upload-store';
      function App() {
        const uploads = useGardenRestoredUploads('itec', {onEvent: () => {}, onSettled: () => {}});
        const tasks = useSyncExternalStore(subscribeGardenUploads, gardenUploadTasksSnapshot);
        return <section><RestoredGardenUploadRows uploads={uploads}/>
          <output>{JSON.stringify(tasks.map(t => ({state: t.state, statuses: t.statuses})))}</output>
          <button onClick={() => startGardenUploadTask({clusterSlug:'itec',files:[new File(['aaaa'],'a.pdf'), new File(['bbbb'],'b.pdf')],options:{label:'',handwriting:false,parseWithVlm:false,generateMap:true}})}>Upload</button>
        </section>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
  });
  let appOpen = true;
  const submitted = [];
  const server = http.createServer(async (request, response) => {
    if (request.url === "/bundle.js") {
      response.writeHead(200, { "Content-Type": "text/javascript" });
      response.end(bundle.outputFiles[0].text);
    } else if (request.url === "/api/ingest") {
      let body = "";
      for await (const chunk of request) body += chunk;
      const name = /filename="([^"]+)"/.exec(body)?.[1];
      submitted.push(name);
      response.writeHead(200, { "Content-Type": "text/event-stream", "X-Breadboard-Runtime-Job-Id": `job_${name.replace(".", "_")}` });
      // While the "app" is open the first upload runs until the app closes.
      if (appOpen) { response.write(`data: ${JSON.stringify({ type: "progress", step: "Reading page 1" })}\n\n`); return; }
      response.end(`data: ${JSON.stringify({ type: "result", success: true, slug: name })}\n\ndata: [DONE]\n\n`);
    } else if (request.url.startsWith("/api/ingest/jobs/")) {
      // After a restart the Runtime has abandoned the job it was running.
      response.writeHead(200, { "Content-Type": "text/event-stream", "X-Breadboard-Runtime-Job-State": "uncertain" });
      response.end(`data: ${JSON.stringify({ type: "error", error: "Runtime job execution failed." })}\n\ndata: [DONE]\n\n`);
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
  await page.waitForFunction(() => document.querySelector("output").textContent.includes('"a.pdf-4":"uploading"'));
  await page.waitForTimeout(300); // let the queue writes land
  assert.deepEqual(submitted, ["a.pdf"], "b.pdf is still waiting its turn");

  // The app closes: a.pdf is mid-run, b.pdf never started.
  await page.close();
  appOpen = false;
  server.closeAllConnections();
  page = await context.newPage();
  await page.goto(origin);
  await page.waitForFunction(() => {
    const tasks = JSON.parse(document.querySelector("output").textContent);
    const statuses = tasks.flatMap(t => Object.entries(t.statuses));
    return tasks.every(t => t.state === "done") &&
      ["a.pdf-4", "b.pdf-4"].every(key => statuses.some(([k, v]) => k === key && v === "done"));
  });
  assert.deepEqual([...submitted].sort(), ["a.pdf", "a.pdf", "b.pdf"], "both files were uploaded again from the kept copies");
  assert.equal(await page.getByTestId("restored-uploads").count(), 0, "no dead row is left behind");

  // Settled uploads leave nothing to replay.
  await page.waitForTimeout(300);
  await page.reload();
  await page.getByText("Upload", { exact: true }).waitFor();
  await page.waitForTimeout(500);
  assert.equal(submitted.length, 3, "a settled upload is never replayed");
  assert.deepEqual(errors, []);
});
