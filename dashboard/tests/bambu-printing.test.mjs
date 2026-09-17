import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { BambuStore } from '../src/lib/bambu/store.ts';
import { BambuJobService } from '../src/lib/bambu/job-service.ts';
import { inspectSlicedFile } from '../src/lib/bambu/inspection.ts';
import { configuredHost, configuredPrinter, validateReview } from '../src/lib/bambu/compatibility.ts';
import { generativeUiResourcesFromToolOutput, normalizeGenerativeUiResources, generativeUiResourcesFromVerification } from '../src/lib/generative-ui/contracts.ts';
import { normalizeTelemetry, startCommand, mergePrinterReport } from '../scripts/bambu-lan-adapter.mjs';
import { FakePrinterAdapter, slicedFixture, sources } from './helpers/bambu-fake.mjs';

async function harness(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'breadboard-bambu-'));
  const db = new Database(path.join(root,'test.db')); db.pragma('foreign_keys = ON'); db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1),(2)');
  const store = new BambuStore(db), adapter = new FakePrinterAdapter();
  const config = configuredPrinter({name:'Studio printer',model:'P1S',nozzle:0.4,buildPlate:'textured_plate',developerModeConfirmed:true,sources:sources()},'printer1',1);
  config.authenticated = true; config.startCapability='eligible_unverified';
  store.savePrinter({userId:1,config,host:'192.168.1.42',serial:'01P000000001',physicalIdentity:'physical1'});
  const credential = async printer => ({id:printer.config.id,host:printer.host,serial:printer.serial,model:printer.config.model,accessCode:'TESTONLY'});
  const service = new BambuJobService(store,path.join(root,'files'),adapter,credential);
  const scope={userId:1,conversationId:1,conversationPublicId:'conv_test',runtimeSessionId:8,runId:'run_one',originatingTurnId:'turn_one'};
  const review={printerId:'printer1',plateId:1,mapping:[{filamentIndex:0,sourceId:'ams:0:0',acceptColorSubstitution:false},{filamentIndex:1,sourceId:'ams:1:0',acceptColorSubstitution:false}],options:{bedLeveling:true,flowCalibration:false,vibrationCalibration:true}};
  async function prepared(bytes=slicedFixture()) { let job=service.create(scope); job=await service.stage(job.id,1,'conv_test',job.revision,bytes,'pièce déjà tranchée.gcode.3mf'); return service.review(job.id,1,'conv_test',job.revision,review); }
  const approve = job => service.approve(job.id,1,'conv_test',job.revision,{plateClear:true,physicalSetup:true});
  t.after(async()=>{db.close();await fs.rm(root,{recursive:true,force:true});});
  return {service,store,adapter,scope,review,config,prepared,approve,root,credential};
}

