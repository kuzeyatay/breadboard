import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import esbuild from "esbuild";
import { chromium } from "playwright";

test("profile defaults, chat overrides and Learn selections stay independent across reloads and tabs", { timeout: 60_000 }, async (t) => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-profile-model-"));
  const previousDataRoot = process.env.BREADBOARD_DATA_DIR;
  process.env.BREADBOARD_DATA_DIR = dataRoot;
  const { default: db } = await import("../src/lib/db.ts");
  const runtimeStore = await import("../src/lib/hermes/runtime-store.ts");
  const { selectedModelForUser } = await import("../src/lib/selected-model.ts");
  t.after(() => {
    db.close();
    fs.rmSync(dataRoot, { recursive: true, force: true });
    if (previousDataRoot === undefined) delete process.env.BREADBOARD_DATA_DIR;
    else process.env.BREADBOARD_DATA_DIR = previousDataRoot;
    delete globalThis.__profileModelTest;
  });
  db.prepare("INSERT INTO users(id, username, email, password_hash) VALUES (1, 'profile', 'profile@example.test', 'x')").run();
  runtimeStore.setHermesUserSettings(1, {
    defaultModel: "cliproxy/claude-opus-5", reasoningEffort: "high", humanizerAuto: true,
  });
  runtimeStore.setHermesUserSettings(1, { defaultModel: "gpt-5.6-sol", reasoningEffort: "max" });

  const gatewayWrites = [];
  let gatewayModel = "gpt-5.6-sol";
  let gatewayFailure = false;
  let signedIn = true;
  globalThis.__profileModelTest = {
    ...runtimeStore,
    session: () => signedIn ? { user: { id: "1" } } : null,
    async setDefaultModel(_request, model) {
      gatewayWrites.push(model);
      if (gatewayFailure) throw Object.assign(new Error("This provider is not connected."), { status: 400 });
      // The route must validate routing before writing the account preference.
      assert.notEqual(runtimeStore.getHermesUserSettings(1).defaultModel, model);
      gatewayModel = model;
      return { defaultModel: model, chatModel: model, storedChatModel: null };
    },
  };
  const stubs = {
    "next/server": "export const NextResponse = Response;",
    "next-auth/next": "export const getServerSession = async () => globalThis.__profileModelTest.session();",
    "@/lib/auth-options": "export const authOptions = {};",
    "@/lib/hermes/runtime-store": `
      export const getHermesUserSettings = id => globalThis.__profileModelTest.getHermesUserSettings(id);
      export const setHermesUserSettings = (id, value) => globalThis.__profileModelTest.setHermesUserSettings(id, value);`,
    "@/lib/hermes/quartz-support": "export const corsHeaders = () => ({});",
    "@/lib/chatmock-providers": `
      export const setDefaultModel = (request, model) => globalThis.__profileModelTest.setDefaultModel(request, model);
      export const providerErrorResponseInit = error => ({status: error.status || 503, message: error.message});`,
  };
  const routeBundle = await esbuild.build({
    entryPoints: [path.join(root, "src/app/api/assistant-preferences/route.ts")],
    absWorkingDir: root, bundle: true, write: false, platform: "node", format: "cjs",
    plugins: [{ name: "isolated-account-and-gateway", setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => args.path in stubs
        ? { path: args.path, namespace: "fixture" } : undefined);
      build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({ contents: stubs[args.path] }));
    } }],
  });
  const routeModule = { exports: {} };
  new Function("require", "module", "exports", routeBundle.outputFiles[0].text)(
    createRequire(import.meta.url), routeModule, routeModule.exports,
  );
  const route = routeModule.exports;
  const request = (body) => new Request("http://localhost/api/assistant-preferences", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });

  signedIn = false;
  assert.equal((await route.PATCH(request({ model: "gpt-6-astra" }))).status, 401);
  signedIn = true;
  assert.equal((await route.PATCH(request({ model: "invalid model" }))).status, 400);
  assert.equal((await route.PATCH(request({ model: "gpt-6-astra", reasoningEffort: "invalid" }))).status, 400);
  assert.deepEqual(gatewayWrites, [], "invalid or unauthenticated changes never reach the gateway");

  const browserBundle = await esbuild.build({
    stdin: { loader: "tsx", resolveDir: root, contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import DefaultModelPanel from './src/app/profile/default-model-panel';
      import {useAssistantIntelligence} from './src/app/components/use-assistant-intelligence';
      function Chat() { const {model, reasoningEffort} = useAssistantIntelligence();
        return <output aria-label="Chat model">{model}|{reasoningEffort}</output>; }
      const ids = ['gpt-5.6-sol', 'gpt-6-astra', 'cliproxy/claude-opus-5'];
      function Controls({name, ...scope}) {
        const {model, setModel, resetModel, reasoningEffort, setReasoningEffort} = useAssistantIntelligence(scope);
        return <section>
          <output aria-label={name+' value'}>{model}|{reasoningEffort}</output>
          <select aria-label={name+' picker'} value={model} onChange={e=>setModel(e.target.value)}>
            {ids.map(id=><option key={id}>{id}</option>)}
          </select>
          <select aria-label={name+' effort'} value={reasoningEffort} onChange={e=>setReasoningEffort(e.target.value)}>
            <option>high</option><option>max</option>
          </select>
          <button onClick={resetModel}>Reset {name}</button>
          {name === 'Learn' && <button onClick={async()=>{
            const response = await fetch('/api/learn-fixture', {method:'POST', body:JSON.stringify({model})});
            if (response.ok) resetModel();
          }}>Start Learn</button>}
        </section>;
      }
      function Switcher() {
        const [id,setId] = React.useState(null);
        const [created,setCreated] = React.useState(null);
        return <>
          <select aria-label="Open chat" value={id ?? 'draft'} onChange={e=>{setCreated(null);setId(e.target.value==='draft'?null:e.target.value)}}>
            <option>draft</option><option>a</option><option>b</option><option>created</option>
          </select>
          <button onClick={()=>{setId('created');setCreated('created')}}>Create chat</button>
          <Controls name="Switched chat" scope="fixture-chat" sessionId={id} createdSessionId={created}/>
        </>;
      }
      function Scopes() {const [extra,setExtra] = React.useState(false);return <><DefaultModelPanel/>
        <Controls name="Chat A" scope="fixture-chat" sessionId="a"/>
        <Controls name="Chat B" scope="fixture-chat" sessionId="b"/>
        <Controls name="Learn" scope="fixture-learn"/>
        <Controls name="Shared terminal" scope="fixture-terminal" sessionId="t1" shared/>
        <Controls name="Shared garden" scope="fixture-garden" sessionId="g1" shared/>
        <Controls name="Temporary" scope="fixture-temporary" sessionId="temp" persist={false}/>
        <button onClick={()=>setExtra(true)}>Open another chat</button>
        {extra && <Controls name="Extra" scope="fixture-chat" sessionId="extra"/>}
        <Switcher/>
      </>}
      createRoot(document.getElementById('root')).render(<React.StrictMode>
        {location.pathname === '/scopes' ? <Scopes/> : location.pathname === '/chat' ? <Chat/> : <><DefaultModelPanel/><Chat/></>}
      </React.StrictMode>);` },
    absWorkingDir: root, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  let failReads = true;
  const topologyRequests = [];
  const learnRequests = [];
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url === "/app.js") {
        res.setHeader("Content-Type", "text/javascript");
        return res.end(browserBundle.outputFiles[0].text);
      }
      if (req.url === "/api/assistant-preferences") {
        res.setHeader("Content-Type", "application/json");
        if (req.method === "GET" && failReads) {
          res.statusCode = 503;
          return res.end(JSON.stringify({ error: "Temporarily unavailable." }));
        }
        let body = "";
        for await (const chunk of req) body += chunk;
        const incoming = new Request("http://localhost/api/assistant-preferences", {
          method: req.method, ...(body ? { body, headers: { "Content-Type": "application/json" } } : {}),
        });
        const response = await route[req.method](incoming);
        res.statusCode = response.status;
        return res.end(await response.text());
      }
      if (req.url === "/api/learn-fixture") {
        let body = "";
        for await (const chunk of req) body += chunk;
        learnRequests.push(JSON.parse(body));
        return res.end("{}");
      }
      if (req.url === "/api/models") {
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({ data: [
          { id: "gpt-5.6-sol", reasoning_efforts: ["high", "max"] },
          { id: "gpt-6-astra", reasoning_efforts: ["high", "max"] },
          { id: "cliproxy/claude-opus-5", reasoning_efforts: ["high"] },
        ] }));
      }
      if (req.url === "/v1/chat/completions") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const payload = JSON.parse(body);
        topologyRequests.push(payload);
        const serving = payload.model === "default" ? gatewayModel : payload.model;
        res.setHeader("Content-Type", "application/json");
        if (serving === "none") {
          res.statusCode = 400;
          return res.end(JSON.stringify({error: {code: "default_model_required", message: "No default model is selected."}}));
        }
        return res.end(JSON.stringify({
          id: "topology-test", model: serving,
          choices: [{ message: { role: "assistant", content: JSON.stringify({ serving }) } }],
        }));
      }
      if (req.url.startsWith("/api/")) {
        res.setHeader("Content-Type", "application/json");
        return res.end("{}");
      }
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/app.js"></script>');
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: String(error) }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const browser = await chromium.launch({
    headless: true, ...(process.platform === "win32" ? { channel: "msedge" } : {}),
  });
  t.after(() => browser.close());
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const base = `http://127.0.0.1:${server.address().port}`;
  const previousBaseUrl = process.env.OPENAI_BASE_URL;
  const previousApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_BASE_URL = `${base}/v1`;
  process.env.OPENAI_API_KEY = "profile-model-test";
  t.after(() => {
    if (previousBaseUrl === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = previousBaseUrl;
    if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousApiKey;
  });
  const { createDefaultTopologyGenerator } = await import("../src/lib/thought-topology/enrichment.ts");
  const { DEFAULT_TOPOLOGY_CACHE_VERSIONS } = await import("../src/lib/thought-topology/cache.ts");
  const generateTopology = createDefaultTopologyGenerator(DEFAULT_TOPOLOGY_CACHE_VERSIONS.summaryModel);
  const topologyModel = async () => JSON.parse(await generateTopology([
    { role: "user", content: "Explain this connection." },
  ])).serving;
  await page.goto(base);
  const select = page.getByRole("combobox", { name: "Default model", exact: true });
  await page.getByRole("alert").waitFor();
  assert.equal(await select.isDisabled(), true);
  failReads = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await page.waitForFunction(() => !document.querySelector("select").disabled);
  assert.equal(await select.inputValue(), "gpt-5.6-sol");

  const chat = await context.newPage();
  await chat.goto(`${base}/chat`);
  await chat.getByText("gpt-5.6-sol|max", { exact: true }).waitFor();
  await select.selectOption("cliproxy/claude-opus-5");
  await page.getByText("Saved. Claude Opus 5 is your default model.", { exact: true }).waitFor();
  await page.getByText("cliproxy/claude-opus-5|high", { exact: true }).waitFor();
  await chat.getByText("cliproxy/claude-opus-5|high", { exact: true }).waitFor();
  assert.equal(gatewayModel, "cliproxy/claude-opus-5");
  assert.equal(await topologyModel(), "cliproxy/claude-opus-5");
  assert.equal(topologyRequests.at(-1).model, "default");
  assert.equal(selectedModelForUser(1), "cliproxy/claude-opus-5");
  assert.equal(runtimeStore.getHermesUserSettings(1).humanizerAuto, true);
  assert.deepEqual(gatewayWrites, ["cliproxy/claude-opus-5"]);

  await page.reload();
  await page.waitForFunction(() => !document.querySelector("select").disabled);
  assert.equal(await select.inputValue(), "cliproxy/claude-opus-5");
  gatewayFailure = true;
  await select.selectOption("gpt-6-astra");
  await page.getByRole("alert").filter({ hasText: "not connected" }).waitFor();
  assert.equal(await select.inputValue(), "cliproxy/claude-opus-5");
  assert.equal(selectedModelForUser(1), "cliproxy/claude-opus-5");
  assert.equal(gatewayModel, "cliproxy/claude-opus-5");

  gatewayFailure = false;
  await select.selectOption("gpt-5.6-sol");
  await page.getByText("gpt-5.6-sol|max", { exact: true }).waitFor();
  assert.equal(selectedModelForUser(1), "gpt-5.6-sol");
  assert.equal(gatewayModel, "gpt-5.6-sol");
  assert.equal(await topologyModel(), "gpt-5.6-sol", "an existing topology generator follows the new default without restarting");
  assert.equal(await page.getByRole("alert").count(), 0);
  await page.goto(`${base}/scopes`);
  const value = (name) => page.getByLabel(`${name} value`);
  const expectValue = async (name, model, effort) => {
    await value(name).filter({hasText: `${model}|${effort}`}).waitFor();
    assert.equal(await value(name).textContent(), `${model}|${effort}`);
  };
  await expectValue("Chat A", "gpt-5.6-sol", "max");
  await chat.goto(`${base}/scopes`);
  await chat.getByLabel("Chat B value").filter({hasText:"gpt-5.6-sol|max"}).waitFor();
  // Chat surfaces share one current selection: the model picked in the
  // terminal is the model a garden workspace opens with, in this tab and the
  // next. A Learn draft and a per-chat override stay out of it.
  await expectValue("Shared terminal", "gpt-5.6-sol", "max");
  await chat.getByLabel("Shared garden value").filter({hasText:"gpt-5.6-sol|max"}).waitFor();
  await page.getByLabel("Shared terminal picker").selectOption("gpt-6-astra");
  await expectValue("Shared garden", "gpt-6-astra", "max");
  await chat.getByLabel("Shared garden value").filter({hasText:"gpt-6-astra|max"}).waitFor();
  await expectValue("Chat A", "gpt-5.6-sol", "max");
  await expectValue("Learn", "gpt-5.6-sol", "max");
  assert.equal(selectedModelForUser(1), "gpt-5.6-sol", "a shared pick is still not the account default");
  // Asking for the default back is an instruction about every chat surface.
  await page.getByRole("button", {name:"Reset Shared terminal", exact:true}).click();
  await expectValue("Shared terminal", "gpt-5.6-sol", "max");
  await expectValue("Shared garden", "gpt-5.6-sol", "max");

  const writesBeforeOverrides = gatewayWrites.length;
  await page.getByLabel("Chat A picker").selectOption("gpt-6-astra");
  await page.getByLabel("Chat A effort").selectOption("high");
  await page.getByLabel("Learn picker").selectOption("cliproxy/claude-opus-5");
  await expectValue("Chat A", "gpt-6-astra", "high");
  await expectValue("Chat B", "gpt-5.6-sol", "max");
  await expectValue("Learn", "cliproxy/claude-opus-5", "high");
  assert.equal(await select.inputValue(), "gpt-5.6-sol");
  assert.equal(selectedModelForUser(1), "gpt-5.6-sol");
  assert.equal(gatewayWrites.length, writesBeforeOverrides, "local picks never PATCH the profile");
  assert.equal(await topologyModel(), "gpt-5.6-sol");

  await select.selectOption("cliproxy/claude-opus-5");
  await expectValue("Chat B", "gpt-5.6-sol", "max");
  await expectValue("Chat A", "gpt-6-astra", "high");
  await expectValue("Switched chat", "cliproxy/claude-opus-5", "high");
  // A previously opened tab must not republish its stale cached profile on remount.
  await chat.getByRole("button", {name:"Open another chat", exact:true}).click();
  await chat.getByLabel("Extra value").filter({hasText:"cliproxy/claude-opus-5|high"}).waitFor();
  await chat.getByLabel("Chat A value").filter({hasText:"gpt-6-astra|high"}).waitFor();
  await chat.getByLabel("Chat B value").filter({hasText:"gpt-5.6-sol|max"}).waitFor();
  await page.getByRole("button", {name:"Reset Chat A", exact:true}).click();
  await chat.getByLabel("Chat A value").filter({hasText:"cliproxy/claude-opus-5|high"}).waitFor();
  await select.selectOption("gpt-5.6-sol");
  await expectValue("Chat A", "cliproxy/claude-opus-5", "high");
  await expectValue("Switched chat", "gpt-5.6-sol", "max");
  await expectValue("Learn", "cliproxy/claude-opus-5", "high");
  await page.getByRole("button", {name:"Start Learn", exact:true}).click();
  await expectValue("Learn", "gpt-5.6-sol", "max");
  assert.deepEqual(learnRequests, [{model:"cliproxy/claude-opus-5"}]);

  // A draft only transfers to the chat it creates, never a reopened conversation.
  await page.getByLabel("Switched chat picker").selectOption("gpt-6-astra");
  await chat.getByLabel("Switched chat value").filter({hasText:"gpt-5.6-sol|max"}).waitFor();
  await page.getByLabel("Open chat").selectOption("b");
  await expectValue("Switched chat", "gpt-5.6-sol", "max");
  await page.getByLabel("Open chat").selectOption("draft");
  await expectValue("Switched chat", "gpt-6-astra", "max");
  await page.getByRole("button", {name:"Create chat", exact:true}).click();
  await expectValue("Switched chat", "gpt-6-astra", "max");
  await page.getByLabel("Open chat").selectOption("draft");
  await expectValue("Switched chat", "gpt-5.6-sol", "max");
  await page.getByLabel("Temporary picker").selectOption("gpt-6-astra");
  assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(key=>key.includes("fixture-temporary"))), false);
  await page.reload();
  await expectValue("Temporary", "gpt-5.6-sol", "max");
  await page.getByLabel("Open chat").selectOption("created");
  await expectValue("Switched chat", "gpt-6-astra", "max");
  await page.getByLabel("Switched chat effort").selectOption("high");
  await page.getByLabel("Switched chat picker").selectOption("cliproxy/claude-opus-5");
  await page.getByLabel("Switched chat picker").selectOption("gpt-6-astra");
  await expectValue("Switched chat", "gpt-6-astra", "high");
  assert.equal(selectedModelForUser(1), "gpt-5.6-sol");
  assert.equal(runtimeStore.getHermesUserSettings(1).reasoningEffort, "max");
  assert.equal(gatewayWrites.length, writesBeforeOverrides + 2);

  await page.getByLabel("Learn picker").selectOption("cliproxy/claude-opus-5");
  await select.selectOption("none");
  await page.getByRole("status").filter({hasText: "Saved. No default model selected. Tasks that require it will fail."}).waitFor();
  assert.equal(runtimeStore.getHermesUserSettings(1).defaultModel, "none");
  assert.equal(selectedModelForUser(1), "none");
  assert.equal(gatewayModel, "none");
  await expectValue("Chat B", "gpt-5.6-sol", "max");
  await chat.getByLabel("Chat B value").filter({hasText: "gpt-5.6-sol|max"}).waitFor();
  await expectValue("Switched chat", "gpt-6-astra", "high");
  await expectValue("Learn", "cliproxy/claude-opus-5", "high");
  await assert.rejects(topologyModel, /No default model is selected/);
  await page.reload();
  await page.waitForFunction(() => !document.querySelector("select").disabled);
  assert.equal(await select.inputValue(), "none");
  assert.equal(await select.locator('option[value="none"]').count(), 1);
  await expectValue("Chat B", "gpt-5.6-sol", "max");
  await expectValue("Switched chat", "none", "max");
  await expectValue("Learn", "cliproxy/claude-opus-5", "high");
  await select.selectOption("gpt-5.6-sol");
  await expectValue("Chat B", "gpt-5.6-sol", "max");
  assert.equal(await topologyModel(), "gpt-5.6-sol");
  assert.deepEqual(errors, []);
});
