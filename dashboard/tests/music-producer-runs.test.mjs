import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakeAceStep, testWav } from "./helpers/fake-acestep.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-music-runs-"));
process.env.BREADBOARD_DATA_DIR = root;
// This suite never contacts the real Runtime or optional analyzer.
delete process.env.BREADBOARD_RUNTIME_V2_CONTROL_URL;
const { default: db } = await import("../src/lib/db.ts");
const store = await import("../src/lib/conversations/store.ts");
const runtime = await import("../src/lib/hermes/runtime-store.ts");
const turns = await import("../src/lib/conversations/external-agent-turns.ts");
const launchStore = await import("../src/lib/music-producer/store.ts");
const artifacts = await import("../src/lib/hermes/artifact-store.ts");
const { musicArtifactContext, publishMusic } = await import("../src/lib/music-producer/artifacts.ts");
const { resolveMusicSource } = await import("../src/lib/music-producer/sources.ts");
const { musicRequestSchema } = await import("../src/lib/music-producer/request.ts");
const { executeMusicWorker } = await import("../src/lib/music-producer/worker.ts");
const { preparedAceStep, ACESTEP_MODEL_REVISION } = await import("../src/lib/acestep/prepared.ts");
const { ACESTEP_REVISION } = await import("../src/lib/acestep/capabilities.ts");
db.prepare("INSERT INTO users(id,username,email,password_hash) VALUES(1,'music-one','music-one@example.test','unused'),(2,'music-two','music-two@example.test','unused')").run();
test.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
const deps = { acquireServiceLease: async () => ({ leaseId: "fixture" }), releaseSupervisorLease: async () => {}, runAudioAnalysis: async () => { throw Error("optional fixture analyzer unavailable"); } };

