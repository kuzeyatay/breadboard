import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";

test("restored uploads poll through outages, settle, and ignore replies from an old garden", { timeout: 30_000 }, async t => {
  const root = path.resolve(import.meta.dirname, "..");
  const bundle = await build({
    absWorkingDir: root,
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {useGardenUploadRecoveries} from './src/app/components/use-garden-upload-recoveries';
      function App() {
        const [garden, setGarden] = useState('telecom-1');
        const [settled, setSettled] = useState(0);
        const {recoveries, refresh} = useGardenUploadRecoveries(garden, () => setSettled(n => n + 1));
        return <><output>{JSON.stringify({garden, settled, recoveries})}</output>
          <button onClick={() => void refresh()}>Refresh</button>
          <button onClick={() => setGarden('other')}>Switch garden</button></>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
  });
  const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const record = { recoveryId: "rec_1", filename: "lab.pdf", resumedJobId: "job_1", resumedState: "queued" };
  let records = [record], status = 200, requests = 0, hold = false, held;
  await page.route("http://localhost:39992/**", route => {
    if (!route.request().url().includes("/ingest-recovery")) {
      return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
    }
    requests++;
    if (hold && route.request().url().includes("telecom-1")) { held = route; return; }
    return route.fulfill({ status, json: { recoveries: records } });
  });
  await page.clock.install();
  await page.goto("http://localhost:39992/");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const state = () => page.locator("output").textContent().then(JSON.parse);
  await page.waitForFunction(() => JSON.parse(document.querySelector('output').textContent).recoveries.length === 1);
  assert.equal((await state()).recoveries[0].resumedState, "queued");

  status = 503;
  await Promise.all([
    page.waitForResponse(response => response.status() === 503),
    page.clock.fastForward(3_100),
  ]);
  assert.equal((await state()).recoveries[0].resumedJobId, "job_1");
  status = 200;
  records = [];
  await page.clock.fastForward(3_100);
  await page.waitForFunction(() => JSON.parse(document.querySelector('output').textContent).settled === 1);
  assert.deepEqual((await state()).recoveries, []);
  const stoppedAt = requests;
  await page.clock.fastForward(30_000);
  assert.equal(requests, stoppedAt, "settled uploads stop polling");

  records = [record];
  await page.getByText("Refresh", { exact: true }).click();
  await page.waitForFunction(() => JSON.parse(document.querySelector('output').textContent).recoveries.length === 1);
  records = [{ ...record, resumedJobId: null, resumedState: null }];
  await page.clock.fastForward(3_100);
  await page.waitForFunction(() => JSON.parse(document.querySelector('output').textContent).settled === 2);
  assert.equal((await state()).recoveries[0].resumedJobId, null, "failed jobs offer Resume again");

  hold = true;
  await page.getByText("Refresh", { exact: true }).click();
  await page.waitForTimeout(50);
  assert.ok(held);
  const duringHold = requests;
  await page.getByText("Refresh", { exact: true }).click();
  assert.equal(requests, duringHold, "refresh does not overlap a pending request");
  records = [];
  await page.getByText("Switch garden", { exact: true }).click();
  await page.waitForFunction(() => JSON.parse(document.querySelector('output').textContent).garden === 'other');
  await held.fulfill({ json: { recoveries: [record] } }).catch(() => {});
  assert.deepEqual((await state()).recoveries, [], "an old request cannot restore another garden's upload row");
  assert.deepEqual(errors, []);
});
