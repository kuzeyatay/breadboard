import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

const root = path.resolve(import.meta.dirname, '..');

test('browser Terminal keeps its composer and Intelligence menu inside the drawer', { timeout: 60_000 }, async t => {
  const bundle = await build({ bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    alias: { '@': path.join(root, 'src') }, outfile: 'terminal-layout.js',
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React,{useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import AssistantComposer from '@/app/components/assistant-composer';
      import ChatGreetingEmptyState from '@/app/components/hermes/chat-greeting-empty-state';
      function App(){
        const [value,setValue]=useState('Keep my draft');
        const [effort,setEffort]=useState('medium');
        const [model,setModel]=useState('gpt-6.1-sol');
        return <aside className="browser-terminal-drawer" data-open="true" style={{'--browser-terminal-width':'640px'}}>
          <section className="bb-terminal-drawer-surface" style={{position:'absolute',inset:0,display:'flex',flexDirection:'column'}}>
            <header style={{height:44,flexShrink:0,padding:12}}>Terminal</header>
            <div style={{display:'flex',flex:1,minHeight:0}}>
              <nav aria-label="Terminal tools" style={{width:52,flexShrink:0,borderRight:'1px solid var(--line)'}}/>
              <main style={{display:'flex',flexDirection:'column',flex:1,minWidth:0}}>
                <div style={{overflow:'auto',flex:1,padding:20}}><ChatGreetingEmptyState
                  greeting={{lead:'A closer look',question:'What are we reading today?'}}
                  suggestions={['Summarize this page in a few key points.','Explain the main idea on this page in plain language.','Which claims on this page should I double-check?','Turn the advice on this page into a practical checklist.']}
                  onSelectSuggestion={setValue}/></div>
                <div style={{padding:12}}><AssistantComposer compact value={value} onChange={setValue} placeholder="Draft"
                  model={model} models={['gpt-6.1-sol','gpt-6.1-terra','gpt-6-astra','gpt-6-sol','gpt-6-luna']} onModelChange={setModel}
                  reasoningEffort={effort} onReasoningEffortChange={setEffort}
                  canSubmit={true} onSubmit={()=>{}} onAddDocuments={()=>{}} onPasteFiles={()=>{}} onOpenGardenChat={()=>{}}/></div>
              </main>
            </div>
          </section>
        </aside>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    plugins: [{ name: 'terminal-layout-services', setup(builder) {
      builder.onResolve({ filter: /^(next\/dynamic|next\/navigation)$|\/(settings-dialog|voice-conversation-overlay|speech-dictation-button)$/ }, args => ({ path: args.path, namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, ({path: name}) => ({ loader: 'tsx', resolveDir: root, contents:
        name === 'next/navigation' ? "export const useRouter=()=>({push(){},replace(){}});export const usePathname=()=>'/';export const useSearchParams=()=>new URLSearchParams();"
        : name === 'next/dynamic' ? 'export default function dynamic(){return ()=>null;}'
        : 'export default function Leaf(){return null;}'
      }));
    } }],
  });
  const stylesheet = path.join(root, 'src/app/globals.css');
  const css = (await postcss([tailwindcss({ base: root })]).process(fs.readFileSync(stylesheet, 'utf8'), { from: stylesheet })).css;
  const executablePath = [chromium.executablePath(), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, executablePath });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://terminal-layout.test/**', route => new URL(route.request().url()).pathname === '/'
    ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html data-theme="light"><body><div id="root"></div></body></html>' })
    : route.fulfill({ json: { ok:true,skills:[],agents:[],sessions:[],groups:[],items:[],goals:[] } }));
  await page.goto('http://terminal-layout.test/');
  await page.addStyleTag({ content: css + bundle.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n') });
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
  await page.getByRole('textbox').waitFor();
  for (const [width, height] of [[640,900],[420,900],[640,600],[420,600]]) {
    await page.setViewportSize({ width:1440, height });
    await page.locator('.browser-terminal-drawer').evaluate((el, width) => el.style.setProperty('--browser-terminal-width', `${width}px`), width);
    await page.getByRole('button', { name:'Medium', exact:true }).click();
    const menu = page.getByRole('dialog', { name:'Intelligence', exact:true });
    await expect(menu).toBeVisible();
    const geometry = await menu.evaluate(el => {
      const drawer = el.closest('.browser-terminal-drawer');
      const header = drawer.querySelector('header').getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      const bounds = drawer.getBoundingClientRect();
      const composer = drawer.querySelector('textarea').closest('form');
      return {menu:rect.toJSON(),drawer:bounds.toJSON(),headerBottom:header.bottom,
        composer:composer?.getBoundingClientRect().toJSON(),
        hit:el.contains(document.elementFromPoint(rect.right-3,rect.top+12))};
    });
    assert.ok(geometry.menu.left >= geometry.drawer.left && geometry.menu.right <= geometry.drawer.right, JSON.stringify(geometry));
    assert.ok(geometry.menu.top >= geometry.headerBottom && geometry.menu.bottom <= geometry.drawer.bottom, JSON.stringify(geometry));
    assert.ok(geometry.hit, 'the menu right edge remains clickable');
    if (geometry.composer) assert.ok(geometry.composer.right <= geometry.drawer.right, JSON.stringify(geometry));
    await menu.getByRole('button', { name:'GPT-6.1 Terra', exact:true }).click();
    await expect(page.getByRole('textbox')).toHaveValue('Keep my draft');
    if (process.env.BREADBOARD_LAYOUT_QA_DIR) {
      fs.mkdirSync(process.env.BREADBOARD_LAYOUT_QA_DIR, { recursive:true });
      await page.screenshot({ path:path.join(process.env.BREADBOARD_LAYOUT_QA_DIR, `terminal-${width}-${height}.png`) });
    }
    await page.getByRole('button', { name:'Close intelligence menu', exact:true }).click({ position:{x:5,y:5}, force:true });
  }
  assert.deepEqual(errors, []);
});
