// Run explicitly: node tests/buzz-browser-flow.mjs. Uses isolated accounts/SQLite.
// External agent/model execution is stubbed by the fixture; all room APIs are real.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import esbuild from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright-core';
import { createBuzzFixture } from './helpers/buzz-release-fixture.mjs';

const fixture=await createBuzzFixture();
const {root,call}=fixture;
const output=path.join(root,'node_modules/.cache/organization-release');
fs.mkdirSync(output,{recursive:true});
const bundle=await esbuild.build({absWorkingDir:root,stdin:{resolveDir:root,loader:'tsx',contents:`import React from 'react'; import {createRoot} from 'react-dom/client'; import BuzzClient from './src/app/buzz/buzz-client'; import {applyAppTheme} from './src/lib/app-theme'; window.pickTheme=applyAppTheme; createRoot(document.getElementById('root')).render(<BuzzClient {...window.PROPS} />);`},bundle:true,write:false,outdir:output,platform:'browser',format:'iife',jsx:'automatic',loader:{'.css':'empty'}});
const globalsPath=path.join(root,'src/app/globals.css');
const globals=await postcss([tailwind({base:root})]).process(fs.readFileSync(globalsPath,'utf8'),{from:globalsPath});
const font=fs.readFileSync(path.join(root,'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')).toString('base64');
const css=[globals.css,...['buzz-theme.css','ui/card-texture.css','buzz-host.css'].map(file=>fs.readFileSync(path.join(root,'src/app/buzz',file),'utf8')),...bundle.outputFiles.filter(file=>file.path.endsWith('.css')).map(file=>file.text),`@font-face{font-family:'Inter Variable';font-weight:100 900;src:url(data:font/woff2;base64,${font}) format('woff2')}`].join('\n');
const js=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text;
const errors=[];
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');const user=Number(req.headers['x-qa-user']||1);
    if(url.pathname==='/app.js'){res.setHeader('content-type','application/javascript');return res.end(js);}
    if(url.pathname==='/app.css'){res.setHeader('content-type','text/css');return res.end(css);}
    if(url.pathname.startsWith('/api/')){
      const m=url.pathname.match(/^\/api\/buzz\/rooms\/([^/]+)(?:\/(members|messages|threads)(?:\/(\d+))?)?$/);
      let key,params={};
      if(m){params.roomId=m[1];if(m[2]==='threads'){key='thread';params.messageId=m[3];}else if(m[2]==='members'){key=m[3]?'member':'members';params.memberId=m[3];}else if(m[2]==='messages'){key=m[3]?'message':'messages';params.messageId=m[3];}else key='room';}
      else key={'/api/buzz/rooms':'rooms','/api/buzz/inbox':'inbox','/api/buzz/people':'people','/api/buzz/search':'search','/api/organizations':'organizations','/api/organizations/invites':'invites'}[url.pathname];
      if(!key){res.setHeader('content-type','application/json');return res.end('{}');}
      let raw='';for await(const chunk of req)raw+=chunk;
      const result=await call(user,key,req.method,raw?JSON.parse(raw):undefined,params,url.search);
      res.statusCode=result.status;res.setHeader('content-type','application/json');return res.end(JSON.stringify(result.body));
    }
    const rails=(await call(user,'rooms')).body;
    const props={selfUserId:user,communities:rails.organizations,rooms:rails.rooms,personas:[],rosterReady:true,initialRoomId:url.searchParams.get('room')};
    res.setHeader('content-type','text/html');res.end(`<!doctype html><html data-theme="light"><head><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script>window.PROPS=${JSON.stringify(props).replaceAll('<','\\u003c')};document.documentElement.dataset.theme=localStorage.getItem('breadboard:theme')||'light';</script><script src="/app.js"></script></body></html>`);
  }catch(error){errors.push(error.message);res.statusCode=500;res.end(JSON.stringify({message:error.message}));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
let browser;
try {
  browser=await chromium.launch({headless:true,executablePath});
  const ownerContext=await browser.newContext({extraHTTPHeaders:{'x-qa-user':'1'},viewport:{width:1440,height:900},reducedMotion:'reduce'});
  const memberContext=await browser.newContext({extraHTTPHeaders:{'x-qa-user':'2'},viewport:{width:1440,height:900},reducedMotion:'reduce'});
  const owner=await ownerContext.newPage(), member=await memberContext.newPage();
  for(const page of [owner,member]){page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000);}
  await owner.goto(origin);
  await owner.getByRole('button',{name:'Create an organization',exact:true}).click();
  await owner.getByRole('dialog').getByRole('textbox').fill('Product team');
  await owner.getByRole('button',{name:'Create organization',exact:true}).click();
  await owner.getByRole('textbox',{name:'Message #general',exact:true}).waitFor();
  await owner.getByRole('button',{name:'New room',exact:true}).click();
  await owner.getByRole('dialog').getByPlaceholder('product-launch').fill('Launch');
  await owner.getByRole('button',{name:/Invite only/}).click();
  await owner.getByRole('dialog').getByRole('button',{name:/Create room|Open room/}).click();
  await owner.getByRole('textbox',{name:'Message #launch',exact:true}).waitFor();
  const rails=(await call(1,'rooms')).body;const room=rails.rooms.find(room=>room.slug==='launch');
  assert.ok(room);
  await owner.getByRole('button',{name:'Add someone',exact:true}).click();
  await owner.getByRole('textbox',{name:'Search people',exact:true}).fill('ben');
  await owner.getByRole('button',{name:'ben',exact:true}).click();
  await owner.getByText(/Invited ben/).waitFor();
  await member.goto(origin);
  await member.getByRole('button',{name:'Accept',exact:true}).click();
  await member.getByRole('button',{name:'Launch',exact:true}).click();
  const memberBox=member.getByRole('textbox',{name:'Message #launch',exact:true});
  await memberBox.waitFor();
  assert.equal(await member.getByRole('button',{name:'Room settings',exact:true}).count(),0);
  assert.equal(await member.getByRole('button',{name:'Add someone',exact:true}).count(),0);
  await memberBox.fill('A draft that survives reload');
  await member.goto(`${origin}/?room=${room.publicId}`);
  await memberBox.waitFor();assert.equal(await memberBox.inputValue(),'A draft that survives reload');
  let failSend=true;
  await member.route('**/api/buzz/rooms/*/messages',async route=>{
    if(route.request().method()==='POST'&&failSend){failSend=false;return route.abort('internetdisconnected');}return route.continue();
  });
  await member.getByRole('button',{name:'Send message',exact:true}).click();
  await member.getByRole('button',{name:'Retry sending message',exact:true}).waitFor();
  await member.goto(`${origin}/?room=${room.publicId}`);
  await member.getByRole('button',{name:'Retry sending message',exact:true}).click();
  await member.getByText('Agent answer for account 2',{exact:true}).waitFor();
  assert.equal((await call(2,'messages','GET',undefined,{roomId:room.publicId})).body.messages.filter(row=>row.body==='A draft that survives reload').length,1);
  const humanId=await member.locator('[data-testid="message-row"]').filter({hasText:'A draft that survives reload'}).getAttribute('data-message-id');
  const humanRow=member.locator(`[data-message-id="${humanId}"]`);
  await humanRow.hover();await humanRow.getByRole('button',{name:'React 👍',exact:true}).click();
  await humanRow.hover();await humanRow.getByRole('button',{name:'Edit message',exact:true}).click();
  await humanRow.getByRole('textbox').fill('Edited team message');await humanRow.getByRole('button',{name:'Save',exact:true}).click();
  const edited=member.locator('[data-testid="message-row"]').filter({hasText:'Edited team message'});
  await edited.hover();await edited.getByRole('button',{name:'Reply in thread',exact:true}).click();
  const thread=member.getByRole('complementary',{name:'Thread',exact:true});
  await thread.getByRole('textbox').fill('Thread reply survives');await thread.getByRole('button',{name:'Send message',exact:true}).click();
  await thread.getByText('Thread reply survives',{exact:true}).waitFor();
  await thread.getByText('Agent answer for account 2',{exact:true}).waitFor();
  await owner.goto(`${origin}/?room=${room.publicId}`);
  await owner.getByRole('button',{name:'Add an agent',exact:true}).click();
  await owner.getByRole('textbox',{name:'Search agents',exact:true}).fill('Deep Research');
  await owner.getByRole('button',{name:/^Deep Research/}).click();
  await owner.getByText('@deep-research',{exact:true}).waitFor();
  await owner.getByRole('textbox',{name:'Message #launch',exact:true}).fill('@deep-research Research release criteria');
  await owner.getByRole('button',{name:'Send message',exact:true}).click();
  await owner.getByText('Native agent answer for account 1',{exact:true}).waitFor();
  await owner.goto(`${origin}/?room=${room.publicId}`);
  await owner.getByText('Native agent answer for account 1',{exact:true}).waitFor();
  await owner.screenshot({path:path.join(output,'light.png')});
  await owner.evaluate(()=>window.pickTheme('dark'));
  await owner.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  await owner.screenshot({path:path.join(output,'dark.png')});
  await owner.setViewportSize({width:640,height:850});
  await owner.getByRole('button',{name:'Room members',exact:true}).click();
  await owner.getByRole('complementary',{name:'Members',exact:true}).waitFor();
  assert.ok(await owner.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await owner.screenshot({path:path.join(output,'narrow.png')});
  await owner.getByRole('button',{name:'Close members panel',exact:true}).click();
  await owner.getByRole('button',{name:'Toggle room navigation',exact:true}).click();
  await owner.getByRole('button',{name:'general',exact:true}).click();
  await owner.getByRole('textbox',{name:'Message #general',exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,flow:'Two accounts; create/invite/accept/private room; permissions; draft/reload; offline retry/reload; reaction/edit; thread/agent; direct native agent/reload; light/dark/narrow navigation',runtime:'stubbed at execution boundary',screenshots:output}));
} catch(error) { if(browser){for(const context of browser.contexts())for(const [index,page] of context.pages().entries())await page.screenshot({path:path.join(output,`failure-${context===browser.contexts()[0]?'owner':'member'}-${index}.png`)}).catch(()=>{});}throw error; }
finally {await browser?.close();await new Promise(resolve=>server.close(resolve));fixture.close();}
