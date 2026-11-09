import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { studioPreferences, studioLocations, inspectBambuStudio, openBambuStudio, stageStudioModel, studioModelExtension } from '../src/lib/bambu/studio.ts';
import { configuredPrinter, modelName, validateReview } from '../src/lib/bambu/compatibility.ts';
import { startCommand } from '../scripts/bambu-lan-adapter.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'breadboard-studio-'));
  t.after(() => fs.rm(root,{recursive:true,force:true}));
  const install={executable:path.join(root,'Bambu Studio','bambu-studio.exe'),resources:path.join(root,'Bambu Studio','resources'),config:path.join(root,'BambuStudio.conf')};
  await fs.mkdir(path.join(install.resources,'profiles/BBL/machine'),{recursive:true});
  await fs.writeFile(install.executable,'TEST APP, NEVER EXECUTED');
  return {root,install};
}

test('local Studio preferences recognize P2S and checksum comments without returning credentials',()=>{
  const secret='DO-NOT-EXPOSE';
  const source=JSON.stringify({app:{version:'02.06.00.51',user_last_selected_machine:secret},access_code:{printer:secret},presets:{machine:'Bambu Lab P2S 0.4 nozzle',process:'0.20mm Standard @BBL P2S',filaments:['Generic PLA @BBL P2S']}})+'\n# checksum = test\n';
  const result=studioPreferences(source);
  assert.equal(result.selected.model,'P2S');assert.equal(result.selected.nozzle,.4);
  assert.deepEqual(result.selected.filaments,['Generic PLA @BBL P2S']);
  assert.equal(JSON.stringify(result).includes(secret),false);
  assert.equal(studioPreferences('broken').selected.model,null);
  assert.equal(studioPreferences('{"presets":{"machine":"Bambu Lab Unknown 0.4 nozzle"}}').selected.model,null);
  assert.equal(modelName('Bambu Lab X1 Carbon 0.4 nozzle'),'X1C');assert.equal(modelName('N7'),'P2S');
});

test('detection reads actual installed model profiles, skips bad files and does not invent a physical connection',async t=>{
  const {install}=await fixture(t);
  await fs.writeFile(install.config,JSON.stringify({presets:{machine:'Bambu Lab P2S 0.4 nozzle'}}));
  const dir=path.join(install.resources,'profiles/BBL/machine');
  await fs.writeFile(path.join(dir,'P2S.json'),JSON.stringify({type:'machine_model',name:'Bambu Lab P2S',nozzle_diameter:'0.4;0.2;0.6;0.8;9'}));
  await fs.writeFile(path.join(dir,'broken.json'),'bad');
  const result=await inspectBambuStudio([install]);
  assert.equal(result.installed,true);assert.equal(result.selected.model,'P2S');
  assert.deepEqual(result.profiles,[{name:'Bambu Lab P2S',nozzles:[.4,.2,.6,.8]}]);
  assert.equal('connected' in result,false);assert.equal('executable' in result,false);
  assert.equal((await inspectBambuStudio([])).installed,false);
});

test('model handoff stages only CAD files under its own root, invokes the discovered app without a shell, and never starts a print',async t=>{
  const {root,install}=await fixture(t);
  const bytes=Buffer.from('solid test\nendsolid test\n');
  const file=await stageStudioModel(path.join(root,'imports'),'../../part & calc.stl',bytes);
  assert.ok(file.startsWith(path.join(root,'imports')+path.sep));
  assert.equal((await fs.readFile(file)).equals(bytes),true);
  const calls=[];
  const launch=(executable,args,options)=>{calls.push({executable,args,options});const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child;};
  const result=await openBambuStudio(file,[install],launch);
  assert.equal(result.opened,true);assert.equal(result.printStarted,false);
  assert.equal(calls[0].executable,install.executable);assert.deepEqual(calls[0].args,[file]);
  assert.equal(calls[0].options.shell,false);assert.equal(calls[0].options.windowsHide,true);
  await assert.rejects(openBambuStudio('https://evil/file.3mf',[install],launch),/local CAD/);
  await assert.rejects(openBambuStudio(undefined,[],launch),/Install Bambu/);
  assert.throws(()=>studioModelExtension('payload.exe',bytes),/valid .3mf/);
  assert.throws(()=>studioModelExtension('payload.3mf',bytes),/valid .3mf/);
  assert.equal(calls.length,1);
});

test('failed Studio launch is reported instead of claiming a handoff',async t=>{
  const {install}=await fixture(t);
  const launch=()=>{const child=new EventEmitter();queueMicrotask(()=>child.emit('error',new Error('private OS details')));return child;};
  await assert.rejects(openBambuStudio(undefined,[install],launch),error=>error.code==='bambu_studio_launch'&&!error.message.includes('private OS'));
});

