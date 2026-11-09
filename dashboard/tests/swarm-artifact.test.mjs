import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { SwarmStore } from "../src/lib/swarm/store.ts";
import { DEFAULT_SWARM_LIMITS } from "../src/lib/swarm/policy.ts";
import { assertConversationSwarmStopped, swarmCoordinatorCurrent } from "../src/lib/swarm/activity.ts";
import { swarmArtifactOwner } from "../src/lib/swarm/artifact-owner.ts";
import { ensureArtifactSchema } from "../src/lib/hermes/artifact-schema.ts";
const bootstrapDirectory=fs.mkdtempSync(path.join(os.tmpdir(),"swarm-artifact-bootstrap-"));
process.env.BREADBOARD_DATA_DIR=bootstrapDirectory;
const { createArtifact, createImportedArtifact }=await import("../src/lib/hermes/artifact-store.ts");
const { default: bootstrapDb }=await import("../src/lib/db.ts");
test.after(()=>{bootstrapDb.close();fs.rmSync(bootstrapDirectory,{recursive:true,force:true});});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-artifacts-"));
  const db = new Database(path.join(root,"test.db"));
  db.pragma("foreign_keys=ON");
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1),(2);
    CREATE TABLE clusters(id INTEGER PRIMARY KEY,slug TEXT,user_id INTEGER);
    CREATE TABLE conversations(id INTEGER PRIMARY KEY,public_id TEXT,user_id INTEGER,surface TEXT,default_garden_id INTEGER,archived_at TEXT);
    INSERT INTO conversations VALUES(1,'conv_parent',1,'dashboard_terminal',NULL,NULL),(2,'conv_worker',1,'dashboard_terminal',NULL,NULL);
    CREATE TABLE hermes_runtime_sessions(id INTEGER PRIMARY KEY,user_id INTEGER,conversation_id INTEGER,external_session_id TEXT,hermes_session_id TEXT);
    INSERT INTO hermes_runtime_sessions VALUES(10,1,1,'parent-session',NULL),(20,1,2,'worker-session',NULL);
    CREATE TABLE hermes_runs(id TEXT PRIMARY KEY,runtime_session_id INTEGER); INSERT INTO hermes_runs VALUES('parent-run',10),('worker-run',20);
    CREATE TABLE conversation_messages(id INTEGER PRIMARY KEY,conversation_id INTEGER,client_message_id TEXT,role TEXT,content TEXT,created_at TEXT);
    INSERT INTO conversation_messages VALUES(100,1,'request','assistant','',datetime('now'));
    CREATE TABLE chat_sessions(id INTEGER PRIMARY KEY,conversation_id INTEGER);
    CREATE TABLE chat_messages(id INTEGER PRIMARY KEY,session_id INTEGER,role TEXT,content TEXT,created_at TEXT,canonical_message_id INTEGER);`);
  ensureArtifactSchema(db);
  const store = new SwarmStore(db);
  const run = store.create({requestId:"test",authority:{userId:1,conversationId:1,conversationPublicId:"conv_parent",runtimeSessionId:10,
    sourceRunId:"parent-run",originClientMessageId:"request",surface:"dashboard_terminal",gardenId:null,gardenSlug:null,
    model:"test",reasoningEffort:"medium",standingApproval:true,allowedTools:["agent_launch"],allowedAgentIds:[],inputReferences:[]},
    limits:DEFAULT_SWARM_LIMITS,admission:()=>({available:true,requiresApproval:false}),plan:{objective:"Evidence and report",reason:"Separate discovery and synthesis",benefit:"coverage",mode:"durable",
      tasks:["research","report"].map((key,index)=>({key,title:key,brief:`Prepare ${key}`,executor:{kind:"persona",id:"researcher"},dependsOn:index?["research"]:[],acceptance:["Saved evidence supports the result"],inputs:[],tokenBudget:1000}))}});
  const lease=store.acquireLease(1,run.id,"test");const claimed=store.claimNext(lease);
  store.attach(lease,claimed.attempt.id,{kind:"persona",id:"researcher",runId:claimed.attempt.id,conversationId:2});
  db.exec("CREATE TABLE swarm_worker_chats(attempt_id TEXT PRIMARY KEY,conversation_id INTEGER,error TEXT,created_at INTEGER)");
  db.prepare("INSERT INTO swarm_worker_chats VALUES(?,2,NULL,?)").run(claimed.attempt.id,Date.now());
  const input={userId:1,conversationId:2,runtimeSessionId:20,hermesSessionId:"worker-session",clusterId:null,runId:"worker-run",assistantMessageId:null,
    surface:"dashboard_terminal",database:db,storageRoot:path.join(root,"artifacts"),kind:"markdown",rendererId:"markdown",title:"Research evidence",content:"# Evidence\n\nThe inspected source supports the result."};
  return {root,db,store,run,lease,claimed,input,close(){db.close();fs.rmSync(root,{recursive:true,force:true});}};
}

test("worker artifacts use the parent conversation with versioned evidence and real provenance",async()=>{
  const f=fixture();try {
    const artifact=createArtifact(f.input);
    assert.equal(artifact.conversation_id,1);assert.equal(artifact.runtime_session_id,10);
    assert.equal(artifact.originating_run_id,"parent-run");assert.equal(artifact.originating_message_id,100);
    assert.equal(JSON.parse(artifact.metadata_json).swarm.attemptId,f.claimed.attempt.id);
    assert.equal(JSON.parse(artifact.metadata_json).swarm.workerRunId,"worker-run");
    const file=path.join(f.root,"report.md");fs.writeFileSync(file,"# Report\n\nSource evidence and its conclusion.\n");
    const imported=await createImportedArtifact({...f.input,filePath:file,authorizedRoot:f.root,scrubProvenance:false});
    assert.equal(imported.status,"ready");assert.equal(imported.conversation_id,1);
    const evidence=f.store.evidence(f.lease,f.claimed.attempt.id,[{kind:"artifact",title:imported.title,summary:"Validated saved report",reference:`artifact:${imported.id}:${imported.current_version}`}]);
    f.store.settle(f.lease,f.claimed.attempt.id,"completed","Saved source evidence and report");
    f.store.verify(1,f.run.id,"research",[{criterion:f.claimed.task.acceptance[0],passed:true,evidenceIds:evidence}]);
    assert.equal(f.store.claimNext(f.lease).task.key,"report","only verified evidence unlocks synthesis");
  }finally{f.close();}
});

test("worker publication rejects forged ownership and cancellation during import",async()=>{
  const f=fixture();try {
    assert.throws(()=>swarmArtifactOwner({...f.input,userId:2},f.db),{code:"swarm_artifact_scope"});
    assert.throws(()=>swarmArtifactOwner({...f.input,runtimeSessionId:10},f.db),{code:"swarm_artifact_scope"});
    const file=path.join(f.root,"late.md");fs.writeFileSync(file,"# Too late\n");
    await assert.rejects(createImportedArtifact({...f.input,filePath:file,authorizedRoot:f.root,scrubProvenance:false,
      beforePublish:()=>f.store.control(1,f.run.id,"cancel")}),{code:"swarm_artifact_scope"});
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM hermes_artifacts").get().n,0);
    // The injected fence ran inside the rolled-back publication transaction.
    // Persist the external Stop separately before checking a later call.
    f.store.control(1,f.run.id,"cancel");
    assert.throws(()=>createArtifact(f.input),{code:"swarm_artifact_scope"});
  }finally{f.close();}
});

test("chat deletion preserves uncertain cancellation records and late coordinators stay stopped",()=>{
  const f=fixture();try {
    assert.equal(swarmCoordinatorCurrent(f.db,f.run.id,1),true);
    f.store.control(1,f.run.id,"cancel");
    assert.equal(swarmCoordinatorCurrent(f.db,f.run.id,1),false);
    assert.throws(()=>assertConversationSwarmStopped(f.db,1),{code:"swarm_stop_pending",status:409});
    assert.throws(()=>f.db.prepare("DELETE FROM conversations WHERE id=1").run(),/workers must stop/);
    assert.equal(f.store.snapshot(1,f.run.id).attempts[0].status,"cancelling");
    f.store.settle(f.lease,f.claimed.attempt.id,"cancelled","Runtime acknowledged Stop");
    assert.doesNotThrow(()=>assertConversationSwarmStopped(f.db,1));
    f.db.prepare("DELETE FROM conversations WHERE id=1").run();
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM swarm_runs").get().n,0);
  }finally{f.close();}
});
