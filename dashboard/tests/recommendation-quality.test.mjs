import assert from 'node:assert/strict';
import test from 'node:test';
import {completeRecommendationPrompts,evidenceRecommendations,selectRecommendations} from '../src/lib/recommendations/types.ts';
import {generateRecommendations} from './helpers/recommendation-model-fixture.mjs';

const context={localDate:'2026-11-08',localTime:'12:24'};
const rent={id:'rent',source:'task',title:'Pay rent',summary:'Project: Personal. Due 2026-11-09.'};
const gym={id:'gym',source:'calendar',title:'Gym: Upper A + cardio',summary:'Scheduled today. Attendance unknown.',calendar:{kind:'event',start:'2026-11-08T16:00',end:'2026-11-08T17:00',status:'upcoming'}};
const gap={id:'gap',source:'calendar',title:'12:24–15:00 today',summary:'Calendar opening.',calendar:{kind:'gap',start:'2026-11-08T12:24',end:'2026-11-08T15:00'}};
const task={id:'simulation',source:'task',title:'Circuit simulation',summary:'Compare the RLC model against the lab measurements.'};
const mail={id:'mail',source:'gmail',title:'Lab report feedback',summary:'Please revise the measurements section.'};
const reading={id:'reading',source:'recall',title:'Transient response derivation',summary:'Damping ratios and characteristic roots.'};
const garden={id:'garden',source:'garden',title:'Engineering ethics',summary:'Course notes',gardenSlug:'ethics'};

test('the screenshot case never turns rent into a project or a gym visit into a meeting',async()=>{
  const cards=await generateRecommendations({evidence:[rent,gym,gap],context,model:'none'});
  assert.deepEqual(cards,[],'with no useful action there are no cards at all');
  assert.doesNotMatch(cards.map(card=>card.prompt).join(' '),/rent|gym|25.minute/i);
});

test('useful source actions fill all four slots before any generic fallback is used',async()=>{
  const cards=await generateRecommendations({evidence:[rent,gym,gap,task,mail,reading,garden],context,model:'none'});
  assert.equal(cards.length,4);assert.ok(cards.every(card=>card.sourceIds.length>0));
  assert.ok(cards.some(card=>card.prompt.includes('measurements section')));
  const ids=cards.flatMap(card=>card.sourceIds);assert.equal(new Set(ids).size,ids.length);
  assert.ok(!ids.includes('rent')&&!ids.includes('gym'));
});

test('unsupported model proposals are rejected even when they cite valid evidence',async()=>{
  const output=[{prompt:'Break Pay rent into a next step I can finish in 25 minutes.',sourceIds:['rent']},
    {prompt:'List questions I want answered at Gym: Upper A + cardio.',sourceIds:['gym']},
    {prompt:'Draft a response addressing the requested measurements changes.',sourceIds:['mail']}];
  const cards=await generateRecommendations({evidence:[rent,gym,gap,mail],context,model:'selected',fetcher:async()=>Response.json({choices:[{message:{content:JSON.stringify(output)}}]})});
  assert.ok(cards.length>=1&&cards.length<=2);assert.deepEqual(cards[0].sourceIds,['mail']);
  assert.ok(cards.every(card=>card.sourceIds.every(id=>id==='mail')));
});

test('a task inside a calendar plan and its direct action cannot occupy two cards',()=>{
  const candidates=[{id:'combined',prompt:'Plan circuit simulation in the calendar opening.',sourceIds:['gap','simulation'],sourceLabel:'Calendar'},
    {id:'repeat',prompt:'Set up the circuit simulation.',sourceIds:['simulation'],sourceLabel:'Plan'}];
  assert.equal(selectRecommendations(candidates,[gap,task],[],context).length,1);
});

test('empty, partial, duplicate and failed-provider results are never padded with generic cards',async()=>{
  for(const evidence of [[],[reading],[reading,garden]]){
    const cards=await generateRecommendations({evidence,context,model:'selected',fetcher:async()=>{throw Error('offline');}});
    assert.ok(cards.length<=4);assert.equal(new Set(cards.map(card=>card.prompt)).size,cards.length);
    assert.ok(cards.every(card=>card.sourceIds.length>0));
    assert.equal(cards.length,evidence.length);
  }
  const one=evidenceRecommendations([mail])[0];
  assert.deepEqual(completeRecommendationPrompts([one.prompt,one.prompt]),[one.prompt]);
});

test('real complications may be useful while ordinary bill payments remain simple',()=>{
  const cards=evidenceRecommendations([{...rent,summary:'Payment failed with an incorrect recipient error.'}]);
  assert.equal(cards.length,1);assert.match(cards[0].prompt,/incorrect recipient/);assert.doesNotMatch(cards[0].prompt,/25 minutes/);
});

test('the Plan project label does not turn an ordinary chore into project work',()=>{
  assert.deepEqual(evidenceRecommendations([{id:'chore',source:'task',title:'Collect the parcel',summary:'Project: Design research. Due 2026-11-09.'}]),[]);
});
