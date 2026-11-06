import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { skillProductDescription } from "../src/lib/hermes/skill-product-copy.ts";

test("skill discovery shows product copy, preserves originals, and passes unchanged selections", { timeout: 60_000 }, async t => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const original = "Use when the user asks for planning. Follow the publisher's detailed instructions.";
  const known = {
    upstreamId: "rlaope/oh-my-hermes/omh-plan", source: "rlaope/oh-my-hermes", sourceType: "github",
    slug: "omh-plan", name: "Plan", command: "/omh:omh-plan", slashCommand: "omh:omh-plan",
    description: original, descriptionLoaded: true, installationStatus: "installed", availability: "ready",
    reasons: [], requiresOpenCode: false, files: null, audits: null, contract: null, requirements: [], installs: 0,
  };
  const custom = { ...known, upstreamId: "skill:calendar", source: "Breadboard", sourceType: "local-install", slug: "calendar", command: "/calendar", slashCommand: "calendar", name: "My calendar", description: "My custom calendar instructions." };
  const command = { ...known, id: known.upstreamId, kind: "skill", token: known.slashCommand, installed: true, enabled: true, healthy: true };
  const summary = skillProductDescription(known);
  assert.notEqual(summary, original);
  const bundle = await build({ absWorkingDir: root, stdin: { resolveDir: root, loader: "tsx", contents: `
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import SkillsCatalogPanel from './src/app/components/hermes/skills-catalog-panel';
    import SlashCommandMenu from './src/app/components/hermes/slash-command-menu';
    createRoot(document.getElementById('catalog')).render(<SkillsCatalogPanel runtimeSessionId={null} onUse={skill => { window.usedSkill = skill; }} />);
    createRoot(document.getElementById('slash')).render(<SlashCommandMenu open query="omh-plan" surface="dashboard_terminal" availableRuntimeAgentIds={[]} onClose={() => {}} onSelect={item => { window.usedCommand = item; }} />);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
  const server = http.createServer((req,res) => {
    if(req.url === "/app.js") { res.setHeader("Content-Type","text/javascript"); return res.end(bundle.outputFiles[0].text); }
    if(req.url.startsWith("/api/")) {
      res.setHeader("Content-Type","application/json");
      let data;
      if(req.url.startsWith("/api/hermes/commands")) data = { groups: { skills: [command], agents: [], prompts: [], mcp: [] } };
      else if(req.url.startsWith("/api/hermes/agency-agents")) data = {ok:true, agents:[{id:"other",slug:"other",name:"Other",division:"general",services:[]}], divisions:[{id:"general",name:"General"}]};
      else if(req.url.startsWith("/api/hermes/skills/detail")) data = {skill:known, detail:{id:known.upstreamId, hash:"test-reviewed-hash", files:[]}, audits:[]};
      else data = {skills:[known,custom],pagination:{page:0,perPage:50,total:2,hasMore:false}};
      return res.end(JSON.stringify(data));
    }
    res.setHeader("Content-Type","text/html; charset=utf-8");
    res.end('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:14px system-ui;margin:24px}#catalog{max-width:620px}#slash{position:relative;margin-top:24px}button,summary{cursor:pointer}button{margin:4px}p{line-height:1.5}</style></head><body><main id="catalog"></main><aside id="slash"></aside><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const browser = await chromium.launch({headless:true,...(process.platform === "win32" ? {channel:"msedge"} : {})});
  t.after(()=>browser.close());
  const page = await browser.newPage({viewport:{width:900,height:900}});
  page.setDefaultTimeout(6000);
  const errors=[]; page.on("pageerror",error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const catalog = page.locator("#catalog"), slash = page.locator("#slash");
  const list = catalog.getByRole("listbox");
  await list.getByText(summary,{exact:true}).waitFor();
  assert.equal(await list.getByText(original,{exact:true}).count(),0);
  await list.getByText(custom.description,{exact:true}).waitFor();
  await slash.getByRole("button",{name:new RegExp(summary.replaceAll(".","\\."))}).click();
  assert.equal((await page.evaluate(()=>window.usedCommand)).description,original);
  await list.getByRole("button").filter({hasText:summary}).click();
  await catalog.getByText(summary,{exact:true}).waitFor();
  assert.equal(await catalog.getByText(original,{exact:true}).isVisible(),false);
  await catalog.getByText("Original description",{exact:true}).click();
  assert.equal(await catalog.getByText(original,{exact:true}).isVisible(),true);
  assert.equal(await catalog.getByText("test-reviewed-hash",{exact:true}).isVisible(),false);
  await catalog.getByText("Technical details",{exact:true}).click();
  assert.equal(await catalog.getByText("test-reviewed-hash",{exact:true}).isVisible(),true);
  await catalog.getByRole("button",{name:"Use /omh:omh-plan",exact:true}).click();
  assert.equal((await page.evaluate(()=>window.usedSkill)).description,original);
  assert.deepEqual(errors,[]);
});
