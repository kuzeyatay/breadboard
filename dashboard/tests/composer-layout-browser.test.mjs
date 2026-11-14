import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Run the production sizing hooks in React and Chromium, without unrelated
// agents, network services or dialogs. AST extraction avoids a copied algorithm.
const filename = new URL('../src/app/components/assistant-composer.tsx', import.meta.url);
const source = fs.readFileSync(filename, 'utf8');
const tree = ts.createSourceFile(filename.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'AssistantComposer');
const names = new Set(['syncCommandBackdrop', 'resizeTextarea', 'assignTextareaRef']);
const hooks = component.body.statements.filter(node =>
  (ts.isVariableStatement(node) && node.declarationList.declarations.some(decl => names.has(decl.name.getText(tree)))) ||
  (ts.isExpressionStatement(node) && /^use(?:Layout)?Effect\(/.test(node.getText(tree)) && node.getText(tree).includes('resizeTextarea')),
).map(node => node.getText(tree)).join('\n');
const constants = tree.statements.filter(node =>
  (ts.isVariableStatement(node) && node.declarationList.declarations.some(decl => decl.name.getText(tree).startsWith('COMPOSER_'))) ||
  (ts.isFunctionDeclaration(node) && node.name?.text === 'composerMaxHeight'),
).map(node => node.getText(tree)).join('\n');

test('chat updates do not remeasure the draft; editing, rewrapping, viewport caps and remounts still work', { timeout: 60000 }, async t => {
  assert.ok(hooks.includes('const assignTextareaRef = useCallback'));
  assert.match(source, /ref=\{assignTextareaRef\}/);
  const bundle = await build({ bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    stdin: { resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'tsx', contents: `
      import React, {useRef,useCallback,useLayoutEffect,useEffect,useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      ${constants}
      function Composer({value, onChange, noise}) {
        const compact = false;
        const menuSearch = null, sentenceCompletion = {text: null};
        const internalTextareaRef = useRef(null), commandBackdropRef = useRef(null);
        ${hooks}
        return <div id="container"><textarea rows={1} ref={assignTextareaRef} value={value} onChange={e=>onChange(e.target.value)}/><span>{noise}</span></div>;
      }
      function App() {
        const [value,onChange] = useState('draft '.repeat(40)), [noise,bump] = useState(0), [mounted,setMounted] = useState(true);
        window.updateNoise = () => { for(let i=0;i<100;i++) flushSync(()=>bump(n=>n+1)); };
        window.setDraft = value => flushSync(()=>onChange(value));
        window.setMounted = value => flushSync(()=>setMounted(value));
        return mounted ? <Composer value={value} onChange={onChange} noise={noise}/> : null;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` } });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? {channel: 'msedge'} : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({viewport:{width:1000,height:900}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<style>#container{width:600px} textarea{width:100%;box-sizing:border-box;font:16px/24px monospace;padding:0;border:0;resize:none;overflow-y:hidden}span{display:none}</style><div id="root"></div>');
  await page.evaluate(() => {
    window.measurements = 0;
    const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight');
    Object.defineProperty(Element.prototype, 'scrollHeight', {configurable:true, get() {
      if (this.tagName === 'TEXTAREA') window.measurements++;
      return original.get.call(this);
    }});
  });
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.locator('textarea').waitFor();
  const settle = () => page.evaluate(() => new Promise(resolve => {
    let frames = 4; const next = () => --frames ? requestAnimationFrame(next) : resolve(); requestAnimationFrame(next);
  }));
  await settle();
  const before = await page.evaluate(() => ({measurements, height:document.querySelector('textarea').clientHeight}));
  await page.evaluate(() => updateNoise());
  await settle();
  assert.equal(await page.evaluate(() => measurements), before.measurements, '100 unrelated React commits cause zero height measurements');
  await page.evaluate(() => document.querySelector('#container').style.minHeight = '500px');
  await settle();
  assert.equal(await page.evaluate(() => measurements), before.measurements, 'height-only observer events cause no measurement');
  await page.evaluate(() => document.querySelector('#container').style.width = '240px');
  await settle();
  assert.ok(await page.locator('textarea').evaluate(el => el.clientHeight) > before.height, 'width changes rewrap and grow the draft');
  await page.evaluate(() => setDraft('line\n'.repeat(40)));
  await settle();
  assert.equal(await page.locator('textarea').evaluate(el => el.style.overflowY), 'auto');
  assert.equal(await page.locator('textarea').evaluate(el => el.clientHeight), 240);
  await page.setViewportSize({width:1000,height:400});
  await settle();
  assert.equal(await page.locator('textarea').evaluate(el => el.clientHeight), 140);
  await page.locator('textarea').fill('short');
  await settle();
  assert.equal(await page.locator('textarea').evaluate(el => el.clientHeight), 24);
  await page.evaluate(() => {setMounted(false);setDraft('line\n'.repeat(4));setMounted(true);});
  await settle();
  assert.equal(await page.locator('textarea').evaluate(el => el.clientHeight), 120);
  assert.deepEqual(errors, []);
});
