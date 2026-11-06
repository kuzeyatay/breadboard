import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

const root = path.resolve(import.meta.dirname, '..');
const ready = (slug, name, kind = 'skill', extra = {}) => ({ id: `${kind}:${slug}`, slug, token: slug, kind, name, description: `Use ${name}`, installed: true, enabled: true, healthy: true, ...extra });

test('plus and slash search from the real composer without changing or sending the draft', { timeout: 120_000 }, async t => {
  const bundle = await build({
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', outfile: 'app.js',
    alias: { '@': path.join(root, 'src') }, loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import AssistantComposer from '@/app/components/assistant-composer';
      function App() {
        const [value,setValue]=useState('Keep my draft'), [session,setSession]=useState('chat-a');
        window.draft=value; window.setDraft=setValue; window.switchChat=()=>setSession('chat-b');
        return <><button id="outside">Outside</button><div style={{position:'fixed',left:24,right:24,bottom:24,maxWidth:800}}>
          <AssistantComposer value={value} onChange={setValue} placeholder="Draft" capabilitySessionId={session}
            model="test" models={[]} onModelChange={()=>{}} reasoningEffort="medium" onReasoningEffortChange={()=>{}}
            canSubmit={Boolean(value.trim())} onSubmit={()=>window.sends=(window.sends||0)+1}
            onAddDocuments={()=>window.filesOpened=true} onPasteFiles={()=>{}} onOpenGardenChat={()=>{}} />
        </div></>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    plugins: [{ name: 'unrelated-services', setup(b) {
      b.onResolve({ filter: /^(next\/dynamic|next\/navigation)$|\/(settings-dialog|voice-conversation-overlay|speech-dictation-button)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({path: name}) => ({ loader: 'tsx', resolveDir: root, contents:
        name === 'next/navigation' ? "export const useRouter=()=>({push(){},replace(){}});export const usePathname=()=>'/';export const useSearchParams=()=>new URLSearchParams();"
        : name === 'next/dynamic' ? 'export default function dynamic(){return ()=>null;}'
        : name.endsWith('settings-dialog') ? "export default function Settings({open,initialTab}){return open?<div role='dialog' aria-label='Settings'>{initialTab}</div>:null;}"
        : 'export default function Leaf(){return null;}'
      }));
    } }],
  });
  const stylesheet = path.join(root, 'src/app/globals.css');
  const css = (await postcss([tailwindcss({ base: root })]).process(fs.readFileSync(stylesheet, 'utf8'), { from: stylesheet })).css;
  const executablePath = [chromium.executablePath(), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
  const browser = await chromium.launch({headless:true, executablePath});
  t.after(()=>browser.close());
  const page = await browser.newPage({viewport:{width:1080,height:800}});
  page.setDefaultTimeout(8000);
  const errors=[];
  let slackConnected = true;
  page.on('pageerror', error=>errors.push(error.message));
  const catalog = {groups:{
    skills:[ready('docx','Documents'),ready('pdf','PDF'),ready('xlsx','Spreadsheets'),ready('write-like-me','Writing style'),ready('goal','Goal mode'),ready('plan-mode','Plan mode'),ready('missing','Not installed','skill',{installed:false})],
    mcp:[ready('gmail','Gmail','mcp',{connected:true}),ready('calendar','Google Calendar','mcp',{connected:true}),ready('github','GitHub','mcp',{connected:true}),ready('disconnected','Disconnected app','mcp',{connected:false,healthy:false}),ready('disabled','Disabled app','mcp',{connected:true,enabled:false})],
    prompts:[],agents:[]},capability:{mode:'knowledge',expiresAt:null,taskScoped:false}};
  await page.route('http://composer.test/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') return route.fulfill({contentType:'text/html',body:'<html data-theme="dark"><body style="background:var(--paper-bg);color:var(--ink)"><div id="root"></div></body></html>'});
    if (url.pathname === '/api/hermes/commands') return route.fulfill({json:catalog});
    if (url.pathname === '/api/hermes/composio/integrations') return route.fulfill({json:{integrations:[
      {slug:'google-calendar',name:'Google Calendar',connected:true},
      {slug:'slack',name:'Slack',logoUrl:'/api/hermes/nango/integrations/logo?provider=slack',connected:slackConnected},
      {slug:'notion',name:'Disconnected Notion',connected:false},
    ]}});
    if (url.pathname === '/api/hermes/nango/integrations/logo' && url.searchParams.get('provider') === 'slack') {
      return route.fulfill({contentType:'image/svg+xml',body:fs.readFileSync(path.join(root,'../nango/packages/webapp/public/images/template-logos/slack.svg'),'utf8')});
    }
    return route.fulfill({json:{ok:true,skills:[],agents:[],divisions:[],bots:[],sessions:[],groups:[],items:[],goals:[]}});
  });
  await page.goto('http://composer.test/');
  await page.addStyleTag({content:css});
  await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
  const plus = page.getByRole('button',{name:'Add to chat',exact:true});
  const slash = page.getByRole('button',{name:'Open capabilities',exact:true});
  const addSearch = page.getByRole('textbox',{name:'Search add menu',exact:true});
  const commandSearch = page.getByRole('textbox',{name:'Search capabilities',exact:true});
  const draft = page.getByRole('textbox',{name:'Draft',exact:true});
  await draft.waitFor();
  await plus.click();
  await page.getByRole('menuitem',{name:/^Slack/}).waitFor();
  await page.getByRole('menuitem',{name:/^Slack/}).locator('img').evaluate(image => image.decode());
  assert.equal(await addSearch.evaluate(input=>document.activeElement===input),true);
  assert.equal(await page.getByRole('button',{name:'Send',exact:true}).isDisabled(),true);
  assert.equal(await page.getByRole('menuitem',{name:/Disconnected app|Disabled app|Not installed|Disconnected Notion/}).count(),0);
  assert.equal(await page.getByRole('menuitem',{name:/Gmail|GitHub|Google Calendar|Documents|PDF|Spreadsheets|Writing style|Goal mode|Plan mode|Research|Reference a chat|Browse all skills/}).count(),0);
  if (process.env.COMPOSER_QA_DIR) {
    fs.mkdirSync(process.env.COMPOSER_QA_DIR,{recursive:true});
    await page.screenshot({path:path.join(process.env.COMPOSER_QA_DIR,'plus-connections.png')});
  }
  await page.keyboard.type('slack');
  assert.equal(await page.getByRole('menuitem').count(),1);
  assert.equal(await page.evaluate(()=>window.draft),'Keep my draft');
  await addSearch.click();
  await page.getByRole('menuitem',{name:/^Slack/}).click();
  assert.equal(await draft.inputValue(),'Keep my draft\nUse my connected Slack account. ');
  assert.equal(await page.evaluate(()=>window.sends||0),0);
  await page.evaluate(()=>window.setDraft('Keep my draft'));
  await page.waitForFunction(()=>window.draft==='Keep my draft');

  await plus.click();
  for (const query of ['spreadsheets','goal','plan','gmail','github','research','reference','capabilities']) {
    await addSearch.fill(query);
    await page.getByRole('status').filter({hasText:'No options match'}).waitFor();
    assert.equal(await page.getByRole('menuitem').count(),0);
  }
  await addSearch.press('Escape');
  assert.equal(await draft.inputValue(),'Keep my draft');
  await plus.click();
  await addSearch.fill('nothing-matches-this');
  await page.getByRole('status').filter({hasText:'No options match'}).waitFor();
  await addSearch.press('Enter');
  assert.equal(await page.evaluate(()=>window.sends||0),0);
  await page.locator('#outside').click();
  assert.equal(await draft.inputValue(),'Keep my draft');
  assert.equal(await page.locator('#outside').evaluate(button=>document.activeElement===button),true);

  await slash.click();
  await commandSearch.fill('docx');
  await page.getByRole('option').filter({hasText:'/docx'}).waitFor();
  assert.equal(await page.getByRole('option').count(),1);
  await commandSearch.press('Enter');
  assert.equal(await draft.inputValue(),'/docx Keep my draft');
  assert.equal(await page.evaluate(()=>window.sends||0),0);
  await slash.click();
  for (const query of ['goal','plan-mode','gmail','github']) {
    await commandSearch.fill(query);
    await page.getByRole('option').filter({hasText:`/${query}`}).waitFor();
  }
  await commandSearch.fill('no-such-capability');
  await commandSearch.press('Enter');
  assert.equal(await page.evaluate(()=>window.sends||0),0);
  await commandSearch.press('Escape');
  assert.equal(await draft.inputValue(),'/docx Keep my draft');

  await plus.click();
  await slash.click();
  await commandSearch.waitFor();
  assert.equal(await page.getByRole('menu').count(),0);
  await plus.click();
  await addSearch.waitFor();
  assert.equal(await page.getByRole('listbox',{name:'Available capabilities'}).count(),0);
  await addSearch.fill('goal');
  await addSearch.press('Enter');
  assert.equal(await page.evaluate(()=>window.sends||0),0);
  await addSearch.press('Escape');
  assert.equal(await draft.inputValue(),'/docx Keep my draft');

  await page.evaluate(()=>window.setDraft(''));
  await draft.fill('/docx');
  await page.getByRole('option').filter({hasText:'/docx'}).waitFor();
  await draft.press('Enter');
  assert.equal(await draft.inputValue(),'/docx ');
  await slash.click();
  await page.getByRole('button',{name:'Browse all',exact:true}).click();
  await page.getByRole('dialog',{name:'Use a capability',exact:true}).waitFor();
  await page.getByRole('button',{name:'Close capabilities',exact:true}).last().click();

  await page.setViewportSize({width:390,height:740});
  await plus.click();
  await addSearch.fill('slack');
  const menuBox = await page.getByRole('menu',{name:'Add to chat',exact:true}).boundingBox();
  assert.ok(menuBox.x>=0 && menuBox.x+menuBox.width<=390);
  await addSearch.press('Escape');
  await plus.click();
  await addSearch.fill('slack');
  await addSearch.press('Enter');
  assert.equal(await draft.inputValue(),'/docx Use my connected Slack account. ');
  assert.equal(await page.evaluate(()=>window.sends||0),0);
  slackConnected = false;
  await plus.click();
  await addSearch.fill('slack');
  await page.getByRole('status').filter({hasText:'No options match'}).waitFor();
  assert.equal(await page.getByRole('menuitem',{name:/^Slack/}).count(),0);
  await addSearch.press('Escape');
  await plus.click();
  await addSearch.fill('manage connections');
  await page.getByRole('menuitem',{name:'Manage connections',exact:true}).click();
  await page.getByRole('dialog',{name:'Settings',exact:true}).filter({hasText:'connections'}).waitFor();
  await page.getByRole('button',{name:'Close intelligence menu',exact:true}).click({position:{x:5,y:5}});
  await plus.click();
  await page.evaluate(()=>window.switchChat());
  await draft.waitFor();
  assert.equal(await page.getByRole('menu').count(),0);
  assert.deepEqual(errors,[]);
});
