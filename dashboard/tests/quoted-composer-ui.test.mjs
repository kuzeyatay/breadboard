import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import esbuild from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
test("Ask in chat moves its quote from the real composer into the steered message", { timeout: 60_000 }, async () => {
  const bundle = await esbuild.build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import AgentRuntimePanel from './src/app/components/hermes/agent-runtime-panel';
      window.steered = []; window.sent = [];
      window.fetch = async () => Response.json({settings:{},models:[],sessions:[],messages:[],artifacts:[],success:true});
      function App() {
        const [input, setInput] = useState('');
        const [busy, setBusy] = useState(true);
        const [messages, setMessages] = useState([
          {id:'question:wire',role:'user',content:'Which way does the field point?',clientMessageId:'wire'},
          {id:'answer:wire',role:'assistant',content:'The electric field points to the right because the battery has arranged charges along the wire.',clientMessageId:'wire'},
        ]);
        return <AgentRuntimePanel messages={messages} sessionId="conv_quote" createdSessionId="conv_quote"
          activities={[]} connection={busy?'streaming':'idle'} runState={busy?'running':'idle'}
          input={input} onInputChange={setInput} onSubmit={()=>{}} onAbort={()=>setBusy(false)}
          onAskSelection={()=>{}} onSteer={async (text, attachments, textSelection)=>{
            window.steered.push({text,attachments,textSelection});
            setMessages(current=>[...current,{id:'steer:wire',role:'user',content:text,textSelection,
              courseCorrection:true,courseCorrectionTargetClientMessageId:'wire',courseCorrectionOffset:current[1].content.length}]);
            return true;
          }}
          onSendQueued={async (text,attachments,textSelection)=>window.sent.push({text,attachments,textSelection})}
          pendingPermission={null} onPermissionDecision={()=>{}} error={null} steerError={null}
          model="test" models={[]} onModelChange={()=>{}} reasoningEffort="medium" onReasoningEffortChange={()=>{}}/>
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", outfile: "app.js",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    plugins: [{ name: "external-services", setup(builder) {
      builder.onResolve({ filter: /^(next\/dynamic|next\/navigation)$|\/(settings-dialog|voice-conversation-overlay|speech-dictation-button|slash-command-menu|command-hub)$|^\.\/(inline-[^/.]+|generative-ui-renderer)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({path: modulePath}) => ({ loader: "tsx", resolveDir: root, contents:
        modulePath === "next/navigation"
          ? "export const useRouter=()=>({push(){},replace(){},refresh(){}});export const usePathname=()=>'/';export const useSearchParams=()=>new URLSearchParams();"
          : modulePath === "next/dynamic" ? "export default function dynamic(){return ()=>null;}"
          : modulePath.endsWith("command-hub") ? "export const CommandHub=()=>null;"
          : modulePath.endsWith("inline-artifact-cards")
            ? "export const primeInlineArtifacts=async()=>[];export const useInlineArtifactPrefetch=()=>true;export const useInlineArtifactScope=()=>null;export const useInlineArtifactViewer=()=>null;export const useRegisterInlineArtifact=()=>{};export const InlineArtifactCardsProvider=({children})=>children;export default function Cards(){return null;}"
          : modulePath.endsWith("inline-proposal-cards")
            ? "export const InlineProposalCardsProvider=({children})=>children;export default function Cards(){return null;}"
            : "export default function Leaf(){return null;}"
      }));
    } }],
  });
  const stylesheet = path.join(root, "src/app/globals.css");
  const cssInput = fs.readFileSync(stylesheet, "utf8").replace('@source "../**/*.{js,mjs,cjs,ts,tsx,jsx,mdx}";', '@source "./components/assistant-composer.tsx"; @source "./components/chat-text-selection-ui.tsx"; @source "./components/hermes/queued-follow-ups.tsx"; @source "./components/hermes/agent-runtime-panel.tsx";');
  const css = (await postcss([tailwind({ base: root })]).process(cssInput, { from: stylesheet })).css;
  const server = http.createServer((request, response) => {
    response.setHeader("Content-Type", request.url === "/app.js" ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8");
    response.end(request.url === "/app.js" ? bundle.outputFiles.find(file => file.path.endsWith(".js")).text : `<!doctype html><html data-theme="light"><head><style>${css}body{margin:0;background:var(--paper-bg)}#root{height:100vh;padding:24px}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  let page;
  const errors = [];
  try {
    const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", chromium.executablePath()].find(fs.existsSync);
    browser = await chromium.launch({ headless: true, executablePath });
    page = await browser.newPage({ viewport: { width: 1144, height: 720 } });
    page.setDefaultTimeout(8000);
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const response = page.locator('[data-chat-selectable-message]').filter({ hasText: "The electric field points to the right" }).first();
    await response.waitFor();
    const quote = await response.innerText();
    await response.scrollIntoViewIfNeeded();
    await response.evaluate(element => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const nodes = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
      const range = document.createRange();
      range.setStart(nodes[0], 0); range.setEnd(nodes.at(-1), nodes.at(-1).length);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });
    await page.getByRole("button", { name: "Ask in chat", exact: true }).click();
    const composer = page.locator(".neu-composer");
    assert.equal(await composer.locator("[data-composer-selection]").count(), 1);
    const question = "/interactive-visualizer-in-chat visualize the wire, surface charges and electric field";
    await composer.locator("textarea").fill(question);
    await composer.locator("textarea").press("Enter");
    const row = composer.locator("[data-queued-message]");
    await row.waitFor();
    assert.ok((await row.innerText()).includes(quote));
    assert.equal(await page.locator("[data-composer-selection]").count(), 0, "the quote leaves the draft with the message");
    for (const width of [1144, 390]) {
      await page.setViewportSize({ width, height: 720 });
      const bounds = await row.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, JSON.stringify(bounds));
    }
    await page.setViewportSize({ width: 1144, height: 720 });
    await composer.screenshot({ path: path.join(root, ".tmp-selection-steering-qa.png") });
    const queuedText = await row.getByRole("button", { name: /^Edit queued message:/ }).getAttribute("aria-label");
    assert.equal(queuedText, `Edit queued message: ${question}`);
    await row.getByRole("button", { name: /^Edit queued message:/ }).click();
    assert.ok((await composer.locator("[data-composer-selection]").innerText()).includes(quote));
    assert.equal(await composer.locator("textarea").inputValue(), question);
    await composer.getByRole("button", { name: "Queue message", exact: true }).click();
    await row.getByRole("button", { name: `Steer the active response with: ${question}`, exact: true }).click();
    await page.waitForFunction(() => window.steered.length === 1);
    assert.equal(await page.evaluate(() => window.steered[0].textSelection.quote), quote);
    assert.equal(await page.evaluate(() => window.steered[0].text), question);
    assert.equal(await row.count(), 0);
    assert.ok((await page.locator("[data-selection-exclude]").filter({ hasText: question }).innerText()).includes(quote));
    assert.deepEqual(errors, []);
  } catch (error) {
    console.log("Failed panel state", await page?.evaluate(() => ({body:document.body.innerText, sent:window.sent, steered:window.steered})), errors);
    throw error;
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
