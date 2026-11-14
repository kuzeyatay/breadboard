import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

test("Blender Settings handles installation, a closed app, connect, check and disable", { timeout: 30_000 }, async t => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const built = await build({
    stdin: { loader: "tsx", resolveDir: root, contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import Blender from './src/app/components/settings-blender';
      createRoot(document.getElementById('root')).render(<ul><Blender/></ul>);` },
    absWorkingDir: root, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    outdir: "blender-test-output", define: { "process.env.NODE_ENV": '"development"' },
  });
  const scripts = built.outputFiles.find(file => file.path.endsWith(".js")).text;
  const css = built.outputFiles.find(file => file.path.endsWith(".css")).text;
  const calls = [];
  let failConnect = true;
  let state = { installed: false, configured: false, enabled: false, addonPath: "C:\\Breadboard Data\\blender\\addon.py", setupCommand: "node 'C:\\Breadboard\\scripts\\setup-blender.mjs' --data-dir 'C:\\Breadboard Data'" };
  const server = http.createServer(async (request, response) => {
    if (request.url === "/app.js") { response.setHeader("content-type", "text/javascript"); return response.end(scripts); }
    if (request.url === "/app.css") { response.setHeader("content-type", "text/css"); return response.end(css); }
    if (request.url === "/api/hermes/connections/blender") {
      response.setHeader("content-type", "application/json");
      if (request.method === "GET") return response.end(JSON.stringify(state));
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks)); calls.push(body);
      if (body.action === "connect" && failConnect) {
        response.statusCode = 503;
        return response.end(JSON.stringify({ error: "Blender did not respond. Open Blender and start its server." }));
      }
      if (body.action === "connect") state = { ...state, enabled: true, connected: true };
      if (body.action === "disable") state = { ...state, enabled: false, connected: false };
      return response.end(JSON.stringify(state));
    }
    response.setHeader("content-type", "text/html");
    response.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/app.css"><style>:root{--paper-surface:white;--ink:#222;--ink-heading:#222;--ink-muted:#555;--line:#ddd;--botanical:green}*{box-sizing:border-box}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { channel: "msedge" } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole("button", { name: "Set up Blender" }).click();
  await page.getByRole("button", { name: "Check installation" }).waitFor();
  assert.match(await page.getByRole("dialog").innerText(), /setup-blender.mjs/);
  assert.equal(await page.getByRole("button", { name: "Connect Blender", exact: true }).count(), 0);
  state.installed = true;
  await page.getByRole("button", { name: "Check installation" }).click();
  await page.getByRole("button", { name: "Connect Blender", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Blender did not respond" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Disable connection" }).count(), 0);
  failConnect = false;
  await page.getByRole("button", { name: "Connect Blender", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Blender responded" }).waitFor();
  await page.getByRole("button", { name: "Check connection" }).click();
  await page.getByRole("button", { name: "Disable connection" }).click();
  await page.getByRole("status").filter({ hasText: "Blender remains open" }).waitFor();
  assert.deepEqual(calls.map(call => call.action), ["connect", "connect", "refresh", "disable"]);
  assert.deepEqual(errors, []);
});
