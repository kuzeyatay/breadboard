import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import esbuild from 'esbuild';
import { chromium } from 'playwright';

test('detached voice uses its originating chat and never creates a session of its own', { timeout: 45_000 }, async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const bundle = await esbuild.build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React,{useMemo,useRef,useState} from 'react';import{createRoot}from'react-dom/client';
      import {useVoiceChatHost} from './src/app/components/use-voice-chat-host';
      import Speech from './src/app/components/speech-dictation-button';
      import VoicePage from './src/app/voice/page';
      import VoiceShortcut from './src/app/components/voice-shortcut';
      window.sent=[];window.newSessions=0;window.commands=[];
      if(location.search.includes('desktop'))window.breadboardDesktop={
        tabs:async command=>{window.commands.push(command);return true;},
        getTabsState:async()=>({enabled:true,tabs:[]}),onTabsState:()=>()=>{}
      };
      if(location.search.includes('native'))window.voiceCompanion={
        state:async()=>false,conversation:async()=>null,onOpen:callback=>{window.nativeOpen=callback;return()=>{};},close:async()=>{}
      };
      function Host(){
        const [id,setId]=useState(location.search.includes('blank')?null:'chat-a');
        const [created,setCreated]=useState(null),[scope,setScope]=useState('garden-a');
        const [messages,setMessages]=useState(id?[{role:'user',content:'Earlier question in chat A'},{role:'assistant',content:'Earlier answer in chat A'}]:[]);
        const [busy,setBusy]=useState(false),[clarification,setClarification]=useState(null);
        const element=useRef(null);
        const snapshot=useMemo(()=>({messages,busy,clarification}),[messages,busy,clarification]);
        const key=useVoiceChatHost({identity:id,createdIdentity:created,scope,element,snapshot,onSend:text=>{
          const chat=id??'created-in-origin';
          if(!id){setCreated(chat);setId(chat);}
          window.sent.push({chat,model:'source-model',text});
          setMessages(current=>[...current,{role:'user',content:text},{role:'assistant',content:'Answer in '+chat}]);
        }});
        window.linkKey=key;
        window.switchChat=()=>{setCreated(null);setId('chat-b');setMessages([{role:'assistant',content:'Chat B history'}]);};
        window.switchScope=()=>setScope('garden-b');
        window.askQuestion=()=>{setBusy(true);setClarification({requestId:'question-a',question:'Which option?'});};
        return <><textarea ref={element} aria-label="Original composer"/><Speech value="" onChange={()=>{}} textareaRef={element}
          placement="below" onOpenVoiceMode={()=>{}} voiceChatKey={key}/><VoiceShortcut/></>;
      }
      createRoot(document.getElementById('root')).render(location.pathname==='/voice'?<VoicePage/>:<Host/>);
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'linked-voice-fixture', setup(build) {
      const stubs = {
        'voice-conversation-overlay': `import React from 'react';export default function Voice(props){return props.open?<section>
          <div data-transcript>{props.messages.map(m=>m.content).join('|')}</div><div data-busy>{String(props.busy)}</div>
          <div data-question>{props.clarification?.question}</div>
          <button onClick={()=>props.onSend('Spoken follow-up')}>Send spoken turn</button>
          <button onClick={props.onClose}>Close voice mode</button></section>:null;}`,
        'use-agent-session': `export function useAgentSession(){window.newSessions++;throw Error('Detached voice must not create a separate session');}export const isActiveAgentRunState=()=>false;`,
        'use-assistant-intelligence': 'export const useAssistantIntelligence=()=>({})',
        'voice-assistant-runtime': 'export default function(){return null}',
        'chat-notification-inbox': 'export function setActiveChatNotificationTarget(){}',
        'music-recognition-button': 'export default function(){return null}',
      };
      build.onResolve({ filter: /.*/ }, args => {
        const key = args.path.split('/').at(-1);
        return key in stubs ? { path: key, namespace: 'fixture' } : null;
      });
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'tsx', resolveDir: root }));
    } }],
  });
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/app.js' ? bundle.outputFiles[0].text : '<!doctype html><html><body style="padding:80px"><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1100, height: 750 } });
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const host = await context.newPage();
  async function openMenu(suffix = '') {
    await host.goto(origin + '/' + suffix);
    await host.waitForFunction(() => Boolean(window.linkKey));
    await host.getByRole('button', { name: 'Voice options — double-tap to talk to the assistant' }).click();
    await host.getByRole('menuitem', { name: 'Talk to the assistant', exact: false }).click({ button: 'right' });
  }
  for (const label of ['Open in new tab', 'Open in new window']) {
    await openMenu();
    const key = await host.evaluate(() => window.linkKey);
    const popup = host.waitForEvent('popup');
    await host.getByRole('menuitem', { name: label, exact: true }).click();
    const voice = await popup;
    assert.equal(new URL(voice.url()).searchParams.get('chat'), key);
    await voice.getByText('Earlier question in chat A|Earlier answer in chat A', { exact: true }).waitFor();
    await voice.getByRole('button', { name: 'Send spoken turn' }).click();
    await host.waitForFunction(() => window.sent.length === 1);
    assert.deepEqual(await host.evaluate(() => window.sent), [{ chat: 'chat-a', model: 'source-model', text: 'Spoken follow-up' }]);
    await voice.waitForFunction(() => document.querySelector('[data-transcript]').textContent.includes('Answer in chat-a'));
    await host.evaluate(() => window.askQuestion());
    await voice.getByText('Which option?', { exact: true }).waitFor();
    assert.equal(await voice.locator('[data-busy]').textContent(), 'true');
    assert.equal(await voice.evaluate(() => window.newSessions), 0);
    await host.evaluate(() => window.switchChat());
    await voice.getByRole('alert').waitFor();
    assert.equal(await voice.getByRole('button', { name: 'Send spoken turn' }).count(), 0);
    assert.equal(await host.evaluate(() => window.sent.length), 1);
    await voice.close();
  }
  // A blank chat is created by its original composer, retaining the same link.
  await openMenu('?blank');
  const key = await host.evaluate(() => window.linkKey);
  const voice = await context.newPage();
  await voice.goto(origin + '/voice?view=full&chat=' + key);
  await voice.getByRole('button', { name: 'Send spoken turn' }).click();
  await voice.waitForFunction(() => document.querySelector('[data-transcript]').textContent.includes('Answer in created-in-origin'));
  assert.equal(await host.evaluate(() => window.linkKey), key);
  await voice.getByRole('button', { name: 'Send spoken turn' }).click();
  await host.waitForFunction(() => window.sent.length === 2);
  assert.deepEqual(await host.evaluate(() => window.sent.map(turn => turn.chat)), ['created-in-origin', 'created-in-origin']);
  await host.evaluate(() => window.switchScope());
  await voice.getByRole('alert').waitFor();
  await voice.close();

  // Native windows receive the identical link through the desktop bridge.
  await openMenu('?desktop');
  const nativeKey = await host.evaluate(() => window.linkKey);
  await host.getByRole('menuitem', { name: 'Open in new window', exact: true }).click();
  assert.deepEqual(await host.evaluate(() => window.commands), [{ type: 'voice-open', conversationKey: nativeKey }]);
  // The global shortcut on a page showing a chat uses that same host as well.
  await host.getByRole('button', { name: 'Voice', exact: true }).click();
  assert.deepEqual(await host.evaluate(() => window.commands.at(-1)), { type: 'voice-open', conversationKey: nativeKey });
  const native = await context.newPage();
  await native.goto(origin + '/voice?native');
  await native.waitForFunction(() => Boolean(window.nativeOpen));
  await native.evaluate(key => window.nativeOpen(true, key), nativeKey);
  await native.getByText('Earlier question in chat A|Earlier answer in chat A', { exact: true }).waitFor();
  await native.getByRole('button', { name: 'Send spoken turn' }).click();
  await host.waitForFunction(() => window.sent.length === 1);
  assert.equal(await native.evaluate(() => window.newSessions), 0);
  await host.close();
  await native.getByRole('alert').waitFor();
  assert.equal(await native.evaluate(() => window.newSessions), 0);
  assert.deepEqual(errors, []);
});
