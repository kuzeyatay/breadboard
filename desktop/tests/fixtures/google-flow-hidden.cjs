const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, session } = require('electron');
const { TabManager } = require('../../dist/main/tab-manager.js');
const { BreadboardUseBridge } = require('../../dist/main/breadboard-use.js');
const { configureBrowserAgentDebugging } = require('../../dist/main/browser-agent-session.js');
const dir = process.argv[2];
app.setPath('userData', path.join(dir, 'profile'));
const cdpPort = configureBrowserAgentDebugging(app.commandLine, app.getPath('userData'));
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/api/auth/session') {
      res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({user:{id:'7'}}));
    }
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>Fixture</title><body>' + (req.headers.cookie?.includes('flow_test=shared') ? 'shared sign-in' : 'app') + '</body>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const loading = path.join(dir, 'loading.html'); fs.writeFileSync(loading, '<!doctype html>');
  const manager = new TabManager({
    allowed:{origins:new Set([origin]),localFiles:new Set([pathToFileURL(loading).href])},
    preloadPath:path.resolve(__dirname,'../../dist/preload/preload.js'),
    loadingHtmlPath:()=>loading,recoveryHtmlPath:()=>loading,theme:()=> 'light',openWindow:()=>{},
  });
  manager.setBrowserUrl(origin+'/browser'); manager.setNewTabUrl(origin+'/new-tab');
  const window = new BrowserWindow({show:false,webPreferences:{preload:path.resolve(__dirname,'../../dist/preload/preload.js'),contextIsolation:true,sandbox:true}});
  manager.attach(window); const page = manager.baseContents(window); await page.loadURL(origin+'/dashboard');
  await session.fromPartition('persist:breadboard-browser').cookies.set({url:origin,name:'flow_test',value:'shared',httpOnly:true});
  const before = manager.stateFor(page);
  const bridge = new BreadboardUseBridge({tabs:manager,dataRoot:dir,dashboardUrl:()=>origin,cdpPort:()=>cdpPort});
  await bridge.start();
  const access = JSON.parse(fs.readFileSync(path.join(dir,'breadboard-use.json'),'utf8'));
  const denied = await fetch(`http://127.0.0.1:${access.port}/breadboard-use`,{method:'POST',headers:{Authorization:`Bearer ${access.token}`},
    body:JSON.stringify({args:{action:'flow_tab'},userId:8,sessionId:'test',runId:'test'})});
  assert.equal(denied.status,403);
  const target = await bridge.execute({action:'flow_tab',foreground:true,lane:'interactive'},'flow-test');
  assert.equal(target.hidden,true);
  assert.equal(manager.chatgptWebPageVisible('google-flow'),false);
  assert.deepEqual(manager.stateFor(page).tabs,before.tabs);
  const data = path.join(dir,'runtime-v2/services/google-flow/users/7'); fs.mkdirSync(data,{recursive:true});
  const result = await new Promise((resolve,reject)=>{
    const child=spawn(process.env.BB_TEST_NODE,[path.join(__dirname,'google-flow-native-probe.mjs'),data,origin+'/flow',target.targetId],{windowsHide:true});
    let output=''; child.stdout.on('data',v=>output+=v); child.stderr.on('data',v=>output+=v);
    child.once('error',reject); child.once('close',code=>resolve({code,output}));
  });
  assert.equal(result.code,0,result.output);
  assert.equal(manager.chatgptWebPageVisible('google-flow'),false);
  assert.equal(manager.chatgptWebPageContents('google-flow').isDestroyed(),false);
  assert.equal(manager.chatgptWebPageContents('google-flow').session,session.fromPartition('persist:breadboard-browser'));
  assert.deepEqual(manager.stateFor(page).tabs,before.tabs);
  assert.deepEqual(await bridge.execute({action:'flow_tab'},'flow-test'),target);
  console.log('PASS: authenticated hidden target, shared sign-in, preserved tab strip, client disconnect leaves browser alive');
  await bridge.close(); fs.writeFileSync(path.join(dir,'passed.json'),JSON.stringify({passed:true}));
}).catch(error=>{console.error(error);app.exit(1);});
