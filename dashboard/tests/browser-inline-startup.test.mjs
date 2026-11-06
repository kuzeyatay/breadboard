import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import test from 'node:test';
import ts from 'typescript';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = fs.readFileSync(path.join(root, 'src/app/browser/browser-client.tsx'), 'utf8');
const tree = ts.createSourceFile('browser-client.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['[terminalLoaded, setTerminalLoaded]', '[activePanel, setActivePanel]', 'lastSelectionRef', 'selectionKey'];
const declarations = new Map();
const effects = [];
let mount;
function visit(node) {
  if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(tree))) declarations.set(node.name.getText(tree), `const ${node.getText(tree)};`);
  if (ts.isExpressionStatement(node) && node.getText(tree).startsWith('useEffect(')) {
    const text = node.getText(tree);
    if (text.endsWith('[selectionKey]);') || (text.includes('setTerminalLoaded(true)') && text.includes('requestAnimationFrame'))) effects.push(text);
  }
  if (ts.isConditionalExpression(node) && node.whenTrue.getText(tree).includes('<DashboardAgentTerminal')) mount = node.condition.getText(tree);
  ts.forEachChild(node, visit);
}
visit(tree);
assert.equal(declarations.size, names.length);
assert.equal(effects.length, 2);
assert.ok(mount);

