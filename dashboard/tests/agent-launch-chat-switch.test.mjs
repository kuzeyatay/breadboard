import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

test("a delayed fresh-chat stream cannot launch into the chat selected later", async () => {
  const bundle = await build({
    stdin: { resolveDir: fileURLToPath(new URL("..", import.meta.url)), loader: "tsx", contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {useAgentLaunchQueue} from './src/app/components/hermes/use-agent-launch-queue';
      window.launches=[];
      function App(){
        const [scope,setScope]=useState(null), [ready,setReady]=useState(false);
        const queue=useAgentLaunchQueue({scopeKey:scope,ready,submit:request=>window.launches.push({scope,id:request.requestId})});
        window.control={setScope,setReady,handleEvent:queue.handleEvent,confirm:queue.confirm,reset:queue.reset};
        return <output>{JSON.stringify({scope,queued:queue.queued,waiting:queue.waiting})}</output>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
    plugins: [{ name: "fixture-yolo", setup(builder) {
      builder.onResolve({ filter: /use-yolo-mode$/ }, () => ({ path: "yolo", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const useYoloMode=()=>[true];export const isYoloModeEnabled=()=>true;" }));
    } }],
  });
  const server = http.createServer((_req, res) => res.end(`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    const executablePath = [
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium",
    ].find(fs.existsSync);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.control);
    const launch = { type: "agent_launch", requestId: "physique-gym", originClientMessageId: "physique-turn", workerClientMessageId: "gym-worker", agentId: "deep-research", agentName: "Deep Research", command: "/agents:deep-research", brief: "Build the gym program", requiresApproval: false };
    // Capture the exact callback held by a request sent on the blank composer.
    await page.evaluate(() => { window.oldStream = window.control.handleEvent; window.control.setScope(832); });
    await page.waitForFunction(() => window.control && document.querySelector("output").textContent.includes('832'));
    await page.evaluate(event => window.oldStream(event, 832), launch);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.evaluate(() => window.control.setScope(831));
    await page.waitForFunction(() => document.querySelector("output").textContent.includes('831'));
    await page.evaluate(() => window.control.setReady(true));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(await page.evaluate(() => window.launches), []);
    await page.evaluate(() => window.control.setScope(832));
    await page.waitForFunction(() => window.launches.length === 1);
    assert.deepEqual(await page.evaluate(() => window.launches), [{ scope: 832, id: "physique-gym" }]);
    await page.evaluate(event => window.oldStream(event, 832), launch);
    assert.equal(await page.evaluate(() => window.launches.length), 1);
    // Unknown ownership is not assigned to whichever chat happens to be open,
    // nor marked seen before the authoritative restored event arrives.
    await page.evaluate(event => window.oldStream(event), { ...launch, requestId: "unknown", originClientMessageId: "other-turn" });
    await page.evaluate(() => window.control.setScope(831));
    await page.waitForFunction(() => document.querySelector("output").textContent.includes('831'));
    assert.equal(await page.evaluate(() => window.launches.length), 1);
    await page.evaluate(event => window.control.handleEvent(event, 831), { ...launch, requestId: "unknown", originClientMessageId: "other-turn" });
    await page.waitForFunction(() => window.launches.length === 2);
    assert.deepEqual(await page.evaluate(() => window.launches.at(-1)), { scope: 831, id: "unknown" });
    // Stopping one conversation drops only its pending launches.
    await page.evaluate(() => window.control.setReady(false));
    await page.evaluate(event => {
      window.control.handleEvent({...event,requestId:'stop-831',originClientMessageId:'stop-831'},831);
      window.control.handleEvent({...event,requestId:'keep-832',originClientMessageId:'keep-832'},832);
    }, launch);
    await page.evaluate(() => window.control.reset(831));
    await page.evaluate(() => window.control.setReady(true));
    assert.equal(await page.evaluate(() => window.launches.length),2);
    await page.evaluate(() => window.control.setScope(832));
    await page.waitForFunction(() => window.launches.length === 3);
    assert.deepEqual(await page.evaluate(() => window.launches.at(-1)), {scope:832,id:'keep-832'});
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
  const garden = fs.readFileSync(new URL("../src/app/gardens/[clusterSlug]/workspace-client.tsx", import.meta.url), "utf8");
  assert.match(garden, /agentLaunchQueue\.handleEvent\(event, sessionId\)/);
  assert.match(garden, /const originSession = originatingAgentLaunchSession/);
});
