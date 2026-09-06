import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { validateRuntimeV2OuterAgentRequest } from "../scripts/runtime-v2-outer-agent-adapters.mjs";
import { executeManagedSetup, validateManagedSetupRequest } from "../scripts/runtime-v2-managed-setup-executor.mjs";

const repo=path.resolve(import.meta.dirname,"../.."),read=file=>fs.readFileSync(path.join(repo,file),"utf8");
test("music execution has a closed native launch contract and a complete packaged source closure",()=>{
  const workers=JSON.parse(read('desktop/runtime-v2/manifests/workers.json')).workers;
  const worker=workers.find(value=>value.kind==='outer-music-producer-node');
  assert.equal(worker.maximumConcurrency,1);assert.equal(worker.environmentSource,'music-producer');assert.equal(worker.exitAfterJob,true);
  assert.ok(fs.existsSync(path.join(repo,worker.allowedEntrypoint)));
  const request={launchId:'music_'+'1'.repeat(32),task:'Ambient piano',model:'model',reasoningEffort:'medium',baseUrl:'http://127.0.0.1:8000/v1',conversationPublicId:'conv_'+'a'.repeat(24),conversationContext:'',defaults:{duration:60,vocalMode:'instrumental'},explicit:{}};
  assert.deepEqual(validateRuntimeV2OuterAgentRequest('music-producer',request),request);
  for(const extra of [{executable:'python'},{env:{}},{cwd:'C:/elsewhere'},{argv:['install']}])assert.throws(()=>validateRuntimeV2OuterAgentRequest('music-producer',{...request,...extra}));
  const service=JSON.parse(read('desktop/runtime-v2/manifests/services.json')).services.find(value=>value.id==='acestep');
  assert.equal(service.startupPolicy,'on-demand');assert.equal(service.maximumConcurrentLeases,1);assert.equal(service.restartPolicy,'never');assert.equal(service.idleTtlMs,60000);
  for(const profile of service.launchProfiles){assert.equal(profile.executableAuthority,'data-root');assert.equal(profile.allowedExecutable,'runtime-v2/services/acestep/.venv/Scripts/python.exe');assert.equal(profile.environmentSource,'acestep');assert.equal(profile.arguments[1].path,'dashboard/scripts/acestep-managed-service.py');}
  const packaging=read('desktop/scripts/prepare-app-resources.mjs');
  for(const script of ['runtime-v2-music-producer-worker.mjs','acestep-managed-service.py','acestep-setup.py'])assert.ok(packaging.includes('"'+script+'"'));
  assert.match(packaging,/worker-src/);assert.match(packaging,/repoRoot, "dashboard", "src"/);
  const workerSource=read('dashboard/src/lib/music-producer/worker.ts');assert.doesNotMatch(workerSource,/child_process|spawn\(|execFile\(/);
  for(const route of ['runs','settings','health','setup','provider']){const source=read(`dashboard/src/app/api/music-producer/${route}/route.ts`);assert.match(source,/requireUserId\(/);assert.doesNotMatch(source,/child_process|spawn\(|execFile\(/);}
  assert.match(read('dashboard/src/lib/conversations/external-agent-cancel.ts'),/music_producer/);
});
test("explicit setup runs only the fixed script as a Runtime-owned child with isolated data",async t=>{
  const dataRoot=fs.mkdtempSync(path.join(os.tmpdir(),'bb-music-setup-'));t.after(()=>fs.rmSync(dataRoot,{recursive:true,force:true}));
  const tools=path.join(dataRoot,'tools');fs.mkdirSync(tools);const uv=path.join(tools,process.platform==='win32'?'uv.exe':'uv');fs.writeFileSync(uv,'fixture');
  let called=0;
  const result=await executeManagedSetup({protocolVersion:1,operation:'acestep',action:'install'},{dataRoot,appRoot:repo,env:{PATH:tools,PATHEXT:'.EXE',BREADBOARD_SUPERVISOR_CONTROL_TOKEN:'fixture-secret'},signal:new AbortController().signal,spawnImpl:(executable,args,options)=>{
    called++;assert.equal(executable.toLowerCase(),uv.toLowerCase());assert.deepEqual(args,['run','--no-project','--python','3.11',path.join(repo,'dashboard/scripts/acestep-setup.py'),dataRoot,executable]);
    assert.equal(options.cwd,dataRoot);assert.equal(options.detached,false);assert.equal(options.shell,false);assert.equal(options.windowsHide,true);assert.equal(options.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN,undefined);
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>true;setImmediate(()=>{child.stdout.end('fixture setup completion');child.stderr.end();child.emit('close',0,null);});return child;
  }});
  assert.equal(result.ok,true);assert.equal(called,1);
  assert.throws(()=>validateManagedSetupRequest({protocolVersion:1,operation:'acestep',action:'install',args:['anything']}));
  const service=read('dashboard/scripts/acestep-managed-service.py');assert.match(service,/HF_HUB_OFFLINE/);assert.match(service,/snapshot_download = deny_download/);assert.match(service,/host="127.0.0.1"/);
});
test("SSE replays sequenced events after the cursor and closes on a durable terminal event",async()=>{
  // TypeScript's bundler resolver permits next/server; Node's test loader requires its .js path.
  const require=createRequire(import.meta.url);
  const code=ts.transpileModule(read('dashboard/src/lib/runtime-v2/outer-agent-events-route.ts'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace('"next/server"',JSON.stringify(pathToFileURL(require.resolve('next/server.js')).href));
  const {outerAgentEventsResponse}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
  const cursors=[],events=[1,2,3].map(sequenceNumber=>({sequenceNumber,type:sequenceNumber===3?'run.completed':'music.stage',payload:{message:'fixture'},at:new Date(0).toISOString()}));
  const response=await outerAgentEventsResponse({runId:'fixture',request:new Request('http://fixture/events?since=0',{headers:{accept:'text/event-stream','last-event-id':'1'}}),pollMs:1,readView:async since=>{cursors.push(since);return{terminal:true,status:'completed',events:events.filter(event=>event.sequenceNumber>since)};}});
  const text=await response.text();assert.deepEqual(cursors,[1]);assert.doesNotMatch(text,/id: 1\n/);assert.match(text,/id: 2\nevent: music.stage/);assert.match(text,/id: 3\nevent: run.completed/);
  const controller=new AbortController();let reads=0;
  const stream=await outerAgentEventsResponse({runId:'fixture',request:new Request('http://fixture/events',{headers:{accept:'text/event-stream'},signal:controller.signal}),pollMs:1,readView:async()=>{reads++;return{terminal:false,status:'running',events:[]};}});
  controller.abort();await stream.text();const count=reads;await new Promise(resolve=>setTimeout(resolve,5));assert.equal(reads,count);
});
test("both surfaces retain private delegation observers, explicit launch identity and scoped source editing",()=>{
  const terminal=read('dashboard/src/app/components/hermes/agent-runtime-panel.tsx'),garden=read('dashboard/src/app/gardens/[clusterSlug]/workspace-client.tsx');
  for(const source of [terminal,garden]){assert.match(source,/InlineMusicProducerRun/);assert.match(source,/persistedOutcome=.*externalAgentOutcome/);assert.match(source,/externalAgentCardContent\(storedMessage\)/);assert.match(source,/delegatedAgentRun &&\s+!(?:message|msg)\.openGymRun &&\s+!(?:message|msg)\.godsEyeRun/);}
  const launcher=read('dashboard/src/app/components/hermes/dashboard-agent-terminal.tsx');
  assert.match(launcher,/launchMusicProducerRun\(request\.brief, selected, request\)/);assert.match(launcher,/musicProducerUserMessage/);
  assert.match(garden,/case "music-producer"/);assert.match(garden,/delegatedAgentRun/);
  const audio=read('dashboard/src/app/api/hermes/tools/audio/route.ts');assert.match(audio,/generatedAudioTrack/);assert.match(audio,/verifyCapabilityToken/);assert.match(audio,/decision\.allowedTools\.includes\(action\)/);
});