test('cold browser highlights send with their chat panel covered and animation frames suspended', { timeout: 60000 }, async t => {
  // Execute the browser's actual lazy-mount gate and effects, both production
  // native bridge clients, the real widget and the real inline request/stream
  // hook. Only native IPC and the remote answer service are represented here.
  const bundle = await build({ bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    alias: { '@': path.join(root, 'src') }, logLevel: 'silent',
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React,{useState,useRef,useEffect,useMemo} from 'react';
      import {createRoot} from 'react-dom/client';
      import Answer from '@/app/browser/inline-answer/inline-answer';
      import {useBrowserInlineAnswer} from '@/app/components/hermes/use-browser-inline-answer';
      import {useInlineAgentQuestions} from '@/app/components/hermes/use-inline-agent-questions';
      const selection={requestId:'cold-request',reference:{id:'cold-highlight',mode:'inline',sourceMessageId:'web:fixture',start:0,end:13,
        quote:'electric flux',sourceUrl:'https://example.test/lesson',sourceTitle:'Lesson'}};
      const emptyMessages=[];
      function Owner(){
        const inline=useInlineAgentQuestions({sessionId:'conv_fixture',messages:emptyMessages,ensureConversation:async()=>'conv_fixture'});
        const question=inline.messages.findLast(m=>m.role==='user');
        const answer=inline.messages.findLast(m=>m.role==='assistant');
        const content=useMemo(()=>({question:question?.content,answer:answer?.content,pending:Boolean(answer?.pending),canAsk:!answer?.pending}),[question,answer]);
        useBrowserInlineAnswer({selection,content,onAsk:(text,attachments)=>void inline.send(text,selection.reference,{model:'fixture',attachments}),onStop:()=>inline.stop(selection.reference.id),onDelete:()=>{},onClose:()=>{}});
        return <div data-owner>Terminal</div>;
      }
      function BrowserHost(){
        const [browser,setBrowser]=useState({terminalOpen:false});
        const terminalOpen=browser.terminalOpen;
        ${names.map(name => declarations.get(name)).join('\n')}
        ${effects.join('\n')}
        window.openHighlight=()=>setBrowser({terminalOpen:false,selection});
        return (${mount}) ? <Owner/> : null;
      }
      if(location.pathname==='/owner'){
        // A fully covered Electron WebContents can stop receiving frames even
        // though its effects, IPC and network are still running.
        window.requestAnimationFrame=()=>1; window.cancelAnimationFrame=()=>{};
        localStorage.setItem('breadboard:agent-mode','false');
        window.breadboardDesktop=parent.bridge;
        createRoot(document.getElementById('root')).render(<BrowserHost/>);
      }else{
        const stateListeners=new Set(),actionListeners=new Set();
        let state={...selection,selection:selection.reference,selectionId:selection.reference.id,viewport:{width:440,height:700},content:{pending:false,canAsk:false}};
        window.bridge={
          getTabsState:async()=>null,onTabsState:()=>()=>{},
          onBrowserInlineAnswerState:fn=>{stateListeners.add(fn);return()=>stateListeners.delete(fn)},
          onBrowserInlineAnswerAction:fn=>{actionListeners.add(fn);return()=>actionListeners.delete(fn)},
          tabs:async command=>{
            if(command.type==='browser-answer-ready')stateListeners.forEach(fn=>fn(state));
            if(command.type==='browser-answer-state'){state={...state,...command.state,content:{...command.state.content,ownerReady:true}};stateListeners.forEach(fn=>fn(state));}
            if(command.type==='browser-answer-action')actionListeners.forEach(fn=>fn(command.action));
            return true;
          }
        };
        window.breadboardDesktop=window.bridge;
        createRoot(document.getElementById('root')).render(<Answer/>);
      }
    ` }, plugins: [{ name: 'unrelated-artifact-ui', setup(builder) {
      builder.onResolve({ filter: /inline-artifact-cards$/ }, () => ({ path: 'artifacts', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const primeInlineArtifacts=async()=>[]; export const InlineArtifactCardsProvider=({children})=>children; export default()=>null;', loader: 'tsx' }));
    } }] });
  const requests = [];
  const server = createServer(async (request, response) => {
    if (request.url === '/bundle.js') { response.setHeader('content-type', 'text/javascript'); response.end(bundle.outputFiles[0].text); return; }
    if (request.url?.endsWith('/direct')) {
      let body = ''; for await (const chunk of request) body += chunk;
      requests.push(JSON.parse(body));
      response.setHeader('content-type', 'text/event-stream');
      response.end(`data: ${JSON.stringify({ type: 'delta', text: 'Delivered answer ' + requests.length })}\n\ndata: [DONE]\n\n`); return;
    }
    if (request.url?.startsWith('/api/')) { response.setHeader('content-type', 'application/json'); response.end('{}'); return; }
    response.setHeader('content-type', 'text/html');
    response.end('<div id="root"></div><script src="/bundle.js"></script>' + (request.url.startsWith('/owner') ? '' : '<iframe src="/owner" style="display:none"></iframe>'));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const executablePath = [chromium.executablePath(), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(fs.existsSync);
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/?theme=${theme}`);
    const owner = page.frame({ url: /\/owner$/ });
    assert.ok(owner);
    await owner.waitForFunction(() => typeof window.openHighlight === 'function', null, { polling: 25 });
    assert.equal(await owner.locator('[data-owner]').count(), 0, 'ordinary browsing stays lazy');
    await owner.evaluate(() => window.openHighlight());
    await owner.waitForFunction(() => Boolean(document.querySelector('[data-owner]')), null, { polling: 25 });
    const editor = page.locator('textarea');
    await editor.fill(`Question by Enter in ${theme}`);
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Ask' && !button.disabled));
    const beforeEnter = requests.length;
    await editor.press('Enter');
    await page.getByText(`Delivered answer ${beforeEnter + 1}`, { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Edit this question' }).click();
    await editor.fill(`Question by button in ${theme}`);
    const before = requests.length;
    await page.getByRole('button', { name: /^Ask/ }).click();
    await page.getByText(`Delivered answer ${before + 1}`, { exact: true }).waitFor();
    assert.equal(requests.at(-1).textSelection.quote, 'electric flux');
    assert.equal(requests.at(-1).concurrentInline, true);
    assert.deepEqual(errors, []);
    await page.close();
  }
  assert.equal(requests.length, 4, 'Enter and Ask reach the request service in both themes');
});
