import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import ts from "typescript";

test("a finished Hermes response reveals its artifact and actions while transport cleanup is pending", { timeout: 30_000 }, async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  // Use the panel's actual busy-state expressions with the real session hook,
  // artifact provider/cards and response actions. Only the artifact editors
  // and backend transport are fixtures.
  const source = readFileSync(new URL("../src/app/components/hermes/agent-runtime-panel.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("panel.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const states = new Map();
  function visit(node) {
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        const name = declaration.name.getText(tree);
        if (["streaming", "activeRun", "externalRunActive", "runInFlight"].includes(name)) {
          states.set(name, node.getText(tree));
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.equal(states.size, 4);
  const stubs = {
    "./artifact-viewer": `export default () => null;
      export const ARTIFACT_BROWSER_EVENT = 'breadboard:artifact-event';
      export const artifactDescription = () => 'Generated file';
      export const artifactPdfHref = () => null;
      export const artifactVideoHref = () => null;
      export const artifactUrl = a => '/preview/' + a.id;
      export const ArtifactFileIcon = () => null;
      export const useFileExplorerAvailable = () => false;`,
    "./artifact-image-studio": "export default () => null;",
    "./artifact-video-studio": "export default () => null;",
  };
  const bundle = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {useAgentSession} from './src/app/components/hermes/use-agent-session';
      import Cards, {InlineArtifactCardsProvider} from './src/app/components/hermes/inline-artifact-cards';
      import AssistantMessageActions from './src/app/components/assistant-message-actions';
      localStorage.setItem('breadboard:agent-mode', 'true');
      window.streams = []; window.dispatches = []; window.artifacts = []; window.sendsFinished = 0;
      window.fetch = async (url, init = {}) => {
        url = String(url);
        if (url === '/api/hermes/sessions' && init.method === 'POST') {
          return Response.json({session:{id:'conv_completion'}});
        }
        if (url.includes('/events?')) {
          const entry = {};
          entry.body = new ReadableStream({
            start(controller) {
              entry.emit = event => controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(event) + '\\n\\n'));
              controller.enqueue(new TextEncoder().encode(': connected\\n\\n'));
            },
            cancel() {
              entry.cancelled = true;
              return new Promise((resolve, reject) => { entry.resolveCleanup = resolve; entry.rejectCleanup = reject; });
            },
          });
          window.streams.push(entry);
          return new Response(entry.body);
        }
        if (url.endsWith('/messages')) {
          window.dispatches.push(JSON.parse(init.body));
          return Response.json({runId:'run-' + window.dispatches.length});
        }
        return Response.json({sessions:[], models:[], artifacts:window.artifacts});
      };
      function App() {
        const session = useAgentSession('dashboard_terminal', {restoreLastConversation:false});
        window.session = session;
        const {messages,runState,connection} = session;
        const persistedRunActive = Boolean(session.activeRunId);
        const locallyStopped = false, externalRunLaunching = false, delegationInFlight = false;
        const externalAgentRunInFlight = () => false;
        ${[...states.values()].join('\n')}
        return <>
          <output>{runState}</output>
          <button onClick={() => void session.send('Create a file').then(() => window.sendsFinished++)}>Send</button>
          <InlineArtifactCardsProvider conversationId={session.sessionId}>
            {messages.filter(m => m.role === 'assistant').map((message, index, replies) => {
              const last = index === replies.length - 1;
              return <section key={message.id} data-response={index}>
                <p>{message.content}</p>
                <Cards ownerMessageId={message.artifactMessageId ?? message.id} thinking={last && (runInFlight || streaming)}/>
                {message.content.trim() && !(last && runInFlight) && <AssistantMessageActions content={message.content}/>}
              </section>;
            })}
          </InlineArtifactCardsProvider>
        </>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    loader: { ".css": "empty", ".module.css": "empty" },
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "artifact-editors", setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: "fixture" } : null);
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path], loader: "tsx", resolveDir: root }));
    } }],
  });
  const server = createServer((request, response) => {
    response.setHeader("content-type", request.url === "/bundle.js" ? "text/javascript" : "text/html");
    response.end(request.url === "/bundle.js" ? bundle.outputFiles[0].text : '<!doctype html><div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(existsSync);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.session?.loadingSession === false);
    for (let turn = 0; turn < 2; turn++) {
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await page.waitForFunction(count => window.dispatches.length === count && window.session.runState === 'running', turn + 1);
      await page.evaluate(index => {
        const artifact = {id:'artifact-' + index, assistantMessageId:'owner-' + index,
          conversationId:'conv_completion', version:1, title:'Generated report ' + index,
          kind:'markdown', status:'ready', previewAvailable:true, downloadAvailable:true};
        window.artifacts.push(artifact);
        window.streams[index].emit({type:'assistant.delta', payload:{text:'Your report is ready.'}});
        window.streams[index].emit({type:'artifact.completed', payload:{artifactId:artifact.id,
          assistantMessageId:artifact.assistantMessageId, conversationId:artifact.conversationId, status:'ready'}});
      }, turn);
      const reply = page.locator('[data-response="' + turn + '"]');
      await reply.getByText("Your report is ready.", { exact: true }).waitFor();
      assert.equal(await reply.getByRole("button", { name: "Copy response", exact: true }).count(), 0);
      assert.equal(await reply.getByText("Generated report " + turn, { exact: true }).count(), 0);
      await page.evaluate(index => window.streams[index].emit({type:'done'}), turn);
      await page.waitForFunction(count => window.sendsFinished === count, turn + 1);
      await reply.getByRole("button", { name: "Copy response", exact: true }).waitFor();
      await reply.getByText("Generated report " + turn, { exact: true }).waitFor();
      assert.deepEqual(await page.evaluate(index => ({
        runState:window.session.runState, activeRunId:window.session.activeRunId,
        cancelled:window.streams[index].cancelled, locked:window.streams[index].body.locked,
      }), turn), {runState:'completed', activeRunId:null, cancelled:true, locked:false});
      // The second turn must complete even though the first cleanup never did.
    }
    await page.evaluate(() => {
      window.streams[0].rejectCleanup(new Error('late network cleanup failure'));
      window.streams[1].resolveCleanup();
    });
    await page.waitForTimeout(50);
    assert.equal(await page.getByRole("button", { name: "Copy response", exact: true }).count(), 2);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
