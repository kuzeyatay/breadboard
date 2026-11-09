import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import Database from "better-sqlite3";
import { SwarmStore } from "../src/lib/swarm/store.ts";
import { DEFAULT_SWARM_LIMITS } from "../src/lib/swarm/policy.ts";

test("persistent team panel approves, pauses, resumes and stops through the actual API", { timeout: 60_000 }, async () => {
  const executablePath = process.env.SWARM_TEST_BROWSER ?? [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/usr/bin/chromium", "/usr/bin/google-chrome",
  ].find(value => fs.existsSync(value));
  assert.ok(executablePath, "Set SWARM_TEST_BROWSER to an installed Chromium browser.");
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"swarm-browser-"));
  const db=new Database(path.join(directory,"state.db"));
  db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1); CREATE TABLE conversations(id INTEGER PRIMARY KEY,user_id INTEGER,public_id TEXT); INSERT INTO conversations VALUES(1,1,'conv_browser');");
  const store=new SwarmStore(db);
  const authority={userId:1,conversationId:1,conversationPublicId:"conv_browser",runtimeSessionId:1,sourceRunId:"parent",originClientMessageId:"request",
    surface:"dashboard_terminal",gardenId:null,gardenSlug:null,model:"test",reasoningEffort:"medium",standingApproval:false,
    allowedTools:["agent_launch"],allowedAgentIds:["get-doc"],inputReferences:[]};
  const run=store.create({authority,requestId:"browser",limits:{...DEFAULT_SWARM_LIMITS,maxTokens:2000},
    admission:()=>({available:true,requiresApproval:true}),plan:{objective:"Compare two sets of source evidence",reason:"Each assignment covers a separate source collection.",mode:"parallel",benefit:"coverage",
      tasks:["papers","reports"].map(key=>({key,title:`Find ${key}`,brief:`Inspect the ${key} and record source links.`,executor:{kind:"runtime",id:"get-doc"},dependsOn:[],acceptance:["Sources are traceable"],inputs:[],tokenBudget:500}))}});
  globalThis.__swarmBrowser={db,store};
  const client=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {SwarmActivity} from './src/app/components/hermes/swarm-activity.tsx';createRoot(document.getElementById('root')).render(<SwarmActivity conversationId="conv_browser"/>);`,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic"});
  const stubs={
    "@/lib/db.ts":"export default globalThis.__swarmBrowser.db;",
    "@/lib/swarm/service.ts":"export const swarmStore=()=>globalThis.__swarmBrowser.store;",
    "@/lib/swarm/pump.ts":"export const wakeSwarm=()=>{};",
    "@/lib/server-auth.ts":"export const requireUserId=async()=>1;export class RouteError extends Error{constructor(status,message){super(message);this.status=status;}}export const routeErrorResponse=e=>Response.json({error:e.message},{status:e.status??500});",
    "@/lib/conversations/store.ts":"export const getConversationForUser=(id,user)=>{const row=globalThis.__swarmBrowser.db.prepare('SELECT * FROM conversations WHERE public_id=? AND user_id=?').get(id,user);if(!row)throw Object.assign(Error('Not found'),{status:404});return row;};export const getConversationForLegacyChatSession=()=>null;",
  };
  const apiBundle=await build({entryPoints:["src/app/api/swarm/route.ts"],bundle:true,write:false,platform:"node",format:"cjs",packages:"external",plugins:[{name:"test-session",setup(b){
    b.onResolve({filter:/.*/},args=>stubs[args.path]!==undefined?{path:args.path,namespace:"stub"}:undefined);
    b.onLoad({filter:/.*/,namespace:"stub"},args=>({contents:stubs[args.path],loader:"js"}));
  }}]});
  const module={exports:{}};new Function("require","module","exports",apiBundle.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
  const server=http.createServer(async(req,res)=>{
    try {
      if(req.url==="/app.js"){res.writeHead(200,{"content-type":"text/javascript"});res.end(client.outputFiles[0].text);return;}
      if(req.url.startsWith("/api/swarm")){
        const chunks=[];for await(const chunk of req)chunks.push(chunk);
        const response=await module.exports[req.method](new Request(`http://127.0.0.1${req.url}`,{method:req.method,...(req.method==="POST"?{body:Buffer.concat(chunks),headers:{"content-type":"application/json"}}:{})}));
        res.writeHead(response.status,{"content-type":"application/json"});res.end(await response.text());return;
      }
      res.writeHead(200,{"content-type":"text/html"});res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:14px system-ui;background:#f7faf8;color:#173d2c;margin:24px}#root{max-width:780px;margin:auto}summary{padding:12px;cursor:pointer}details{border:1px solid #c7d9cc;border-radius:8px;padding:8px;background:white}button{padding:8px 12px;margin:4px;border:1px solid #a8cbb7;border-radius:6px;background:#eef8f1}li{margin:12px 0}p{overflow-wrap:anywhere}code{overflow-wrap:anywhere}</style></head><body><main id="root"></main><script src="/app.js"></script></body></html>`);
    }catch(error){res.writeHead(500);res.end(String(error));}
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const browser=await chromium.launch({executablePath,headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1000,height:800}});const errors=[];page.on("pageerror",error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByLabel("Team progress: 0 of 2 complete").click();
    await page.getByRole("button",{name:"Approve assignment"}).first().click();
    await page.waitForFunction(()=>document.querySelectorAll('button').length>0 && [...document.querySelectorAll('button')].filter(b=>b.textContent==='Approve assignment').length===1);
    assert.equal(store.snapshot(1,run.id).tasks[0].status,"queued");
    await page.reload();await page.getByLabel("Team progress: 0 of 2 complete").click();
    assert.equal(await page.getByRole("button",{name:"Approve assignment"}).count(),1,"approval persists across reload");
    await page.getByRole("button",{name:"Pause new work"}).click();await page.getByRole("button",{name:"Resume",exact:true}).waitFor();
    assert.equal(store.get(1,run.id).status,"paused");
    await page.getByRole("button",{name:"Resume",exact:true}).click();await page.getByRole("button",{name:"Pause new work"}).waitFor();
    assert.equal(store.get(1,run.id).status,"running");
    await page.getByText("Assignment and evidence",{exact:true}).first().click();
    fs.mkdirSync(path.resolve(".swarm-verification"),{recursive:true});
    await page.screenshot({path:path.resolve(".swarm-verification/team-panel.png"),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,"panel fits a narrow conversation");
    await page.getByRole("button",{name:"Stop team"}).click();
    await page.getByText("cancelled",{exact:true}).first().waitFor();assert.equal(store.get(1,run.id).status,"cancelled");
    await page.reload();await page.getByLabel("Team progress: 0 of 2 complete").waitFor();
    assert.equal(await page.getByRole("button",{name:"Stop team"}).count(),0);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));delete globalThis.__swarmBrowser;db.close();fs.rmSync(directory,{recursive:true,force:true});}
});
