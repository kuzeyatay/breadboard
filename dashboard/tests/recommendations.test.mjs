import assert from 'node:assert/strict';
import test from 'node:test';
import { collectRecommendationEvidence } from '../src/lib/recommendations/collect.ts';
import { completeRecommendations, evidenceRecommendations, parseRecommendations, selectRecommendations, GARDEN_FALLBACK_RECOMMENDATION_PROMPTS } from '../src/lib/recommendations/types.ts';
import { generateRecommendations } from './helpers/recommendation-model-fixture.mjs';

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
  assert.equal(suggestions.length,4);
  assert.deepEqual(suggestions[0].sourceIds,['garden:4']);
  assert.ok(suggestions.slice(1).every(item=>item.sourceIds.length===0));
  assert.ok(suggestions.slice(1).every(item=>GARDEN_FALLBACK_RECOMMENDATION_PROMPTS.includes(item.prompt)));
});

test('generation sends bounded evidence as untrusted data and never enables tools', async () => {
  let body;
  const suggestions = await generateRecommendations({evidence,context:{},model:'chosen/provider',baseUrl:'http://example.test/v1',
    fetcher:async(url,init)=>{
      assert.equal(url,'http://example.test/v1/chat/completions');body=JSON.parse(init.body);
      return Response.json({choices:[{message:{content:JSON.stringify([{prompt:'Use my transient notes to prepare for the lab.',sourceIds:['recall:3','calendar:2']}])}}]});
    }});
  assert.equal(body.model,'chosen/provider');
  assert.equal('tools' in body,false);
  assert.match(body.messages[0].content,/untrusted data/);
  assert.equal(suggestions[0].sourceLabel,'Recall · Calendar');
});

test('garden generation sends only explicit garden evidence and rejects outside and mixed citations', async () => {
  const context={gardenSlug:'circuits'};
  const mixed=[...evidence,{id:'garden:other',source:'garden',title:'Neuro computation',summary:'Another garden',gardenSlug:'neuro'},
    {id:'recall:scoped',source:'recall',title:'Damping derivation',summary:'RLC circuit damping notes',gardenSlug:'circuits'}];
  const proposals=[
    {prompt:'Resolve my calendar overlap with the gym.',sourceIds:['calendar:2']},
    {prompt:'Reply to the lab feedback using Circuits.',sourceIds:['garden:4','gmail:1']},
    {prompt:'Quiz me on Neuro computation.',sourceIds:['garden:other']},
    {prompt:'Explain damping using the passage I read in this garden.',sourceIds:['recall:scoped']},
  ];
  let request;
  const cards=await generateRecommendations({evidence:mixed,context,model:'selected',fetcher:async(_url,init)=>{
    request=JSON.parse(init.body);
    return Response.json({choices:[{message:{content:JSON.stringify(proposals)}}]});
  }});
  const supplied=JSON.parse(request.messages.at(-1).content);
  assert.deepEqual(supplied.evidence.map(item=>item.id),['garden:4','recall:scoped']);
  assert.doesNotMatch(JSON.stringify(supplied),/Lab report feedback|RLC lab meeting|Transient response|Neuro computation/);
  assert.match(request.messages[1].content,/Garden scope is mandatory/);
  assert.equal(cards.length,4);
  assert.ok(cards.some(card=>card.sourceIds.includes('recall:scoped')),'explicitly garden-linked Recall remains usable');
  assert.ok(cards.every(card=>card.sourceIds.every(id=>['garden:4','recall:scoped'].includes(id))));
  assert.doesNotMatch(JSON.stringify(cards),/gym|feedback|Neuro/);
  const selected=selectRecommendations(parseRecommendations(proposals,mixed,8),mixed,[],context);
  assert.deepEqual(selected.map(card=>card.sourceIds),[['recall:scoped']]);
  assert.ok(evidenceRecommendations(mixed,[],context).every(card=>card.sourceIds.every(id=>['garden:4','recall:scoped'].includes(id))));
});

test('a garden with no matching evidence always has four garden fallbacks and never calls the model', async () => {
  for (const model of ['none','selected']) {
    const cards=await generateRecommendations({evidence,context:{gardenSlug:'empty-garden'},model,
      fetcher:async()=>assert.fail('unrelated evidence must not start a completion')});
    assert.deepEqual(cards.map(card=>card.prompt),GARDEN_FALLBACK_RECOMMENDATION_PROMPTS);
    assert.ok(cards.every(card=>card.sourceIds.length===0));
  }
});

test('a model may decline to invent suggestions; grounded alternatives and then generic cards fill four slots', async () => {
  const run = content => generateRecommendations({evidence,context:{},model:'selected',fetcher:async()=>Response.json({choices:[{message:{content}}]})});
  assert.deepEqual(await run('[]'),completeRecommendations(evidenceRecommendations(evidence)));
  assert.deepEqual(await run('[{"prompt":"Guess something","sourceIds":["fake"]}]'),completeRecommendations(evidenceRecommendations(evidence)));
});
