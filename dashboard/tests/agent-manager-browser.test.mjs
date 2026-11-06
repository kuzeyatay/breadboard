import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import { chromium } from "playwright";
import { agentManagerEntry } from "../src/lib/agent-manager/catalog.ts";

test("Agent Manager renders every specialist and controls durable setup through reload, confirmation and cancellation", { timeout: 90000 }, async (t) => {
  const root = path.resolve(import.meta.dirname, "..");
  const bundle = await build({
    stdin: { loader: "tsx", resolveDir: root, contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import AgentManagerPanel from './src/app/components/hermes/agent-manager-panel';
      window.openedSettings=[]; window.changed=0;
      createRoot(document.getElementById('root')).render(<AgentManagerPanel onOpenAgentSettings={id=>window.openedSettings.push(id)} onChanged={()=>window.changed++}/>);` },
    absWorkingDir: root, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
  });
  const cssSource = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8")
    .replace('@source "../**/*.{js,mjs,cjs,ts,tsx,jsx,mdx}";', '@source "./components/hermes/agent-manager-panel.tsx"; @source "./components/confirm-dialog.tsx";');
  const css = (await postcss([tailwindcss({ base: root })]).process(cssSource, { from: path.join(root, "src/app/globals.css") })).css;
  const calls = [], operations = new Map();
  let installed = false, complete = false, healthRunning = 0, maxHealthRunning = 0, hybridStorage = false;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/app.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles[0].text); return; }
    if (url.pathname === "/style.css") { response.setHeader("content-type", "text/css"); response.end(css); return; }
    if (url.pathname.startsWith("/api/")) {
      response.setHeader("content-type", "application/json");
      const json = (value) => response.end(JSON.stringify(value));
      if (url.pathname.endsWith("/health")) {
        healthRunning++; maxHealthRunning = Math.max(maxHealthRunning, healthRunning);
        await new Promise((resolve) => setTimeout(resolve, 15));
        healthRunning--;
        if (url.pathname === "/api/deep-tutor/health") return json({ ok: true, available: installed, cloned: true, environmentReady: true, packageInstalled: installed, root: "C:\\Breadboard\\DeepTutor", reason: installed ? null : "Source is present, but required packages are missing." });
        if (url.pathname === "/api/codex/health") return json({ ok: true, available: false, installed: true, reason: "Connect a repository to this Garden." });
        if (url.pathname === "/api/music-producer/health") return json({ ok: true, state: "missing-models", message: "Local models have not been downloaded." });
        return json({ ok: true, available: true, installed: true, cloned: true });
      }
      if (url.pathname === "/api/agent-manager") {
        const agentId = url.searchParams.get("agentId");
        if (request.method === "POST") {
          const chunks = []; for await (const chunk of request) chunks.push(chunk);
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")); calls.push({ method: "POST", body });
          complete = false;
          const operation = { agentId: body.agentId, actionId: body.actionId, jobId: `job_${"a".repeat(64)}`, state: "queued", message: "Preparing requested dependencies.", finished: false };
          operations.set(body.agentId, operation); response.statusCode = 202; return json({ ok: true, operation });
        }
        if (request.method === "DELETE") {
          calls.push({ method: "DELETE", agentId });
          const operation = { ...operations.get(agentId), state: "cancelled", message: "Setup cancelled. Dependencies may be partly installed.", finished: true };
          operations.set(agentId, operation); return json({ ok: true, operation });
        }
        if (!agentId) return json({ ok: true, storageRoot: hybridStorage ? "C:\\BreadboardData" : "D:\\BreadboardData", bulkStorageRoot: hybridStorage ? "D:\\BreadboardLargeFiles" : null, operationAgentIds: [...operations.keys()] });
        calls.push({ method: "GET", agentId });
        const operation = operations.get(agentId);
        if (operation && !operation.finished && complete) {
          installed = operation.actionId !== "remove";
          Object.assign(operation, { state: "succeeded", finished: true, message: installed ? "Dependencies installed." : "Dependencies removed; user files preserved." });
        }
        return json({ ok: true, operation: operation ?? null });
      }
      response.statusCode = 404; return json({ ok: false, error: "Unexpected fixture endpoint" });
    }
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end('<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/style.css"></head><body style="padding:24px"><main id="root" style="max-width:1100px;margin:auto"></main><script src="/app.js"></script></body></html>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { channel: "msedge" } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.setDefaultTimeout(10000);
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole("button", { name: "Refresh status", exact: true }).waitFor();
  assert.equal(await page.locator("article").count(), 41);
  assert.match(await page.getByRole("region", { name: "Agent Manager" }).innerText(), /Managed storage: D:\\BreadboardData/);
  assert.equal(await page.getByLabel("Filter by workflow").locator("option").count(), 9);
  assert.ok(maxHealthRunning <= 3, `Opening the manager launched ${maxHealthRunning} simultaneous health probes`);
  await page.getByLabel("Filter by workflow").selectOption("learn");
  assert.equal(await page.locator("article").count(), 2);
  await page.getByLabel("Filter by workflow").selectOption("");
  await page.getByLabel("Filter by installation").selectOption("attention");
  assert.ok(await page.locator("article").filter({ has: page.getByRole("heading", { name: /^Deep Tutor/ }) }).count());
  assert.equal(await page.locator("article").filter({ has: page.getByRole("heading", { name: /^Bolt Slides/ }) }).count(), 0);
  await page.getByLabel("Filter by installation").selectOption("all");
  await page.getByLabel("Search agents").fill("codex");
  const codexRow = page.locator("article").filter({ has: page.getByRole("heading", { name: /^Codex/ }) });
  assert.equal(await codexRow.getByRole("button", { name: "Agent settings", exact: true }).count(), 0);
  await codexRow.getByText("Dependencies and storage", { exact: true }).click();
  assert.ok(await codexRow.getByText(agentManagerEntry("codex").requirements, { exact: true }).isVisible());
  await page.getByLabel("Search agents").fill("deep tutor");
  const row = page.locator("article");
  const actionLabel = (id) => agentManagerEntry("deep-tutor").actions.find((action) => action.id === id).label;
  assert.equal(await row.count(), 1);
  assert.match(await row.innerText(), /Needs installation/);
  assert.match(await row.innerText(), /required packages are missing/);
  await row.getByText("Dependencies and storage", { exact: true }).click();
  assert.match(await row.innerText(), /C:\\Breadboard\\DeepTutor/);
  await row.getByRole("button", { name: "Agent settings", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.openedSettings), ["deep-tutor"]);
  await row.getByRole("button", { name: actionLabel("install"), exact: true }).click();
  await row.getByRole("button", { name: "Stop setup", exact: true }).waitFor();
  assert.deepEqual(calls.find((call) => call.method === "POST").body, { agentId: "deep-tutor", actionId: "install" });
  await page.waitForFunction(() => document.querySelector("article")?.textContent.includes("Setup in progress"));
  hybridStorage = true;
  await page.reload();
  await page.getByLabel("Search agents").fill("deep tutor");
  await row.getByRole("button", { name: "Stop setup", exact: true }).waitFor();
  const managerText = await page.getByRole("region", { name: "Agent Manager" }).innerText();
  assert.match(managerText, /Chats and settings: C:\\BreadboardData/);
  assert.match(managerText, /Agent downloads: D:\\BreadboardLargeFiles/);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1, "Reload must reconnect to the job without another install");
  complete = true;
  await row.getByText("Dependencies installed.", { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector("article")?.textContent.includes("Ready"));
  await row.getByRole("button", { name: actionLabel("remove"), exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /Chats.*generated files.*other files are kept/);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
  await row.getByRole("button", { name: actionLabel("remove"), exact: true }).click();
  await dialog.getByRole("button", { name: "Remove dependencies", exact: true }).click();
  await row.getByRole("button", { name: "Stop setup", exact: true }).waitFor();
  assert.deepEqual(calls.filter((call) => call.method === "POST").at(-1).body, { agentId: "deep-tutor", actionId: "remove", confirmRemoval: true });
  await row.getByRole("button", { name: "Stop setup", exact: true }).click();
  await row.getByText("Setup cancelled. Dependencies may be partly installed.", { exact: true }).waitFor();
  assert.deepEqual(calls.filter((call) => call.method === "DELETE"), [{ method: "DELETE", agentId: "deep-tutor" }]);
  const screenshots = path.resolve(root, "../.tmp/agent-manager-qa");
  fs.mkdirSync(screenshots, { recursive: true });
  await page.screenshot({ path: path.join(screenshots, "desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "The manager should fit a narrow viewport");
  await page.screenshot({ path: path.join(screenshots, "mobile.png"), fullPage: true });
  assert.deepEqual(errors, []);
});
