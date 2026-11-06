import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

const root = fileURLToPath(new URL('../', import.meta.url));
const composerSource = readFileSync(path.join(root, 'src/app/components/assistant-composer.tsx'), 'utf8');
const tree = ts.createSourceFile('composer.tsx', composerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const composer = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'AssistantComposer');
// Exercise the real selection handlers and complete prompt picker/editor. Only
// unrelated agent panels and backend responses are replaced by the fixture.
const handlers = composer.body.statements.filter(node => ts.isFunctionDeclaration(node) &&
  ['insertCommand', 'insertCommandToken', 'selectDirectSlashCommand'].includes(node.name?.text),
).map(node => node.getText(tree)).join('\n');

test('saved prompts fill the draft without sending, and settings edit the saved text', { timeout: 60_000 }, async t => {
  const cssPath = path.join(root, 'src/app/globals.css');
  const css = (await postcss([tailwindcss({ base: root })]).process(readFileSync(cssPath, 'utf8'), { from: cssPath })).css;
  const bundle = await build({ bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    alias: { '@': path.join(root, 'src') }, logLevel: 'silent',
    plugins: [{ name: 'unrelated-panels', setup(build) {
      build.onResolve({ filter: /./ }, args => {
        if (args.path === 'next/dynamic') return { path: 'dynamic', namespace: 'fixture' };
        if (args.kind === 'dynamic-import' || /(?:skills-catalog-panel|workflow-templates-panel|reference-chats-panel|bots-panel)$/.test(args.path)) {
          return { path: 'panel', namespace: 'fixture' };
        }
      });
      build.onLoad({ filter: /./, namespace: 'fixture' }, args => ({ contents: args.path === 'dynamic'
        ? 'export default function dynamic(){return ()=>null}'
        : 'export default function Panel(){return null};export const BrowserOperatorDialog=Panel' }));
    } }],
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React,{useRef,useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {CommandHub} from '@/app/components/hermes/command-hub';
      import SlashCommandMenu from '@/app/components/hermes/slash-command-menu';
      import {slashQueryReplacementRange} from '@/lib/hermes/slash-query';
      import {CODEX_COMMAND} from '@/lib/codex/identity';
      import {OPENCODE_COMMAND} from '@/lib/opencode/identity';
      window.submissions=0;
      function App(){
        const [value,onChange]=useState(''),[open,setOpen]=useState(false),[showSlashCommands,setShowSlashCommands]=useState(false);
        const internalTextareaRef=useRef(null),commandHubRef=useRef(null),slashCommandMenuRef=useRef(null);
        const codexAgent=false,onSelectTradingAgents=null,onSelectShorts=null,onSelectFormsmith=null;
        ${handlers}
        return <main style={{position:'absolute',left:20,bottom:20,width:'min(620px,calc(100vw - 40px))'}}>
          <form onSubmit={e=>{e.preventDefault();window.submissions++}}>
            <textarea aria-label="Chat field" ref={internalTextareaRef} value={value} onChange={e=>onChange(e.target.value)}
              onKeyDown={e=>{if(slashCommandMenuRef.current?.handleKeyDown(e))return;commandHubRef.current?.handleKeyDown(e)}}/>
            <CommandHub ref={commandHubRef} open={open} onOpenChange={setOpen} onSelect={insertCommand} surface="dashboard_terminal"/>
            <button type="button" onClick={()=>setShowSlashCommands(true)}>Find saved prompt</button>
            <SlashCommandMenu ref={slashCommandMenuRef} open={showSlashCommands} query="review" surface="dashboard_terminal"
              availableRuntimeAgentIds={[]} onClose={()=>setShowSlashCommands(false)} onSelect={selectDirectSlashCommand}/>
          </form>
        </main>
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` } });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  const writes = [];
  page.on('pageerror', error => errors.push(error.message));
  let prompt = { id: 'user-17', kind: 'prompt', slug: 'review-notes', token: 'review-notes', name: 'Review notes',
    description: 'Review my notes', content: 'Review my notes.\n\nKeep equations, indentation, and café names.',
    category: 'Study', enabled: true, healthy: true, installed: true, isDefault: false };
  const originalContent = prompt.content;
  await page.route('http://localhost:53169/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    let json = {};
    if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
    if (pathname === '/api/hermes/commands') json = { groups: { prompts: [prompt], agents: [], skills: [], mcp: [] }, capability: { mode: 'knowledge', taskScoped: false, expiresAt: null } };
    else if (pathname === '/api/hermes/prompts/user-17' && request.method() === 'PATCH') {
      const body = request.postDataJSON();
      writes.push(body);
      prompt = { ...prompt, name: body.title, category: body.category, content: body.content, description: body.content };
      json = { prompt };
    } else if (request.method() !== 'GET') throw new Error(`Unexpected write: ${request.method()} ${pathname}`);
    await route.fulfill({ json });
  });
  await page.goto('http://localhost:53169/');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const draft = page.getByRole('textbox', { name: 'Chat field' });
  const openPrompts = async () => {
    await page.getByRole('button', { name: 'Open capabilities', exact: true }).click();
    await page.getByRole('tab', { name: 'Prompts', exact: true }).click();
  };
  await draft.fill('An existing draft');
  await openPrompts();
  const promptList = page.getByRole('listbox', { name: 'Prompts', exact: true });
  await expect(promptList).toContainText('Review notes');
  await expect(promptList).not.toContainText('/review-notes');
  await promptList.getByRole('button', { name: /^Review notes/ }).click();
  await expect(draft).toHaveValue(originalContent);
  await expect(draft).toBeFocused();
  assert.equal(await draft.evaluate(node => node.selectionStart), originalContent.length);
  assert.equal(await page.evaluate(() => submissions), 0);

  await openPrompts();
  // Enter on settings must open the editor, not select or submit the prompt.
  await promptList.getByRole('button', { name: 'Edit Review notes', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Edit prompt', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toHaveValue(originalContent);
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Review revised notes');
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Explain the revised notes.\nLeave this ready to send.');
  await page.getByRole('button', { name: 'Save prompt', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Prompt saved.');
  assert.equal(writes.length, 1);
  await page.getByRole('button', { name: '← Back', exact: true }).click();
  await promptList.getByRole('button', { name: /^Review revised notes/ }).click();
  await expect(draft).toHaveValue(prompt.content);

  await openPrompts();
  await page.getByRole('button', { name: 'Saved prompts settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Manage prompts', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '← Back', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search prompts' }).press('Enter');
  await expect(draft).toBeFocused();
  await expect(draft).toHaveValue(prompt.content);

  await draft.fill('/review');
  await page.getByRole('button', { name: 'Find saved prompt', exact: true }).click();
  await page.getByRole('button', { name: /^Review revised notes/ }).click();
  await expect(draft).toHaveValue(prompt.content);
  assert.equal(await page.evaluate(() => submissions), 0);
  assert.deepEqual(errors, []);

  await page.setViewportSize({ width: 390, height: 780 });
  await openPrompts();
  const edit = promptList.getByRole('button', { name: 'Edit Review revised notes', exact: true });
  await expect(edit).toBeVisible();
  const bounds = await edit.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
  await edit.click();
  await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toHaveValue(prompt.content);
});
