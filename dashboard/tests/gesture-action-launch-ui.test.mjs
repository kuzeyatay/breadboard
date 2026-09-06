import assert from 'node:assert/strict';
import test from 'node:test';
import { clapBrowser } from './helpers/clap-browser.mjs';

// Real tabs and production provider/worklet; the desktop bridge only delegates
// its foreground-open command to the test browser's native window.open.
test('desktop gestures open and focus a new speech tab, wait for its dock, and never replay on reload', {timeout:45000}, async () => {
  const h = await clapBrowser();
  try {
    await h.context.addInitScript(() => {
      window.dockDelay = 350;
      window.tabCommands = [];
      const state = () => ({enabled:true,selfId:1,activeId:document.hasFocus()?1:2,windowFocused:true,tabs:[],extensions:[]});
      window.breadboardDesktop = {
        getTabsState: async () => state(),
        onTabsState: listener => {
          const update = () => listener(state());
          window.addEventListener('focus',update);window.addEventListener('blur',update);
          return () => {window.removeEventListener('focus',update);window.removeEventListener('blur',update);};
        },
        tabs: async command => {
          window.tabCommands.push(command);
          if (command.type === 'open') { window.open(command.url,'_blank')?.focus(); }
          return true;
        },
      };
    });
    for (const kind of ['dictation']) {
      const source = await h.context.newPage();
      await source.goto(h.url+'/profile?no-dock&collapsed');
      await source.waitForFunction(()=>window.clapSnapshot?.().loaded);
      await source.evaluate(kind=>window.saveAction({prompt:kind,action:{kind}}),kind);
      await source.getByRole('switch',{name:/^(Clap|Finger-snap) controls$/}).click();
      await source.waitForFunction(()=>window.clapSnapshot().status==='listening');
      const popup = source.waitForEvent('popup');
      await source.evaluate(()=>window.emitClaps());
      const destination = await popup;
      await destination.waitForFunction(()=>window.prepares===1);
      assert.equal(await destination.evaluate(()=>document.hasFocus()),true);
      assert.equal(await source.evaluate(()=>window.prepares),0);
      const open = await source.evaluate(()=>window.tabCommands.find(c=>c.type==='open'));
      assert.equal(open.background,false);
      assert.match(open.url,/\/dashboard\?gestureRun=/);
      assert.equal(await destination.locator('[data-clap-indicator],.clap-notice').count(),0);
      if (kind === 'voice') await destination.getByRole('dialog',{name:/voice/i}).waitFor();
      await destination.reload();await destination.waitForFunction(()=>window.clapSnapshot?.().loaded);
      assert.equal(await destination.evaluate(()=>window.prepares),0);
      assert.equal(await destination.getByRole('dialog',{name:/voice/i}).count(),0);
      await destination.close();await source.close();
    }
  } finally { await h.close(); }
});

test('the voice gesture opens the compact native voice window without a terminal handoff', {timeout:20000}, async () => {
  const h = await clapBrowser();
  try {
    const page = await h.context.newPage();
    await page.addInitScript(() => {
      window.tabCommands = [];
      window.breadboardDesktop = { tabs: async command => { window.tabCommands.push(command); return true; }, getTabsState: async () => ({enabled:true,selfId:1,activeId:1,windowFocused:true,tabs:[]}), onTabsState: () => () => {} };
    });
    await page.goto(h.url + '/profile?no-dock&collapsed');
    await page.evaluate(() => window.openGestureAction({userId:'1',control:'clap',eventId:'voice-test',action:{kind:'voice'}},{kind:'voice'}));
    assert.deepEqual(await page.evaluate(() => window.tabCommands), [{type:'voice-open'}]);
    assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('breadboard:gesture-launch:')).length), 0);
    assert.equal(await page.evaluate(() => window.prepares), 0);
  } finally { await h.close(); }
});

test('snap opens the player, waits for readiness and submits the saved track only once', {timeout:30000}, async () => {
  const h = await clapBrowser();h.fixture.playerReady=false;
  try {
    const source=await h.context.newPage();await source.goto(h.url+'/profile?profile&snaps&no-dock&collapsed');
    await source.waitForFunction(()=>window.clapSnapshot?.().loaded);
    await source.locator('#snap-controls').getByRole('switch',{name:/^(Clap|Finger-snap) controls$/}).click();
    await source.waitForFunction(()=>window.clapSnapshot().status==='listening');
    const popup=source.waitForEvent('popup');await source.evaluate(()=>window.emitClaps('snap'));
    const destination=await popup;await destination.waitForFunction(()=>window.clapSnapshot?.().loaded);
    assert.equal(h.fixture.executions,0,'no command before Breadboard has a playback device');
    h.fixture.playerReady=true;
    await new Promise(resolve=>setTimeout(resolve,800));
    assert.equal(h.fixture.executions,1);
    assert.equal(h.fixture.executionBodies[0].expectedAction.trackUri,'spotify:track:4EsRpVBBKiqOZ67DJj0QHF');
    assert.match(destination.url(),/\/new-tab\?panel=spotify$/);
    await destination.reload();await destination.waitForFunction(()=>window.clapSnapshot?.().loaded);
    assert.equal(h.fixture.executions,1);
    assert.equal(await destination.locator('[data-clap-indicator],.clap-notice').count(),0);
  } finally { await h.close(); }
});

test('handoffs reject stale, other-account, malformed and already-consumed requests', {timeout:15000}, async () => {
  const h=await clapBrowser();
  try {
    const page=await h.context.newPage();await page.goto(h.url+'/profile?no-dock');
    await page.waitForFunction(()=>window.clapSnapshot?.().loaded);
    const results=await page.evaluate(()=>{
      const consume=patch=>{
        const token=crypto.randomUUID();
        localStorage.setItem('breadboard:gesture-launch:'+token,JSON.stringify({userId:'1',at:Date.now(),control:'clap',eventId:'test',action:{kind:'voice'},...patch}));
        history.replaceState({},'', '/dashboard?gestureRun='+token);
        return window.takeGestureLaunch('1');
      };
      return [consume({at:Date.now()-180000}),consume({userId:'2'}),consume({action:{kind:'shell'}}),consume({}),window.takeGestureLaunch('1')];
    });
    assert.deepEqual(results.slice(0,3),[null,null,null]);
    assert.equal(results[3].action.kind,'voice');assert.equal(results[4],null);
    assert.equal(h.fixture.executions,0);
  } finally { await h.close(); }
});