test('P2S is selectable, but local Studio handles printing until direct LAN protocol is validated',()=>{
  const config=configuredPrinter({name:'My P2S',model:'P2S',nozzle:.4,buildPlate:'engineering_plate',developerModeConfirmed:true,sources:[]},'p2s',1);
  assert.equal(config.model,'P2S');config.authenticated=true;config.startCapability='eligible_unverified';
  const reasons=validateReview({printerId:'p2s',plateId:1,mapping:[],options:{bedLeveling:true,flowCalibration:false,vibrationCalibration:true}},{model:'Bambu Lab P2S',nozzle:.4,buildPlate:'engineering_plate',blockers:[],filaments:[]},config);
  assert.equal(reasons.length,1);assert.match(reasons[0],/Bambu Studio/);
  assert.throws(()=>startCommand({id:'p2s',model:'P2S',host:'192.168.1.20',serial:'22E000000001',accessCode:'TESTONLY'},{remoteFilename:'bb_'+'0'.repeat(32)+'.3mf'}),/Bambu Studio/);
});

test('standard desktop discovery includes the locally installed Windows app',()=>{
  const found=studioLocations('win32',{ProgramFiles:'C:/Apps',APPDATA:'C:/Profile',LOCALAPPDATA:'C:/Local'},'C:/User');
  assert.equal(found[0].executable,path.join('C:/Apps','Bambu Studio','bambu-studio.exe'));
  assert.equal(found[0].config,path.join('C:/Profile','BambuStudio','BambuStudio.conf'));
  assert.ok(found.some(x=>x.executable===path.join('C:/Local','Programs','Bambu Studio','bambu-studio.exe')));
});

test('Studio API checks signed-in same-origin access, rejects path arguments and hands off uploaded models without printer commands',async t=>{
  const {root}=await fixture(t);
  globalThis.__studioRouteTest={userId:1,root,opens:[]};
  t.after(()=>{delete globalThis.__studioRouteTest;});
  const stubs={
    'server-auth.ts':'export class RouteError extends Error {constructor(status,message){super(message);this.status=status;}} export const requireUserId=()=>{if(!globalThis.__studioRouteTest.userId)throw new RouteError(401,"Unauthorized");return globalThis.__studioRouteTest.userId;};',
    'conversations/store.ts':'export const getConversationForUser=()=>({});',
    'runtime-paths.ts':'export const dashboardBulkDataDir=()=>globalThis.__studioRouteTest.root;',
  };
  const plugins=[{name:'test-host',setup(b){
    b.onResolve({filter:/.*/},args=>{
      const portable=(args.path.startsWith('.')?path.resolve(args.resolveDir,args.path):args.path).replaceAll('\\','/');
      const key=Object.keys(stubs).find(k=>portable.endsWith('/'+k)||(portable+'.ts').endsWith('/'+k));
      return key?{path:key,namespace:'test-host'}:null;
    });
    b.onLoad({filter:/.*/,namespace:'test-host'},args=>({contents:stubs[args.path],loader:'ts'}));
    b.onLoad({filter:/[/\\]bambu[/\\]studio\.ts$/},async args=>({loader:'ts',contents:(await fs.readFile(args.path,'utf8')).replace('export async function inspectBambuStudio(locations = studioLocations()): Promise<BambuStudioStatus> {','export async function inspectBambuStudio(locations = studioLocations()): Promise<BambuStudioStatus> {\n return {installed:true,message:"test"} as BambuStudioStatus;').replace('export async function openBambuStudio(file?: string, locations = studioLocations(), launch = spawn) {','export async function openBambuStudio(file?: string, locations = studioLocations(), launch = spawn) {\n globalThis.__studioRouteTest.opens.push(file ?? null); return {opened:true,printStarted:false};')}));
  }}];
  const outfile=path.join(root,'route.cjs');
  await build({entryPoints:[path.resolve('src/app/api/hermes/connections/bambu/studio/route.ts')],outfile,bundle:true,platform:'node',format:'cjs',plugins,logLevel:'silent'});
  const route=createRequire(import.meta.url)(outfile);
  const url='http://127.0.0.1:1234/api/hermes/connections/bambu/studio';
  const post=(body,headers={origin:'http://127.0.0.1:1234'})=>route.POST(new Request(url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)}));
  globalThis.__studioRouteTest.userId=null;
  assert.equal((await route.GET(new Request(url))).status,401);
  globalThis.__studioRouteTest.userId=1;
  assert.equal((await route.GET(new Request(url))).status,200);
  assert.equal((await post({action:'open'},{})).status,403);
  assert.equal((await post({action:'open'},{origin:'https://foreign.example'})).status,403);
  assert.equal((await post({action:'open'},{origin:'http://127.0.0.1:1234',authorization:'Bearer tool'})).status,403);
  assert.equal((await post({action:'open',file:'C:/private/file.3mf'})).status,400);
  assert.equal((await post({action:'open'})).status,200);
  const response=await route.POST(new Request(url,{method:'POST',headers:{origin:'http://127.0.0.1:1234','content-type':'application/octet-stream','x-bambu-filename':encodeURIComponent('../../test.stl')},body:'solid test\nendsolid test\n'}));
  assert.equal(response.status,200);assert.equal((await response.json()).printStarted,false);
  assert.equal(globalThis.__studioRouteTest.opens.length,2);
  assert.ok(globalThis.__studioRouteTest.opens[1].startsWith(path.join(root,'bambu/studio/1')+path.sep));
});
