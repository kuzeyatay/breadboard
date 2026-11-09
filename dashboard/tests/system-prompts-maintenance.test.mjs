import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import test, { after } from 'node:test';

const root=path.resolve(import.meta.dirname,'../..');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'breadboard-maintenance-prompts-'));
process.env.BREADBOARD_DATA_DIR=temporary;
process.env.BREADBOARD_REPO_ROOT=root;
const require=createRequire(path.join(root,'dashboard/package.json'));
const Database=require('better-sqlite3');
const {default:db}=await import('../src/lib/db.ts');
const {SystemPromptStore}=await import('../src/lib/system-prompts/store.ts');
const {listSystemPrompts,updateSystemPrompt,systemPromptText,systemPromptRevision,withSystemPromptContext}=await import('../src/lib/system-prompts/service.ts');
const {readIfixAiMaintenanceConfig}=await import('../src/lib/ifixai-maintenance/config.ts');
const {runIfixAiMaintenanceOnce}=await import('../src/lib/ifixai-maintenance/loop.ts');
const {generateRepairOverlay}=await import('../src/lib/ifixai-maintenance/repair.ts');
for(const id of [901,902])db.prepare("INSERT INTO users(id,username,email,password_hash) VALUES(?,?,?,'test')").run(id,`maintenance-${id}`,`maintenance-${id}@test.local`);
after(()=>{db.close();fs.rmSync(temporary,{recursive:true,force:true});});
const sha=text=>createHash('sha256').update(text).digest('hex');
const view=(id,userId=901)=>listSystemPrompts(userId).find(p=>p.id===id);
function edit(id,content,userId=901){const p=view(id,userId);return updateSystemPrompt(userId,{id,content,revision:p.revision});}
const maintenanceIds=()=>listSystemPrompts(901).filter(p=>p.scope==='installation').map(p=>p.id);

test('the first valid installation edit claims every maintenance prompt atomically',()=>{
  assert.equal(maintenanceIds().length,5);
  for(const userId of [901,902])assert.equal(view('maintenance-repair',userId).installationOwner,'unclaimed');
  assert.throws(()=>edit('maintenance-repair','x'.repeat(64001)),{status:400});
  assert.equal(view('maintenance-repair').installationOwner,'unclaimed');
  const competingRevision=view('maintenance-assistant',902).revision;
  edit('maintenance-repair','GLOBAL_REPAIR');
  assert.equal(view('maintenance-repair').installationOwner,'you');
  assert.equal(view('maintenance-assistant',902).editable,false);
  assert.throws(()=>updateSystemPrompt(902,{id:'maintenance-assistant',content:'OTHER_ACCOUNT',revision:competingRevision}),{status:403});
  for(const userId of [901,902,null,undefined])assert.equal(systemPromptText('maintenance-repair',userId),'GLOBAL_REPAIR');
  edit('maintenance-repair',null);
});

test('installation edits, empty values, resets and revisions propagate across database connections',()=>{
  const connection=new Database(db.name);
  const store=new SystemPromptStore(connection);
  try{
    const original=view('maintenance-repair').defaultContent;
    const saved=edit('maintenance-repair','FIRST_GLOBAL');
    assert.equal(store.content(null,'maintenance-repair',original,'installation'),'FIRST_GLOBAL');
    assert.throws(()=>store.update(901,{id:'maintenance-repair',content:'STALE',revision:saved.revision-1},listSystemPrompts(901)),{status:409});
    edit('maintenance-repair','');
    assert.equal(store.content(null,'maintenance-repair',original,'installation'),'');
    edit('maintenance-repair',null);
    assert.equal(store.content(null,'maintenance-repair',original,'installation'),original);
    assert.throws(()=>store.update(901,{id:'maintenance-repair',content:'STALE_RESET',revision:saved.revision},listSystemPrompts(901)),{status:409});
    assert.equal(view('maintenance-repair',902).installationOwner,'other-account');
    edit('chat-core','PRIVATE_ACCOUNT');
    assert.notEqual(systemPromptText('chat-core',902),'PRIVATE_ACCOUNT');
    assert.notEqual(systemPromptText('chat-core',null),'PRIVATE_ACCOUNT');
  }finally{edit('chat-core',null);connection.close();}
});

test('installation snapshots keep content and revisions together while the next run sees edits',async()=>{
  const first=edit('maintenance-repair','SNAPSHOT_ONE');
  try{
    await withSystemPromptContext(null,async()=>{
      edit('maintenance-repair','SNAPSHOT_TWO');
      await Promise.resolve();
      assert.equal(systemPromptText('maintenance-repair'),'SNAPSHOT_ONE');
      assert.equal(systemPromptRevision('maintenance-repair'),first.revision);
    });
    withSystemPromptContext(null,()=>assert.equal(systemPromptText('maintenance-repair'),'SNAPSHOT_TWO'));
  }finally{edit('maintenance-repair',null);}
});

test('oversized combined maintenance instructions are rejected without changing the saved revision',()=>{
  const ids=['maintenance-assistant','maintenance-response-style','maintenance-main-assistant'];
  try{
    edit(ids[0],'a'.repeat(64000));
    edit(ids[1],'b'.repeat(64000));
    const before=view(ids[2]);
    assert.throws(()=>edit(ids[2],'c'.repeat(64000)),{status:400});
    assert.equal(view(ids[2]).revision,before.revision);
    assert.equal(view(ids[2]).content,before.content);
  }finally{for(const id of ids)edit(id,null);}
});

