import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/app/components/assistant-composer.tsx'), 'utf8');
const tree = ts.createSourceFile('composer.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let input;
function visit(node) {
  if (ts.isJsxElement(node) && node.openingElement.getText(tree).includes('relative flex min-w-0 flex-1 items-center') && node.getText(tree).includes('<textarea')) input = node.getText(tree);
  ts.forEachChild(node, visit);
}
visit(tree);
const component = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'AssistantComposer');
const names = new Set(['syncCommandBackdrop', 'resizeTextarea', 'assignTextareaRef']);
const sizing = component.body.statements.filter(node =>
  (ts.isVariableStatement(node) && node.declarationList.declarations.some(decl => names.has(decl.name.getText(tree)))) ||
  (ts.isExpressionStatement(node) && /^use(?:Layout)?Effect\(/.test(node.getText(tree)) && node.getText(tree).includes('resizeTextarea')),
).map(node => node.getText(tree)).join('\n');
const constants = tree.statements.filter(node =>
  (ts.isVariableStatement(node) && node.declarationList.declarations.some(decl => decl.name.getText(tree).startsWith('COMPOSER_'))) ||
  (ts.isFunctionDeclaration(node) && node.name?.text === 'composerMaxHeight'),
).map(node => node.getText(tree)).join('\n');

test('typed predictions append with Tab, cancel safely, and wrap with the real composer', { timeout: 120_000 }, async t => {
  const bundle = await build({ bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    alias: { '@': path.join(root, 'src') }, stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React, {useRef,useState,useCallback,useEffect,useLayoutEffect} from 'react';
      import {createRoot} from 'react-dom/client';
      import {useSentenceCompletion} from '@/app/components/use-sentence-completion';
      import PromptSuggestionOverlay from '@/app/components/prompt-suggestion-overlay';
      import {composerSegments} from '@/lib/composer-links';
      import {splitLeadingCommandTokens} from '@/app/components/hermes/command-text';
      ${constants}
      function App() {
        const [value,onChange]=useState(''), [state,configure]=useState({chat:'one',busy:false,compact:false,menu:false});
        const compact=state.compact;
        const sentenceCompletion=useSentenceCompletion({conversationKey:state.chat,value,enabled:!state.busy&&!state.menu,onChange});
        const promptSuggestion={text:null,dismiss:()=>{},handleKeyDown:()=>false};
        const internalTextareaRef=useRef(null),commandBackdropRef=useRef(null);
        const slashCommandMenuRef=useRef(null),commandHubRef=useRef(null),addMenuRef=useRef(null);
        slashCommandMenuRef.current={handleKeyDown:event=>{if(state.menu&&event.key==='Tab'){event.preventDefault();window.menuAccepted=true;return true;}return false;}};
        const pendingWorkflowPrompt=null,setPendingWorkflow=()=>{},showSlashCommands=false;
        const menuSearch=null,setMenuSearch=()=>{};
        const setSlashQuery=()=>{},setShowSlashCommands=()=>{},setShowCommandHub=()=>{},slashQueryAt=()=>null;
        const onKeyDown=undefined,walkMessageHistory=()=>false,queueHeld=false;
        const uploadQueued=null,uploadQueuedRef=useRef(null),isAddingDocuments=false;
        const canSubmit=Boolean(value.trim()),isSending=false,disabled=false;
        const submitMessage=()=>{window.sent.push(value);onChange('');};
        const handlePaste=()=>{},textareaStyle=undefined,placeholder='Ask anything';
        ${sizing}
        window.configure=next=>configure(current=>({...current,...next}));
        window.setDraft=onChange;
        return <div className="p-6"><button id="previous">Previous</button>
          <div id="composer" className="neu-composer flex items-center gap-3 rounded-3xl p-4" style={{width:'100%',maxWidth:700}}>
            ${input}<button id="next">Send</button>
          </div></div>;
      }
      window.sent=[];
      createRoot(document.getElementById('root')).render(<App/>);
    ` } });
  const stylesheet = path.join(root, 'src/app/globals.css');
  const css = (await postcss([tailwindcss({ base: root })]).process(fs.readFileSync(stylesheet, 'utf8'), { from: stylesheet })).css;
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  const requests = [];
  let deferred = false, release;
  let responseText = ' how an RLC circuit works?';
  await page.route('http://completion.test/api/sentence-completion', async route => {
    const payload = route.request().postDataJSON();
    requests.push(payload);
    assert.equal('model' in payload, false, 'the chat model cannot override the background model');
    const wait = deferred;
    const text = responseText;
    if (wait) await new Promise(resolve => { release = resolve; });
    await route.fulfill({ json: { completion: text } }).catch(() => {});
  });
  await page.route('http://completion.test/', route => route.fulfill({ contentType: 'text/html', body: '<html data-theme="light"><body><div id="root"></div></body></html>' }));
  await page.goto('http://completion.test/');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const textarea = page.getByRole('textbox', { name: 'Ask anything' });
  const ghost = page.locator('[data-sentence-completion-text]');
  await textarea.focus();
  await textarea.press('Tab');
  await expect(page.locator('#next')).toBeFocused();
  assert.equal(requests.length, 0, 'empty drafts do not request sentence completion');

  await textarea.fill('Can you');
  await textarea.pressSequentially(' explain', { delay: 20 });
  await expect(ghost).toHaveText(responseText);
  assert.equal(requests.length, 1, 'typing is debounced');
  assert.equal(requests[0].draft, 'Can you explain');
  await expect(textarea).toHaveValue('Can you explain');
  await textarea.pressSequentially(' how');
  await expect(ghost).toHaveText(' an RLC circuit works?');
  await page.waitForTimeout(600);
  assert.equal(requests.length, 1, 'typing matching text consumes the existing completion');
  await textarea.press('Tab');
  await expect(textarea).toHaveValue('Can you explain how an RLC circuit works?');
  await expect(textarea).toBeFocused();
  assert.deepEqual(await page.evaluate(() => window.sent), []);
  assert.equal(await textarea.evaluate(node => node.selectionStart), (await textarea.inputValue()).length);
  await textarea.press('Enter');
  assert.deepEqual(await page.evaluate(() => window.sent), ['Can you explain how an RLC circuit works?']);

  responseText = 'ain this in simple terms?';
  await textarea.fill('Can you expl');
  await expect(ghost).toHaveText(responseText);
  await textarea.press('Tab');
  await expect(textarea).toHaveValue('Can you explain this in simple terms?');

  responseText = ' a practical example?';
  await textarea.fill('Can you show');
  await expect(ghost).toBeVisible();
  await textarea.press('Escape');
  await expect(ghost).toHaveCount(0);
  const dismissedRequests = requests.length;
  await page.waitForTimeout(600);
  assert.equal(requests.length, dismissedRequests);
  await textarea.press('Tab');
  await expect(page.locator('#next')).toBeFocused();
  await expect(textarea).toHaveValue('Can you show');

  await textarea.fill('Please show');
  await expect(ghost).toBeVisible();
  await textarea.press('Shift+Tab');
  await expect(page.locator('#previous')).toBeFocused();
  await expect(ghost).toHaveCount(0);
  await textarea.focus();
  await expect(ghost).toBeVisible();
  await textarea.press('ArrowLeft');
  await expect(ghost).toHaveCount(0);
  await textarea.press('Tab');
  await expect(textarea).toHaveValue('Please show');
  await textarea.focus();
  await textarea.press('Control+a');
  const selectedRequests = requests.length;
  await page.waitForTimeout(600);
  assert.equal(requests.length, selectedRequests, 'selected text is never replaced by a prediction');

  await textarea.fill('Explain this');
  await textarea.dispatchEvent('compositionstart');
  const composingRequests = requests.length;
  await textarea.fill('Explain this idea');
  await page.waitForTimeout(650);
  assert.equal(requests.length, composingRequests, 'IME composition does not request predictions');
  await expect(ghost).toHaveCount(0);
  await textarea.dispatchEvent('compositionend');
  await expect(ghost).toBeVisible();
  assert.equal(await textarea.evaluate(node => node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true, isComposing: true }))), true);
  await expect(textarea).toHaveValue('Explain this idea');
  await page.evaluate(() => window.configure({ menu: true }));
  await expect(ghost).toHaveCount(0);
  await textarea.press('Tab');
  assert.equal(await page.evaluate(() => window.menuAccepted), true);
  await expect(textarea).toHaveValue('Explain this idea');
  await page.evaluate(() => window.configure({ menu: false, busy: true }));
  await textarea.fill('Waiting while busy');
  const busyRequests = requests.length;
  await page.waitForTimeout(600);
  assert.equal(requests.length, busyRequests);

  deferred = true;
  responseText = ' stale suggestion';
  await page.evaluate(() => window.configure({ busy: false, chat: 'old' }));
  await expect.poll(() => typeof release).toBe('function');
  deferred = false;
  responseText = ' a fresh suggestion';
  await page.evaluate(() => window.configure({ chat: 'new' }));
  release();
  await expect(ghost).toHaveText(responseText);
  await page.waitForTimeout(100);
  await expect(ghost).not.toContainText('stale');

  responseText = ' a practical example that shows how the resistor, inductor and capacitor work together?';
  await textarea.fill('I am learning about electrical circuits.\nCould you give me');
  await expect(ghost).toHaveText(responseText);
  const artifacts = path.join(root, 'artifacts/sentence-completion');
  fs.mkdirSync(artifacts, { recursive: true });
  for (const compact of [false, true]) {
    await page.evaluate(compact => { window.configure({ compact }); document.documentElement.dataset.theme = compact ? 'dark' : 'light'; }, compact);
    await page.setViewportSize({ width: compact ? 380 : 900, height: 600 });
    await expect(ghost).toBeVisible();
    await expect.poll(async () => {
      const box = await textarea.boundingBox();
      const mirror = await page.locator('[data-sentence-completion] > div').boundingBox();
      return Math.abs(box.height - mirror.height);
    }).toBeLessThan(2);
    const composer = await page.locator('#composer').boundingBox();
    const suffix = await ghost.boundingBox();
    assert.ok(suffix.x >= composer.x && suffix.x + suffix.width <= composer.x + composer.width + 1);
    assert.ok(suffix.y >= composer.y && suffix.y + suffix.height <= composer.y + composer.height);
    await page.screenshot({ path: path.join(artifacts, compact ? 'narrow-dark.png' : 'desktop-light.png') });
  }
  const draft = await textarea.inputValue();
  await textarea.press('Tab');
  await expect(textarea).toHaveValue(draft + responseText);
  assert.deepEqual(errors, []);
});
