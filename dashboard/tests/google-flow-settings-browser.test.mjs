import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

test("Flow Settings connects in the background without an extension or external browser", { timeout: 30_000 }, async t => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const built = await build({
    stdin: { loader: "tsx", resolveDir: root, contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import Flow from './src/app/components/settings-google-flow';
      createRoot(document.getElementById('root')).render(<ul><Flow/></ul>);` },
    absWorkingDir: root, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    outdir: "flow-test-output", define: { "process.env.NODE_ENV": '"development"' },
  });
  const scripts = built.outputFiles.find(file => file.path.endsWith(".js")).text;
  const css = built.outputFiles.find(file => file.path.endsWith(".css")).text;
  const calls = [];
  let state = { installed: true, configured: false, enabled: false, connected: false, accountLabel: null, background: true };
  const server = http.createServer(async (request, response) => {
    if (request.url === "/app.js") { response.setHeader("content-type", "text/javascript"); return response.end(scripts); }
    if (request.url === "/app.css") { response.setHeader("content-type", "text/css"); return response.end(css); }
    if (request.url === "/api/hermes/connections/google-flow") {
      response.setHeader("content-type", "application/json");
      if (request.method === "GET") return response.end(JSON.stringify(state));
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks)); calls.push(body);
      if (body.action === "connect") state = { ...state, enabled: true, connected: true, accountLabel: "Personal" };
      if (body.action === "disable") state = { ...state, enabled: false, connected: false };
      return response.end(JSON.stringify(state));
    }
    response.setHeader("content-type", "text/html");
    response.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/app.css"><style>:root{--paper-surface:white;--ink:#222;--ink-heading:#222;--ink-muted:#555;--line:#ddd;--botanical:green}*{box-sizing:border-box}</style><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { channel: "msedge" } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole("button", { name: "Set up Google Flow Veo" }).click();
  assert.equal(await page.getByRole("checkbox").count(), 0);
  assert.match(await page.getByRole("dialog").innerText(), /Sign in to Google in Breadboard’s browser, then connect here/);
  await page.getByRole("button", { name: "Connect in background", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Connected. Use /veo in chat to create a video." }).waitFor();
  assert.deepEqual(calls, [{action:"connect"}]);
  const box = await page.getByRole("dialog").boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390);
  await page.getByRole("button", { name: "Disable connection", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Connection disabled" }).waitFor();
  assert.deepEqual(errors, []);
});
