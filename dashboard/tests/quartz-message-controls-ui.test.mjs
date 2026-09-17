import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const root = path.resolve(import.meta.dirname, '..');
const file = path.join(root, 'src/app/garden/garden-assistant.tsx');
const tree = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map();
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name) declarations.set(node.name.text, node.getText(tree));
  if (ts.isVariableStatement(node)) for (const item of node.declarationList.declarations) declarations.set(item.name.getText(tree), `const ${item.getText(tree)};`);
  ts.forEachChild(node, visit);
}
visit(tree);

test('Quartz sent-message controls work on hover, focus and touch and preserve the surrounding history', { timeout: 60_000 }, async () => {
  // Use the actual Quartz row and edit/delete handlers. Only persistence and
  // model dispatch are replaced, so the fixture never changes a user's chat.
  const bundle = await build({ bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    alias: { '@': path.join(root, 'src') },
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React,{memo,useRef,useState} from 'react';import{createRoot}from'react-dom/client';
      import UserMessageControls from '@/app/components/chat/user-message-controls';
      import CollapsibleUserMessage from '@/app/components/chat/collapsible-user-message';
      import {UserMessageText} from '@/app/components/hermes/command-text';
      import {reusableChatAttachments} from '@/lib/chat-attachments';
      import {isClarificationAnswerMessage} from '@/lib/steered-response';
      const gardenAssistantVisibleContent=m=>m.content,uiResourcesForUserRequest=r=>r??[];
      const delegatedThinkingUpdates=()=>[],delegatedAgentCompletedLabelForMessage=()=>'';
      const ActivityPanel=()=>null,ChatTimeSeparator=()=>null,AssistantMessageActions=()=>null,ChatMessageAttachments=()=>null,ChatVideoLinkEmbeds=()=>null,QuotedChatSelection=()=>null,InlineProposalCards=()=>null;
      const AssistantRichResponse=({markdown})=>markdown,SelectableAssistantMarkdown=({content})=><p>{content}</p>;
      ${declarations.get('TranscriptRow')}
      window.sent=[];window.saved=[];window.branches=[];
      Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copied=text}}});
      function App(){
        const [messages,setMessages]=useState([
          {id:'u1',role:'user',content:'/explain First question',selectedText:'Selected note'},
          {id:'a1',role:'assistant',content:'First answer'},
          {id:'u2',role:'user',content:'Second question'},
          {id:'a2',role:'assistant',content:'Second answer'},
        ]);
        const [chatIsStreaming,setBusy]=useState(false),[updatingMessages,setUpdatingMessages]=useState(false);
        const messageMutationPendingRef=useRef(false),activeChat={id:7,isOwn:true};
        const sendMessage=(...args)=>window.sent.push(args);
        const persistChatSession=async(id,next)=>{window.saved.push({id,messages:next});return !window.failSave};
        const updateSessionMessages=()=>{},saveBranchGroups=groups=>window.branches.push(groups);
        ${declarations.get('editUserMessage')}
        ${declarations.get('deleteUserMessage')}
        window.setBusy=setBusy;
        return <main>{messages.map(message=><section key={message.id} data-message={message.id}>
          <TranscriptRow message={message} messageKey={message.id} userActionsDisabled={chatIsStreaming||updatingMessages}
            onEditUserMessage={editUserMessage} onDeleteUserMessage={deleteUserMessage}/>
        </section>)}</main>;
      }createRoot(document.getElementById('root')).render(<App/>);
    ` }, logLevel: 'silent' });
  const cssPath = path.join(root, 'src/app/globals.css');
  const cssSource = fs.readFileSync(cssPath, 'utf8').replace('@source "../**/*.{js,mjs,cjs,ts,tsx,jsx,mdx}";',
    '@source "./garden/garden-assistant.tsx"; @source "./components/chat/user-message-controls.tsx"; @source "./components/confirm-dialog.tsx"; @source "./components/hermes/save-prompt-dialog.tsx";');
  const css = (await postcss([tailwind({ base: root })]).process(cssSource, { from: cssPath })).css;
  const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, chromium.executablePath(), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => p && fs.existsSync(p));
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 560, height: 800 } });
    const errors = [], prompts = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://localhost:53140/**', route => {
      if (route.request().url().endsWith('/api/hermes/prompts')) {
        const prompt = route.request().postDataJSON(); prompts.push(prompt);
        return route.fulfill({ json: { prompt: { ...prompt, id: 'saved' } } });
      }
      return route.fulfill({ contentType: 'text/html', body: '<html><body><div id="root" style="padding:24px"></div></body></html>' });
    });
    await page.goto('http://localhost:53140/');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const first = page.locator('[data-message="u1"]');
    const actions = first.getByLabel('Sent message actions');
    const copy = first.getByRole('button', { name: 'Copy message', exact: true });
    await copy.waitFor();
    await page.mouse.move(0, 0);
    assert.equal(await actions.evaluate(el => getComputedStyle(el).opacity), '0');
    await first.getByText('/explain First question').hover();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[aria-label="Sent message actions"]')).opacity === '1');
    await copy.click();
    assert.equal(await page.evaluate(() => window.copied), '/explain First question');
    await first.getByRole('button', { name: 'Message copied' }).waitFor();
    await page.mouse.move(0, 0);
    assert.equal(await actions.evaluate(el => getComputedStyle(el).opacity), '1', 'focus keeps the controls visible');

    await first.getByRole('button', { name: 'Save message to Prompts' }).click();
    await page.getByRole('button', { name: 'Save prompt', exact: true }).click();
    await page.getByText('Saved to Prompts.', { exact: true }).waitFor();
    assert.equal(prompts[0].content, '/explain First question');
    await page.getByRole('button', { name: 'Close save prompt dialog' }).click();

    await first.getByRole('button', { name: 'Edit message and create a branch' }).click();
    await page.getByRole('textbox', { name: 'Edit message' }).fill('Cancelled edit');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await page.evaluate(() => window.sent.length), 0);
    await first.getByRole('button', { name: 'Edit message and create a branch' }).click();
    await page.getByRole('textbox', { name: 'Edit message' }).fill('Edited question');
    await page.getByRole('button', { name: 'Save & send' }).click();
    const sent = await page.evaluate(() => window.sent[0]);
    assert.equal(sent[0], 'Edited question');
    assert.deepEqual(sent[1], [], 'resubmit from the original question boundary');
    assert.equal(sent[3], 'Selected note', 'retain the original page selection');
    assert.equal(sent[6].id, 'u1', 'keep the original turn as the branch source');

    await page.evaluate(() => window.setBusy(true));
    await page.waitForFunction(() => document.querySelector('[aria-label="Edit message and create a branch"]').disabled);
    assert.equal(await first.getByRole('button', { name: 'Delete this message and its answer' }).isDisabled(), true);
    assert.equal(await first.getByRole('button', { name: 'Save message to Prompts' }).isDisabled(), false);
    await page.evaluate(() => window.setBusy(false));

    const remove = first.getByRole('button', { name: 'Delete this message and its answer' });
    await remove.click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await page.evaluate(() => window.saved.length), 0);
    await page.evaluate(() => { window.failSave = true; });
    await remove.click();
    await page.getByRole('button', { name: 'Delete message', exact: true }).click();
    await remove.waitFor();
    assert.equal(await first.count(), 1, 'a failed save leaves the message in place');
    await page.evaluate(() => { window.failSave = false; });
    await remove.click();
    await page.getByRole('button', { name: 'Delete message', exact: true }).click();
    await first.waitFor({ state: 'detached' });
    assert.equal(await page.locator('[data-message="a1"]').count(), 0);
    assert.deepEqual(await page.locator('[data-message]').evaluateAll(els => els.map(el => el.dataset.message)), ['u2', 'a2']);
    assert.deepEqual(await page.evaluate(() => window.saved.at(-1).messages.map(m => m.id)), ['u2', 'a2']);
    assert.deepEqual(await page.evaluate(() => window.branches.at(-1)), {});
    assert.deepEqual(errors, []);

    const touch = await browser.newPage({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
    await touch.setContent('<div id="root"></div>');
    await touch.addStyleTag({ content: css });
    await touch.addScriptTag({ content: bundle.outputFiles[0].text });
    await touch.getByLabel('Sent message actions').first().waitFor();
    assert.equal(await touch.getByLabel('Sent message actions').first().evaluate(el => getComputedStyle(el).opacity), '1');
  } finally { await browser.close(); }
});
