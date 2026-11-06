import assert from 'node:assert/strict';
import test from 'node:test';
import { collectRecommendationEvidence } from '../src/lib/recommendations/collect.ts';
import { evidenceRecommendations, parseRecommendations } from '../src/lib/recommendations/types.ts';
import { generateRecommendations } from '../src/lib/recommendations/generate.ts';

const evidence = [
  {id:'gmail:1',source:'gmail',title:'Lab report feedback',summary:'Please revise the measurements section.'},
  {id:'calendar:2',source:'calendar',title:'RLC lab meeting',summary:'Tomorrow at 10:00'},
  {id:'recall:3',source:'recall',title:'Transient response notes',summary:'Reviewing the step-response derivation.'},
  {id:'garden:4',source:'garden',title:'Circuits',summary:'Study garden',gardenSlug:'circuits'},
];

test('evidence reads are independent, bounded, deduplicated and omit recovery codes', async () => {
  const result = await collectRecommendationEvidence([
    async()=>[evidence[0],evidence[0]],
    async()=>{throw new Error('calendar disconnected');},
    ()=>new Promise(()=>{}),
    async()=>[evidence[2],{...evidence[0],id:'code',title:'Your verification code'}],
  ], 15);
  assert.deepEqual(result.map(item=>item.id),['gmail:1','recall:3']);
});

test('suggestions must cite real evidence and reject fabricated IDs and malformed prompts', () => {
  const result = parseRecommendations([
    {prompt:'Prepare for the lab meeting using the email feedback.',sourceIds:['calendar:2','gmail:1']},
    {prompt:'Invented deadline',sourceIds:['missing']},
    {prompt:'No source',sourceIds:[]},
    {prompt:'First\nsecond',sourceIds:['gmail:1']},
    {prompt:'x'.repeat(241),sourceIds:['gmail:1']},
  ], evidence);
  assert.equal(result.length,1);
  assert.equal(result[0].sourceLabel,'Calendar · Gmail');
});

test('busy histories cannot crowd connected apps and Recall out of the evidence budget', async () => {
  const result=await collectRecommendationEvidence([
    async()=>Array.from({length:30},(_,index)=>({id:`chat:${index}`,source:'chat',title:`Chat ${index}`,summary:''})),
    async()=>evidence,
  ]);
  assert.equal(result.length,28);
  for (const item of evidence) assert.ok(result.some(row=>row.id===item.id));
});

test('model failure still offers diverse next steps grounded in actual evidence', async () => {
  const suggestions = await generateRecommendations({evidence,context:{},model:'selected',fetcher:async()=>new Response('',{status:503})});
  assert.equal(suggestions.length,4);
  assert.ok(suggestions.every(item=>item.sourceIds.every(id=>evidence.some(source=>source.id===id))));
  assert.equal(new Set(suggestions.map(item=>item.sourceLabel)).size,4);
  assert.match(suggestions.find(item=>item.sourceLabel==='Recall').prompt,/Transient response notes/);
  assert.deepEqual(evidenceRecommendations([]),[]);
});

test('garden fallback stays with the selected garden instead of unrelated mail', async () => {
  const suggestions = await generateRecommendations({evidence,context:{gardenSlug:'circuits'},model:'none'});
  assert.equal(suggestions.length,1);
  assert.deepEqual(suggestions[0].sourceIds,['garden:4']);
});

test('generation sends bounded evidence as untrusted data and never enables tools', async () => {
  let body;
  const suggestions = await generateRecommendations({evidence,context:{gardenSlug:'circuits'},model:'chosen/provider',baseUrl:'http://example.test/v1',
    fetcher:async(url,init)=>{
      assert.equal(url,'http://example.test/v1/chat/completions');body=JSON.parse(init.body);
      return Response.json({choices:[{message:{content:JSON.stringify([{prompt:'Use my transient notes to prepare for the lab.',sourceIds:['recall:3','calendar:2']}])}}]});
    }});
  assert.equal(body.model,'chosen/provider');
  assert.equal('tools' in body,false);
  assert.match(body.messages[0].content,/untrusted data/);
  assert.equal(suggestions[0].sourceLabel,'Recall · Calendar');
});

test('a model may decline to invent suggestions, and invalid citations fall back safely', async () => {
  const run = content => generateRecommendations({evidence,context:{},model:'selected',fetcher:async()=>Response.json({choices:[{message:{content}}]})});
  assert.deepEqual(await run('[]'),[]);
  assert.deepEqual(await run('[{"prompt":"Guess something","sourceIds":["fake"]}]'),evidenceRecommendations(evidence));
});
