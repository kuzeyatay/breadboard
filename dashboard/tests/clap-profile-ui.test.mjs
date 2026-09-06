import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { clapBrowser } from './helpers/clap-browser.mjs';

async function desktopFixture(context) {
 await context.addInitScript(() => {
  const selfId=Number(new URL(location.href).searchParams.get('owner')||1),listeners=new Set();
  window.desktopState={enabled:true,selfId,activeId:selfId,windowFocused:true,tabs:[],extensions:[]};
  window.desktopCommands=[];
  window.setDesktopState=patch=>{Object.assign(window.desktopState,patch);for(const listener of listeners)listener({...window.desktopState});};
  window.breadboardDesktop={getTabsState:async()=>({...window.desktopState}),onTabsState:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},tabs:async command=>{window.desktopCommands.push(command);return true;}};
 });
}

test('parallel listening switches save independently, roll back on failure, and survive reload', {timeout:30000}, async()=>{
 const h=await clapBrowser();
 try{
  const page=await h.context.newPage();page.setDefaultTimeout(5000);
  await page.goto(h.url+'/profile?profile&snaps');await page.waitForFunction(()=>window.clapSnapshot?.().loaded);
  const clap=page.locator('#clap-controls').getByRole('switch',{name:'Keep listening in parallel'});
  const snap=page.locator('#snap-controls').getByRole('switch',{name:'Keep listening in parallel'});
  assert.equal(await clap.getAttribute('aria-checked'),'false');assert.equal(await snap.getAttribute('aria-checked'),'false');
  h.fixture.failSave=true;await snap.click();await page.getByRole('alert').filter({hasText:'Could not save preferences'}).waitFor();
  assert.equal(await snap.getAttribute('aria-checked'),'false');assert.equal(h.fixture.snapPreferences.allowConcurrentListening,false);
  h.fixture.failSave=false;await snap.click();await page.waitForFunction(()=>window.clapSnapshot().snapPreferences.allowConcurrentListening);
  assert.equal(h.fixture.preferences.allowConcurrentListening,false);
  await page.reload();await page.waitForFunction(()=>window.clapSnapshot?.().loaded);
  assert.equal(await snap.getAttribute('aria-checked'),'true');assert.equal(await clap.getAttribute('aria-checked'),'false');
  await clap.click();await page.waitForFunction(()=>window.clapSnapshot().preferences.allowConcurrentListening);
  await snap.click();await page.waitForFunction(()=>!window.clapSnapshot().snapPreferences.allowConcurrentListening);
  assert.equal(h.fixture.preferences.allowConcurrentListening,true);assert.equal(h.fixture.snapPreferences.allowConcurrentListening,false);
  assert.equal(await page.evaluate(()=>window.captures.length),0,'changing the restriction does not start a disabled listener');
 }finally{await h.close();}
});

