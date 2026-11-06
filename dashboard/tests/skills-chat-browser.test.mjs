import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import { summarizeCapabilityUse } from "../src/lib/hermes/capability-usage.ts";

test("skills install with explicit access, remain removable in drafts, and show recorded response usage", { timeout: 90_000 }, async t => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const capabilities = summarizeCapabilityUse({
    selection: { inventory: { skills: 300, connections: 4, workflows: 2 }, skills: [
      { slug: "writing", name: "Writing helper", selection: "requested", guidanceLoaded: true },
      { slug: "watch", name: "Watch", selection: "automatic", guidanceLoaded: true },
      { slug: "premortem", name: "Premortem", selection: "requested" },
    ] },
    toolCalls: [{ toolName: "watch_run", success: false }, { toolName: "factcheck_run", success: true }],
    skillOpens: [{ slug: "apple-design" }],
  });
  const verification = { state: "unverified", evidence: [], assumptions: [], unsupportedClaims: [], capabilities };
  const bundle = await build({ absWorkingDir: root, stdin: { resolveDir: root, loader: "tsx", contents: `
    import React, { useState } from 'react'; import { createRoot } from 'react-dom/client';
    import SkillsCatalogPanel from './src/app/components/hermes/skills-catalog-panel';
    import SelectedSkills from './src/app/components/hermes/selected-skills';
    import AssistantMessageActions from './src/app/components/assistant-message-actions';
    function App() {
      const [value, setValue] = useState(() => localStorage.getItem('draft') ?? 'Improve this paragraph.');
      const [hints, setHints] = useState([]);
      const update = value => { setValue(value); localStorage.setItem('draft', value); };
      return <>
        <SkillsCatalogPanel runtimeSessionId="chat-1" onUse={skill => {
          const hint = { id: 'skill:' + skill.slug, slug: skill.slug, name: skill.name, token: skill.slashCommand };
          setHints([hint]); update(skill.command + ' Improve this paragraph.');
        }} />
        <section style={{padding:12, borderTop:'1px solid var(--line)'}} aria-label="Draft message">
          <SelectedSkills value={value} onChange={update} sessionId="chat-1" surface="dashboard_terminal" hints={hints} />
          <textarea aria-label="Message" value={value} onChange={e => update(e.target.value)} style={{width:'100%', padding:8}} />
        </section>
        <article style={{padding:12}} aria-label="Saved response">
          <p>Here is the revised paragraph.</p>
          <AssistantMessageActions content="Here is the revised paragraph." verification={${JSON.stringify(verification)}} />
        </article>
        <article aria-label="Response without usage"><AssistantMessageActions content="No recorded skills." /></article>
      </>;
    }
    createRoot(document.getElementById('root')).render(<App />);` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  const stylesheet = path.join(root, "src/app/globals.css");
  const cssInput = fs.readFileSync(stylesheet, "utf8").replace('@source "../**/*.{js,mjs,cjs,ts,tsx,jsx,mdx}";', '@source "./components/hermes/*.tsx";\n@source "./components/assistant-message-actions.tsx";');
  const css = (await postcss([tailwindcss({ base: root })]).process(cssInput, { from: stylesheet })).css;
  let installed = false;
  let missingFiles = false;
  let integrityVerified = false;
  let failPromotion = true;
  const requests = [];
  const candidate = () => ({
    upstreamId: "example/writing", slug: "writing", name: "Writing helper", command: "/writing", slashCommand: "writing",
    source: "example", sourceType: "community", description: "Rewrite a paragraph with clearer sentences.", descriptionLoaded: true,
    installationStatus: installed ? "installed" : "not_installed", availability: missingFiles ? "unavailable" : installed ? "ready" : "needs_review",
    reasons: installed ? [] : ["Review access before installing."], requirements: [], contract: null, installs: 30,
  });
  const report = () => ({
    name: "writing", package: "example/writing", files: ["SKILL.md", "references/style.md"],
    fileHashes: { "SKILL.md": "reviewed-file-hash", "references/style.md": "reference-hash" },
    requestedPermissions: ["filesystem-read", "network"], discoveredScripts: [], externalNetworkRequirements: [],
    risks: ["This skill can read workspace files."], riskSummary: "The downloaded revision is checked before promotion.",
    integrityVerified, classification: { classification: "eligible_general", category: "writing", reasons: [] },
  });
  const server = http.createServer(async (req, res) => {
    if (req.url === "/app.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(bundle.outputFiles[0].text); }
    if (req.url === "/style.css") { res.setHeader("Content-Type", "text/css"); return res.end(css); }
    if (req.url.startsWith("/api/")) {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : null;
      requests.push({ method: req.method, url: req.url, body });
      const url = new URL(req.url, "http://localhost");
      res.setHeader("Content-Type", "application/json");
      if (url.pathname === "/api/hermes/skills/install") return res.end(JSON.stringify({ report: report() }));
      if (url.pathname === "/api/hermes/skills/promote") {
        if (body.decision === "promote") {
          if (failPromotion) { failPromotion = false; res.statusCode = 503; return res.end(JSON.stringify({ error: "Installation failed. Please try again." })); }
          installed = true;
        }
        return res.end("{}");
      }
      if (url.pathname === "/api/hermes/skills/detail") return res.end(JSON.stringify({
        skill: candidate(), detail: { hash: "upstream-revision-hash", files: [{ path: "SKILL.md", contents: "Guidance" }] }, audits: [],
      }));
      if (url.pathname === "/api/hermes/skills") {
        const skills = url.searchParams.get("filter") === "all" || installed ? [candidate()] : [];
        return res.end(JSON.stringify({ skills, pagination: { page: 0, perPage: 50, total: skills.length, hasMore: false } }));
      }
      if (url.pathname === "/api/hermes/commands") return res.end(JSON.stringify({ groups: { skills: [
        { id: "skill:writing", token: "writing", slug: "writing", name: "Writing helper" },
        { id: "skill:watch", token: "watch", slug: "watch", name: "Watch" },
      ] } }));
      return res.end("{}");
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end('<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><main id="root" style="max-width:620px;margin:auto"></main><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { channel: "msedge" } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole("button", { name: "Discover", exact: true }).click();
  await page.getByRole("button", { name: /^\/writing\s/ }).click();
  await page.getByRole("heading", { name: "Writing helper", exact: true }).waitFor();
  await page.getByText("Technical details", { exact: true }).waitFor();
  assert.equal(await page.getByText("upstream-revision-hash", { exact: true }).isVisible(), false);
  await page.getByRole("button", { name: "Install skill", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "could not be verified" }).waitFor();
  await page.getByLabel("Read files in the allowed workspace", { exact: true }).check();
  await page.getByLabel("Access the network", { exact: true }).check();
  assert.equal(await page.getByRole("button", { name: "Install", exact: true }).isDisabled(), true, "integrity failure blocks installation even with access approved");
  assert.equal(requests.some(r => r.url.includes("/promote")), false);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  integrityVerified = true;
  await page.getByRole("button", { name: "Install skill", exact: true }).click();
  const install = page.getByRole("button", { name: "Install", exact: true });
  await install.waitFor();
  assert.equal(await install.isDisabled(), true);
  await page.getByLabel("Read files in the allowed workspace", { exact: true }).check();
  assert.equal(await install.isDisabled(), true, "every requested permission needs a choice");
  await page.getByLabel("Access the network", { exact: true }).check();
  assert.equal(await install.isDisabled(), false);
  assert.equal(await page.getByText("Before you install", { exact: true }).isVisible(), true);
  assert.equal(await page.getByText(/reviewed-file-hash/).isVisible(), false);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "installation fits mobile");
  const output = path.join(root, "artifacts/skills-library-qa");
  fs.mkdirSync(output, { recursive: true });
  await page.screenshot({ path: path.join(output, "skill-install-mobile.png"), fullPage: true });
  await install.click();
  await page.getByRole("status").filter({ hasText: "Installation failed" }).waitFor();
  assert.equal(await page.getByLabel("Access the network", { exact: true }).isChecked(), true);
  await install.click();
  await page.getByRole("status").filter({ hasText: "Installed. Use this skill" }).waitFor();
  assert.equal(await page.getByLabel("Selected skills", { exact: true }).count(), 0, "installing does not silently select a skill");
  const promotion = requests.filter(r => r.body?.decision === "promote").at(-1);
  assert.deepEqual(promotion.body.approvedPermissions, ["filesystem-read", "network"]);
  assert.equal(promotion.body.runtimeSessionId, "chat-1");
  await page.getByRole("button", { name: "Use /writing", exact: true }).click();
  const message = page.getByRole("textbox", { name: "Message", exact: true });
  await page.getByRole("button", { name: "Remove Writing helper skill", exact: true }).waitFor();
  assert.equal(await message.inputValue(), "/writing Improve this paragraph.");
  await page.getByRole("button", { name: "Remove Writing helper skill", exact: true }).click();
  assert.equal(await message.inputValue(), "Improve this paragraph.");
  await message.fill("/agents:codex /writing /watch Explain /writing in prose.");
  await page.getByRole("button", { name: "Remove Watch skill", exact: true }).waitFor();
  await page.getByRole("button", { name: "Remove Writing helper skill", exact: true }).click();
  assert.equal(await message.inputValue(), "/agents:codex /watch Explain /writing in prose.");
  await page.reload();
  await page.getByRole("button", { name: "Remove Watch skill", exact: true }).waitFor();
  const usage = page.getByLabel("Skills for this response", { exact: true });
  assert.equal(await usage.count(), 1, "unrecorded responses do not claim skill use");
  await usage.getByText("Skill instructions loaded:", { exact: true }).waitFor();
  assert.match(await usage.getByRole("button", { name: "Writing helper", exact: true }).getAttribute("title"), /Selected by you.*Instructions supplied/);
  assert.match(await usage.getByRole("button", { name: "Watch", exact: true }).getAttribute("title"), /Selected automatically.*All recorded calls failed/);
  assert.match(await usage.getByRole("button", { name: "Apple design", exact: true }).getAttribute("title"), /Chosen by the assistant.*Instructions opened/);
  assert.equal(await usage.getByText("Selected · use not recorded:", { exact: true }).isVisible(), true);
  assert.equal(await usage.getByText("Skills used:", { exact: true }).isVisible(), true);
  await usage.getByRole("button", { name: "Writing helper", exact: true }).click();
  await page.getByRole("dialog", { name: "Response evidence", exact: true }).waitFor();
  await page.getByRole("button", { name: "Close evidence", exact: true }).click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "chat fits mobile");
  await page.setViewportSize({ width: 900, height: 850 });
  await page.screenshot({ path: path.join(output, "skill-chat-desktop.png"), fullPage: true });
  await message.fill("A plain message /watch is prose.");
  assert.equal(await page.getByLabel("Selected skills", { exact: true }).count(), 0);
  await message.fill("");
  assert.equal(await page.getByLabel("Selected skills", { exact: true }).count(), 0);
  missingFiles = true;
  await page.reload();
  await page.getByRole("button", { name: /^\/writing\s/ }).click();
  await page.getByRole("button", { name: "Repair installation", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Use /writing", exact: true }).count(), 0);
  assert.deepEqual(errors, []);
});