test('sliced archives require machine instructions and metadata, with optional estimates kept unknown', async () => {
  const result=await inspectSlicedFile(slicedFixture(),'valid.gcode.3mf');
  assert.equal(result.plates[0].nozzle,0.4);assert.equal(result.plates[0].durationSeconds,4800);assert.equal(result.plates[0].grams,12.5);
  assert.deepEqual(result.plates[0].filaments.map(f=>f.index),[0,1]);assert.equal(result.plates[0].blockers.length,0);
  const absent=await inspectSlicedFile(slicedFixture({estimates:false}),'valid.gcode.3mf');assert.equal(absent.plates[0].durationSeconds,null);assert.equal(absent.plates[0].grams,null);
  for (const [bytes,name] of [[slicedFixture({unsliced:true}),'unsliced.gcode.3mf'],[Buffer.from('PKbroken'),'corrupt.gcode.3mf'],[slicedFixture(),'model.stl']]) await assert.rejects(inspectSlicedFile(bytes,name));
  const missing=await inspectSlicedFile(slicedFixture({missing:true}),'missing.gcode.3mf');assert.ok(missing.plates[0].blockers.some(s=>s.includes('indices')));
});
test('archive traversal, decompression bombs, unsupported methods and corruption are rejected', async () => {
  const zip=slicedFixture({extra:{'safe.txt':'plain'}});const traversal=Buffer.from(zip.toString('latin1').replaceAll('safe.txt','../a.txt'),'latin1');
  await assert.rejects(inspectSlicedFile(traversal,'unsafe.gcode.3mf'),/unsafe/);
  const bomb=slicedFixture();const central=bomb.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));bomb.writeUInt32LE(65*1024*1024,central+24);
  await assert.rejects(inspectSlicedFile(bomb,'bomb.gcode.3mf'),/oversized/);
  const corrupt=slicedFixture();corrupt[40]^=0xff;await assert.rejects(inspectSlicedFile(corrupt,'corrupt.gcode.3mf'));
});
test('compatibility blocks wrong model/nozzle/plate, missing sources, material mismatch and unsupported external combinations',async t=>{
  const h=await harness(t), {plates}=await inspectSlicedFile(slicedFixture(),'part.gcode.3mf'), plate=plates[0];
  assert.deepEqual(validateReview(h.review,plate,h.config),[]);
  for (const change of [{model:'Bambu Lab A1'},{nozzle:0.6},{buildPlate:'cool_plate'}]) assert.ok(validateReview(h.review,{...plate,...change},h.config).length);
  assert.ok(validateReview(h.review,plate,{...h.config,sources:[]}).length);
  assert.ok(validateReview(h.review,plate,{...h.config,sources:sources().map(s=>({...s,material:'ABS'}))}).length);
  const substitute={...h.review,mapping:[h.review.mapping[0],{...h.review.mapping[1],sourceId:'ams:0:0'}]};
  assert.ok(validateReview(substitute,plate,h.config).some(s=>s.includes('colour')));substitute.mapping[1].acceptColorSubstitution=true;assert.deepEqual(validateReview(substitute,plate,h.config),[]);
  const external={...sources()[0],id:'external',unit:null,tray:null};
  const single={...plate,filaments:[plate.filaments[0]]};const externalReview={...h.review,mapping:[{filamentIndex:0,sourceId:'external',acceptColorSubstitution:false}]};
  assert.deepEqual(validateReview(externalReview,single,{...h.config,sources:[external]}),[]);
  assert.ok(validateReview({...h.review,mapping:h.review.mapping.map(m=>({...m,sourceId:'external',acceptColorSubstitution:true}))},plate,{...h.config,sources:[external]}).some(s=>s.includes('multi-material')));
  assert.throws(()=>configuredPrinter({...h.config,model:'H2D'},'x',1));
  for(const host of ['127.0.0.1','8.8.8.8','http://192.168.1.2','printer.local','192.168.1.255']) assert.throws(()=>configuredHost(host));
});
test('one canonical task/turn draft and widget round-trip through actual tool-output normalization',async t=>{
  const h=await harness(t), first=h.service.create(h.scope), second=h.service.create(h.scope);assert.equal(first.id,second.id);
  const other=h.service.create({...h.scope,runId:'another-run',conversationId:2,conversationPublicId:'conv_other'});assert.notEqual(first.id,other.id);
  assert.throws(()=>h.store.get(first.id,2,'conv_test'));assert.throws(()=>h.store.get(first.id,1,'conv_other'));
  const resource={schemaVersion:1,kind:'printer-job',renderer:'bambu-print-card',id:first.resourceId,title:'Bambu',createdAt:first.createdAt,actions:['approve'],data:{jobId:first.id,runId:h.scope.runId,conversationPublicId:h.scope.conversationPublicId,originatingTurnId:h.scope.originatingTurnId,approved:true,host:'evil'}};
  const normalized=generativeUiResourcesFromToolOutput('bambu_print_prepare',JSON.stringify({uiResources:[resource,resource]}));assert.equal(normalized.length,1);assert.deepEqual(normalized[0].actions,[]);assert.equal(normalized[0].data.host,undefined);
  assert.deepEqual(generativeUiResourcesFromToolOutput('arbitrary_tool',{uiResources:[resource]}),[]);
  assert.equal(normalizeGenerativeUiResources(JSON.parse(JSON.stringify(normalized))).length,1);
  assert.equal(generativeUiResourcesFromVerification({evidence:[{success:true,details:{toolName:'bambu_print_prepare',result:{uiResources:[resource]}}}]}).length,1);
});
test('preparation performs zero printer writes; wrong-user, wrong-job, stale and missing consent fail',async t=>{
  const h=await harness(t),job=await h.prepared();assert.equal(job.state,'awaiting_approval');assert.equal(h.adapter.writes.length,0);
  assert.throws(()=>h.service.approve(job.id,2,'conv_test',job.revision,{plateClear:true,physicalSetup:true}));
  assert.throws(()=>h.service.approve('forged',1,'conv_test',job.revision,{plateClear:true,physicalSetup:true}));
  assert.throws(()=>h.service.approve(job.id,1,'conv_test',job.revision-1,{plateClear:true,physicalSetup:true}));
  assert.throws(()=>h.service.approve(job.id,1,'conv_test',job.revision,{plateClear:false,physicalSetup:true}));
  const printer=h.store.printer('printer1');printer.config.revision++;h.store.savePrinter(printer);assert.throws(()=>h.approve(job),/configuration changed/);assert.equal(h.adapter.writes.length,0);
});
test('expired or forged approval snapshots cannot dispatch',async t=>{
  const h=await harness(t),job=h.approve(await h.prepared());job.approval.expiresAt=new Date(Date.now()-1).toISOString();h.store.save(job);await h.service.tick();assert.equal(h.adapter.writes.length,0);assert.equal(h.store.get(job.id).state,'blocked');
  const updated=h.service.review(job.id,1,'conv_test',h.store.get(job.id).revision,h.review);const forged=h.approve(updated);forged.approval.snapshot.review.options.bedLeveling=false;h.store.save(forged);await h.service.tick();assert.equal(h.adapter.writes.length,0);
});
test('double approval and concurrent ticks dispatch one attempt; telemetry alone confirms printing and completion',async t=>{
  const h=await harness(t),job=await h.prepared();h.approve(job);h.approve(job);await Promise.all([h.service.tick(),h.service.tick(),h.service.tick()]);
  assert.deepEqual(h.adapter.writes.map(w=>w.action),['upload','start']);assert.equal(h.store.get(job.id).state,'start_unconfirmed');
  h.adapter.report('preparing',{progress:0,stage:'Heating nozzle'});await h.service.tick();assert.equal(h.store.get(job.id).state,'preparing');
  h.adapter.report('printing',{progress:100,layer:50,totalLayers:50});await h.service.tick();assert.equal(h.store.get(job.id).state,'printing');
  h.adapter.report('idle');await h.service.tick();assert.equal(h.store.get(job.id).state,'printing');
  h.adapter.report('completed');await h.service.tick();assert.equal(h.store.get(job.id).state,'completed');assert.ok(h.store.get(job.id).finishedAt);
  const next=h.service.again(job.id,1,'conv_test');assert.notEqual(next.id,job.id);assert.equal(next.state,'review_required');assert.equal(next.approval,null);assert.equal(h.service.again(job.id,1,'conv_test').id,next.id);assert.equal(h.store.get(job.id).nextJobId,next.id);
});
test('busy after upload never queues or starts; uncertain dispatch never resends after restart',async t=>{
  const h=await harness(t),job=h.approve(await h.prepared());h.adapter.busyAfterUpload=true;await h.service.tick();assert.equal(h.store.get(job.id).state,'blocked');assert.deepEqual(h.adapter.writes.map(w=>w.action),['upload']);
  h.adapter.busyAfterUpload=false;h.adapter.telemetry.state='idle';const j=h.service.review(job.id,1,'conv_test',h.store.get(job.id).revision,h.review);h.approve(j);h.adapter.startTimeout=true;await h.service.tick();
  assert.equal(h.store.get(job.id).state,'start_unconfirmed');const before=h.adapter.writes.length;
  const restored=new BambuJobService(new BambuStore(h.store.db),path.join(h.root,'files'),h.adapter,h.credential);restored.recover();await restored.tick();assert.equal(h.adapter.writes.length,before);
  assert.equal(restored.view(job.id,1,'conv_test').job.id,job.id);
});
test('a crash before start, or a cancelled upload, never replays upload/start',async t=>{
  const h=await harness(t),job=h.approve(await h.prepared());h.service.recover();await h.service.tick();assert.equal(h.adapter.writes.length,0);
  h.approve(h.service.review(job.id,1,'conv_test',h.store.get(job.id).revision,h.review));
  let release;h.adapter.uploadHold=new Promise(resolve=>{release=resolve;});const pending=h.service.tick();
  while(!h.adapter.writes.length) await new Promise(resolve=>setTimeout(resolve,1));
  h.service.cancelDraft(job.id,1,'conv_test');assert.equal(h.store.isLocked('physical1'),true);release();await pending;
  assert.equal(h.adapter.writes.filter(w=>w.action==='start').length,0);assert.equal(h.store.isLocked('physical1'),false);
});
test('connection loss preserves values, and old widgets cannot control unrelated jobs',async t=>{
  const h=await harness(t),job=h.approve(await h.prepared());await h.service.tick();h.adapter.report('printing',{progress:44,layer:30});await h.service.tick();
  h.adapter.telemetry.connected=false;await h.service.tick();assert.equal(h.store.get(job.id).state,'printing');assert.equal(h.store.get(job.id).telemetry.progress,44);assert.equal(h.service.view(job.id,1,'conv_test').stale,true);
  h.adapter.telemetry.connected=true;h.adapter.report('printing',{filename:'external-job.3mf'});await assert.rejects(h.service.control(job.id,1,'conv_test','pause',false),/not confirmed/);
  h.adapter.report('printing');await h.service.control(job.id,1,'conv_test','pause',false);assert.equal(h.store.get(job.id).state,'printing');assert.equal(h.store.get(job.id).pendingControl,'pause');
  h.adapter.report('paused');await h.service.tick();assert.equal(h.store.get(job.id).state,'paused');assert.equal(h.store.get(job.id).pendingControl,null);
  await assert.rejects(h.service.control(job.id,1,'conv_test','cancel',false));await h.service.control(job.id,1,'conv_test','cancel',true);assert.equal(h.store.get(job.id).state,'cancel_requested');
  h.adapter.report('failed',{printError:0});await h.service.tick();assert.equal(h.store.get(job.id).state,'cancelled');
});
test('real adapter command encodes the exact selected plate and multi-AMS mapping without automatic matching',async t=>{
  const h=await harness(t),job=h.approve(await h.prepared());const access={id:'printer1',host:'192.168.1.42',serial:'01P000000001',model:'P1S',accessCode:'TESTONLY'};
  const command=startCommand(access,{snapshot:job.approval.snapshot,remoteFilename:'bb_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.3mf',attemptId:'123'}).print;
  assert.equal(command.command,'project_file');assert.equal(command.param,'Metadata/plate_1.gcode');assert.deepEqual(command.ams_mapping,[0,4,-1,-1,-1]);assert.equal(command.flow_cali,false);assert.equal(command.auto_match_ams,undefined);
  assert.throws(()=>startCommand(access,{snapshot:job.approval.snapshot,remoteFilename:'../unsafe',attemptId:'123'}));
  const state=normalizeTelemetry({gcode_state:'RUNNING',stg_cur:7,mc_percent:1},{},new Date().toISOString());assert.equal(state.state,'preparing');assert.equal(state.stage,'Heating nozzle');assert.equal(state.remainingMinutes,undefined);
});