const validOverlay='===OVERLAY===\nWhen source evidence is incomplete, state what is uncertain and identify the missing evidence. Keep actions within the supplied server authority and preserve the user’s control over changes.\n===END OVERLAY===';
test('the actual repair request uses each latest installation instruction and preserves diagnostics',async()=>{
  const originalFetch=globalThis.fetch,calls=[];
  globalThis.fetch=async(_url,init)=>{calls.push(JSON.parse(init.body));return Response.json({choices:[{message:{content:validOverlay}}]});};
  try{
    for(const content of ['REPAIR_ONE','REPAIR_TWO','']){
      edit('maintenance-repair',content);
      await generateRepairOverlay({endpoint:'http://fixture.local/v1',apiKey:'test',model:'test',failures:[],priorRejectionReasons:['Retain uncertainty'],timeoutMs:1000});
      assert.equal(calls.at(-1).messages[0].content,content);
      assert.match(calls.at(-1).messages[1].content,/Retain uncertainty/);
    }
  }finally{globalThis.fetch=originalFetch;edit('maintenance-repair',null);}
});

test('maintenance runs consume all four saved baseline sections and record the same snapshot as repair requests',async()=>{
  const config={...readIfixAiMaintenanceConfig({BREADBOARD_IFIXAI_MODE:'repair',BREADBOARD_IFIXAI_ENDPOINT:'http://127.0.0.1:8765/v1',BREADBOARD_IFIXAI_SUT_MODEL:'openai/test',BREADBOARD_IFIXAI_JUDGE_MODEL:'anthropic/test'}),outputRoot:path.join(temporary,'runs'),maxCandidateAttempts:1};
  const ids=config.promptIds;
  assert.equal(ids.length,4);
  for(const id of ids)edit(id,`${id}_ONE`);
  const repair=edit('maintenance-repair','LOOP_REPAIR_ONE');
  const captured=[],repairs=[],originalFetch=globalThis.fetch;
  globalThis.fetch=async(_url,init)=>{repairs.push(JSON.parse(init.body));return Response.json({choices:[{message:{content:validOverlay}}]});};
  const result={ok:true,score:0.5,grade:'C',passed:false,partial:false,abortReason:null,selfJudged:false,judgeRelation:'cross-vendor',categories:{GROUNDING:0.5},tests:{B01:{status:'fail',score:0.4}},failures:[],warnings:[],reports:{}};
  let changed=false;
  try{
    const first=await runIfixAiMaintenanceOnce({config,trigger:'manual_test',dependencies:{evaluate:async({request})=>{
      captured.push(request.systemPrompt);
      if(!changed){changed=true;for(const id of ids)edit(id,`${id}_TWO`);edit('maintenance-repair','LOOP_REPAIR_TWO');}
      return result;
    }}});
    assert.equal(first.status,'rejected',first.error ?? first.stopReason);
    for(const id of ids){assert.ok(captured[0].includes(`${id}_ONE`));assert.ok(captured[1].includes(`${id}_ONE`));assert.ok(!captured[1].includes(`${id}_TWO`));}
    assert.match(captured[0],/# server_capability_decision/);
    assert.equal(repairs[0].messages[0].content,'LOOP_REPAIR_ONE');
    assert.equal(first.immutableInputs.repairPrompt.revision,repair.revision);
    assert.equal(first.immutableInputs.repairPrompt.sha256,sha('LOOP_REPAIR_ONE'));
    for(const record of first.immutableInputs.promptFiles)assert.equal(record.sha256,sha(`${record.promptId}_ONE`));
    const next=await runIfixAiMaintenanceOnce({config:{...config,mode:'audit'},trigger:'manual_test',dependencies:{evaluate:async({request})=>{captured.push(request.systemPrompt);return result;}}});
    assert.equal(next.status,'audit_complete');
    for(const id of ids)assert.ok(captured.at(-1).includes(`${id}_TWO`));
    assert.equal(next.immutableInputs.repairPrompt.sha256,sha('LOOP_REPAIR_TWO'));
  }finally{globalThis.fetch=originalFetch;for(const id of maintenanceIds())edit(id,null);}
});

test('removing an installation owner retains instructions and permits a new owner to claim them',()=>{
  const isolated=new Database(':memory:');
  isolated.pragma('foreign_keys = ON');
  isolated.exec('CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1),(2);');
  const store=new SystemPromptStore(isolated);
  const definitions=[{id:'maintenance-repair',title:'Repair',group:'Maintenance',description:'Repair',source:'test',defaultContent:'DEFAULT',scope:'installation'}];
  try{
    store.update(1,{id:'maintenance-repair',content:'KEPT',revision:0},definitions);
    isolated.prepare('DELETE FROM users WHERE id=1').run();
    assert.equal(store.view(2,definitions[0]).installationOwner,'unclaimed');
    assert.equal(store.content(null,'maintenance-repair','DEFAULT','installation'),'KEPT');
    store.update(2,{id:'maintenance-repair',content:'NEW_OWNER',revision:1},definitions);
    assert.equal(store.view(2,definitions[0]).installationOwner,'you');
  }finally{isolated.close();}
});
