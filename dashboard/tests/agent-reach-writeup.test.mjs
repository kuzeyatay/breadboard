import test from 'node:test';
import assert from 'node:assert/strict';
import {evidenceBatches, retrievedSources, writeRetrievedFindings} from '../src/lib/agent-reach/writeup.ts';

test('evidence batches preserve every source character, identity and request across boundaries', () => {
 const sources=[{sourceId:'one',request:'read source one',content:'abc😀defghi'}, {sourceId:'two',request:'read source two',content:'klmnop'}];
 const batches=evidenceBatches(sources,5);
 for(const batch of batches) assert.ok(batch.reduce((sum,source)=>sum+source.content.length,0)<=5);
 for(const source of sources){
  const parts=batches.flat().filter(part=>part.sourceId===source.sourceId);
  assert.equal(parts.map(part=>part.content).join(''),source.content);
  assert.ok(parts.every(part=>part.request===source.request && part.content.isWellFormed()));
 }
});

test('large real-shaped tool transcripts use bounded summaries and a clean final report', async () => {
 const messages=[{role:'system',content:'operational instructions must not enter the report'}, {role:'user',content:'full original request and personal constraints'}];
 for(let i=0;i<5;i++){
  messages.push({role:'assistant',tool_calls:[{id:`call${i}`,type:'function',function:{name:'agent_reach',arguments:JSON.stringify({command:`curl https://source.example/${i}`})}}]});
  messages.push({role:'tool',tool_call_id:`call${i}`,content:`Source ${i}\n`+'x'.repeat(50000)});
 }
 const sources=retrievedSources(messages);
 assert.equal(sources.length,5);
 assert.match(sources[4].request,/https:\/\/source.example\/4/);
 let inFlight=0,maxInFlight=0;
 const requests=[];
 const answer=await writeRetrievedFindings({messages,signal:new AbortController().signal,complete:async request=>{
  requests.push(request);
  inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);
  await new Promise(resolve=>setTimeout(resolve,5));inFlight--;
  assert.equal(request.some(message=>message.role==='tool'||message.tool_calls),false);
  assert.ok(request[1].content.includes('full original request and personal constraints'));
  assert.equal(JSON.stringify(request).includes('operational instructions must not enter the report'),false);
  return request[0].content.includes('intermediate notes') ? `Verified note from batch ${requests.length}` : 'Final cited findings';
 }});
 assert.equal(answer,'Final cited findings');
 assert.equal(requests.length,6);
 assert.equal(maxInFlight,2);
 assert.equal((requests.at(-1)[1].content.match(/## Evidence batch/g)??[]).length,5);
});

test('one failed evidence batch cancels its sibling and does not write a fabricated final', async () => {
 const messages=[{role:'user',content:'request'}, {role:'tool',content:'a'.repeat(180001)}];
 let calls=0,cancelled=false;
 await assert.rejects(writeRetrievedFindings({messages,signal:new AbortController().signal,complete:async (_messages,signal)=>{
  calls++;
  if(calls===1){await new Promise(resolve=>setTimeout(resolve,5));throw new Error('provider failed');}
  return new Promise((_,reject)=>signal.addEventListener('abort',()=>{cancelled=true;reject(signal.reason);},{once:true}));
 }}),/provider failed/);
 assert.equal(calls,2);assert.equal(cancelled,true);
});

test('small evidence needs one call and an empty report is a failure', async () => {
 let calls=0;
 await assert.rejects(writeRetrievedFindings({messages:[{role:'user',content:'request'}, {role:'tool',content:'actual evidence'}],signal:new AbortController().signal,complete:async request=>{
  calls++;assert.match(request[1].content,/actual evidence/);return ' ';
 }}),/without findings/);
 assert.equal(calls,1);
});
