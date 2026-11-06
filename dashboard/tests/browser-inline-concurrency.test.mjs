import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import ts from 'typescript';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = fs.readFileSync(path.join(root, 'src/app/components/hermes/dashboard-agent-terminal.tsx'), 'utf8');
const tree = ts.createSourceFile('terminal.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map();
const names = ['sessionCreateOptions', 'session', 'inlineQuestions', 'messages', 'askSelection'];
function visit(node) {
  if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(tree))) {
    declarations.set(node.name.getText(tree), `const ${node.getText(tree)};`);
  }
  ts.forEachChild(node, visit);
}
visit(tree);
assert.equal(declarations.size, names.length);
assert.match(source, /messages=\{messages\}/);
assert.match(source, /onAbortInline=\{inlineQuestions.stop\}/);

async function waitUntil(predicate) {
  const deadline = Date.now() + 8_000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'expected request did not arrive');
    await delay(10);
  }
}

test('web Ask here and main chat run independently, stop separately, and restore without a busy lock', { timeout: 60_000 }, async t => {
  // Use Terminal's actual wiring, send callback, and both production session
  // hooks. Only unrelated artifact UI and the HTTP service are replaced.
  const bundle = await build({ bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    alias: { '@': path.join(root, 'src') }, logLevel: 'silent',
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React,{useState,useMemo,useCallback} from 'react';
      import {createRoot} from 'react-dom/client';
      import {useAgentSession} from './src/app/components/hermes/use-agent-session';
      import {useInlineAgentQuestions} from './src/app/components/hermes/use-inline-agent-questions';
      function App(){
        const temporaryChat=false,drawerPresentation=true,newChatWorkspace=null;
        const runtimeUnavailable=false,model='fixture',reasoningEffort='high';
        const [chatAttachments,setChatAttachments]=useState([]),[,setAttachmentStatus]=useState('');
        ${names.slice(0, 4).map(name => declarations.get(name)).join('\n')}
        const busy=['connecting','streaming','waiting'].includes(session.connection);
        ${declarations.get('askSelection')}
        window.control={session,messages,askSelection,stopInline:inlineQuestions.stop};
        return <><button onClick={()=>void session.send('Main question',{model})}>Send main</button>
          <button onClick={()=>void session.abort()}>Stop main</button>
          <output>{session.runState}</output></>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` }, plugins: [{ name: 'unrelated-ui', setup(builder) {
      const stubs = {
        './inline-artifact-cards': 'export const primeInlineArtifacts=async()=>[];',
        'next/navigation': 'export const useRouter=()=>({push(){}}); export const usePathname=()=>"/"; export const useSearchParams=()=>new URLSearchParams();',
      };
      builder.onResolve({ filter: /.*/ }, a => a.path in stubs ? { path: a.path, namespace: 'fixture' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: stubs[a.path], loader: 'tsx', resolveDir: root }));
    } }] });
  const turns = [], stops = [], creations = [];
  const streams = new Map();
  let saved = { id: 'conv_web', title: 'Web lesson', messages: [] };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/bundle.js') {
      response.setHeader('content-type', 'text/javascript'); response.end(bundle.outputFiles[0].text); return;
    }
    if (!url.pathname.startsWith('/api/')) {
      response.setHeader('content-type', 'text/html');
      response.end('<div id="root"></div><script src="/bundle.js"></script>'); return;
    }
    response.setHeader('content-type', 'application/json');
    let raw = ''; for await (const chunk of request) raw += chunk;
    if (url.pathname === '/api/hermes/sessions' && request.method === 'POST') {
      creations.push(JSON.parse(raw));
      response.end(JSON.stringify({ session: { id: 'conv_web', activeDirectory: null } })); return;
    }
    if (url.pathname === '/api/hermes/sessions') { response.end(JSON.stringify({ sessions: [saved] })); return; }
    if (url.pathname === '/api/hermes/sessions/conv_web') { response.end(JSON.stringify({ session: saved })); return; }
    if (url.pathname.endsWith('/abort')) {
      stops.push(url.searchParams.get('inlineTurnId')); response.end('{"aborted":true}'); return;
    }
    if (url.pathname.endsWith('/direct') || url.pathname.endsWith('/messages')) {
      const turn = JSON.parse(raw); turns.push(turn);
      const inline = turn.concurrentInline && turn.textSelection?.mode === 'inline';
      const key = inline ? turn.clientMessageId : 'main';
      if (streams.has(key)) {
        response.statusCode = 409;
        response.end('{"error":{"message":"This chat is still working on the previous message."}}'); return;
      }
      if (url.pathname.endsWith('/messages')) { response.end('{"accepted":true,"runId":"side-agent"}'); return; }
      streams.set(key, response);
      response.setHeader('content-type', 'text/event-stream'); response.flushHeaders(); return;
    }
    response.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const executablePath = [chromium.executablePath(), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(fs.existsSync);
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(8_000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('breadboard:agent-mode', 'false');
    window.breadboardDesktop = { getBrowserTerminalAccess: async () => ({ port: 43210, token: 'a'.repeat(64) }) };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.control && !window.control.session.loadingSession);
  const ask = async id => page.evaluate(id => { void window.control.askSelection(`Question ${id}`, {
    id, mode: 'inline', sourceMessageId: 'web:lesson', start:0, end:13, quote:'electric flux',
    sourceUrl:'https://example.test/lesson', sourceTitle:'Gauss law',
  }); }, id);
  const finish = (key, text) => {
    const response = streams.get(key); assert.ok(response, `stream ${key} exists`);
    streams.delete(key); response.end(`data: ${JSON.stringify({type:'delta',text})}\n\ndata: [DONE]\n\n`);
  };

  // Ask here can create the chat first, then leave the main Send available.
  await ask('first');
  await waitUntil(() => turns.length === 1);
  assert.equal(turns[0].concurrentInline, true);
  assert.equal(turns[0].browserAccess.port, 43210);
  assert.equal(turns[0].textSelection.sourceUrl, 'https://example.test/lesson');
  await page.getByRole('button', { name:'Send main', exact:true }).click();
  await waitUntil(() => turns.length === 2);
  assert.equal(creations.length, 1);
  assert.equal(stops.length, 0);
  finish('main', 'Main completed while highlight is pending');
  await page.waitForFunction(() => window.control.session.runState === 'completed');
  assert.equal(await page.evaluate(() => window.control.messages.findLast(m => m.textSelection?.id === 'first').pending), true);

  // A main turn already in progress is not interrupted by another highlight.
  await page.getByRole('button', { name:'Send main', exact:true }).click();
  await waitUntil(() => turns.length === 3);
  await ask('second');
  await waitUntil(() => turns.length === 4);
  assert.equal(stops.length, 0);
  const secondId = turns[3].clientMessageId;
  await page.evaluate(() => window.control.stopInline('second'));
  assert.deepEqual(stops, [secondId]);
  assert.equal(await page.evaluate(() => window.control.session.runState), 'running');
  finish(secondId, 'Late stopped answer');
  finish(turns[0].clientMessageId, 'First highlight answer');
  await page.waitForFunction(() => window.control.messages.some(m => m.content === 'First highlight answer' && !m.pending));

  await ask('third');
  await waitUntil(() => turns.length === 5);
  await page.getByRole('button', { name:'Stop main', exact:true }).click();
  await waitUntil(() => stops.includes(null));
  assert.equal(await page.evaluate(() => window.control.messages.findLast(m => m.textSelection?.id === 'third').pending), true);
  finish('main', 'Late main answer');
  finish(turns[4].clientMessageId, 'Third highlight answer');
  await page.waitForFunction(() => window.control.messages.some(m => m.content === 'Third highlight answer' && !m.pending));

  // Main tokens cannot starve the independent agent answer's polling timer.
  await page.getByRole('button', { name:'Send main', exact:true }).click();
  await waitUntil(() => turns.length === 6);
  const ticking = setInterval(() => streams.get('main')?.write('data: {"type":"delta","text":" More main text"}\n\n'), 100);
  t.after(() => clearInterval(ticking));
  await page.evaluate(() => localStorage.setItem('breadboard:agent-mode', 'true'));
  await ask('agent');
  await waitUntil(() => turns.length === 7);
  assert.equal(turns[6].concurrentInline, true);
  const agentId = turns[6].clientMessageId;
  await page.waitForFunction(id => window.control.messages.some(m => m.clientMessageId === id && m.pending), agentId);
  saved.messages = (await page.evaluate(() => window.control.messages)).map(m => m.clientMessageId === agentId && m.role === 'assistant'
    ? {...m, reasoning:'Checking the selected flux equation'} : m);
  await page.waitForFunction(() => window.control.messages.some(m => m.reasoning === 'Checking the selected flux equation'));
  assert.equal(await page.evaluate(() => window.control.session.runState), 'running');
  clearInterval(ticking);
  finish('main', 'Main completed with agent highlight pending');
  await page.waitForFunction(() => window.control.session.runState === 'completed');
  saved.messages = await page.evaluate(() => window.control.messages);

  // A restored agent-mode highlight must not take ownership of the main run.
  await page.reload();
  await page.waitForFunction(() => window.control && !window.control.session.loadingSession);
  await page.evaluate(() => window.control.session.openSession('conv_web'));
  await page.waitForFunction(() => window.control.session.sessionId === 'conv_web' && !window.control.session.loadingSession);
  assert.equal(await page.evaluate(() => window.control.session.runState), 'idle');
  saved.messages = saved.messages.map(m => m.clientMessageId === agentId && m.role === 'assistant'
    ? { ...m, pending:false, content:'Restored highlight completed', responseCompletedAt:new Date().toISOString() } : m);
  await page.waitForFunction(() => window.control.messages.some(m => m.content === 'Restored highlight completed' && !m.pending));
  await page.getByRole('button', { name:'Send main', exact:true }).click();
  await waitUntil(() => turns.length === 8);
  finish('main', 'Main works after restore');
  await page.waitForFunction(() => window.control.session.runState === 'completed');
  assert.deepEqual(errors, []);
});
