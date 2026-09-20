import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

test("media picker queues every selected file, survives navigation, and keeps failures retryable", { timeout: 60_000 }, async t => {
  const root = path.resolve(import.meta.dirname, "..");
  const bundle = await build({ absWorkingDir: root, stdin: { resolveDir: root, loader: "tsx", contents: `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import GardenVideoImport from './src/app/components/garden-video-import';
    function App() {
      const [open, setOpen] = useState(true);
      const [mounted, setMounted] = useState(true);
      return <><button onClick={() => setMounted(x => !x)}>Switch garden</button>
        <button onClick={() => setOpen(true)}>Add media</button>
        {mounted && <GardenVideoImport clusterSlug="ec-2" isOwner open={open} expanded mediaSources={[]} onClose={() => setOpen(false)} onExpand={() => {}}/>}</>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, outfile: "test.js", platform: "browser", format: "iife", jsx: "automatic", plugins: [{ name: "next-link", setup(build) {
    build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "test" }));
    build.onLoad({ filter: /.*/, namespace: "test" }, () => ({ loader: "js", contents: 'export default function Link(props) { return null; }' }));
  } }] });
  const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const requests = [];
  const held = [];
  await page.route("http://localhost:39991/**", async route => {
    const url = route.request().url();
    if (url.endsWith("/health")) return route.fulfill({ json: {} });
    if (url.includes("/video-transcriptions")) {
      if (route.request().method() === "GET") return route.fulfill({ json: { jobs: [] } });
      requests.push(route.request().postDataBuffer().toString());
      held.push(route);
      return;
    }
    return route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div></body></html>' });
  });
  await page.goto("http://localhost:39991/");
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith(".js")).text });
  const mediaFiles = Array.from({ length: 7 }, (_, i) => ({ name: `lecture-${i}.${i % 2 ? "mp4" : "mp3"}`, mimeType: i % 2 ? "video/mp4" : "audio/mpeg", buffer: Buffer.from("media") }));
  await page.getByLabel("Video or audio files", { exact: true }).setInputFiles([...mediaFiles, { name: "bad.txt", mimeType: "text/plain", buffer: Buffer.from("invalid") }]);
  await expect(page.getByRole("list", { name: "Selected media files" }).getByRole("listitem")).toHaveCount(7);
  await expect(page.getByText(/bad.txt:/)).toBeVisible();
  await page.getByRole("button", { name: "Queue 7 files" }).click();
  await expect(page.getByRole("button", { name: /View transcription progress for/ })).toHaveCount(7);
  assert.equal(requests.length, 1);
  await page.getByRole("button", { name: "Switch garden" }).click();
  // Every accepted response is followed by the next transfer even while unmounted.
  for (let i = 0; i < 7; i++) {
    await expect.poll(() => held.length).toBe(i + 1);
    assert.match(requests[i], new RegExp(`lecture-${i}\\.`));
    if (i === 1) await held[i].fulfill({ status: 503, json: { error: "Temporary outage" } });
    else await held[i].fulfill({ json: { duplicate: true, source: { title: `Existing ${i}` } } });
  }
  await page.getByRole("button", { name: "Switch garden" }).click();
  await expect(page.getByRole("button", { name: /View transcription progress for/ })).toHaveCount(1);
  await page.getByRole("button", { name: /View transcription progress for lecture-1/ }).click();
  await expect(page.getByText("Temporary outage", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect.poll(() => held.length).toBe(8);
  await held[7].fulfill({ json: { duplicate: true, source: { title: "Existing 1" } } });
  await expect(page.getByText("Source already available", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Add media" }).click();
  await page.getByLabel("Video or audio files", { exact: true }).setInputFiles(mediaFiles[0]);
  await page.locator("#garden-media-panel [class*=border-dashed]").evaluate(element => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["video"], "dropped.mp4", { type: "video/mp4" }));
    transfer.items.add(new File(["audio"], "dropped.mp3", { type: "audio/mpeg" }));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }));
  });
  await expect(page.getByRole("button", { name: "Queue 3 files" })).toBeVisible();
  await page.getByRole("button", { name: "Remove dropped.mp4" }).click();
  await expect(page.getByRole("button", { name: "Queue 2 files" })).toBeVisible();
  await page.getByLabel("YouTube URL", { exact: true }).fill("https://youtu.be/dQw4w9WgXcQ");
  await expect(page.getByRole("list", { name: "Selected media files" })).toHaveCount(0);
  assert.deepEqual(errors, []);
});