function fixture(connection, overrides = {}) {
  const conversation = store.createConversation({ userId: 1, title: "Music fixture" });
  runtime.createRuntimeSession({ conversationId: conversation.id, userId: 1, surface: "dashboard_terminal", chatSessionId: null, agentName: "Hermes", clusterId: null, gardenId: null, pageSlug: null, workspaceKey: crypto.randomUUID(), activeDirectory: root, filesystemMode: "restricted", hermesSessionId: crypto.randomUUID() });
  const launchId = `music_${crypto.randomBytes(16).toString('hex')}`, clientMessageId = crypto.randomUUID();
  launchStore.createMusicLaunch({ id: launchId, userId: 1, conversationPublicId: conversation.public_id, clientMessageId, task: "test fixture" });
  turns.recordExternalAgentTurn({ conversation, clientMessageId, surface: "dashboard_terminal", userContent: "/agents:music-producer test fixture", run: { kind: "music_producer", runId: launchId, task: "test fixture" } });
  const request = musicRequestSchema.parse({ brief: "test fixture audio", ...overrides });
  launchStore.updateMusicLaunch(1,launchId,{ request_json: JSON.stringify(request), provider_json: JSON.stringify({ ...connection, managed:false, directory:root }) });
  const workspace = path.join(root, launchId); fs.mkdirSync(workspace);
  const controller = new AbortController(), events = [];
  return { conversation, request, events, controller, input: { launchId, task:"test fixture", model:"fixture", reasoningEffort:"medium", baseUrl:"http://127.0.0.1:1/v1", conversationPublicId:conversation.public_id, conversationContext:"", defaults:{duration:60,vocalMode:"instrumental"}, explicit:{}, userId:1, workspace, signal:controller.signal, update: next => events.push(...next) } };
}
test("worker commits real audio, literal lyrics and an owned transcript without a browser", async t => {
  const fake = await fakeAceStep(); t.after(() => fake.close());
  const f = fixture(fake.connection, { vocalMode:"vocal", language:"tr", lyrics:"Bir ses\nGökyüzünde" });
  const result = await executeMusicWorker(f.input,deps); assert.equal(result.status,"completed");
  const launch = launchStore.musicLaunch(1,f.input.launchId); assert.equal(launch.provider_receipt,"task-1");
  assert.equal(launch.collection_state,"completed"); assert.match(launch.summary,/measured 0.20s/); assert.match(launch.summary,/\[Lyrics\]/);
  const list = artifacts.listArtifactsForUser({userId:1,conversationPublicId:f.conversation.public_id});
  assert.equal(list.length,2); const audio = list.find(a=>a.kind==='audio'), lyrics=list.find(a=>a.kind==='markdown');
  assert.equal(audio.renderer_id,"audio-file"); assert.equal(lyrics.status,"ready");
  assert.equal(fs.readFileSync(artifacts.artifactDeliveryFile(lyrics,1).absolutePath,'utf8'),f.request.lyrics);
  assert.equal(lyrics.parent_artifact_id,audio.id);
  assert.throws(()=>artifacts.getArtifactForUser({userId:2,conversationPublicId:f.conversation.public_id,artifactId:audio.id}));
  const other=store.createConversation({userId:1,title:"Other chat"});
  assert.throws(()=>resolveMusicSource(1,other.public_id,{kind:"artifact",artifactId:audio.id,version:1}));
  assert.throws(()=>resolveMusicSource(1,f.conversation.public_id,{kind:"artifact",artifactId:audio.id,version:99}));
  assert.ok(f.events.every((event,index)=>event.sequenceNumber===index+1));
  assert.equal(f.events.at(-1).type,"run.completed");
  // Re-enter with the persisted receipt: no second submission or import.
  await executeMusicWorker(f.input,deps);
  assert.equal(fake.submissions,1); assert.equal(artifacts.listArtifactVersions(audio.id).length,1);
  assert.equal(artifacts.listArtifactsForUser({userId:1,conversationPublicId:f.conversation.public_id}).length,2);
});
test("version publication is idempotent, accepts pinned history and retains bytes after rejected revisions", async t => {
  const fake=await fakeAceStep(); t.after(()=>fake.close()); const f=fixture(fake.connection);
  await executeMusicWorker(f.input,deps); const launch=launchStore.musicLaunch(1,f.input.launchId);
  const context=musicArtifactContext(1,f.input.launchId), file=path.join(f.input.workspace,'version.wav'); fs.writeFileSync(file,testWav(0.2,440));
  const nextId=`music_${crypto.randomBytes(16).toString('hex')}`;
  launchStore.createMusicLaunch({id:nextId,userId:1,conversationPublicId:f.conversation.public_id,clientMessageId:crypto.randomUUID(),task:'revise'});
  const request=musicRequestSchema.parse({brief:'darker',operation:'cover',source:{kind:'artifact',artifactId:launch.artifact_id,version:1}});
  const input={userId:1,id:nextId,context,request,sourceFile:file,authorizedRoot:f.input.workspace,metadata:{},signal:f.controller.signal};
  const saved=await publishMusic(input); assert.equal(saved.version,2); assert.equal(saved.artifact.id,launch.artifact_id);
  assert.equal((await publishMusic(input)).version,2); assert.equal(artifacts.listArtifactVersions(saved.artifact.id).length,2);
  const third=`music_${crypto.randomBytes(16).toString('hex')}`; launchStore.createMusicLaunch({id:third,userId:1,conversationPublicId:f.conversation.public_id,clientMessageId:crypto.randomUUID(),task:'revise version one'});
  fs.writeFileSync(file,testWav(0.2,660));
  const historical=await publishMusic({...input,id:third}); assert.equal(historical.version,3);
  assert.equal(JSON.parse(artifacts.listArtifactVersions(saved.artifact.id).find(row=>row.version===3).metadata_json).source.version,1);
  const fourth=`music_${crypto.randomBytes(16).toString('hex')}`; launchStore.createMusicLaunch({id:fourth,userId:1,conversationPublicId:f.conversation.public_id,clientMessageId:crypto.randomUUID(),task:'cancel revision'});
  launchStore.updateMusicLaunch(1,fourth,{collection_state:'cancelling'});
  await assert.rejects(()=>publishMusic({...input,id:fourth}),/cancelled/);
  assert.equal(artifacts.listArtifactVersions(saved.artifact.id).length,3);
  assert.deepEqual(fs.readFileSync(resolveMusicSource(1,f.conversation.public_id,request.source)),testWav());
  assert.deepEqual(fs.readFileSync(resolveMusicSource(1,f.conversation.public_id,{...request.source,version:2})),testWav(0.2,440));
  assert.deepEqual(fs.readFileSync(resolveMusicSource(1,f.conversation.public_id,{...request.source,version:3})),testWav(0.2,660));
});
test("lost receipt is uncertain and re-entry never blindly resubmits", async t => {
  const fake=await fakeAceStep({loseReceipt:true}); t.after(()=>fake.close()); const f=fixture(fake.connection);
  await executeMusicWorker(f.input,deps); const row=launchStore.musicLaunch(1,f.input.launchId);
  assert.equal(row.collection_state,'uncertain'); assert.equal(row.provider_state,'uncertain'); assert.equal(fake.submissions,1);
  await executeMusicWorker(f.input,deps); assert.equal(fake.submissions,1);
});
test("cancellation before submission, during collection and publication prevents late output", async t => {
  for(const stage of ['before','music.receipt','Saving audio to this conversation']) {
    const fake=await fakeAceStep(); t.after(()=>fake.close()); const f=fixture(fake.connection);
    if(stage==='before') f.controller.abort();
    f.input.update=events=>{ f.events.push(...events); if(events.some(e=>e.type===stage || e.payload.message===stage)) f.controller.abort(); };
    const result=await executeMusicWorker(f.input,deps); assert.equal(result.status,'aborted');
    assert.equal(artifacts.listArtifactsForUser({userId:1,conversationPublicId:f.conversation.public_id}).length,0);
    assert.equal(fake.submissions,stage==='before'?0:1);
    assert.match(launchStore.musicLaunch(1,f.input.launchId).summary,stage==='before'?/No generation was submitted/:/may continue/);
    assert.equal(fs.existsSync(path.join(f.input.workspace,'generated.wav')),false);
  }
});
test("corrupt output cannot become an artifact and optional analysis failure does not discard valid audio", async t => {
  const fake=await fakeAceStep({corrupt:true}); t.after(()=>fake.close()); const f=fixture(fake.connection);
  assert.equal((await executeMusicWorker(f.input,deps)).status,'failed');
  assert.equal(artifacts.listArtifactsForUser({userId:1,conversationPublicId:f.conversation.public_id}).length,0);
});
test("prepared-model observation is bounded, detects changed files and performs no setup", () => {
  const directory=path.join(root,'prepared'); fs.mkdirSync(directory);
  assert.equal(preparedAceStep(directory),null); assert.deepEqual(fs.readdirSync(directory),[]);
  const files=['acestep-v15-turbo','vae','Qwen3-Embedding-0.6B'].map(name=>{const relative=`source/checkpoints/${name}/fixture.safetensors`; const file=path.join(directory,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'fixture');return {path:relative,size:7};});
  fs.writeFileSync(path.join(directory,'models-ready.json'),JSON.stringify({sourceRevision:ACESTEP_REVISION,modelRevision:ACESTEP_MODEL_REVISION,model:'acestep-v15-turbo',files,hardware:{cuda:false}}));
  assert.equal(preparedAceStep(directory).hardware.cuda,false);
  fs.appendFileSync(path.join(directory,files[0].path),'changed'); assert.equal(preparedAceStep(directory),null);
});