test('parallel snaps share foreground audio and run in the background while restricted claps pause', {timeout:45000}, async()=>{
 const h=await clapBrowser();
 h.fixture.preferences={...h.fixture.preferences,enabled:true,resumeOnStartup:true};
 h.fixture.snapPreferences={...h.fixture.snapPreferences,enabled:true,resumeOnStartup:true,allowConcurrentListening:true};
 h.fixture.snapAction={prompt:'Open my calendar',action:{kind:'page',page:'calendar'}};
 try{
  await desktopFixture(h.context);const page=await h.context.newPage();page.setDefaultTimeout(5000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(h.url+'/profile?profile&snaps');await page.waitForFunction(()=>window.clapSnapshot?.().status==='listening');
  await page.evaluate(async()=>{window.foreground=await window.requestForeground({audio:true});});
  await page.waitForFunction(()=>window.clapSnapshot().status==='listening'&&window.clapSnapshot().pauseReason==='Paused during other audio');
  assert.equal(await page.locator('#clap-controls .clap-status').innerText(),'Paused during other audio');
  assert.equal(await page.locator('#snap-controls .clap-status').innerText(),'Listening');
  assert.equal(await page.evaluate(()=>window.captures.filter(c=>c.stream.getTracks()[0].readyState==='live').length),2,'recording and gesture capture can coexist');
  await page.evaluate(()=>window.setDesktopState({activeId:2,windowFocused:false}));
  await page.waitForFunction(()=>window.clapSnapshot().status==='listening'&&window.clapSnapshot().pauseReason?.includes('inactive'));
  const time=await page.evaluate(()=>window.clapSnapshot().snapMeter.audioTime);
  await page.evaluate(()=>window.emitClaps('clap'));await page.waitForFunction(at=>window.clapSnapshot().snapMeter.audioTime>at+1700,time);
  assert.equal(await page.evaluate(()=>window.clapSnapshot().gestures),0);assert.equal(await page.evaluate(()=>window.desktopCommands.length),0);
  await page.evaluate(()=>window.emitClaps('snap'));await page.waitForFunction(()=>window.desktopCommands.length===1);
  assert.equal(await page.evaluate(()=>window.desktopCommands[0].type),'open');assert.match(await page.evaluate(()=>window.desktopCommands[0].url),/\/plan\?view=calendar$/);
  await page.waitForFunction(()=>window.clapSnapshot().status==='listening');
  const snapSwitch=page.locator('#snap-controls').getByRole('switch',{name:'Keep listening in parallel'});
  await snapSwitch.click();await page.waitForFunction(()=>!window.clapSnapshot().snapPreferences.allowConcurrentListening&&window.captures.filter(c=>c.gestureCapture).every(c=>c.stream.getTracks()[0].readyState==='ended'));
  assert.equal(await page.evaluate(()=>window.foreground.getTracks()[0].readyState),'live','turning off parallel listening preserves the foreground recorder');
  await page.evaluate(()=>{window.stopForeground(window.foreground);window.setDesktopState({activeId:1,windowFocused:true});});
  await page.waitForFunction(()=>window.clapSnapshot().status==='listening'&&!window.clapSnapshot().pauseReason&&!window.clapSnapshot().snapPauseReason);
  assert.equal(await page.evaluate(()=>window.captures.filter(c=>c.stream.getTracks()[0].readyState==='live').length),1);
  await snapSwitch.click();await page.waitForFunction(()=>window.clapSnapshot().snapPreferences.allowConcurrentListening);
  await page.evaluate(()=>{window.releasePlayback=window.holdAudio();});
  await page.locator('#snap-controls').getByRole('button',{name:'Test snaps',exact:true}).click();
  await page.waitForFunction(()=>window.clapSnapshot().status==='listening');
  await page.evaluate(()=>window.emitClaps('snap'));await page.waitForFunction(()=>window.clapSnapshot().snapGestures===1);
  assert.equal(await page.evaluate(()=>window.desktopCommands.length),1,'parallel test mode never dispatches the action');
  await page.evaluate(()=>window.releasePlayback());
  assert.deepEqual(errors,[]);
 }finally{await h.close();}
});

test('parallel ownership moves to the foreground and falls back to one background detector', {timeout:30000}, async()=>{
 const h=await clapBrowser();h.fixture.preferences={...h.fixture.preferences,enabled:true,resumeOnStartup:true,allowConcurrentListening:true};
 try{
  await desktopFixture(h.context);const a=await h.context.newPage();a.setDefaultTimeout(5000);
  await a.goto(h.url+'/profile?profile&owner=1');await a.waitForFunction(()=>window.clapSnapshot?.().status==='listening');
  await a.evaluate(()=>window.setDesktopState({windowFocused:false}));
  const b=await h.context.newPage();b.setDefaultTimeout(5000);await b.goto(h.url+'/profile?profile&owner=2');
  await b.waitForFunction(()=>window.clapSnapshot?.().status==='listening');
  await a.waitForFunction(()=>window.captures.every(c=>c.stream.getTracks()[0].readyState==='ended'));
  assert.equal(await a.locator('#clap-controls .clap-status').innerText(),'Listening in another tab or window');
  await b.close();await a.waitForFunction(()=>window.clapSnapshot().status==='listening');
  assert.equal(await a.evaluate(()=>window.captures.filter(c=>c.stream.getTracks()[0].readyState==='live').length),1);
  await a.locator('#clap-controls').getByRole('switch',{name:'Keep listening in parallel'}).click();
  await a.waitForFunction(()=>window.clapSnapshot().status==='paused'&&window.captures.every(c=>c.stream.getTracks()[0].readyState==='ended'));
  await a.evaluate(()=>window.setDesktopState({windowFocused:true}));await a.waitForFunction(()=>window.clapSnapshot().status==='listening');
 }finally{await h.close();}
});

test('profile saves actions directly, calibrates locally, and reviews workflows without running', {timeout:45000},async()=>{
 const h=await clapBrowser();
 try{
  const page=await h.context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(h.url+'/profile?profile');await page.waitForFunction(()=>window.clapSnapshot?.().loaded);
  assert.match(await page.locator('[data-clap-current]').innerText(),/dictation/);
  await page.getByRole('button',{name:'Open my calendar',exact:true}).click();
  h.fixture.failSave=true;await page.getByRole('button',{name:'Save action'}).click();
  await page.getByRole('alert').filter({hasText:'Could not save preferences'}).waitFor();assert.equal(h.fixture.action.action.kind,'dictation');
  h.fixture.failSave=false;await page.getByRole('button',{name:'Save action'}).click();
  await page.waitForFunction(()=>window.clapSnapshot().action.action.kind==='page');
  assert.equal(h.fixture.action.action.page,'calendar');assert.equal(h.fixture.requests.some(url=>url.includes('/interpret')),false);assert.equal(h.fixture.executions,0,'setting the prompt does not run it');
  await page.getByRole('button',{name:'Calibrate',exact:true}).click();await page.waitForFunction(()=>window.clapSnapshot().status==='listening');
  await page.waitForFunction(()=>window.clapSnapshot().meter?.audioTime>2200);
  await page.evaluate(()=>window.emitClaps());await page.waitForFunction(()=>window.clapSnapshot().gestures===1);
  assert.deepEqual(await page.evaluate(()=>window.navigated),[]);assert.equal(h.fixture.executions,0);assert.equal(await page.evaluate(()=>window.prepares),0);
  await page.getByRole('button',{name:'Finish test'}).click();
  await page.getByRole('combobox',{name:'Action',exact:true}).selectOption('workflow');
  await page.getByRole('combobox',{name:'Saved workflow'}).selectOption('wf_example');
  await page.waitForFunction(()=>window.clapSnapshot().action.action.kind==='workflow');
  await page.getByRole('switch',{name:/^(Clap|Finger-snap) controls$/}).click();await page.waitForFunction(()=>window.clapSnapshot().status==='listening');
  const workflowTabPromise=page.waitForEvent('popup');await page.evaluate(()=>window.emitClaps());const workflowTab=await workflowTabPromise;await workflowTab.waitForLoadState();
  assert.match(workflowTab.url(),/\/workflows\?workflow=wf_example&clapReview=1$/);assert.equal(h.fixture.executions,0);await workflowTab.close();await page.bringToFront();
  await page.evaluate(()=>window.savePreferences({...window.clapSnapshot().preferences,enabled:false},false));
  await page.getByRole('textbox',{name:'When I clap…'}).fill('Do something');await page.getByRole('button',{name:'Save action'}).click();
  await page.getByRole('status').filter({hasText:'Saved.'}).waitFor();assert.deepEqual(h.fixture.action.action,{kind:'assistant',prompt:'Do something'});
  const qa=path.join(h.root,'.tmp-clap-controls-qa');fs.mkdirSync(qa,{recursive:true});
  await page.evaluate(()=>{history.pushState({},'', '/profile?profile');window.dispatchEvent(new Event('test-route'));});
  await page.evaluate(()=>window.showChat(false));
  await page.screenshot({path:path.join(qa,'profile-light.png'),fullPage:true});
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.screenshot({path:path.join(qa,'profile-dark.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(qa,'profile-mobile.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
 }finally{await h.close();}
});

test('clap and snap AI instructions persist and dispatch directly once per detected gesture', {timeout:45000},async()=>{
 const h=await clapBrowser();
 try{
  const page=await h.context.newPage();page.setDefaultTimeout(5000);
  const instructions={clap:'Open my calendar in Breadboard and summarize tomorrow',snap:'Open Notepad and write the current date'};
  for(const control of ['clap','snap']){
   await page.goto(h.url+'/profile?profile&snaps');await page.waitForFunction(()=>window.clapSnapshot?.().loaded);
   const panel=page.locator(`#${control}-action`),settings=page.locator(`#${control}-controls`);
   await panel.getByRole('textbox').fill(instructions[control]);await panel.getByRole('button',{name:'Save action'}).click();
   await panel.getByRole('status').filter({hasText:'Saved.'}).waitFor();
   const row=control==='clap'?'action':'snapAction';
   assert.deepEqual(h.fixture[row].action,{kind:'assistant',prompt:instructions[control]});
   assert.equal(h.fixture.executions,control==='clap'?0:1,'configuration never starts an AI task');
   await page.reload();await page.waitForFunction(()=>window.clapSnapshot?.().loaded);
   assert.equal(await panel.getByRole('textbox').inputValue(),instructions[control]);
   await settings.getByRole('button',{name:control==='clap'?'Test claps':'Test snaps',exact:true}).click();
   await page.waitForFunction(()=>window.clapSnapshot().status==='listening');
   await page.evaluate(c=>window.emitClaps(c),control);await page.waitForFunction(c=>window.clapSnapshot()[c==='clap'?'gestures':'snapGestures']===1,control);
   assert.equal(h.fixture.executions,control==='clap'?0:1,'test mode never dispatches the saved AI instruction');
   await settings.getByRole('switch',{name:/^(Clap|Finger-snap) controls$/}).click();
   await page.waitForFunction(()=>window.clapSnapshot().status==='listening'&&window.clapSnapshot().mode==='actions');
   const destinationPromise=page.waitForEvent('popup');await page.evaluate(c=>window.emitClaps(c),control);const destination=await destinationPromise;await destination.waitForFunction(()=>window.navigated.length===1);
   assert.equal(h.fixture.executions,control==='clap'?1:2);
   assert.equal(h.fixture.executionBodies.at(-1).control,control);
   assert.deepEqual(h.fixture.executionBodies.at(-1).expectedAction,{kind:'assistant',prompt:instructions[control]});
   assert.equal(h.fixture.executionBodies.at(-1).confirmed,undefined);
   assert.equal(await page.getByRole('dialog',{name:'Review clap request'}).count(),0);
   assert.equal(await destination.evaluate(()=>window.navigated[0]),'/dashboard?terminalChat=conv_gesture_test');assert.equal(await destination.locator('.clap-notice').count(),0);await destination.close();await page.bringToFront();
   await page.evaluate(async c=>{const p=window.clapSnapshot()[c==='snap'?'snapPreferences':'preferences'];await window.savePreferences({...p,enabled:false},false,c);},control);
  }
  assert.deepEqual(h.fixture.action.action,{kind:'assistant',prompt:instructions.clap});
  assert.deepEqual(h.fixture.snapAction.action,{kind:'assistant',prompt:instructions.snap});
 }finally{await h.close();}
});

test('clap preference controls save, recover from a rejected save, and survive a reload', {timeout:30000},async()=>{
 const h=await clapBrowser();h.fixture.preferences={...h.fixture.preferences,deviceId:'saved-microphone'};
 try{
  const page=await h.context.newPage();page.setDefaultTimeout(5000);await page.goto(h.url+'/profile?profile');await page.waitForFunction(()=>window.clapSnapshot?.().loaded);
  const controls=page.locator('#clap-controls'),gesture=controls.getByRole('combobox',{name:'Gesture',exact:true});
  h.fixture.failSave=true;await gesture.selectOption('single');
  await controls.getByRole('alert').filter({hasText:'Could not save preferences'}).waitFor();
  assert.equal(await gesture.inputValue(),'double');assert.equal(h.fixture.preferences.pattern,'double');
  h.fixture.failSave=false;await gesture.selectOption('single');await page.waitForFunction(()=>window.clapSnapshot().preferences.pattern==='single');
  assert.equal(await controls.getByRole('alert').count(),0);
  await controls.getByRole('combobox',{name:'Microphone',exact:true}).selectOption('');await page.waitForFunction(()=>window.clapSnapshot().preferences.deviceId==='');
  await controls.getByRole('slider').press('ArrowRight');await page.waitForFunction(()=>window.clapSnapshot().preferences.sensitivity===.6);
  await controls.getByRole('checkbox',{name:'Resume listening when Breadboard starts'}).check();await page.waitForFunction(()=>window.clapSnapshot().preferences.resumeOnStartup);
  assert.equal(h.fixture.preferences.pattern,'single');assert.equal(h.fixture.preferences.deviceId,'');assert.equal(h.fixture.preferences.sensitivity,.6);assert.equal(h.fixture.preferences.resumeOnStartup,true);
  await page.reload();await page.waitForFunction(()=>window.clapSnapshot?.().loaded);
  assert.equal(await gesture.inputValue(),'single');assert.equal(await controls.getByRole('combobox',{name:'Microphone',exact:true}).inputValue(),'');
  assert.equal(await controls.getByRole('slider').inputValue(),'60');assert.equal(await controls.getByRole('checkbox',{name:'Resume listening when Breadboard starts'}).isChecked(),true);
  assert.equal(await page.evaluate(()=>window.captures.length),0,'saving settings does not enable listening');
 }finally{await h.close();}
});

test('cross-window owner lease prevents duplicate capture and yields to foreground audio', {timeout:30000},async()=>{
 const h=await clapBrowser();h.fixture.preferences={...h.fixture.preferences,enabled:true,resumeOnStartup:true};
 try{
  const a=await h.context.newPage();await a.goto(h.url+'/profile');await a.waitForFunction(()=>window.clapSnapshot?.().status==='listening');
  const b=await h.context.newPage();await b.goto(h.url+'/profile');await b.waitForFunction(()=>window.clapSnapshot?.().loaded);
  const live=p=>p.evaluate(()=>window.captures.filter(c=>c.stream.getAudioTracks()[0].readyState==='live').length);
  assert.equal(await live(a)+await live(b),1);
  await b.evaluate(async()=>{window.foreground=await window.requestForeground({audio:true})});
  assert.equal(await live(a),0);assert.equal(await live(b),1);
  await b.evaluate(()=>window.stopForeground(window.foreground));
  await b.getByRole('switch',{name:/^(Clap|Finger-snap) controls$/}).click();
  await a.waitForFunction(()=>window.clapSnapshot().active===false);
  await a.waitForFunction(()=>window.captures.every(c=>c.stream.getAudioTracks()[0].readyState==='ended'));
  await b.waitForFunction(()=>window.captures.every(c=>c.stream.getAudioTracks()[0].readyState==='ended'));
 }finally{await h.close();}
});

test('Profile gesture switches retain independent listening, Spotify default, prompt action and action-free test', {timeout:45000},async()=>{
 const h=await clapBrowser();
 try{
  const page=await h.context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(h.url+'/profile?profile&snaps');await page.waitForFunction(()=>window.clapSnapshot?.().loaded);
  const clap=page.locator('#clap-controls'),snap=page.locator('#snap-controls'),prompt=page.locator('#snap-action');
  assert.equal(await clap.locator('header').getByRole('switch',{name:'Clap controls',checked:false}).count(),1);
  assert.equal(await snap.locator('header').getByRole('switch',{name:'Finger-snap controls',checked:false}).count(),1);
  assert.equal(await page.getByRole('button',{name:/^(Start|Stop) listening$/}).count(),0);
  assert.equal(await snap.locator('.clap-status').evaluate(el=>getComputedStyle(el).position),'absolute','ordinary status does not occupy space beside the switch');
  assert.equal(await snap.locator('.clap-status').innerText(),'Off');
  assert.match(await page.locator('[data-snap-current]').innerText(),/Snap by manifest/);
  assert.equal(await snap.getByRole('combobox',{name:'Gesture',exact:true}).inputValue(),'single');
  assert.equal(await page.evaluate(()=>window.captures.length),0);
  await snap.getByRole('button',{name:'Test snaps',exact:true}).click();await page.waitForFunction(()=>window.clapSnapshot().status==='listening');
  await page.evaluate(()=>window.emitClaps('snap'));await page.waitForFunction(()=>window.clapSnapshot().snapGestures===1);
  assert.equal(h.fixture.executions,0);assert.equal(await page.evaluate(()=>window.prepares),0);
  h.fixture.failSave=true;
  await snap.getByRole('switch',{name:/^(Clap|Finger-snap) controls$/}).click();
  await snap.getByRole('alert').filter({hasText:'Could not save preferences'}).waitFor();
  assert.equal(await page.evaluate(()=>window.clapSnapshot().snapActive),false);
  h.fixture.failSave=false;
  await snap.getByRole('button',{name:'Test snaps',exact:true}).click();
  await snap.getByRole('switch',{name:/^(Clap|Finger-snap) controls$/}).click();await page.waitForFunction(()=>window.clapSnapshot().status==='listening'&&window.clapSnapshot().mode==='actions');
  assert.equal(await snap.getByRole('alert').count(),0);
  const musicTabPromise=page.waitForEvent('popup');await page.evaluate(()=>window.emitClaps('snap'));const musicTab=await musicTabPromise;await musicTab.waitForFunction(()=>!location.search.includes('gestureRun'));
  await new Promise(resolve=>setTimeout(resolve,300));assert.equal(h.fixture.executions,1);assert.match(musicTab.url(),/new-tab\?panel=spotify/);assert.equal(await musicTab.locator('.clap-notice,[data-clap-indicator]').count(),0);await musicTab.close();await page.bringToFront();
  assert.equal(h.fixture.executionBodies[0].control,'snap');assert.equal(h.fixture.executionBodies[0].expectedAction.trackUri,'spotify:track:4EsRpVBBKiqOZ67DJj0QHF');
  assert.equal(h.fixture.preferences.enabled,false,'snap enable does not enable claps');
  await clap.getByRole('switch',{name:/^(Clap|Finger-snap) controls$/}).click();await page.waitForFunction(()=>window.clapSnapshot().status==='listening');
  assert.equal(await page.evaluate(()=>window.captures.filter(c=>c.stream.getTracks()[0].readyState==='live').length),1,'two enabled controls share a microphone');
  await snap.getByRole('switch',{name:/^(Clap|Finger-snap) controls$/}).click();await page.waitForFunction(()=>window.clapSnapshot().status==='listening');
  assert.equal(await page.evaluate(()=>window.clapSnapshot().active),true,'snap off preserves claps');
  await clap.getByRole('switch',{name:/^(Clap|Finger-snap) controls$/}).click();await page.waitForFunction(()=>window.captures.every(c=>c.stream.getTracks()[0].readyState==='ended'));
  assert.equal(h.fixture.snapPreferences.enabled,false);assert.equal(h.fixture.preferences.enabled,false);
  await prompt.getByRole('button',{name:'Open my calendar',exact:true}).click();await prompt.getByRole('button',{name:'Save action'}).click();
  await page.waitForFunction(()=>window.clapSnapshot().snapAction.action.kind==='page');
  assert.equal(h.fixture.action.action.kind,'dictation','snap commands never replace the clap action');
  await prompt.getByRole('button',{name:'Restore Snap by manifest'}).click();await page.waitForFunction(()=>window.clapSnapshot().snapAction.action.kind==='music');
  await page.reload();await page.waitForFunction(()=>window.clapSnapshot?.().loaded);assert.equal(await page.evaluate(()=>window.captures.length),0);
  await page.evaluate(()=>window.showChat(false));const qa=path.join(h.root,'.tmp-clap-controls-qa');
  await page.screenshot({path:path.join(qa,'clap-and-snap-light.png'),fullPage:true});
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(qa,'clap-and-snap-mobile.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
 }finally{await h.close();}
});
