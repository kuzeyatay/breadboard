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
let surface, input;
function visit(node) {
  if (ts.isJsxElement(node)) {
    const opening = node.openingElement.getText(tree);
    if (opening.includes('className="neu-composer ')) surface = opening;
    if (opening.includes('relative flex min-w-0 flex-1 items-center') && node.getText(tree).includes('<textarea')) input = node.getText(tree);
  }
  ts.forEachChild(node, visit);
}
visit(tree);
assert.ok(surface && input, 'Exercise the production composer surface and text field');

test('the visible composer padding focuses the draft without stealing control or caret clicks', { timeout: 120_000 }, async t => {
  const bundle = await build({ bundle: true, write: false, outfile: 'composer-focus.js', platform: 'browser', format: 'iife', jsx: 'automatic',
    alias: { '@': path.join(root, 'src') }, stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React, {useRef,useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {createPortal} from 'react-dom';
      import ComposerBorderBeam from '@/app/components/effects/composer-border-beam';
      import PromptSuggestionOverlay from '@/app/components/prompt-suggestion-overlay';
      import {composerSegments} from '@/lib/composer-links';
      import {splitLeadingCommandTokens} from '@/app/components/hermes/command-text';
      function App() {
        const [value,onChange] = useState(''), [compact,setCompact] = useState(false);
        const internalTextareaRef=useRef(null), commandBackdropRef=useRef(null), composerSurfaceRef=useRef(null);
        const assignTextareaRef=internalTextareaRef, slashCommandMenuRef=useRef(null), commandHubRef=useRef(null);
        const pendingWorkflowPrompt=null, setPendingWorkflow=()=>{}, showSlashCommands=false;
        const menuSearch=null, setMenuSearch=()=>{}, closeMenuSearch=()=>{}, addMenuRef=useRef(null);
        const setSlashQuery=()=>{}, setShowSlashCommands=()=>{}, setShowCommandHub=()=>{}, slashQueryAt=()=>null;
        const onKeyDown=undefined, walkMessageHistory=()=>false, queueHeld=false;
        const uploadQueued=null, uploadQueuedRef=useRef(null), cancelUploadSend=()=>{};
        const isAddingDocuments=false, queueDisabled=false, holdForUploads=()=>false;
        const promptSuggestion={text:null,dismiss:()=>{},handleKeyDown:()=>false};
        const canSubmit=false, isSending=false, disabled=false, submitMessage=()=>{};
        const handlePaste=()=>{}, syncCommandBackdrop=()=>{}, textareaStyle=undefined;
        const placeholder='Ask anything.';
        window.setCompact=setCompact;
        return <><button id="outside">Outside</button>
          <div className="bb-composer-overlay px-4 pb-3">
            <ComposerBorderBeam active={!value.trim()}>
              ${surface}
                <div className="flex min-w-0 items-end gap-1.5">
                  <button className="h-11 w-11" id="add" onClick={()=>window.adds=(window.adds||0)+1}>+</button>
                  ${input}
                  <button className="h-11 w-11" id="send" onClick={()=>window.sends=(window.sends||0)+1}>Send</button>
                </div>
                {createPortal(<div style={{position:'fixed',top:80,left:0}}><input aria-label="Menu search"/></div>,document.body)}
              </div>
            </ComposerBorderBeam>
          </div></>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` } });
  const stylesheet = path.join(root, 'src/app/globals.css');
  const css = (await postcss([tailwindcss({base:root})]).process(fs.readFileSync(stylesheet, 'utf8'), {from:stylesheet})).css;
  const executablePath = [chromium.executablePath(), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(fs.existsSync);
  const browser = await chromium.launch({headless:true, ...(executablePath ? {executablePath} : {})});
  t.after(()=>browser.close());
  const page = await browser.newPage({viewport:{width:1000,height:700}});
  const errors=[];
  page.on('pageerror', error=>errors.push(error.message));
  t.after(()=>assert.deepEqual(errors,[]));
  await page.setContent('<html data-theme="light"><body><div id="root"></div></body></html>');
  await page.addStyleTag({content:css});
  for (const output of bundle.outputFiles) {
    if (output.path.endsWith('.css')) await page.addStyleTag({content:output.text});
    else await page.addScriptTag({content:output.text});
  }
  const textarea = page.getByPlaceholder('Ask anything.');
  await textarea.waitFor().catch(error=>{console.error({errors});throw error;});

  for (const compact of [false,true]) {
    await page.evaluate(compact=>window.setCompact(compact),compact);
    await textarea.fill('');
    const field = await textarea.boundingBox();
    const pill = await page.locator('.neu-composer').boundingBox();
    const container = await textarea.locator('..').boundingBox();
    const add = await page.locator('#add').boundingBox();
    const points = [
      ['above the text',field.x+field.width/2,container.y+2],
      ['below the text',field.x+field.width/2,container.y+container.height-2],
      ['top padding',pill.x+pill.width/2,pill.y+3],
      ['bottom padding',pill.x+pill.width/2,pill.y+pill.height-3],
      ['gap beside the controls',add.x+add.width+2,field.y+field.height/2],
    ];
    for (const [label,x,y] of points) {
      await page.locator('#outside').click();
      await page.mouse.click(x,y);
      await expect(textarea, `${compact?'compact':'normal'}: ${label}`).toBeFocused({timeout:1000});
    }
    await page.keyboard.type('A garden question');
    await expect(textarea).toHaveValue('A garden question');
  }

  await page.locator('#add').click();
  await expect(page.locator('#add')).toBeFocused();
  assert.equal(await page.evaluate(()=>window.adds),1);
  await page.locator('#send').click();
  await expect(page.locator('#send')).toBeFocused();
  assert.equal(await page.evaluate(()=>window.sends),1);
  await page.getByLabel('Menu search').click();
  await expect(page.getByLabel('Menu search')).toBeFocused();

  await textarea.fill('Keep this draft');
  await textarea.press('Home');
  await textarea.press('ArrowRight');
  await textarea.press('ArrowRight');
  await textarea.press('ArrowRight');
  await page.locator('#outside').click();
  const container=await textarea.locator('..').boundingBox();
  await page.mouse.click(container.x+container.width/2,container.y+2);
  assert.equal(await textarea.evaluate(node=>node.selectionStart),3,'padding preserves the existing caret');
  await textarea.click({position:{x:2,y:8}});
  assert.equal(await textarea.evaluate(node=>node.selectionStart),0,'direct text clicks still place the caret');

  await textarea.fill('/research https://example.com');
  await page.locator('#outside').click();
  const field=await textarea.boundingBox();
  await page.mouse.click(field.x+10,field.y+field.height/2);
  await expect(textarea).toBeFocused();
  await page.locator('.neu-composer a').evaluate(link=>link.addEventListener('click',event=>{event.preventDefault();window.linkOpened=true;}));
  await page.locator('.neu-composer a').click();
  assert.equal(await page.evaluate(()=>window.linkOpened),true,'mirrored links retain their own click action');
  await expect(textarea).not.toBeFocused();
});
