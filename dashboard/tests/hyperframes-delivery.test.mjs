import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import './helpers/genoffice-node-loader.mjs';
import { ensureArtifactSchema } from '../src/lib/hermes/artifact-schema.ts';
import { publishHyperframesVideo, hyperframesDeliveryContent } from '../src/lib/hyperframes/artifact.ts';
import { artifactFile } from '../src/lib/hermes/artifact-store.ts';
import { prepareTurn } from '../src/lib/hermes/dispatch-core.ts';
import { agentLaunchContinuationMessage } from '../src/lib/hermes/agent-launch.ts';
import { completedResearchDelivery } from '../src/lib/conversations/completed-research.ts';
import { textToCadCommandText } from '../src/lib/hermes/text-to-cad-intent.ts';

const result='Rendered the animation. Next step: [video.mp4](C:/Users/me/runtime/project/out/video.mp4).';
const handback=agentLaunchContinuationMessage({agentName:'Hyperframes',outcome:'completed',content:result,continuationId:'worker'});

test('worker handbacks do not request host file access or activate CAD, with or without YOLO',()=>{
  for(const surface of ['dashboard_terminal','garden_chat']) {
    const prepared=prepareTurn({request:handback,internalAgentContinuation:true,surface,userId:1,grants:[],
      workspaceRoot:'/tmp/workspace',superAgent:true,resolvedResources:[{kind:'path',value:'C:/Users/me/runtime/project/out/video.mp4)',absolute:true}]});
    assert.equal(prepared.blocked,false);
    assert.deepEqual(prepared.pendingPermissions,[]);
    assert.deepEqual(prepared.plan.requiredResources,[]);
    assert.equal(textToCadCommandText({text:handback,internalContinuation:true,surface,authenticated:true}).automatic,false);
  }
  const actualDownload=prepareTurn({request:'Download https://example.test/video.mp4 to C:/Users/me/Downloads',
    surface:'dashboard_terminal',userId:1,grants:[],workspaceRoot:'/tmp/workspace'});
  assert.equal(actualDownload.blocked,true,'real user filesystem requests still need authority');
});

test('direct video delivery requires the durable completed worker and refuses mixed batches',()=>{
  const row=(role,id,metadata={})=>({role,client_message_id:id,status:'complete',content:'',metadata:JSON.stringify(metadata),created_at:'2026-09-13T13:00:00Z'});
  const messages=[row('user','question'),row('assistant','worker',{externalAgent:true,delegatedAgentRun:true,
    internalAgentContinuation:true,externalAgentOutcome:'completed',externalAgentResult:result,
    externalAgentRun:{kind:'hyperframes',runId:'job_video',brief:'Video'}})];
  const input={agentKind:'hyperframes',internalAgentContinuation:true,clientMessageId:'answer',continuationText:handback,messages};
  assert.equal(completedResearchDelivery(input)?.runId,'job_video');
  assert.equal(completedResearchDelivery({...input,continuationText:handback.replace('result:worker','result:forged')}),null);
  assert.equal(completedResearchDelivery({...input,messages:[...messages,row('assistant','other',{delegatedAgentRun:true})]}),null);
});

test('verified MP4 becomes one durable chat artifact across concurrent delivery and replay',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'hf-artifact-'));
  const database=new Database(':memory:');database.pragma('foreign_keys=ON');
  database.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY);
    CREATE TABLE clusters(id INTEGER PRIMARY KEY,slug TEXT,user_id INTEGER);
    CREATE TABLE conversations(id INTEGER PRIMARY KEY,public_id TEXT,user_id INTEGER,surface TEXT,default_garden_id INTEGER,title TEXT);
    CREATE TABLE hermes_runtime_sessions(id INTEGER PRIMARY KEY,conversation_id INTEGER,user_id INTEGER,external_session_id TEXT,hermes_session_id TEXT);
    CREATE TABLE hermes_runs(id TEXT PRIMARY KEY,runtime_session_id INTEGER,instruction TEXT,status TEXT,dispatch_json TEXT,started_at TEXT NOT NULL,finished_at TEXT);
    CREATE TABLE conversation_messages(id INTEGER PRIMARY KEY,conversation_id INTEGER,role TEXT,metadata TEXT);
    INSERT INTO users VALUES(1);
    INSERT INTO conversations VALUES(10,'conv_video',1,'dashboard_terminal',NULL,'Cat explainer');
    INSERT INTO hermes_runtime_sessions VALUES(20,10,1,'session_video',NULL);`);
  database.prepare('INSERT INTO conversation_messages VALUES(30,10,?,?)').run('assistant',JSON.stringify({externalAgentRun:{kind:'hyperframes',runId:'job_video'}}));
  ensureArtifactSchema(database);
  const file=path.join(root,'runtime/jobs/job_video/attempts/1/worker_video/workspace/project/out/video.mp4');
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const bytes=Buffer.from('000000186674797069736F6D0000020069736F6D69736F32','hex');fs.writeFileSync(file,bytes);
  const receipt={id:Buffer.from('out/video.mp4').toString('base64url'),relativePath:'out/video.mp4',name:'video.mp4',
    kind:'video',contentType:'video/mp4',size:bytes.length,modifiedAt:new Date().toISOString()};
  let reads=0;
  const options={database,dataRoot:root,storageRoot:path.join(root,'artifacts'),
    readView:async()=>{reads++;return {status:'completed',terminal:true,events:[{payload:{artifacts:[receipt]}}]};},
    inspectRun:async()=>({jobId:'job_video',attempt:1,workerInstanceId:'worker_video'})};
  try {
    assert.equal(await publishHyperframesVideo(2,'job_video',options),null);
    assert.equal(reads,0,'ownership is checked before touching the runtime');
    const [a,b]=await Promise.all([publishHyperframesVideo(1,'job_video',options),publishHyperframesVideo(1,'job_video',options)]);
    assert.equal(a.id,b.id);assert.equal(a.originating_message_id,30);assert.equal(a.conversation_public_id,'conv_video');
    const output=artifactFile({artifact:a,version:1,purpose:'preview',storageRoot:options.storageRoot,database});
    assert.deepEqual(fs.readFileSync(output.path),bytes);
    fs.unlinkSync(file);
    const replay=await publishHyperframesVideo(1,'job_video',options);
    assert.equal(replay.id,a.id,'the artifact survives removal of the worker workspace');
    assert.equal(reads,1);
    assert.equal(database.prepare('SELECT count(*) AS n FROM hermes_artifacts').get().n,1);
    assert.match(hyperframesDeliveryContent(replay,'job_video'),/conversationId=conv_video/);
    database.prepare('DELETE FROM hermes_artifacts WHERE id=?').run(a.id);
    assert.equal(await publishHyperframesVideo(1,'job_video',options),null,'deleted artifacts stay deleted');
  } finally {database.close();fs.rmSync(root,{recursive:true,force:true});}
});