test('file tampering and edits invalidate consent, and physical locks exclude a second task',async t=>{
  const h=await harness(t),first=h.approve(await h.prepared());
  const second=h.service.create({...h.scope,runId:'run_two',originatingTurnId:'turn_two'});
  let staged=await h.service.stage(second.id,1,'conv_test',second.revision,slicedFixture(),'second.gcode.3mf');
  staged=h.service.review(second.id,1,'conv_test',staged.revision,h.review);assert.throws(()=>h.approve(staged),/already has/);
  await fs.appendFile(h.service.artifactPath(first.file.id),'tampered');await h.service.tick();assert.equal(h.adapter.writes.length,0);assert.equal(h.store.get(first.id).state,'blocked');
  const changed=h.service.review(staged.id,1,'conv_test',staged.revision,{...h.review,options:{...h.review.options,bedLeveling:false}});
  assert.throws(()=>h.approve(staged),/review has changed/);assert.equal(changed.approval,null);
});
test('uncertain starts close only after explicit inspection and fresh idle, never another machine command',async t=>{
  const h=await harness(t),job=h.approve(await h.prepared());h.adapter.startTimeout=true;await h.service.tick();
  await assert.rejects(h.service.resolveInspected(job.id,1,'conv_test',job.revision,false),/Inspect/);
  h.adapter.report('printing',{filename:'other.3mf'});await assert.rejects(h.service.resolveInspected(job.id,1,'conv_test',job.revision,true),/idle/);
  h.adapter.report('idle');const closed=await h.service.resolveInspected(job.id,1,'conv_test',job.revision,true);assert.equal(closed.state,'cancelled');assert.match(closed.message,/unknown/);assert.equal(h.store.isLocked('physical1'),false);
  assert.deepEqual(h.adapter.writes.map(w=>w.action),['upload','start']);const again=h.service.again(job.id,1,'conv_test');assert.equal(again.approval,null);assert.equal(again.state,'review_required');
});
test('partial new job reports cannot inherit a previous identity, progress or completed state',()=>{
  const old={gcode_file:'old.3mf',subtask_name:'old.3mf',task_id:'123',gcode_state:'FINISH',mc_percent:100,layer_num:50};
  const previous=normalizeTelemetry(old,{});
  const delta={subtask_name:'new.3mf',task_id:'456'};const merged=mergePrinterReport(old,delta);
  assert.equal(merged.gcode_file,undefined);assert.equal(merged.mc_percent,undefined);assert.equal(merged.gcode_state,undefined);
  const report=normalizeTelemetry(merged,previous,new Date().toISOString(),delta);assert.equal(report.filename,'new.3mf');assert.equal(report.progress,undefined);assert.equal(report.state,undefined);
  for (const partial of [{gcode_file:'',task_id:'0'},{task_id:'456',gcode_state:'RUNNING'}]) {
    const unbound=normalizeTelemetry(mergePrinterReport(old,partial),previous,new Date().toISOString(),partial);assert.equal(unbound.filename,undefined);assert.equal(unbound.identityObservedAt,undefined);
  }
});
test('unrelated live jobs preserve this task values and stale control state is rejected',async t=>{
  const h=await harness(t),job=h.approve(await h.prepared());await h.service.tick();h.adapter.report('printing',{progress:42});await h.service.tick();
  h.adapter.report('printing',{filename:'unrelated.3mf',progress:87});await h.service.tick();assert.equal(h.store.get(job.id).telemetry.progress,42);assert.equal(h.service.view(job.id,1,'conv_test').stale,true);
  h.adapter.report('printing');const read=h.adapter.observe.bind(h.adapter);h.adapter.observe=async()=>({...await read(),stateObservedAt:new Date(Date.now()-60000).toISOString()});await assert.rejects(h.service.control(job.id,1,'conv_test','pause',true));assert.equal(h.adapter.writes.filter(w=>w.action==='control').length,0);
});

test('known-empty live inventory blocks upload and cancelled transfers release recovered locks',async t=>{
  const h=await harness(t),job=h.approve(await h.prepared());h.adapter.telemetry.sources=[];await h.service.tick();assert.equal(h.adapter.writes.length,0);assert.equal(h.store.get(job.id).state,'blocked');
  const cancelled=h.store.get(job.id);cancelled.state='cancelled';h.store.save(cancelled);h.store.lock('physical1',job.id);h.service.recover();assert.equal(h.store.isLocked('physical1'),false);
});
