import assert from 'node:assert/strict';
import test from 'node:test';
import { clapBrowser } from './helpers/clap-browser.mjs';
import fs from 'node:fs';
import path from 'node:path';

test('real worklet, foreground handoff, composer targeting and automatic voice in a new tab', {timeout:60000}, async()=>{
 const h=await clapBrowser();
 try{
  let page=await h.context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(h.url+'/new-tab?collapsed');await page.waitForFunction(()=>window.clapSnapshot?.().loaded);
  assert.equal(await page.evaluate(()=>window.captures.length),0,'disabled default never captures');
  assert.equal(await page.evaluate(()=>window.prepares),0,'detector settings do not prepare speech');
  await page.getByRole('switch',{name:/^(Clap|Finger-snap) controls$/}).click();
  await page.waitForFunction(()=>window.clapSnapshot().status==='listening');
  assert.equal(await page.evaluate(()=>window.captures.filter(c=>c.stream.getAudioTracks()[0].readyState==='live').length),1,'StrictMode has one live owner');
  await page.getByRole('button',{name:'Test claps',exact:true}).click();
  await page.waitForFunction(()=>window.clapSnapshot().status==='listening');
  await page.evaluate(()=>window.duplicateGesture=true);
  await page.evaluate(()=>window.emitClaps());await page.waitForFunction(()=>window.clapSnapshot().gestures===1);
  assert.equal(await page.evaluate(()=>window.prepares),0);assert.equal(h.fixture.executions,0);
  await page.getByRole('button',{name:'Finish test'}).click();
  await page.evaluate(()=>window.saveAction({prompt:'Open voice',action:{kind:'voice'}}));
  await page.waitForFunction(()=>window.clapSnapshot().status==='listening');const source=page;const popup=page.waitForEvent('popup');await page.evaluate(()=>window.emitClaps());page=await popup;
  await page.getByRole('dialog',{name:/voice/i}).waitFor();
  assert.equal(new URL(page.url()).pathname,'/voice');assert.equal(new URL(source.url()).pathname,'/new-tab');assert.deepEqual(await page.evaluate(()=>window.navigated),[]);assert.equal(await source.locator('[data-clap-indicator],.clap-notice').count(),0);
  await page.waitForFunction(()=>window.prepares===1);
  assert.equal(await page.evaluate(()=>window.greetings.length),0,'greeting waits for the selected provider');
  assert.equal(await page.evaluate(()=>window.captures.filter(c=>c.stream.getAudioTracks()[0].readyState==='live').length),0);
  await page.evaluate(()=>window.finishPrepare());
  await page.waitForFunction(()=>window.greetings.length===1&&Boolean(window.finishGreeting));
  assert.equal(await page.evaluate(()=>window.greetings[0].provider),'local');
  const qa=path.join(h.root,'.tmp-clap-controls-qa');fs.mkdirSync(qa,{recursive:true});
  await page.screenshot({path:path.join(qa,'voice-current-tab.png'),animations:'disabled'});
  assert.equal(await page.evaluate(()=>window.captures.filter(c=>c.stream.getAudioTracks()[0].readyState==='live').length),0,'greeting finishes before capture');
  await page.evaluate(()=>window.finishGreeting());
  await page.waitForFunction(()=>window.captures.some(c=>c.stream.getAudioTracks()[0].readyState==='live'));
  assert.deepEqual(await page.evaluate(()=>window.sent),[]);
  await page.getByRole('button',{name:'Close voice mode'}).click();
  await page.close();page=source;await page.bringToFront();await page.evaluate(()=>window.showChat(true));
  await page.waitForFunction(()=>window.clapSnapshot().status==='listening');
  await page.evaluate(()=>{window.showSecond(true);window.saveAction({prompt:'Dictate',action:{kind:'dictation'}})});
  await page.getByRole('textbox',{name:'Draft B'}).fill('Keep this draft.');
  await page.evaluate(()=>window.dispatchSpeech('dictation'));await page.waitForFunction(()=>window.prepares>=1);
  const count=await page.evaluate(()=>window.prepares);await page.evaluate(()=>window.dispatchSpeech('dictation'));
  assert.equal(await page.evaluate(()=>window.prepares),count,'starting dictation is idempotent');
  assert.equal(await page.getByRole('textbox',{name:'Draft A'}).inputValue(),'');
  assert.equal(await page.getByRole('textbox',{name:'Draft B'}).inputValue(),'Keep this draft.');
  // Unmount during preparation and then grant the stale operation: no draft mutation or live capture.
  await page.evaluate(()=>{window.showSecond(false);window.finishPrepare()});
  await page.waitForFunction(()=>window.clapSnapshot().status==='listening');
  await page.evaluate(()=>window.showSettings(false));
  assert.equal(await page.evaluate(()=>window.clapSnapshot().active),true,'closing settings retains explicit enable');
  await page.evaluate(()=>{history.pushState({},'', '/profile');window.dispatchEvent(new Event('test-route'));});
  assert.equal(await page.evaluate(()=>window.clapSnapshot().status),'listening','route changes preserve capture');
  await page.evaluate(async()=>{window.foreground=await window.requestForeground({audio:true})});
  assert.equal(await page.evaluate(()=>window.captures.filter(c=>c.stream.getAudioTracks()[0].readyState==='live').length),1,'ambient released before foreground grant');
  await page.evaluate(()=>window.stopForeground(window.foreground));await page.waitForFunction(()=>window.clapSnapshot().status==='listening');
  await page.evaluate(()=>window.savePreferences({...window.clapSnapshot().preferences,enabled:false},false));
  await page.waitForFunction(()=>window.captures.every(c=>c.stream.getAudioTracks()[0].readyState==='ended'));
  assert.deepEqual(errors,[]);
 } finally{await h.close();}
});

