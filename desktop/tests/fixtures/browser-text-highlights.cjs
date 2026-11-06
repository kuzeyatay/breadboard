const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain, webContents, session } = require('electron');
const { TabManager } = require('../../dist/main/tab-manager.js');
const { IPC_CHANNELS, isTabsCommand } = require('../../dist/shared/ipc-contract.js');
const [dir] = process.argv.slice(2);
app.setPath('userData', path.join(dir, 'profile'));
app.on('window-all-closed', () => {});
const until = async (probe, label) => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    let timer;
    const value = await Promise.race([probe(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Probe stalled: ' + label)), 8000); })]).finally(() => clearTimeout(timer));
    if (value) return; await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error('Timed out: ' + label);
};

app.whenReady().then(async () => {
  let prepend = ''; let failSave = false; let saveCount = 0;
  const documents = new Map(); const receipts = new Set();
  const server = http.createServer(async (req, res) => {
    if (req.url === '/api/text-highlights') {
      assert.match(req.headers.cookie ?? '', /session=trusted/);
      let body = ''; for await (const chunk of req) body += chunk;
      const { key, mutations = [] } = JSON.parse(body);
      assert.match(key, /^breadboard:web-highlights:v1:http:\/\/127\.0\.0\.1:\d+\/page/);
      if (failSave && mutations.length) { res.writeHead(503); res.end('{}'); return; }
      const entries = documents.get(key) ?? new Map();
      for (const mutation of mutations) if (!receipts.has(mutation.operationId)) {
        receipts.add(mutation.operationId); saveCount++;
        if (mutation.value === null) entries.delete(mutation.id); else entries.set(mutation.id, mutation.value);
      }
      documents.set(key, entries);
      fs.writeFileSync(path.join(dir, 'saved.json'), JSON.stringify([...documents].map(([key, value]) => [key, [...value.values()]])));
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ entries: [...entries.values()], acknowledged: mutations.map(m => m.operationId) })); return;
    }
    if (['/menu.js','/menu.css','/answer.js','/owner.js'].includes(req.url)) {
      res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css');
      res.end(fs.readFileSync(path.join(dir, req.url.slice(1)))); return;
    }
    res.setHeader('Content-Type', 'text/html');
    if (req.url.startsWith('/api/')) { res.setHeader('Content-Type','application/json'); res.end('{"artifacts":[],"messages":[]}'); }
    else if (req.url.startsWith('/browser/inline-answer')) {
      res.end('<!doctype html><html data-breadboard-desktop="true" class="h-full"><body class="min-h-full flex flex-col"><div class="desktop-title-bar">Window controls</div><div id="root"></div><link rel="stylesheet" href="/menu.css"><script src="/answer.js"></script></body></html>');
    } else if (req.url.startsWith('/browser/selection-popover')) {
      res.end('<!doctype html><html data-breadboard-desktop="true" class="h-full"><body class="min-h-full flex flex-col"><div class="desktop-title-bar">Window controls</div><div id="root"></div><link rel="stylesheet" href="/menu.css"><script src="/menu.js"></script></body></html>');
    } else if (req.url.startsWith('/page')) {
      res.end(`<!doctype html><title>Highlight lesson</title><body style="margin:50px;background:#fffdf7;font:18px/1.7 system-ui">${prepend}<p id="passage">The <em>selected</em> words follow.</p><p id="second">A second passage to keep.</p><input value="Private input"><div style="height:1200px"></div></body>`);
    } else if (req.url === '/browser') res.end('<!doctype html><title>Trusted shell</title><body><div id="root"></div><script src="/owner.js"></script></body>');
    else res.end('<!doctype html><title>Trusted shell</title><body>Terminal</body>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await session.defaultSession.cookies.set({ url: origin, name: 'session', value: 'trusted' });
  const loading = path.join(dir, 'loading.html'); fs.writeFileSync(loading, '<!doctype html>');
  const manager = new TabManager({ allowed: { origins: new Set([origin]), localFiles: new Set([pathToFileURL(loading).href]) },
    preloadPath: path.resolve(__dirname, '../../dist/preload/preload.js'), loadingHtmlPath: () => loading, recoveryHtmlPath: () => loading,
    theme: () => 'dark', openWindow: () => {}, log: console.log });
  manager.setBrowserUrl(origin + '/browser'); manager.setNewTabUrl(origin + '/new-tab');
  ipcMain.handle(IPC_CHANNELS.getTabsState, event => manager.stateFor(event.sender));
  ipcMain.handle(IPC_CHANNELS.tabsCommand, (event, command) => isTabsCommand(command) && manager.handleCommand(event.sender, command));
  const window = new BrowserWindow({ show: false, width: 1400, height: 900,
    webPreferences: { preload: path.resolve(__dirname, '../../dist/preload/preload.js'), contextIsolation: true, sandbox: true } });
  manager.attach(window); await window.loadURL(origin + '/dashboard');
  await manager.handleCommand(window.webContents, { type: 'browser', url: origin + '/page' });
  let chrome, page;
  await until(() => {
    chrome = webContents.getAllWebContents().find(w => w.getURL() === origin + '/browser');
    page = webContents.getAllWebContents().find(w => w.getURL() === origin + '/page');
    return chrome && page && !page.isLoading();
  }, 'web page');
  window.showInactive();
  await manager.handleCommand(chrome, { type: 'browser-terminal', open: true });
  await manager.handleCommand(chrome, { type: 'browser-terminal', open: false });
  await until(() => page.executeJavaScript('Boolean(window.__breadboardHighlights)'), 'highlighter bootstrap');
  const positionPackets=[];
  const recordPosition=(_event,url)=>{if(url.startsWith('breadboard-selection:')){const packet=JSON.parse(new URL(url).searchParams.get('data')); if(packet.action==='position') positionPackets.push(packet);}};
  page.on('will-navigate',recordPosition);
  const select = async (selector = '#passage') => {
    page.focus();
    await until(() => manager.stateFor(chrome).tabs.some(tab => tab.browser?.pageReady), 'page presentation before selection');
    // A real drag releases after Chromium has delivered focus and viewport events.
    await new Promise(resolve => setTimeout(resolve, 100));
    await until(() => !webContents.getAllWebContents().some(w => w.getURL().startsWith(origin + '/browser/selection-popover')), 'previous selector closed');
    await page.executeJavaScript(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); const range = document.createRange(); range.selectNodeContents(element);
      getSelection().removeAllRanges(); getSelection().addRange(range); document.dispatchEvent(new PointerEvent('pointerup', {bubbles:true})); })()`);
    let popup;
    await until(async () => {
      popup = webContents.getAllWebContents().find(w => w.getURL().startsWith(origin + '/browser/selection-popover'));
      return popup && !popup.isLoading() && await popup.executeJavaScript('Boolean(document.querySelector(".bb-chat-selection-menu"))');
    }, 'shared selector');
    await until(async () => await popup.executeJavaScript('document.querySelector(".bb-chat-selection-menu").getBoundingClientRect().height > 20'), 'selector layout');
    return popup;
  };
  const click = (popup, label) => popup.executeJavaScript(`document.querySelector('[aria-label=${JSON.stringify(label)}]').click()`);
  const marks = name => page.executeJavaScript(`CSS.highlights.get('breadboard-web-${name}')?.size || 0`);
  const clickSaved = async () => {
    page.focus(); await new Promise(resolve => setTimeout(resolve,100));
    await page.executeJavaScript(`(() => { getSelection().removeAllRanges(); const rect=document.querySelector('#passage').getBoundingClientRect();
      document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:rect.left+5,clientY:rect.top+10})); })()`);
  };
  const answerView = async () => {
    let answer;
    await until(async()=>{
      answer=webContents.getAllWebContents().find(w=>w.getURL().startsWith(origin+'/browser/inline-answer'));
      return answer && !answer.isLoading() && await answer.executeJavaScript('Boolean(document.querySelector(".bb-inline-answer"))');
    },'webpage answer overlay');
    return answer;
  };
  const checkOverlay = async (contents, selector, inset) => {
    const measure = () => contents.executeJavaScript(`(() => {
      const card=document.querySelector(${JSON.stringify(selector)}), rect=card.getBoundingClientRect();
      return {titlebar:getComputedStyle(document.querySelector('.desktop-title-bar')).display,
        top:rect.top,left:rect.left,right:rect.right,bottom:rect.bottom,
        viewport:{width:innerWidth,height:innerHeight},
        htmlBackground:getComputedStyle(document.documentElement).backgroundColor,
        bodyBackground:getComputedStyle(document.body).backgroundColor};
    })()`);
    // A streamed React update precedes its native resize acknowledgement.
    // Wait for that round trip, then inspect the actual compositor viewport.
    await until(async () => {
      const next=await measure();
      return next.bottom<=next.viewport.height-inset+1 && next.right<=next.viewport.width-inset+1;
    },'native overlay resize');
    const geometry = await measure();
    assert.equal(geometry.titlebar,'none','native popup must not paint the desktop title strip');
    assert.equal(geometry.htmlBackground,'rgba(0, 0, 0, 0)');
    assert.equal(geometry.bodyBackground,'rgba(0, 0, 0, 0)');
    assert.equal(geometry.top,inset,'card starts inside its own viewport, independent of application chrome');
    assert.ok(geometry.bottom<=geometry.viewport.height-inset+1,'card and bottom border are not clipped: '+JSON.stringify(geometry));
    assert.ok(geometry.left>=inset && geometry.right<=geometry.viewport.width-inset+1);
  };
  let popup = await select();
  assert.equal(await page.executeJavaScript('typeof window.breadboardDesktop'), 'undefined');
  assert.equal(await manager.handleCommand(page, { type: 'browser-selection-action', action: 'highlight', value: 'pink' }), false);
  assert.equal(await popup.executeJavaScript('getComputedStyle(document.querySelector(".desktop-title-bar")).display'), 'none');
  assert.deepEqual(await popup.executeJavaScript('Array.from(document.querySelectorAll("button")).map(b=>b.textContent.trim()).filter(Boolean)'), ['Add note', 'Ask in chat', 'Ask here']);
  assert.equal(await popup.executeJavaScript('Math.round(document.querySelector(".bb-chat-selection-menu").getBoundingClientRect().width)'), 390);
  // Save an image for visual QA outside the temporary profile.
  const artifactDir = process.env.BREADBOARD_HIGHLIGHT_QA_DIR;
  const capture=async(contents,name)=>{
    if(!artifactDir)return; let pixels;
    await until(async()=>{pixels=await contents.capturePage().catch(()=>null);return pixels && !pixels.isEmpty();},'visual capture '+name);
    fs.mkdirSync(artifactDir,{recursive:true});fs.writeFileSync(path.join(artifactDir,name),pixels.toPNG());
  };
  await capture(popup,'selector.png');
  await checkOverlay(popup,'.bb-chat-selection-menu',10);
  await click(popup, 'Highlight blue');
  await until(async () => await marks('blue') === 1, 'saved blue highlight');
  assert.equal(await page.executeJavaScript(`(() => {
    document.body.style.color='white';document.body.style.background='#10110f';
    return getComputedStyle(document.querySelector('#passage'),'::highlight(breadboard-web-blue)').color;
  })()`),'rgb(19, 32, 27)','pastel marks remain readable on dark webpages');
  assert.equal(saveCount, 1);
  prepend = '<p>New content was inserted before the saved text.</p>';
  page.reload();
  await until(async () => !page.isLoading() && await page.executeJavaScript('document.body.textContent.includes("New content was inserted")') && await marks('blue') === 1, 'refresh relocation');
  assert.equal(await page.executeJavaScript('Array.from(CSS.highlights.get("breadboard-web-blue"))[0].toString()'), 'The selected words follow.');
  assert.equal(await page.executeJavaScript('document.querySelectorAll("#passage mark").length'), 0, 'painting preserves page DOM');
  popup = await select(); await click(popup, 'Add note');
  await until(() => popup.executeJavaScript('Boolean(document.querySelector("textarea"))'), 'note editor');
  await popup.executeJavaScript('document.querySelector("textarea").focus()'); await popup.insertText('Remember this passage');
  await popup.executeJavaScript('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="Save note").click()');
  await until(() => [...documents.values()][0]?.values().next().value?.note === 'Remember this passage', 'saved note');
  await clickSaved();
  await until(async()=>{
    popup=webContents.getAllWebContents().find(w=>w.getURL().startsWith(origin+'/browser/selection-popover'));
    return popup && await popup.executeJavaScript('document.querySelector("textarea")?.value === "Remember this passage"');
  },'clicking a highlight reopens its note');
  await manager.handleCommand(popup,{type:'browser-selection-close'});
  popup = await select(); failSave = true;
  await click(popup, 'Highlight pink');
  await until(() => popup.executeJavaScript('Boolean(document.querySelector("[role=alert]"))'), 'honest save failure');
  assert.equal(await marks('blue'), 1); assert.equal(await marks('pink'), 0);
  failSave = false; await click(popup, 'Highlight pink');
  await until(async () => await marks('pink') === 1, 'retry save');
  popup = await select('#second'); await click(popup, 'Highlight green');
  await until(async () => await marks('green') === 1, 'second independent highlight');
  popup = await select('#second'); await click(popup, 'Remove highlight');
  await until(async () => await marks('green') === 0, 'erase second highlight');
  assert.equal(await marks('pink'), 1, 'erasing one passage preserves another');
  popup = await select();
  await popup.executeJavaScript('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="Ask here").click()');
  await until(() => manager.stateFor(chrome).tabs.some(tab => tab.browser?.selection?.reference?.mode === 'inline'), 'Ask here handoff');
  let selected = manager.stateFor(chrome).tabs.find(tab => tab.browser?.selection)?.browser.selection;
  assert.equal(selected.reference.quote, 'The selected words follow.'); assert.equal(selected.reference.sourceUrl, origin + '/page');
  assert.equal(manager.stateFor(chrome).tabs.find(tab=>tab.browser?.selection).browser.terminalOpen,false,'Ask here leaves the webpage width intact');
  let answer=await answerView();
  await checkOverlay(answer,'.bb-inline-answer',16);
  assert.equal(await answer.executeJavaScript(`document.querySelector(${JSON.stringify('[aria-label="Saved highlight note"]')})?.textContent`), 'Remember this passage');
  await until(()=>answer.executeJavaScript('Boolean(document.querySelector("textarea"))'),'webpage question editor');
  const nativeAnswer=window.contentView.children.find(view=>view.webContents?.id===answer.id);
  const nativePage=window.contentView.children.find(view=>view.webContents?.id===page.id);
  const answerBounds=nativeAnswer.getBounds(), pageBounds=nativePage.getBounds();
  assert.ok(answerBounds.x>=pageBounds.x && answerBounds.x+answerBounds.width<=pageBounds.x+pageBounds.width);
  assert.ok(answerBounds.y>=pageBounds.y && answerBounds.y+answerBounds.height<=pageBounds.y+pageBounds.height);
  const nativeStack=window.contentView.children.map(view=>view.webContents?.id);
  assert.ok(nativeStack.indexOf(answer.id)>nativeStack.indexOf(page.id),'answer is above the webpage: '+nativeStack.join(',')+' answer='+answer.id+' page='+page.id);
  assert.equal(await manager.handleCommand(page,{type:'browser-answer-action',action:{requestId:selected.requestId,selectionId:selected.reference.id,action:'delete'}}),false);
  await answer.executeJavaScript('document.querySelector("textarea").focus()'); await answer.insertText('Explain this passage');
  await answer.executeJavaScript('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="Ask").click()');
  await until(()=>answer.executeJavaScript('document.body.textContent.includes("Thinking")'),'pending answer appears');
  await checkOverlay(answer,'.bb-inline-answer',16);
  await chrome.executeJavaScript('window.finishOwnerAnswer()');
  await until(()=>answer.executeJavaScript('document.body.textContent.includes("A saved explanation.")'),'streamed answer appears above webpage');
  for (const theme of ['light','dark']) {
    await answer.executeJavaScript(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    await checkOverlay(answer,'.bb-inline-answer',16);
    await answer.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    // Let the shared control background transitions finish before visual QA.
    await new Promise(resolve=>setTimeout(resolve,250));
    await capture(answer,'website-answer-'+theme+'.png');
  }
  await new Promise(resolve=>setTimeout(resolve,150));
  const initialAnswerY=nativeAnswer.getBounds().y;
  const initialScroll=await page.executeJavaScript('scrollY');
  const positionCount=positionPackets.length;
  await page.executeJavaScript(`window.scrollTo(0,${initialScroll+30})`);
  await until(()=>positionPackets.length>positionCount && nativeAnswer.getBounds().y<initialAnswerY,'answer follows its webpage highlight while scrolling');
  await page.executeJavaScript(`window.scrollTo(0,${initialScroll})`);
  await until(()=>nativeAnswer.getBounds().y===initialAnswerY,'answer returns with its source');
  const initialAnswerX=nativeAnswer.getBounds().x;
  await answer.executeJavaScript(`document.querySelector(${JSON.stringify('[aria-label="Move answer"]')}).dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`);
  await until(()=>nativeAnswer.getBounds().x===initialAnswerX+10,'shared move control moves the native card');
  window.setContentSize(1250,820);
  await new Promise(resolve=>setTimeout(resolve,150));
  const resizedPage=nativePage.getBounds(), resizedAnswer=nativeAnswer.getBounds();
  assert.ok(!answer.isDestroyed() && resizedAnswer.x>=resizedPage.x && resizedAnswer.x+resizedAnswer.width<=resizedPage.x+resizedPage.width,'resize keeps the answer on the webpage');
  await checkOverlay(answer,'.bb-inline-answer',16);
  await chrome.executeJavaScript(`window.setOwnerAnswer(${JSON.stringify('A longer explanation with enough detail to fill the answer card.\n\n'.repeat(35))})`);
  await until(()=>answer.executeJavaScript('document.querySelector(".bb-inline-answer").scrollHeight>document.querySelector(".bb-inline-answer").clientHeight'),'long answer scrolls inside its card');
  await checkOverlay(answer,'.bb-inline-answer',16);
  assert.ok(await answer.executeJavaScript(`(() => {
    const card=document.querySelector('.bb-inline-answer');card.scrollTop=card.scrollHeight;
    return [...card.querySelectorAll('button')].at(-1).getBoundingClientRect().bottom<=innerHeight-16;
  })()`),'long answer action row remains reachable');
  await chrome.executeJavaScript('window.setOwnerAnswer("A saved explanation.")');
  await until(()=>answer.executeJavaScript('document.querySelector(".bb-inline-answer").scrollHeight<=document.querySelector(".bb-inline-answer").clientHeight'),'short answer shrinks again');
  await checkOverlay(answer,'.bb-inline-answer',16);
  await capture(answer,'website-answer.png');
  assert.equal(await chrome.executeJavaScript('window.ownerQuestion.selection.sourceUrl'),origin+'/page','Terminal receives the actual webpage source');
  assert.equal(await manager.handleCommand(chrome, { type: 'browser-selection-conversation', id: selected.reference.id, url: selected.url, conversationId: 'conv_saved' }), true);
  // Reopen creates a new renderer; only the durable store can restore this annotation.
  const tabId = manager.stateFor(chrome).selfId;
  const closedPageId = page.id; const closedChromeId = chrome.id;
  await manager.handleCommand(chrome, { type: 'close', id: tabId });
  await manager.handleCommand(window.webContents, { type: 'browser', url: origin + '/page' });
  await until(() => {
    chrome = webContents.getAllWebContents().find(w => w.id !== closedChromeId && w.getURL() === origin + '/browser');
    page = webContents.getAllWebContents().find(w => w.id !== closedPageId && w.getURL() === origin + '/page');
    return page && chrome && !page.isLoading();
  }, 'reopened page');
  await until(async () => await marks('answer') === 1, 'restored inline marker');
  await clickSaved(); answer=await answerView();
  await until(()=>answer.executeJavaScript('document.body.textContent.includes("A saved explanation.")'),'clicking saved highlight restores its saved answer');
  await answer.executeJavaScript('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await until(()=>answer.isDestroyed(),'answer closes on Escape');
  popup = await select();
  assert.equal(await popup.executeJavaScript('document.querySelector("textarea").value'), 'Remember this passage');
  await popup.executeJavaScript('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="Ask here").click()');
  await until(() => manager.stateFor(chrome).tabs.some(tab => tab.browser?.selection?.conversationId === 'conv_saved'), 'reopen owning chat');
  assert.equal([...documents.values()][0].size, 1, 'same passage updates one annotation');
  selected = manager.stateFor(chrome).tabs.find(tab => tab.browser?.selection)?.browser.selection;
  assert.equal(await manager.handleCommand(page, { type: 'browser-selection-delete', id: selected.reference.id, url: selected.url }), false);
  failSave = true;
  assert.equal(await manager.handleCommand(chrome, { type: 'browser-selection-delete', id: selected.reference.id, url: selected.url }), false);
  assert.equal(await marks('answer'), 1, 'failed deletion retains the saved marker');
  failSave = false;
  assert.equal(await manager.handleCommand(chrome, { type: 'browser-selection-delete', id: selected.reference.id, url: selected.url }), true);
  assert.equal(await marks('answer'), 0); assert.equal([...documents.values()][0].size, 0);
  popup = await select();
  await popup.executeJavaScript('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="Ask here").click()');
  await until(() => manager.stateFor(chrome).tabs.some(tab => tab.browser?.selection?.reference?.id !== selected.reference.id && tab.browser?.selection?.reference), 'fresh question after deleting marker');
  // Verification is complete before Chromium's native shutdown (managed by the helper).
  fs.writeFileSync(path.join(dir, 'passed.json'), JSON.stringify({passed:true}));
  console.log('Shared selector, clickable notes, webpage answer overlay, scroll/drag/resize, persistence, and saved chat association passed.');
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
