import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import esbuild from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');

test('Quartz menus fit clipped panels while Garden workspace keeps its original anchored layout', { timeout: 60_000 }, async () => {
  const bundle = await esbuild.build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import AssistantComposer from './src/app/components/assistant-composer';
      window.fetch = async () => Response.json({settings:{},models:[],sessions:[],success:true,
        available:true,captured_at:new Date().toISOString(),primary:{used_percent:25,window_minutes:300,resets_in_seconds:3600}});
      function App() {
        const quartz = location.pathname !== '/workspace';
        const [value,setValue] = useState('What is charge and what is a magnetic field?');
        const [model,setModel] = useState('gpt-5.6-terra');
        const [effort,setEffort] = useState('max');
        window.selection = {model,effort};
        return <aside id="assistant">
          <header><strong>Assistant</strong><p>EM 1 Learning Map</p></header>
          <article><p>At every position, the electromagnetic field has values that determine how a charged particle placed there would move.</p></article>
          <footer><AssistantComposer compact={quartz} viewportBoundedIntelligence={quartz}
            capabilitySurface="garden_chat" value={value} onChange={setValue} onSubmit={()=>{}}
            canSubmit model={model} models={['gpt-5.6-terra','gpt-5.6-luna','gpt-5.5','gpt-5.4','gpt-oss-120b-medium', ...Array.from({length:12},(_,i)=>'cliproxy/gemini-'+i)]}
            reasoningEffort={effort} onModelChange={setModel} onReasoningEffortChange={setEffort}/></footer>
        </aside>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', outfile: 'app.js',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'service-boundaries', setup(builder) {
      builder.onResolve({ filter: /^(next\/dynamic|next\/navigation)$|\/(command-hub|voice-conversation-overlay|speech-dictation-button|settings-(agent-memory|accounts|connections|messaging|guardrails|mcp|providers|recall|speech|voice-calibration))$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({path: modulePath}) => ({ loader: 'tsx', resolveDir: root, contents:
        modulePath === 'next/navigation'
          ? "export const useRouter=()=>({push(){},replace(){},refresh(){}});export const usePathname=()=>'/';export const useSearchParams=()=>new URLSearchParams();"
          : modulePath === 'next/dynamic' ? 'export default function dynamic(){return ()=>null;}'
          : modulePath.endsWith('command-hub') ? 'export const CommandHub=()=>null;'
          : modulePath.endsWith('speech-dictation-button') ? 'export default function Leaf(){return <button style={{width:36,flexShrink:0}}>Mic</button>;}'
          : modulePath.includes('/settings-') ? "export default function Leaf(){return <div><input aria-label='Saved setting' defaultValue='Keep this'/><div style={{height:800}}>Account details</div><button>Last setting</button></div>;}"
          : 'export default function Leaf(){return null;}'
      }));
    } }],
  });
  const stylesheet = path.join(root, 'src/app/globals.css');
  const cssInput = fs.readFileSync(stylesheet, 'utf8').replace('@source "../**/*.{js,mjs,cjs,ts,tsx,jsx,mdx}";', '@source "./components/assistant-composer.tsx"; @source "./components/settings-dialog.tsx"; @source "./components/usage-limits-popover.tsx";');
  const css = (await postcss([tailwind({ base: root })]).process(cssInput, { from: stylesheet })).css;
  const server = http.createServer((request, response) => {
    const js = request.url === '/app.js';
    response.setHeader('Content-Type', js ? 'text/javascript' : 'text/html');
    response.end(js ? bundle.outputFiles.find(file=>file.path.endsWith('.js')).text : `<!doctype html><html><head><style>${css}
      body{margin:0;background:var(--paper-bg)}
      #assistant{position:fixed;right:0;top:8px;bottom:0;width:min(586px,calc(100% - 24px));display:flex;flex-direction:column;overflow:hidden;background:var(--paper-raised);border:1px solid var(--line)}
      header{padding:16px;border-bottom:1px solid var(--line)}article{flex:1;min-height:0;overflow:auto;padding:24px}footer{padding:12px}
      .workspace #assistant{inset:0;width:100%;overflow:visible}.workspace footer{width:1024px;max-width:100%;margin:0 auto;padding:12px 0}
      </style></head><body class="${request.url === '/workspace' ? 'workspace' : ''}"><div id="root"></div><script src="/app.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(fs.existsSync);
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage({ viewport: { width: 624, height: 934 } });
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const trigger = page.locator('button[title*=" reasoning · "]');
    const menu = page.getByRole('dialog', { name: 'Intelligence', exact: true });
    const usage = page.getByRole('dialog', { name: 'Usage limits', exact: true });
    const settings = page.getByRole('dialog', { name: 'Settings panel', exact: true });
    const fits = async locator => {
      await locator.waitFor({ state: 'visible' });
      const bounds = await locator.boundingBox();
      const viewport = page.viewportSize();
      assert.ok(bounds.x >= 11 && bounds.y >= 11 && bounds.x + bounds.width <= viewport.width - 11 && bounds.y + bounds.height <= viewport.height - 11, JSON.stringify({bounds,viewport}));
      // Bounds alone miss ancestor clipping and overlapping layers.
      assert.equal(await locator.evaluate(element => {
        const r = element.getBoundingClientRect();
        return [[r.left+8,r.top+8],[r.right-8,r.bottom-8]].every(([x,y])=>element.contains(document.elementFromPoint(x,y)));
      }), true);
    };
    await trigger.click();
    for (const viewport of [{width:624,height:934}, {width:390,height:700}, {width:624,height:420}, {width:1282,height:922}, {width:1024,height:768}, {width:1440,height:900}]) {
      await page.setViewportSize(viewport);
      await fits(menu);
      await menu.getByRole('button', {name:'High Deeper thinking',exact:true}).click();
      assert.equal(await page.evaluate(()=>window.selection.effort), 'high');
      await menu.getByRole('button', {name:'GPT-5.6 Luna',exact:true}).click();
      assert.equal(await page.evaluate(()=>window.selection.model), 'gpt-5.6-luna');
      const toggle = menu.getByRole('switch', {name:/^Rewrite naturally/});
      const before = await toggle.getAttribute('aria-checked');
      await toggle.click();
      assert.notEqual(await toggle.getAttribute('aria-checked'), before);
      await menu.getByRole('switch', {name:/^Super agent/}).scrollIntoViewIfNeeded();
      await menu.getByRole('button', {name:'Usage',exact:true}).click();
      await fits(usage);
      await usage.getByRole('button', {name:'Refresh',exact:true}).click();
      await page.keyboard.press('Escape');
      await usage.waitFor({state:'detached'});
      assert.equal(await menu.isVisible(), true);
      await menu.getByRole('button', {name:'Settings',exact:true}).click();
      await fits(settings);
      await settings.getByRole('textbox', {name:'Saved setting'}).first().fill('Preserved');
      await settings.getByRole('button', {name:'Last setting'}).last().scrollIntoViewIfNeeded();
      await page.keyboard.press('Escape');
      await settings.waitFor({state:'hidden'});
      assert.equal(await menu.isVisible(), true);
      await menu.getByRole('button', {name:'Settings',exact:true}).click();
      assert.equal(await settings.getByRole('textbox', {name:'Saved setting'}).first().inputValue(), 'Preserved');
      await settings.getByRole('button', {name:'Close settings'}).click();
    }
    await menu.getByRole('button', {name:'Settings',exact:true}).click();
    for (const viewport of [{width:1024,height:768}, {width:1282,height:922}, {width:390,height:700}, {width:1282,height:922}]) {
      await page.setViewportSize(viewport);
      await fits(settings);
    }
    const artifacts = path.join(root, '.tmp-intelligence-menu-qa');
    fs.mkdirSync(artifacts, {recursive:true});
    await settings.getByRole('button', {name:'Close settings'}).click();
    await page.setViewportSize({width:624,height:934});
    await menu.getByRole('button', {name:'Ultra Maximum reasoning depth',exact:true}).click();
    await menu.locator(':scope > div').first().evaluate(element=>element.scrollTop=0);
    await page.mouse.move(20,20);
    await page.screenshot({path:path.join(artifacts,'quartz-intelligence.png')});
    await menu.getByRole('switch', {name:/^Super agent/}).scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(artifacts,'quartz-intelligence-switches.png')});
    await page.keyboard.press('Escape');
    await menu.waitFor({state:'detached'});
    assert.equal(await trigger.evaluate(element=>document.activeElement===element), true);
    await trigger.click();
    await page.locator('article').click({position:{x:16,y:16}});
    await menu.waitFor({state:'detached'});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth), false);

    // The full Garden workspace keeps its original anchored menu and leftward
    // subpanels. Only the Quartz reader above opts into viewport positioning.
    await page.setViewportSize({width:1440,height:900});
    await page.goto(`http://127.0.0.1:${server.address().port}/workspace`);
    const workspaceSettings = page.getByRole('dialog', {name:'Settings',exact:true});
    const workspaceUsage = page.locator('div.absolute').filter({has: page.getByText('Usage Limits', {exact:true})}).last();
    for (const viewport of [{width:1440,height:900}, {width:1282,height:922}]) {
      await page.setViewportSize(viewport);
      await trigger.click();
      await fits(menu);
      const triggerBounds = await trigger.boundingBox();
      const menuBounds = await menu.boundingBox();
      assert.ok(Math.abs(menuBounds.x - triggerBounds.x) < 1, 'Workspace Intelligence keeps its original left alignment');
      assert.ok(Math.abs(menuBounds.y + menuBounds.height + 8 - triggerBounds.y) < 1, 'Workspace Intelligence stays above its trigger');
      assert.equal(await menu.getAttribute('data-viewport-popover'), null);
      await menu.getByRole('button', {name:'Usage',exact:true}).click();
      await fits(workspaceUsage);
      await fits(menu);
      const usageBounds = await workspaceUsage.boundingBox();
      assert.ok(usageBounds.x + usageBounds.width <= menuBounds.x + 1, 'Workspace Usage remains beside Intelligence');
      await menu.getByRole('button', {name:'Settings',exact:true}).click();
      await fits(workspaceSettings);
      await fits(menu);
      const settingsBounds = await workspaceSettings.boundingBox();
      assert.ok(settingsBounds.x + settingsBounds.width <= menuBounds.x - 7, 'Workspace Settings remains beside Intelligence');
      await workspaceSettings.getByRole('textbox', {name:'Saved setting'}).first().fill('Workspace preserved');
      await workspaceSettings.getByRole('button', {name:'Last setting'}).last().scrollIntoViewIfNeeded();
      await workspaceSettings.getByRole('textbox', {name:'Saved setting'}).first().scrollIntoViewIfNeeded();
      await page.mouse.move(20,20);
      await page.screenshot({path:path.join(artifacts,`garden-settings-beside-intelligence-${viewport.width}.png`)});
      await workspaceSettings.getByRole('button', {name:'Close settings'}).click();
      await menu.getByRole('button', {name:'Settings',exact:true}).click();
      assert.equal(await workspaceSettings.getByRole('textbox', {name:'Saved setting'}).first().inputValue(), 'Workspace preserved');
      await workspaceSettings.getByRole('button', {name:'Close settings'}).click();
      await page.getByRole('button', {name:'Close intelligence menu',exact:true}).click({position:{x:16,y:16}});
      await menu.waitFor({state:'detached'});
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve=>server.close(resolve));
  }
});