test('OpenAI greets in the conversation session and provider failure never uses system speech', {timeout:30000}, async()=>{
 const h=await clapBrowser();h.fixture.speechProvider='chatgpt';
 try{
  const page=await h.context.newPage();await page.goto(h.url+'/browser?collapsed');await page.waitForFunction(()=>window.clapSnapshot?.().loaded);
  await page.evaluate(()=>window.dispatchSpeech('voice'));await page.waitForFunction(()=>window.prepares===1);await page.evaluate(()=>window.finishPrepare());
  await page.waitForFunction(()=>window.greetings.length===1);
  assert.equal(await page.evaluate(()=>window.greetings[0].provider),'chatgpt');assert.equal(await page.evaluate(()=>window.voiceConnections),1);
  assert.equal(await page.evaluate(()=>window.voiceListening),false,'OpenAI microphone input muted during greeting');
  await page.evaluate(()=>window.finishGreeting());await page.waitForFunction(()=>window.voiceListening===true);
  assert.equal(h.fixture.requests.includes('/api/speech/synthesize'),false,'no Voicebox fallback from OpenAI');
  await page.getByRole('button',{name:'Close voice mode'}).click();await page.evaluate(()=>{window.failVoice=true;window.dispatchSpeech('voice')});
  await page.waitForFunction(()=>window.prepares===2);await page.evaluate(()=>window.finishPrepare());
  await page.getByText('Selected OpenAI voice unavailable',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.greetings.length),1);
  assert.equal(h.fixture.requests.includes('/api/speech/synthesize'),false);
  await page.getByRole('button',{name:'Close voice mode'}).click();h.fixture.speechProvider='local';h.fixture.voiceFailure=true;
  await page.evaluate(()=>window.dispatchSpeech('voice'));await page.waitForFunction(()=>window.prepares===3);await page.evaluate(()=>window.finishPrepare());
  await page.getByText('Selected Voicebox unavailable',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.voiceConnections),2,'Voicebox failure does not open OpenAI');
 }finally{await h.close();}
});

test('suspension, removed devices, hidden settings and peer refresh cannot execute a test gesture', {timeout:45000}, async()=>{
 const h=await clapBrowser();
 try{
  const page=await h.context.newPage();await page.goto(h.url+'/profile');await page.waitForFunction(()=>window.clapSnapshot?.().loaded);
  await page.getByRole('button',{name:'Test claps',exact:true}).click();await page.waitForFunction(()=>window.clapSnapshot().status==='listening');
  await page.evaluate(()=>{const peer=new BroadcastChannel('breadboard:clap-controls');peer.postMessage({userId:'1',type:'active',active:true});peer.close();});
  await page.evaluate(()=>window.emitClaps());await page.waitForFunction(()=>window.clapSnapshot().gestures===1);
  assert.equal(await page.evaluate(()=>window.clapSnapshot().mode),'test');assert.equal(await page.evaluate(()=>window.prepares),0);
  await page.evaluate(()=>window.worklets.at(-1).context.suspend());await page.waitForFunction(()=>window.clapSnapshot().status==='suspended');
  await page.evaluate(()=>window.worklets.at(-1).context.resume());await page.waitForFunction(()=>window.clapSnapshot().status==='listening');
  assert.equal(await page.evaluate(()=>window.clapSnapshot().meter.accepted),0,'resume clears onset/pattern state');
  await page.evaluate(()=>window.captures.at(-1).stream.getAudioTracks()[0].dispatchEvent(new Event('ended')));
  await page.waitForFunction(()=>window.clapSnapshot().status==='error');
  assert.match(await page.getByRole('alert').innerText(),/disconnected/);
  await page.evaluate(()=>window.showSettings(false));await page.waitForFunction(()=>window.clapSnapshot().mode==='actions');
  assert.equal(await page.evaluate(()=>window.clapSnapshot().active),false);
  assert.equal(await page.evaluate(()=>window.captures.every(c=>c.stream.getTracks().every(t=>t.readyState==='ended'))),true);
 }finally{await h.close();}
});

test('pending grants are cancelled, and notification/preview renderers cannot listen', {timeout:45000},async()=>{
 const h=await clapBrowser();
 try{
  const page=await h.context.newPage();await page.goto(h.url+'/profile');await page.waitForFunction(()=>window.clapSnapshot?.().loaded);
  await page.evaluate(()=>window.delayPermission=true);await page.getByRole('switch',{name:/^(Clap|Finger-snap) controls$/}).click();
  await page.waitForFunction(()=>Boolean(window.grantPermission));
  await page.getByRole('switch',{name:/^(Clap|Finger-snap) controls$/}).click();await page.evaluate(()=>window.grantPermission());
  await page.waitForFunction(()=>window.captures.length===1&&window.captures[0].stream.getAudioTracks()[0].readyState==='ended');
  await page.close();h.fixture.preferences={...h.fixture.preferences,enabled:true,resumeOnStartup:true};
  for(const path of ['/notification-overlay','/preview/example']){
   const surface=await h.context.newPage();await surface.goto(h.url+path);await surface.waitForFunction(()=>Boolean(window.clapSnapshot));
   await surface.waitForTimeout(300);assert.equal(await surface.evaluate(()=>window.captures.length),0,path);await surface.close();
  }
 } finally{await h.close();}
});