function preparedFixture(directory) {
  fs.mkdirSync(directory,{recursive:true});
  const files=['acestep-v15-turbo','vae','Qwen3-Embedding-0.6B'].map(name=>{const relative=`source/checkpoints/${name}/fixture.safetensors`;const target=path.join(directory,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,'fixture');return{path:relative,size:7};});
  fs.writeFileSync(path.join(directory,'models-ready.json'),JSON.stringify({sourceRevision:ACESTEP_REVISION,modelRevision:ACESTEP_MODEL_REVISION,model:'acestep-v15-turbo',files,hardware:{cuda:false}}));
}
test("managed cancellation retains the receipt and releases its lease; reset requires an owned stopped provider",async t=>{
  const fake=await fakeAceStep({running:true});t.after(()=>fake.close());const f=fixture(fake.connection),directory=path.join(f.input.workspace,'managed');preparedFixture(directory);
  const config={...fake.connection,managed:true,directory};launchStore.updateMusicLaunch(1,f.input.launchId,{provider_json:JSON.stringify(config)});
  let released=0;
  f.input.update=events=>{if(events.some(e=>e.type==='music.receipt'))f.controller.abort();};
  await executeMusicWorker(f.input,{...deps,releaseSupervisorLease:async lease=>{assert.equal(lease.leaseId,'fixture');released++;}});
  const gate=path.join(directory,'generation-receipt.json');assert.equal(released,1);assert.equal(JSON.parse(fs.readFileSync(gate)).taskId,'task-1');
  assert.equal(launchStore.musicLaunch(1,f.input.launchId).provider_state,'draining');
  const {clearStoppedMusicGate}=await import('../src/lib/music-producer/provider-recovery.ts');
  const recovery={resolveAceStepConfig:()=>config,readRun:async()=>({terminal:true}),readSupervisedServiceSnapshot:async()=>({state:'busy'})};
  await assert.rejects(()=>clearStoppedMusicGate(1,recovery),/report ACE-Step stopped/);
  await assert.rejects(()=>clearStoppedMusicGate(2,{...recovery,readSupervisedServiceSnapshot:async()=>({state:'stopped'})}),/run_not_found/);
  await assert.rejects(()=>clearStoppedMusicGate(1,{...recovery,readRun:async()=>({terminal:false})}),/owning collector/);
  await clearStoppedMusicGate(1,{...recovery,readSupervisedServiceSnapshot:async()=>({state:'stopped'})});assert.equal(fs.existsSync(gate),false);
});
test("known receipts resume collection without submission and external jobs acquire no managed lease",async t=>{
  const fake=await fakeAceStep();t.after(()=>fake.close());const f=fixture(fake.connection);
  launchStore.updateMusicLaunch(1,f.input.launchId,{provider_receipt:'persisted-receipt',provider_state:'running'});
  assert.equal((await executeMusicWorker(f.input,{...deps,acquireServiceLease:async()=>{throw Error('must not lease external provider');}})).status,'completed');
  assert.equal(fake.submissions,0);assert.equal(fake.requests[0].url,'/v1/models');
});
test("failed provider and cancellation during retrieval retain no partial audio",async t=>{
  for(const failed of [true,false]){
    let f;const fake=await fakeAceStep({failed,onRequest:url=>{if(!failed&&url.startsWith('/v1/audio'))f.controller.abort();}});t.after(()=>fake.close());f=fixture(fake.connection);
    const result=await executeMusicWorker(f.input,deps);assert.equal(result.status,failed?'failed':'aborted');
    assert.equal(artifacts.listArtifactsForUser({userId:1,conversationPublicId:f.conversation.public_id}).length,0);
    assert.equal(fs.existsSync(path.join(f.input.workspace,'generated.wav')),false);
  }
});
test("deleting the owning conversation before publication prevents a late artifact",async t=>{
  const fake=await fakeAceStep();t.after(()=>fake.close());const f=fixture(fake.connection);
  f.input.update=events=>{if(events.some(e=>e.payload.message==='Saving audio to this conversation'))store.deleteConversation(f.conversation);};
  assert.equal((await executeMusicWorker(f.input,deps)).status,'failed');
  assert.equal(store.getConversationById(f.conversation.id),null);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM hermes_artifacts WHERE conversation_id=?').get(f.conversation.id).count,0);
});
test("the final publication guard rolls back an artifact inside the commit transaction",async t=>{
  const fake=await fakeAceStep();t.after(()=>fake.close());const f=fixture(fake.connection),context=musicArtifactContext(1,f.input.launchId);
  const source=path.join(f.input.workspace,'guard.wav');fs.writeFileSync(source,testWav());
  await assert.rejects(()=>artifacts.createImportedArtifact({...context,authorizedRoot:f.input.workspace,filePath:source,kind:'audio',title:'Guarded',filename:'music.wav',scrubProvenance:false,beforePublish:()=>{throw Error('conversation cancelled at commit');}}),/cancelled at commit/);
  assert.equal(artifacts.listArtifactsForUser({userId:1,conversationPublicId:f.conversation.public_id}).length,0);
  assert.deepEqual(fs.readFileSync(source),testWav());
});
test("generated analysis resolves a pinned same-conversation identity and rejects path or foreign identities",async t=>{
  const fake=await fakeAceStep();t.after(()=>fake.close());const f=fixture(fake.connection);await executeMusicWorker(f.input,deps);
  const {generatedAudioTrack}=await import('../src/lib/audio-analyzer/artifacts.ts'),row=launchStore.musicLaunch(1,f.input.launchId);
  const track=generatedAudioTrack(1,f.conversation.public_id,`artifact:${row.artifact_id}@1`);assert.equal(track.sizeBytes,testWav().length);
  assert.throws(()=>generatedAudioTrack(2,f.conversation.public_id,`artifact:${row.artifact_id}@1`));
  assert.throws(()=>generatedAudioTrack(1,f.conversation.public_id,'artifact:../../file@1'));
  assert.equal(generatedAudioTrack(1,f.conversation.public_id,'ordinary.wav'),null);
});
test("racing explicit setup clicks converge and stale job responses cannot replace a newer setup",async()=>{
  const setup=await import('../src/lib/music-producer/setup-state.ts');
  assert.equal(setup.claimMusicSetup(1,null,'first'),'first');assert.equal(setup.claimMusicSetup(1,null,'second'),'first');
  assert.equal(setup.claimMusicSetup(1,'first','third'),'first');setup.saveMusicSetup(1,'first','job_first');
  assert.equal(setup.claimMusicSetup(1,'first','next'),'next');setup.saveMusicSetup(1,'first','late_response');
  assert.equal(setup.musicSetup(1).request_id,'next');assert.equal(setup.musicSetup(1).job_id,null);
});
test("duplicate browser submissions keep their original descriptor even when native admission fails",async t=>{
  const fake=await fakeAceStep();t.after(()=>fake.close());const f=fixture(fake.connection);await executeMusicWorker(f.input,deps);
  const {saveAceStepSettings}=await import('../src/lib/acestep/config.ts');saveAceStepSettings(1,{mode:'external',externalUrl:fake.connection.baseUrl,apiKey:'fixture-key',model:fake.connection.model});
  const {startRun}=await import('../src/lib/music-producer/run-manager.ts');
  const input={...f.input,clientMessageId:crypto.randomUUID(),task:'another draft'};delete input.launchId;delete input.update;delete input.signal;delete input.workspace;
  await assert.rejects(()=>startRun(input));
  const second=await startRun(input);assert.equal(second.status,'failed');assert.equal(launchStore.musicLaunch(1,second.runId).task,'another draft');
  await assert.rejects(()=>startRun({...input,task:'changed submission'}),/conflict/);
  assert.equal(fake.submissions,1);
});
test("uploaded references must occur in this user's owning conversation",async t=>{
  const fake=await fakeAceStep();t.after(()=>fake.close());const f=fixture(fake.connection);
  const {writeAudioBlob}=await import('../src/lib/conversations/audio-blob-store.ts');
  const blob=await writeAudioBlob({userId:1,format:'wav',body:new Response(testWav()).body});
  const source={kind:'attachment',blobId:blob.blobId};assert.throws(()=>resolveMusicSource(1,f.conversation.public_id,source),/not_in_conversation/);
  const row=db.prepare("SELECT id,metadata FROM conversation_messages WHERE conversation_id=? AND role='user'").get(f.conversation.id);
  const metadata={...JSON.parse(row.metadata),attachments:[{type:'audio',blobId:blob.blobId,name:'Reference.wav',format:'wav',sizeBytes:blob.byteSize}]};
  db.prepare('UPDATE conversation_messages SET metadata=? WHERE id=?').run(JSON.stringify(metadata),row.id);
  assert.deepEqual(fs.readFileSync(resolveMusicSource(1,f.conversation.public_id,source)),testWav());
  assert.throws(()=>resolveMusicSource(2,f.conversation.public_id,source));
  const other=store.createConversation({userId:1,title:'Other reference chat'});assert.throws(()=>resolveMusicSource(1,other.public_id,source));
});
