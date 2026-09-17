import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import ts from 'typescript';
import postcss from 'postcss';
import Database from 'better-sqlite3';
import { chromium } from 'playwright';
import { ensureNangoSchema } from '../src/lib/nango/schema.ts';
import { createHermesEventNormalizationState, normalizeHermesEvent } from '../src/lib/agent-runtime/hermes-events.ts';
import { FakePrinterAdapter, slicedFixture, sources } from './helpers/bambu-fake.mjs';
import { startBambuService } from '../scripts/runtime-v2-bambu-service.mjs';

const root=path.resolve(import.meta.dirname,'..');
const require=createRequire(import.meta.url);
function taskRenderer(file) {
  const source=ts.createSourceFile(file,fs.readFileSync(path.join(root,file),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let found;
  function visit(node){if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(source)==='GenerativeUiRenderer')found=node.getText(source);ts.forEachChild(node,visit);}visit(source);
  assert.ok(found,'Actual task UI must contain GenerativeUiRenderer');return found;
}
test('Electron task → real tool/API handlers → durable service → protected gateway → fake printer → restored native widget', {timeout:180000}, async()=>{
  const qa=path.join(root,'.tmp-bambu-qa');fs.mkdirSync(qa,{recursive:true});
  const dbFile=path.join(qa,'fixture.db');if(fs.existsSync(dbFile))fs.unlinkSync(dbFile);
  const db=new Database(dbFile);db.pragma('foreign_keys=ON');db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1),(2);
    CREATE TABLE conversations(id INTEGER PRIMARY KEY,public_id TEXT,user_id INTEGER,title TEXT,surface TEXT,legacy_chat_session_id INTEGER);
    INSERT INTO conversations VALUES(1,'conv_bambu_qa',1,'Print a prepared file','dashboard_terminal',7);
    CREATE TABLE conversation_messages(id INTEGER PRIMARY KEY,conversation_id INTEGER,role TEXT,metadata TEXT,created_at TEXT);`);ensureNangoSchema(db);
  const scope={id:8,user_id:1,conversation_id:1,surface:'dashboard_terminal',hermes_session_id:'runtime_qa',allowed_garden_ids:'[]'};
  globalThis.__bambuQa={db,root:qa,scope,conv:db.prepare('SELECT * FROM conversations').get(),userId:1};
  delete globalThis.bambuService;
  const envNames=['NEXTAUTH_SECRET','BREADBOARD_BAMBU_SERVICE_TOKEN','BREADBOARD_BAMBU_SERVICE_URL','BREADBOARD_BAMBU_DASHBOARD_ORIGIN','HERMES_TOOL_SECRET'];
  const oldEnv=Object.fromEntries(envNames.map(name=>[name,process.env[name]]));
  process.env.NEXTAUTH_SECRET='bambu-qa-local-secret-isolated-from-user-state';process.env.HERMES_TOOL_SECRET='bambu-qa-tool-secret';process.env.BREADBOARD_BAMBU_SERVICE_TOKEN='bambu-qa-private-runtime-secret-0000000000000';
  const stubs={
    'server-only':'export {};',
    'db.ts':'export default globalThis.__bambuQa.db;',
    'runtime-paths.ts':'export const dashboardDataDir=()=>globalThis.__bambuQa.root;',
    'server-auth.ts':'export class RouteError extends Error { constructor(status,message){super(message);this.status=status;} } export async function requireUserId(){const id=globalThis.__bambuQa.userId;if(!id)throw new RouteError(401,"Unauthorized");return id;}',
    'conversations/store.ts':'export function getConversationById(id){return id===1?globalThis.__bambuQa.conv:null;} export function getConversationForUser(id,user){const c=globalThis.__bambuQa.conv;if(id!==c.public_id||user!==c.user_id)throw Object.assign(new Error("Conversation not found"),{status:404});return c;}',
    'hermes/runtime-store.ts':'export const getRuntimeSessionById=id=>id===8?globalThis.__bambuQa.scope:null; export const getRuntimeSessionByExternalId=(_runtime,id)=>id==="runtime_qa"?globalThis.__bambuQa.scope:null; export const getRuntimeSessionByHermesId=id=>id==="runtime_qa"?globalThis.__bambuQa.scope:null; export const runtimeExternalSessionId=()=>"runtime_qa"; export const getActiveCapabilityDecision=()=>({allowedTools:["bambu_print_prepare"]});',
    'hermes/run-store.ts':'export const getActiveRuntimeRun=()=>({id:"run_qa",dispatch_json:JSON.stringify({clientMessageId:"turn_qa"})});',
    'hermes/browser-terminal-context.ts':'export const getBrowserTerminalContext=()=>null;',
    'supervisor-control.ts':'export const isRuntimeV2ServiceControlConfigured=()=>true; export const acquireServiceLease=async()=>({id:"qa-supervisor-lease",targetId:"bambu-printer"}); export const releaseSupervisorLease=async()=>{};',
    'hermes/artifact-store.ts':'export function getArtifactForUser(){throw Object.assign(new Error("Artifact not found"),{status:404});} export function artifactFile(){throw Error("No artifact");}',
    'conversations/model-blob-store.ts':'export function readModelBlob(){return globalThis.__bambuQa.uploadBytes;}',
  };
  const plugins=[{name:'isolated-host-authorities',setup(b){b.onResolve({filter:/.*/},args=>{const portable=(args.path.startsWith('.')?path.resolve(args.resolveDir,args.path):args.path).replaceAll('\\','/');const key=Object.keys(stubs).find(k=>k==='server-only'?portable===k:portable.endsWith('/'+k)||(portable+'.ts').endsWith('/'+k));return key?{path:key,namespace:'qa'}:null;});b.onLoad({filter:/.*/,namespace:'qa'},args=>({contents:stubs[args.path],loader:'ts'}));}}];
  const routeFiles={tool:'src/app/api/hermes/tools/bambu/route.ts',connections:'src/app/api/hermes/connections/bambu/route.ts',job:'src/app/api/hermes/connections/bambu/jobs/[jobId]/route.ts',file:'src/app/api/hermes/connections/bambu/jobs/[jobId]/file/route.ts',internal:'src/app/api/hermes/connections/bambu/internal/route.ts',photo:'src/app/api/hermes/connections/bambu/[printerId]/photo/route.ts'};
  const routes={};
  for(const [name,file]of Object.entries(routeFiles)){const outfile=path.join(qa,`route-${name}.cjs`);await build({entryPoints:[path.join(root,file)],outfile,bundle:true,platform:'node',format:'cjs',packages:'external',plugins});routes[name]=require(outfile);}
  const terminal=taskRenderer('src/app/components/hermes/agent-runtime-panel.tsx'),garden=taskRenderer('src/app/gardens/[clusterSlug]/workspace-client.tsx');
  await build({stdin:{resolveDir:root,loader:'tsx',contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';import GenerativeUiRenderer from './src/app/components/hermes/generative-ui-renderer';
    const sessionId='conv_bambu_qa',chatSessionId=7,handleGenerativeUiAction=()=>{},onGenerativeUiAction=()=>{},activeProductComparison=null;
    function Task(){const[message,setMessage]=useState(window.fixtureMessage);const[visible,setVisible]=useState(true);window.showWidget=setVisible;window.refreshMessage=setMessage;const msg=message;return <main><header><h1>Print a prepared file</h1><p>Breadboard · task output</p></header><p>{message.content}</p><section id="task-column" style={{width:"100%",maxWidth:440}}>{visible&&(new URLSearchParams(location.search).has('garden')?(${garden}):(${terminal}))}</section></main>;}createRoot(document.getElementById('root')).render(<Task/>);`},outfile:path.join(qa,'app.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"test"'}});
  const sheet=postcss.parse(fs.readFileSync(path.join(root,'src/app/globals.css'),'utf8'));let tokens='';sheet.walkRules(rule=>{if([':root',':root[data-theme="dark"]','html[data-theme="dark"]'].includes(rule.selector))tokens+=rule.toString();});
  const css=tokens+'\n'+fs.readFileSync(path.join(qa,'app.css'),'utf8')+'\n*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:system-ui}main{padding:32px}@media(max-width:500px){#task-column{max-width:320px}}h1{font-size:18px}header p,main>p{font-size:12px;color:var(--ink-muted)}button{font-family:inherit}';
  let fixtureMessage, apiRequests=0;
  const server=http.createServer(async(req,res)=>{
    try{
      const requestUrl=new URL(req.url,`http://127.0.0.1:${server.address().port}`);
      if(req.url==='/app.js'){res.setHeader('content-type','text/javascript');res.end(fs.readFileSync(path.join(qa,'app.js')));return;}
      if(req.url==='/app.css'){res.setHeader('content-type','text/css');res.end(css);return;}
      if(!req.url.startsWith('/api/')){res.setHeader('content-type','text/html');res.end(`<!doctype html><html><head><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script>document.documentElement.dataset.theme=localStorage.getItem("qa-theme")||"light";window.fixtureMessage=${JSON.stringify(fixtureMessage).replaceAll('<','\\u003c')}</script><script src="/app.js"></script></body></html>`);return;}
      const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);apiRequests++;
      const request=new Request(requestUrl,{method:req.method,headers:req.headers,...(bytes.length?{body:bytes,duplex:'half'}:{})});
      const p=requestUrl.pathname;let key,params={};
      if(p==='/api/hermes/tools/bambu')key='tool';else if(p.endsWith('/internal'))key='internal';else if(/\/jobs\//.test(p)){const m=/\/jobs\/([^/]+)(?:\/(file|thumbnail))?$/.exec(p);key=m?.[2]??'job';params={jobId:m?.[1]};}else if(p.endsWith('/photo')){key='photo';params={printerId:p.split('/').at(-2)};}else key='connections';
      const response=await routes[key][req.method](request,{params:Promise.resolve(params)});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
    }catch(error){res.statusCode=500;res.end(JSON.stringify({error:error.message}));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;process.env.BREADBOARD_BAMBU_DASHBOARD_ORIGIN=origin;
  const portProbe=http.createServer();await new Promise(resolve=>portProbe.listen(0,'127.0.0.1',resolve));const port=portProbe.address().port;await new Promise(resolve=>portProbe.close(resolve));process.env.BREADBOARD_BAMBU_SERVICE_URL=`http://127.0.0.1:${port}`;
  const fake=new FakePrinterAdapter();fake.clock=Date.now();const daemon=await startBambuService({adapter:fake,argv:['--port',String(port)]});
  let app, electronChild;
  const screenshot=async name=>{const done=path.join(qa,'capture-done.json');if(fs.existsSync(done))fs.unlinkSync(done);fs.writeFileSync(path.join(qa,'capture-request.json'),JSON.stringify({name}));for(let i=0;i<200;i++){if(fs.existsSync(done)){const receipt=JSON.parse(fs.readFileSync(done,'utf8'));assert.equal(receipt.name,name,JSON.stringify(receipt));return;}await new Promise(r=>setTimeout(r,50));}throw Error('Native screenshot timed out');};
  const post=async(url,body,headers={})=>{const response=await fetch(origin+url,{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)});const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;};
  try{
    const saved=await post('/api/hermes/connections/bambu',{action:'save',name:'Studio printer',model:'P1S',nozzle:0.4,buildPlate:'textured_plate',developerModeConfirmed:true,sources:sources(),host:'192.168.1.42',serial:'01P000000001',accessCode:'TESTONLY'});
    assert.equal(JSON.stringify(saved).includes('TESTONLY'),false);assert.equal(JSON.stringify(saved).includes('192.168.1.42'),false);
    const tested=await post('/api/hermes/connections/bambu',{action:'test',printerId:saved.printer.id});assert.equal(tested.printer.authenticated,true);assert.equal(fake.writes.length,0);
    const tool=await post('/api/hermes/tools/bambu',{tool:'bambu_print_prepare',args:{}},{authorization:'Bearer bambu-qa-tool-secret','x-hermes-session-id':'runtime_qa'});
    const scoped=`/api/hermes/connections/bambu/jobs/${tool.jobId}?conversation=conv_bambu_qa`;
    for(const headers of [{},{origin:'https://untrusted.example'},{origin,authorization:'Bearer bambu-qa-tool-secret','x-hermes-session-id':'runtime_qa'}]) {
      const denied=await fetch(origin+scoped,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({action:'approve',revision:1,plateClear:true,physicalSetup:true})});assert.equal(denied.status,403);
    }
    globalThis.__bambuQa.userId=2;assert.equal((await fetch(origin+scoped)).status,404);globalThis.__bambuQa.userId=1;
    assert.equal((await fetch(origin+scoped+'&chatSessionId=99')).status,403);
    assert.equal((await fetch(process.env.BREADBOARD_BAMBU_SERVICE_URL+'/v1/observe',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,401);
    const forbidden=await fetch(origin+'/api/hermes/tools/bambu',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer bambu-qa-tool-secret','x-hermes-session-id':'runtime_qa'},body:JSON.stringify({tool:'bambu_print_prepare',args:{approved:true,host:'192.168.1.3'}})});assert.equal(forbidden.status,400);assert.equal(fake.writes.length,0);
    const retained=slicedFixture();globalThis.__bambuQa.uploadBytes=retained;
    db.prepare("INSERT INTO conversation_messages VALUES(1,1,'user',?,datetime('now'))").run(JSON.stringify({attachments:[{type:'model',format:'3mf',blobId:'mdl_11111111111111111111111111111111',name:'retained.gcode.3mf',sizeBytes:retained.length}]}));
    const attachmentJob=globalThis.bambuService.create({...globalThis.bambuService.store.get(tool.jobId).scope,runId:'attachment_qa'});
    const attached=await post(`/api/hermes/connections/bambu/jobs/${attachmentJob.id}?conversation=conv_bambu_qa`,{action:'attach',revision:1,uploadId:'1-0'});assert.equal(attached.job.file.name,'retained.gcode.3mf');assert.equal(fake.writes.length,0);
    const events=normalizeHermesEvent({type:'tool.complete',session_id:'runtime_qa',payload:{name:'bambu_print_prepare',tool_id:'tool-qa',result:JSON.stringify(tool)}},'runtime_qa','conv_bambu_qa',createHermesEventNormalizationState());
    const uiResources=events.flatMap(e=>e.payload.uiResources??[]);assert.equal(uiResources.length,1,'Actual normalized tool event contains the native printer resource');
    fixtureMessage={role:'assistant',content:'Your prepared print is ready for review.',uiResources};fs.writeFileSync(path.join(qa,'transcript.json'),JSON.stringify(fixtureMessage));
    const executablePath=path.resolve(root,'../desktop/node_modules/electron/dist/electron.exe');
    const electronEnv={...process.env};delete electronEnv.ELECTRON_RUN_AS_NODE;delete electronEnv.NODE_TEST_CONTEXT;
    const electronLog=path.join(qa,'electron-output.log'),fd=fs.openSync(electronLog,'w');
    electronChild=spawn(executablePath,['--remote-debugging-port=0',path.join(root,'tests/helpers/bambu-electron.cjs'),qa,origin],{cwd:path.resolve(root,'../desktop'),env:electronEnv,windowsHide:true,stdio:['ignore',fd,fd]});fs.closeSync(fd);
    let endpoint;for(let i=0;i<150;i++){endpoint=/DevTools listening on (ws:\/\/[^\s]+)/.exec(fs.readFileSync(electronLog,'utf8'))?.[1];if(endpoint)break;if(electronChild.exitCode!==null)throw Error(fs.readFileSync(electronLog,'utf8')+' Electron exited: '+electronChild.exitCode);await new Promise(r=>setTimeout(r,100));}assert.ok(endpoint,fs.readFileSync(electronLog,'utf8'));
    app=await chromium.connectOverCDP(endpoint);
    const context=app.contexts()[0];const page=context.pages()[0]??await context.waitForEvent('page');const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.getByRole('article',{name:'Bambu Lab print job'}).waitFor();
    const png=await (await import('sharp')).default({create:{width:8,height:8,channels:3,background:'#808080'}}).png().toBuffer();
    const photo=await fetch(origin+`/api/hermes/connections/bambu/${saved.printer.id}/photo`,{method:'POST',headers:{origin,'content-type':'image/png'},body:png});assert.equal(photo.status,200);
    fs.unlinkSync(path.join(qa,'bambu','photos',`${saved.printer.id}.png`));await page.reload();
    await page.getByRole('button',{name:'Choose sliced file',exact:true}).waitFor();
    await page.getByRole('button',{name:'Choose sliced file',exact:true}).focus();assert.equal(await page.getByRole('button',{name:'Choose sliced file',exact:true}).evaluate(el=>el===document.activeElement),true);
    const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Choose sliced file',exact:true}).press('Enter');
    await (await chooser).setFiles({name:'two colour part.gcode.3mf',mimeType:'application/octet-stream',buffer:slicedFixture()});
    await page.getByRole('dialog').waitFor();await page.getByLabel('Physical source',{exact:true}).nth(0).selectOption('ams:0:0');await page.getByLabel('Physical source',{exact:true}).nth(1).selectOption('ams:1:0');
    await page.getByRole('button',{name:'Check this setup',exact:true}).click();await page.getByRole('button',{name:'Approve & print',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Approve & print',exact:true}).isEnabled(),false);assert.equal(fake.writes.length,0);
    await screenshot('review-light.png');
    await page.getByLabel('I checked that the build plate is clear and correctly installed.').check();await page.getByLabel('I checked that the physical nozzle, filament and setup match this review.').check();
    let releaseUpload;fake.uploadHold=new Promise(resolve=>releaseUpload=resolve);
    await page.getByRole('button',{name:'Approve & print',exact:true}).click();await page.getByRole('button',{name:'Close print details'}).click();
    await page.locator('button').filter({hasText:'Add printer photo'}).waitFor();
    await page.waitForFunction(()=>document.querySelector('article')?.textContent.includes('Uploading'));await screenshot('uploading-light.png');
    releaseUpload();await page.waitForFunction(()=>document.querySelector('article')?.textContent.includes('Start unconfirmed'));
    assert.deepEqual(fake.writes.map(w=>w.action),['upload','start']);
    fake.report('printing',{progress:42,layer:96,totalLayers:228,remainingMinutes:49,nozzleTemperature:219,bedTemperature:60});
    await page.getByRole('button',{name:'Pause',exact:true}).waitFor();await screenshot('printing-light.png');
    // Two simultaneous views share the native telemetry session and never start again.
    const secondReady=context.waitForEvent('page');fs.writeFileSync(path.join(qa,'window-request.json'),'{}');const second=await secondReady;await second.getByRole('button',{name:'Pause',exact:true}).waitFor();await second.close();
    await page.getByRole('button',{name:'Pause',exact:true}).click();assert.equal(fake.writes.at(-1).command,'pause');fake.report('paused',{stage:'Paused by user'});await page.getByRole('button',{name:'Resume',exact:true}).waitFor();await screenshot('paused-light.png');
    await page.evaluate(()=>{document.documentElement.dataset.theme='dark';localStorage.setItem('qa-theme','dark')});await page.setViewportSize({width:390,height:900});await screenshot('paused-dark-narrow.png');
    const noOverflow=await page.locator('article').evaluate(el=>el.scrollWidth<=el.clientWidth);assert.equal(noOverflow,true);
    await page.getByRole('button',{name:'Resume',exact:true}).click();fake.report('printing');await page.getByRole('button',{name:'Pause',exact:true}).waitFor();
    fake.telemetry.connected=false;await page.waitForFunction(()=>document.querySelector('article')?.textContent.includes('Status stale'));await screenshot('offline-dark-narrow.png');assert.match(await page.locator('article').innerText(),/42/);assert.match(await page.locator('article').innerText(),/may still be running/);
    await page.evaluate(()=>window.showWidget(false));await page.reload();await page.getByRole('article').waitFor();assert.equal(fake.writes.filter(w=>w.action==='start').length,1);
    fake.telemetry.connected=true;fake.report('completed',{progress:100});await page.getByRole('button',{name:'Print again'}).waitFor();await screenshot('completed-dark-narrow.png');
    await page.reload();await page.getByRole('button',{name:'Print again'}).waitFor();assert.equal(fake.writes.filter(w=>w.action==='start').length,1);
    await page.getByRole('button',{name:'Print again'}).click();await page.getByRole('button',{name:'Review print'}).waitFor();await page.getByRole('button',{name:'Review print'}).click();
    await page.getByLabel('Physical source',{exact:true}).nth(0).selectOption('ams:0:0');await page.getByRole('button',{name:'Check this setup',exact:true}).click();await page.waitForFunction(()=>document.body.textContent.includes('Map each required'));await screenshot('error-dark-narrow.png');
    await page.getByRole('button',{name:'Close print details'}).click();
    assert.equal(errors.length,0,errors.join('\n'));assert.ok(apiRequests>10);
    assert.equal(globalThis.bambuService.store.active().length,0);const readsAfter= fake.reads;await new Promise(r=>setTimeout(r,2600));assert.equal(fake.reads,readsAfter,'Completed jobs stop printer polling');
    fs.writeFileSync(path.join(qa,'receipt.json'),JSON.stringify({electron:true,normalizedToolEvent:true,realApiHandlers:true,realDurableService:true,authenticatedGateway:true,authorization:'cross-origin, bearer-agent approval, wrong owner/chat and unauthenticated daemon rejected',authorizedAttachment:true,keyboard:true,brokenImageFallback:true,sharedViews:true,completedJobsStopPolling:true,adapter:'deterministic fake',supervisor:'test lease provider; native compile/tests separate',writes:fake.writes.map(w=>w.action),screenshots:fs.readdirSync(qa).filter(f=>f.endsWith('.png')),hardware:'BLOCKED: no printer configuration or physical approval supplied'},null,2));
  }finally{
    const lastPage=app?.contexts()[0]?.pages()[0];if(lastPage){await screenshot('last-state.png').catch(()=>{});fs.writeFileSync(path.join(qa,'last-state.txt'),await lastPage.locator('body').innerText().catch(()=>''));}
    await app?.close();electronChild?.kill();await daemon.stop();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();delete globalThis.bambuService;delete globalThis.__bambuQa;
    for(const name of envNames){if(oldEnv[name]===undefined)delete process.env[name];else process.env[name]=oldEnv[name];}
  }
});
