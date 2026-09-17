import test from 'node:test';
import assert from 'node:assert/strict';
import {describeDocuments} from '../src/lib/get-doc/query-plan.ts';
const documents=[
 {id:'doc_1',title:'Study A',authors:[],abstract:'Findings A',description:'Catalog A'},
 {id:'doc_2',title:'Study B',authors:[],abstract:'Findings B',description:'Catalog B'},
 {id:'doc_3',title:'Study C',authors:[],abstract:'Findings C',description:'Catalog C'},
];
const row=(id,title,description)=>({id,title,description,bearing:'direct'});
const response=documents=>({content:JSON.stringify({documents}),usage:{inputTokens:10,outputTokens:5}});

test('a shifted title-ID pair is rejected and only unreviewed papers get the bounded retry', async () => {
 const requests=[];
 const result=await describeDocuments({baseUrl:'unused',model:'unused',reasoningEffort:'max',intent:'Find applicable studies',documents,completeImpl:async input=>{
  requests.push(input);
  if(requests.length===1)return response([row('doc_1','Study A','Review A'),row('doc_2','Study C','Wrong shifted claim')]);
  assert.equal(input.messages[1].content.includes('  title: Study A'),false);
  assert.ok(input.messages[1].content.includes('  title: Study B'));
  assert.ok(input.messages[1].content.includes('  title: Study C'));
  assert.ok(input.timeoutMs<=requests[0].timeoutMs);
  return response([row('doc_2','Study B','Review B'),row('doc_3','Study C','Review C')]);
 }});
 assert.deepEqual(result.documents.map(document=>document.description),['Review A','Review B','Review C']);
 assert.equal(result.calls,2);
 assert.deepEqual(result.usage,{inputTokens:20,outputTokens:10});
});

test('persistently missing or mismatched reviews retain catalog facts and no invented classification', async () => {
 const result=await describeDocuments({baseUrl:'unused',model:'unused',reasoningEffort:'max',intent:'Find studies',documents,completeImpl:async()=>response([row('doc_1','Wrong title','Wrong claim')])});
 assert.equal(result.calls,2);
 assert.deepEqual(result.documents,documents);
 assert.ok(result.documents.every(document=>document.bearing===undefined));
});
