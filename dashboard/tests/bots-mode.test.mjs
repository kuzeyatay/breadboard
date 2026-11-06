import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { registerHooks } from "node:module";
import ts from "typescript";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright-core";

// All writes go into this test's temporary database, never the running app.
// Completion hooks can launch other agent runs; they are outside this test.
const fixtureHooks = registerHooks({ resolve(specifier,context,next) {
  if(specifier.endsWith("/hooks/chat-completed.ts")) return {url:"data:text/javascript,export const fireSuccessfulChatHooks=async()=>{}",shortCircuit:true};
  return next(specifier,context);
} });
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-bots-test-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;
const { default: db } = await import("../src/lib/db.ts");
const conversations = await import("../src/lib/conversations/store.ts");
const botModule = await import("../src/lib/bots/store.ts");
const { botsStore } = await import("../src/lib/bots/server.ts");
const core = await import("../src/lib/hermes/route-core.ts");
const { botPersonalityPrompt } = await import("../src/lib/bots/types.ts");
db.prepare("INSERT INTO users(id,username,email,password_hash) VALUES (1,'bots-test','bots@example.test','x'),(2,'bots-other','other@example.test','x')").run();
after(() => {
  db.close(); fixtureHooks.deregister();
  assert.equal(path.dirname(path.resolve(dataRoot)),path.resolve(os.tmpdir()));
  assert.ok(path.basename(dataRoot).startsWith("breadboard-bots-test-"));
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

function loadModule(file, modules) {
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports = {};
  new Function("require", "exports", code)(id => {
    assert.ok(Object.hasOwn(modules, id), `Missing fixture module ${id}`);
    return modules[id];
  }, exports);
  return exports;
}
let userId = 1;
let conversationStoreLoads = 0;
const api = loadModule(new URL("../src/app/api/bots/route.ts", import.meta.url), {
  "next/server": { NextResponse: { json: Response.json } },
  "@/lib/server-auth": { requireUserId: async () => { if (!userId) throw new core.ApiError(401, "unauthorized", "Sign in."); return userId; } },
  "@/lib/hermes/route-helpers": { ...core, apiErrorResponse: error => { const { status, body } = core.describeError(error); return Response.json(body, { status }); } },
  get "@/lib/conversations/store"() { conversationStoreLoads++; return conversations; },
  "@/lib/bots/server": { botsStore },
  "@/lib/bots/store": botModule,
});
const input = { name: "Test Luna", description: "Astronomy companion", personality: "Speak warmly with astronomy analogies.", avatar: { shape: "star", color: "#dba92f", face: "mouth" } };
function call(method, body, query = "") { return api[method](new Request(`http://localhost/api/bots${query}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })); }

test("Bots HTTP handlers persist to canonical chats, enforce ownership and reject invalid input", async () => {
  assert.equal(conversationStoreLoads, 0, "loading the roster route must not load the chat runtime");
  assert.equal((await (await call("GET")).json()).bots.length, 6);
  const created = await call("POST", input);
  assert.equal(created.status, 201);
  const { bot } = await created.json();
  assert.equal(conversationStoreLoads, 0, "listing and saving bots must not load the chat runtime");
  const { conversationId } = await (await call("POST", { action: "chat", id: bot.id })).json();
  assert.ok(conversationStoreLoads > 0, "opening a chat loads the canonical chat store on demand");
  const chat = conversations.getConversationForUser(conversationId, 1);
  assert.equal(chat.surface, "dashboard_terminal");
  assert.equal((await (await call("POST", { action: "chat", id: bot.id })).json()).conversationId, conversationId);
  conversations.reserveConversationTurn({ conversation: chat, clientMessageId: "test-saved-message", surface: chat.surface, content: "Explain the Moon." });
  conversations.completeAssistantMessage({ conversationId: chat.id, clientMessageId: "test-saved-message", content: "A saved bot reply." });
  assert.equal((await call("PATCH", { ...input, id: bot.id, name: "Updated Luna" })).status, 200);
  assert.equal((await (await call("GET", undefined, `?conversationId=${conversationId}`)).json()).bot.name, "Updated Luna");
  userId = 2;
  for (const [method, body, query] of [["GET", undefined, `?conversationId=${conversationId}`], ["POST", { action: "chat", id: bot.id }], ["PATCH", { ...input, id: bot.id }], ["DELETE", { id: bot.id }]]) assert.equal((await call(method, body, query)).status, 404);
  userId = 0;
  assert.equal((await call("GET")).status, 401);
  userId = 1;
  assert.equal((await call("PATCH", { ...input, id: "" })).status, 404);
  assert.equal((await call("POST", { ...input, personality: "" })).status, 400);
  assert.equal((await call("POST", { ...input, personality: "x".repeat(40_000) })).status, 413);
  assert.equal((await call("DELETE", { id: bot.id })).status, 200);
  assert.equal((await (await call("GET", undefined, `?conversationId=${conversationId}`)).json()).bot.archived, true);
  assert.equal(conversations.listRecentConversationMessages(chat.id, 20).at(-1).content, "A saved bot reply.");
});

test("the provider turn sends the saved personality, persists the reply and uses subsequent edits", async () => {
  const calls = [];
  const file = new URL("../src/lib/conversations/direct-turn-service.ts", import.meta.url);
  const replacements = {
    "server-only": {},
    "openai": class FakeProvider {
      responses = { create: async body => {
        calls.push(body);
        return (async function* () {
          yield { type: "response.output_text.delta", output_index: 0, delta: "Hello from your bot." };
          yield { type: "response.completed", response: { usage: { input_tokens: 12, output_tokens: 6, total_tokens: 18 } } };
        })();
      } };
    },
    "./deliver-completed-hyperframes.ts": { deliverCompletedHyperframes: async () => null },
    "./memory.ts": { retrieveExplicitCrossConversationContext: () => null, composeExplicitCrossConversationContext: () => "" },
    "./memory-profile.ts": { scheduleMemoryProfileSynthesisForConversation: () => {} },
    "./title-service.ts": { shouldGenerateConversationTitleForTurn: () => false },
    "../hermes/browser-terminal-context.ts": { browserTerminalPrompt: async () => "" },
    "../hermes/run-store.ts": { getActiveRuntimeRun: () => null },
    "../weather/forecast.ts": { fetchWeatherForecast: async () => { throw Error("unexpected weather request"); } },
  };
  const compiled = ts.transpileModule(fs.readFileSync(file,"utf8"), { compilerOptions:{ module:ts.ModuleKind.CommonJS } }).outputText;
  const modules = { ...replacements };
  for (const [,id] of compiled.matchAll(/require\("([^"]+)"\)/g)) {
    if (!Object.hasOwn(modules,id)) modules[id] = await import(new URL(id,file).href);
  }
  const { startDirectProviderTurn } = loadModule(file, modules);
  const bot = botsStore().save(1,{...input,name:"Orbit",personality:"Be concise, playful, and use astronomy analogies."});
  const id = botsStore().chat(1,bot.id,name=>conversations.createConversation({userId:1,title:name,surface:"dashboard_terminal"}));
  const conversation = conversations.getConversationForUser(id,1);
  const run = async (chat,clientMessageId) => {
    const response = await startDirectProviderTurn({ request:new Request("http://localhost/test"),conversation:chat,surface:chat.surface,clientMessageId,text:"Introduce yourself.",model:"fixture-model",reasoningEffort:"none" });
    assert.match(await response.text(),/Hello from your bot/);
  };
  await run(conversation,"bot-first");
  assert.match(calls[0].instructions,/your name is "Orbit"/);
  assert.match(calls[0].instructions,/Be concise, playful, and use astronomy analogies/);
  assert.equal(calls[0].model,"fixture-model");
  assert.equal(conversations.listRecentConversationMessages(conversation.id,20).at(-1).content,"Hello from your bot.");
  botsStore().save(1,{...input,name:"Orbit",personality:"Now use a patient, reflective tone."},bot.id);
  await run(conversation,"bot-second");
  assert.match(calls[1].instructions,/patient, reflective tone/);
  assert.doesNotMatch(calls[1].instructions,/Be concise, playful/);
  assert.equal(calls[1].input.some(item=>item.role==="assistant" && item.content==="Hello from your bot."),true);
  await run(conversations.createConversation({userId:1,title:"Ordinary",surface:"dashboard_terminal"}),"ordinary-first");
  assert.doesNotMatch(calls[2].instructions,/Selected conversation bot|your name is "Orbit"/);
  botsStore().archive(1,bot.id);
});

test("Capabilities Bots editor, saved avatars, chat navigation and lifecycle work in Chromium", { timeout: 120_000 }, async () => {
  userId = 1;
  const root = fileURLToPath(new URL("../", import.meta.url));
  const bundle = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React, {useEffect,useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {CommandHub} from './src/app/components/hermes/command-hub';
      import {BotConversationProvider,BotConversationIdentity} from './src/app/components/bots/bot-conversation';
      import AssistantResponseMeta from './src/app/components/assistant-response-meta';
      function App() {
        const [open,setOpen]=useState(true), [chat,setChat]=useState(localStorage.getItem('test-chat'));
        const [active,setActive]=useState(true), [label,setLabel]=useState('Thinking');
        useEffect(()=> { const fn=e=>{setChat(e.detail.chatId);localStorage.setItem('test-chat',e.detail.chatId)}; window.addEventListener('breadboard:chat-notification-open-request',fn); return ()=>window.removeEventListener('breadboard:chat-notification-open-request',fn); },[]);
        return <main><h1>Breadboard · Bot conversation</h1><BotConversationProvider conversationId={chat}>
          <BotConversationIdentity/><AssistantResponseMeta active={active} label={label} onDisclosureToggle={()=>{}} />
        </BotConversationProvider><output data-chat>{chat||'Ordinary chat'}</output>
        <div><button onClick={()=>{setActive(true);setLabel('Thinking')}}>Think</button><button onClick={()=>{setActive(true);setLabel('Waiting for your answer')}}>Wait</button><button onClick={()=>setActive(false)}>Complete</button><button onClick={()=>setChat(null)}>Ordinary chat</button></div>
        <div style={{position:'fixed',bottom:24,left:24}}><CommandHub open={open} onOpenChange={setOpen} onSelect={()=>{}} surface="dashboard_terminal"/></div></main>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "framework-and-unrelated-panels", setup(builder) {
      builder.onResolve({ filter: /^next\/(dynamic|navigation)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      // Keep the real capabilities shell and all bot components; omit unrelated agents' settings.
      builder.onResolve({ filter: /(?:settings-dialog|preferences-dialog|browser-operator|skills-catalog-panel|workflow-templates-panel|reference-chats-panel)$/ }, args => ({ path: args.path, namespace: "empty-panel" }));
      builder.onLoad({ filter: /.*/, namespace: "empty-panel" }, () => ({ contents: "export default function Panel(){return null} export const BrowserOperatorDialog=Panel;" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ resolveDir: root, loader: "tsx", contents: args.path === "next/dynamic" ? "import React,{lazy,Suspense} from 'react'; export default function dynamic(load,{loading:Loading}={}){const Component=lazy(async()=>{if(Loading && window.deferBotsModule) await new Promise(resolve=>{window.releaseBotsModule=resolve});const m=await load();return typeof m==='function'?{default:m}:m});return props=><Suspense fallback={Loading?<Loading/>:null}><Component {...props}/></Suspense>}" : "export const usePathname=()=>'/dashboard'; export const useRouter=()=>({push:url=>{window.pushedUrl=url}});" }));
    } }],
  });
  const css = await postcss([tailwind()]).process('@import "tailwindcss" source(none); @source "../src/app/components/bots"; @source "../src/app/components/hermes/command-hub.tsx"; @source "../src/app/components/hermes/loading-rows.tsx";', { from: path.join(root,"tests/bots-test.css") });
  const theme = `:root{--ink:#303731;--ink-heading:#203528;--ink-muted:#697367;--paper:#f6f5ee;--paper-surface:#fffef8;--paper-raised:#f9f8f1;--paper-strong:#eaece1;--line:#dce0d4;--botanical:#46664d;--danger:#a73737}body{background:var(--paper);font-family:Arial,sans-serif;color:var(--ink)}main{max-width:800px;margin:40px auto;padding:20px}h1{margin-bottom:20px}main>div>button{padding:8px} .assistant-response-meta canvas{vertical-align:middle}`;
  const serverErrors = [];
  const server = createServer(async (request,response) => {
    try {
      const url = new URL(request.url,"http://localhost");
      if (url.pathname === "/bundle.js") { response.setHeader("content-type","text/javascript"); response.end(bundle.outputFiles[0].text); }
      else if (url.pathname === "/style.css") { response.setHeader("content-type","text/css");response.end(css.css+theme); }
      else if (url.pathname === "/api/bots") {
        const chunks=[]; for await (const chunk of request) chunks.push(chunk);
        const body=Buffer.concat(chunks).toString();
        const result=await api[request.method](new Request(url,{method:request.method,...(body?{body}:{})}));
        response.writeHead(result.status,Object.fromEntries(result.headers));response.end(await result.text());
      } else if (url.pathname.startsWith("/api/")) {
        response.setHeader("content-type","application/json");response.end(JSON.stringify({items:[],skills:[],agents:[],groups:{skills:[],mcp:[],prompts:[],agents:[]},capability:{taskScoped:false}}));
      } else { response.setHeader("content-type","text/html");response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/bundle.js"></script>'); }
    } catch (error) {serverErrors.push(error);response.writeHead(500);response.end(error.message);}
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  let browser;
  try {
    const executablePath=["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe","C:/Program Files/Microsoft/Edge/Application/msedge.exe","/usr/bin/chromium"].find(fs.existsSync);
    browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
    const page=await browser.newPage({viewport:{width:1100,height:900}});
    page.setDefaultTimeout(10_000);
    const errors=[];page.on("pageerror",error=>{errors.push(error.message);process.stderr.write(error.stack+"\n");});
    let releaseRoster;
    let rosterReady = new Promise(resolve => { releaseRoster = resolve; });
    let rosterRequests = 0;
    await page.route("**/api/bots", async route => {
      if (route.request().method() === "GET") { rosterRequests++; await rosterReady; }
      await route.continue();
    });
    const preloaded = page.waitForRequest(request => new URL(request.url()).pathname === "/api/bots");
    await page.goto(`http://127.0.0.1:${server.address().port}/dashboard`);
    await preloaded;
    await page.evaluate(() => { window.deferBotsModule = true; });
    await page.getByRole("tab",{name:"Bots",exact:true}).click();
    await page.getByRole("status", { name: "Loading bots", exact: true }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "Search bots", exact: true }).count(), 1, "the Bots panel is available without waiting for a dynamic chunk");
    await page.evaluate(() => { window.deferBotsModule = false; });
    await page.getByRole("textbox", { name: "Search bots", exact: true }).waitFor();
    assert.equal(await page.getByRole("status", { name: "Loading bots", exact: true }).count(), 1, "data loading keeps the same skeleton rows");
    releaseRoster();
    await page.getByRole("button",{name:"Chat with Sage",exact:true}).waitFor();
    assert.equal(rosterRequests, 1, "mounting the tab reuses its pending preload");
    assert.equal(await page.locator("section[aria-label=Bots] [data-bot-avatar]").count(),botsStore().list(1).length);
    const avatar = page.getByRole("button", { name: "Chat with Sage", exact: true }).locator("canvas");
    const firstFrame = await avatar.evaluate(canvas => canvas.toDataURL());
    await page.waitForFunction(before => document.querySelector('[aria-label="Chat with Sage"] canvas')?.toDataURL() !== before, firstFrame);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator('[aria-label="Chat with Sage"] [data-bot-paused="true"]').waitFor();
    const reducedFrame = await avatar.evaluate(canvas => canvas.toDataURL());
    await page.waitForTimeout(200);
    assert.equal(await avatar.evaluate(canvas => canvas.toDataURL()), reducedFrame, "roster avatars respect reduced motion");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.locator('[aria-label="Chat with Sage"] [data-bot-paused="false"]').waitFor();
    await page.getByRole("tab", { name: "Agents", exact: true }).click();
    await page.getByRole("tab", { name: "Bots", exact: true }).click();
    await page.getByRole("button", { name: "Chat with Sage", exact: true }).waitFor();
    assert.equal(rosterRequests, 1, "returning to Bots uses the cached roster");
    assert.equal(await page.getByRole("status", { name: "Loading bots", exact: true }).count(), 0);
    // A long chat used to let the 30-second cache expire and blank the tab.
    // Hold revalidation open to prove an expired roster stays immediately usable.
    rosterReady = new Promise(resolve => { releaseRoster = resolve; });
    await page.getByRole("tab", { name: "Agents", exact: true }).click();
    await page.evaluate(() => { const now = Date.now.bind(Date); Date.now = () => now() + 5 * 60_000 + 1; });
    const refreshStarted = page.waitForRequest(request => new URL(request.url()).pathname === "/api/bots");
    await page.getByRole("tab", { name: "Bots", exact: true }).click();
    await refreshStarted;
    assert.equal(await page.getByRole("button", { name: "Chat with Sage", exact: true }).count(), 1, "expired cached bots paint before refresh finishes");
    assert.equal(await page.getByRole("status", { name: "Loading bots", exact: true }).count(), 0);
    assert.equal(rosterRequests, 2, "tab preload and mount share one background refresh");
    const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/bots");
    releaseRoster();
    await (await refreshed).finished();
    await page.unroute("**/api/bots");
    const screenshotRoot=path.resolve(process.env.BOTS_QA_DIR || path.join(root,"../qa"));fs.mkdirSync(screenshotRoot,{recursive:true});
    await page.screenshot({path:path.join(screenshotRoot,"bots-capabilities.png")});
    await page.getByRole("button",{name:"New bot",exact:true}).click();
    await page.getByLabel("Name",{exact:true}).fill("Luna Browser");
    await page.getByLabel("Short description").fill("A curious astronomy companion");
    await page.getByLabel("Personality",{exact:true}).fill("Speak warmly. Explain astronomy with playful analogies.");
    await page.getByRole("button",{name:"cat avatar",exact:true}).click();
    await page.getByLabel("Avatar color").fill("#aa66dd");
    await page.getByLabel("Avatar face",{exact:true}).selectOption("mouth");
    await page.getByLabel("Preview activity").selectOption("sleeping");
    assert.equal(await page.locator("form [data-bot-state=sleeping]").count(),1);
    let rejectFirstSave=true;
    await page.route("**/api/bots",route=>{
      if(rejectFirstSave && route.request().method()==="POST") {
        rejectFirstSave=false;
        return route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Temporary save failure"})});
      }
      return route.continue();
    });
    await page.getByRole("button",{name:"Create bot",exact:true}).click();
    await page.getByRole("alert").filter({hasText:"Temporary save failure"}).waitFor();
    assert.equal(await page.getByLabel("Name",{exact:true}).inputValue(),"Luna Browser","a failed save must preserve the draft");
    await page.getByRole("button",{name:"Create bot",exact:true}).click();
    await page.getByRole("button",{name:"Chat with Luna Browser",exact:true}).waitFor();
    const saved=botsStore().list(1).find(bot=>bot.name==="Luna Browser");
    assert.deepEqual(saved.avatar,{shape:"cat",color:"#aa66dd",face:"mouth"});
    await page.getByRole("button",{name:"Edit Luna Browser",exact:true}).click();
    assert.equal(await page.getByLabel("Personality",{exact:true}).inputValue(),"Speak warmly. Explain astronomy with playful analogies.");
    await page.getByLabel("Name",{exact:true}).fill("Luna Revised");
    await page.getByRole("button",{name:"star avatar",exact:true}).click();
    await page.getByRole("button",{name:"Save changes",exact:true}).click();
    await page.getByRole("button",{name:"Chat with Luna Revised",exact:true}).click();
    await page.locator(`[data-conversation-bot="${saved.id}"]`).waitFor();
    const chatId=await page.locator("[data-chat]").textContent();
    assert.equal(botPersonalityPrompt(botsStore().forConversation(1,chatId)).includes("Luna Revised"),true);
    assert.equal(await page.locator(".assistant-response-meta [data-bot-state=working]").count(),1);
    const working=await page.locator(".assistant-response-meta canvas").evaluate(canvas=>canvas.toDataURL());
    await page.waitForFunction(before=>document.querySelector(".assistant-response-meta canvas")?.toDataURL()!==before,working);
    await page.emulateMedia({reducedMotion:"reduce"});
    await page.locator('.assistant-response-meta [data-bot-paused="true"]').waitFor();
    const still=await page.locator(".assistant-response-meta canvas").evaluate(canvas=>canvas.toDataURL());
    await page.waitForTimeout(200);
    assert.equal(await page.locator(".assistant-response-meta canvas").evaluate(canvas=>canvas.toDataURL()),still,"reduced-motion changes must stop a live avatar");
    await page.emulateMedia({reducedMotion:"no-preference"});
    await page.locator('.assistant-response-meta [data-bot-paused="false"]').waitFor();
    await page.getByRole("button",{name:"Wait",exact:true}).click();
    assert.equal(await page.locator(".assistant-response-meta [data-bot-state=default]").count(),1);
    await page.getByRole("button",{name:"Complete",exact:true}).click();
    assert.equal(await page.locator(".assistant-response-meta [data-bot-state=sleeping]").count(),1);
    assert.equal(await page.locator('.assistant-response-meta [data-bot-paused="true"]').count(),1);
    // Saved identity survives a reload and changing between regular and bot chats.
    await page.reload();
    await page.getByRole("tab",{name:"Bots",exact:true}).click();
    await page.getByRole("button",{name:"Chat with Luna Revised",exact:true}).click();
    assert.equal(await page.locator("[data-chat]").textContent(),chatId);
    await page.locator(".assistant-response-meta [data-bot-state=working]").waitFor();
    await page.screenshot({path:path.join(screenshotRoot,"bots-thinking.png")});
    await page.getByRole("button",{name:"Ordinary chat",exact:true}).click();
    assert.equal(await page.locator(".assistant-response-meta [data-bot-avatar]").count(),0);
    await page.getByRole("button",{name:"Open capabilities",exact:true}).click();
    await page.getByRole("button",{name:"Duplicate Luna Revised",exact:true}).click();
    assert.equal(await page.getByLabel("Name",{exact:true}).inputValue(),"Luna Revised-2");
    await page.getByRole("button",{name:"Create bot",exact:true}).click();
    await page.getByRole("button",{name:"Remove Luna Revised-2",exact:true}).click();
    await page.getByRole("button",{name:"Remove bot",exact:true}).click();
    await page.getByRole("button",{name:"Chat with Luna Revised-2",exact:true}).waitFor({state:"detached"});
    await page.setViewportSize({width:390,height:844});
    await page.emulateMedia({reducedMotion:"reduce"});
    await page.getByRole("button",{name:"New bot",exact:true}).click();
    await page.screenshot({path:path.join(screenshotRoot,"bots-editor-mobile.png")});
    await page.getByRole("button",{name:"Cancel",exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(screenshotRoot,"bots-editor-mobile-options.png")});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true,"mobile layout must not overflow");
    assert.deepEqual(errors,[]);assert.deepEqual(serverErrors,[]);
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
