import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {Readable} from 'node:stream';
import {NextRequestAdapter} from '../../dashboard/node_modules/next/dist/server/web/spec-extension/adapters/next-request.js';
import path from 'node:path';
import {createHmac} from 'node:crypto';
import {createRecoveryHandoffHandler, requestRecoveryHandoff} from '../../dashboard/src/lib/hermes/task-recovery-handoff.ts';
import {executeRuntimeV2BackgroundRequest} from '../../dashboard/scripts/runtime-v2-background-executor.mjs';
import {taskRecoveryCheckpoint, MAX_PROVIDER_RECOVERY_WAIT_MS} from '../../dashboard/src/lib/hermes/task-recovery-policy.ts';
import {automaticRepairPathAllowed} from '../../desktop/src/shared/source-repair.ts';

test('automatic repairs cannot edit the authenticated recovery handoff',()=>{
  assert.equal(automaticRepairPathAllowed('dashboard/src/lib/hermes/task-recovery-handoff.ts'),false);
  assert.equal(automaticRepairPathAllowed('dashboard/src/app/api/internal/task-recovery/route.ts'),false);
});

const env={BREADBOARD_HERMES_TOOL_SECRET:'test-only-recovery-service-secret'};
const token='Bearer '+createHmac('sha256',env.BREADBOARD_HERMES_TOOL_SECRET).update('breadboard:task-recovery:v1').digest('hex');
const url='http://127.0.0.1:39871/api/internal/task-recovery';
const req=(options={})=>new Request(url,{method:'POST',headers:{authorization:token},...options});

test('the actual Next Node request adapter accepts an empty POST stream and rejects payloads',async()=>{
  let calls=0;const handle=createRecoveryHandoffHandler(async()=>{calls++;return {version:1,resumed:0,reconciled:0};},env);
  const request=body=>NextRequestAdapter.fromNodeNextRequest({method:'POST',url,headers:{authorization:token},body:Readable.from(body)},new AbortController().signal);
  assert.equal((await handle(request([]))).status,200);
  assert.equal((await handle(request(['{"command":"arbitrary"}']))).status,400);
  assert.equal(calls,1);
});

test('recovery handoff rejects unauthenticated or programmable requests before any work',async()=>{
  let calls=0;const handle=createRecoveryHandoffHandler(async()=>{calls++;return {version:1,resumed:1,reconciled:1};},env);
  for(const r of [req({headers:{}}),req({headers:{authorization:'Bearer wrong'}}),req({body:JSON.stringify({command:'arbitrary'})}),req({method:'GET'}),req({headers:{authorization:token,origin:'http://127.0.0.1:39871'}}),new Request(url+'?userId=2',{method:'POST',headers:{authorization:token}}),new Request(url.replace('127.0.0.1','example.com'),{method:'POST',headers:{authorization:token}})])assert.ok((await handle(r)).status>=400);
  assert.equal(calls,0);assert.equal((await handle(req())).status,200);assert.equal(calls,1);
});

test('concurrent scheduler deliveries join one finite sweep and a later sweep can retry',async()=>{
  let calls=0,release;const gate=new Promise(r=>release=r);
  const handle=createRecoveryHandoffHandler(async()=>{calls++;await gate;return {version:1,resumed:0,reconciled:1};},env);
  const a=handle(req()),b=handle(req());await new Promise(setImmediate);assert.equal(calls,1);release();
  assert.equal((await a).status,200);assert.equal((await b).status,200);
  assert.equal((await handle(req())).status,200);assert.equal(calls,2);
});

test('native background recovery reaches the authenticated dashboard without a supervisor capability',async t=>{
  let sweeps=0;const handle=createRecoveryHandoffHandler(async()=>{sweeps++;return {version:1,resumed:3,reconciled:1};},env);
  const server=http.createServer(async(incoming,outgoing)=>{
    assert.equal(incoming.method,'POST');assert.equal(incoming.headers.authorization,token);
    const result=await handle(NextRequestAdapter.fromNodeNextRequest({url:`http://127.0.0.1:${server.address().port}${incoming.url}`,method:incoming.method,headers:incoming.headers,body:incoming},new AbortController().signal));
    outgoing.writeHead(result.status,{'content-type':'application/json'});outgoing.end(await result.text());
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
  const updates={...env,BREADBOARD_INTERNAL_URL:`http://127.0.0.1:${server.address().port}`,BREADBOARD_RUNTIME_V2_ACTIVE:'true',BREADBOARD_SUPERVISOR_CONTROL_TOKEN:undefined,BREADBOARD_SUPERVISOR_CONTROL_URL:undefined};
  const before=Object.fromEntries(Object.keys(updates).map(k=>[k,process.env[k]]));
  t.after(()=>{for(const [k,v]of Object.entries(before))v===undefined?delete process.env[k]:process.env[k]=v;});
  for(const[k,v]of Object.entries(updates))v===undefined?delete process.env[k]:process.env[k]=v;
  const result=await executeRuntimeV2BackgroundRequest({request:{protocolVersion:1,operation:'hermes-abandoned-run-recovery'},executionScope:{userId:null,gardenId:null,conversationId:null},sourceRoot:path.resolve('dashboard/src')});
  assert.deepEqual(result,{operation:'hermes-abandoned-run-recovery',resumed:3,reconciled:1});assert.equal(sweeps,1);
});

test('callback never sends service credentials to an external destination and fails closed on bad receipts',async()=>{
  let requests=0;const transport=async()=>{requests++;return Response.json({version:1,resumed:1,reconciled:0});};
  await assert.rejects(requestRecoveryHandoff({...env,BREADBOARD_INTERNAL_URL:'https://example.com'},transport),/local dashboard/);assert.equal(requests,0);
  await assert.rejects(requestRecoveryHandoff({...env,BREADBOARD_INTERNAL_URL:url},async()=>Response.json({ok:true})),/invalid receipt/);
  await assert.rejects(requestRecoveryHandoff({...env,BREADBOARD_INTERNAL_URL:url},async()=>new Response(null,{status:503})),/503/);
});

test('provider restarts wait durably without proposing source edits or consuming reasoning retries',()=>{
  let previous;const started=100000;
  for(let index=0;index<240;index++){
    const decision=taskRecoveryCheckpoint({status:'error',failure:{code:'hermes_turn_failed',message:`HTTP ${index%2?503:502}, Error response`},tools:[],turn:12,previous,now:started+index*30000});
    assert.equal(decision.stopped,undefined);assert.equal(decision.checkpoint.providerWaitStartedAt,started);
    assert.equal(decision.checkpoint.notBefore,started+(index+1)*30000);previous=JSON.parse(JSON.stringify(decision.checkpoint));
  }
  assert.equal(taskRecoveryCheckpoint({status:'error',failure:{code:'hermes_turn_failed',message:'HTTP 504'},tools:[],turn:12,previous,now:started+MAX_PROVIDER_RECOVERY_WAIT_MS}).stopped,'provider_recovery_deadline');
  assert.equal(taskRecoveryCheckpoint({status:'cancelled',tools:[],turn:12,previous}).stopped,'cancelled');
  assert.equal(taskRecoveryCheckpoint({status:'error',failure:{code:'hermes_turn_failed',message:'HTTP 503 permission_denied'},tools:[],turn:0,previous}).stopped,'requires_user_or_external_change');
  assert.equal(taskRecoveryCheckpoint({status:'completed',tools:[],turn:0,previous}).checkpoint,undefined);
});
