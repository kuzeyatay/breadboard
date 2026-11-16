import assert from 'node:assert/strict';
import test from 'node:test';
import {completeRecommendationPrompts,evidenceRecommendations,parseRecommendations,recommendationBasis,selectRecommendations} from '../src/lib/recommendations/types.ts';
import {generateRecommendations} from './helpers/recommendation-model-fixture.mjs';

const context={localDate:'2026-11-08',localTime:'12:24'};
const rent={id:'rent',source:'task',title:'Pay rent',summary:'Project: Personal. Due 2026-11-09.'};
const gym={id:'gym',source:'calendar',title:'Gym: Upper A + cardio',summary:'Scheduled today. Attendance unknown.',calendar:{kind:'event',start:'2026-11-08T16:00',end:'2026-11-08T17:00',status:'upcoming'}};
const gap={id:'gap',source:'calendar',title:'12:24–15:00 today',summary:'Calendar opening.',calendar:{kind:'gap',start:'2026-11-08T12:24',end:'2026-11-08T15:00'}};
const task={id:'simulation',source:'task',title:'Circuit simulation',summary:'Compare the RLC model against the lab measurements.'};
const mail={id:'mail',source:'gmail',title:'Lab report feedback',summary:'Please revise the measurements section.'};
const reading={id:'reading',source:'recall',title:'Transient response derivation',summary:'Damping ratios and characteristic roots.'};
const garden={id:'garden',source:'garden',title:'Engineering ethics',summary:'Course notes',gardenSlug:'ethics'};

test('the four reported terminal cards fail offline, after model generation, and when restored from history', async () => {
  const lecture = {...gym, id:'calendar:ethics', title:'Impact of technology engineering ethics. 0LVX30, 0LVX30 session', summary:''};
  const ci = {...mail, title:'[kuzeyatay/breadboard] Run failed: Multisim engineering regressions - v0.1.3-prebeta',
    sender:'notifications@github.com', summary:'Review the workflow run. One job failed.'};
  const project = {...garden, title:'project manus dei', summary:'A recently opened garden.'};
  const weather = {id:'repeat-open:weather',source:'schedule',title:"Check tomorrow's weather forecast in Delft. Will I need an umbrella",summary:'Asked by hand in 3 separate chats.'};
  const fragment = {...weather,id:'repeat-open:question',title:'What does that mean'};
  const evidence = [lecture,ci,project,weather,fragment];
  const proposals = [
    {prompt:`Prepare for “${lecture.title}” using the details in “${ci.title}”.`,sourceIds:[ci.id,lecture.id]},
    {prompt:`Every weekday at 9am, ${weather.title}`,sourceIds:[weather.id]},
    {prompt:`Quiz me on the key ideas in “${project.title}”, using my garden notes.`,sourceIds:[project.id]},
    {prompt:'Every weekday at 9am, check: What does that mean',sourceIds:[fragment.id]},
  ];
  const known = new Map(evidence.map(item=>[item.id,item]));
  const shown = parseRecommendations(proposals,evidence).map(card=>({...card,basis:recommendationBasis(card,known)}));
  assert.equal(shown.length,4);
  assert.deepEqual(evidenceRecommendations(evidence,shown,context),[]);
  assert.deepEqual(await generateRecommendations({evidence,context,shown,model:'selected',fetcher:async()=>
    Response.json({choices:[{message:{content:JSON.stringify(proposals)}}]})}),[]);
  // Rewording the proposal or citing a genuine chat cannot manufacture a schedule either.
  const chat = {id:'chat:weather',source:'chat',title:'Weather in Delft',summary:'Last asked: Will I need an umbrella?'};
  assert.deepEqual(selectRecommendations(parseRecommendations([{...proposals[1],sourceIds:[chat.id]}],[chat]),[chat]),[]);
  const synonym = {prompt:'Use the Multisim failure to write talking points for engineering ethics.',sourceIds:[ci.id,lecture.id]};
  assert.deepEqual(selectRecommendations(parseRecommendations([synonym],evidence),evidence),[]);
  const assigned = {...ci,id:'gmail:tutor',sender:'tutor@example.test',title:'Updated assignment',summary:'Please revise the stakeholder analysis for 0LVX30.'};
  assert.deepEqual(evidenceRecommendations([lecture,assigned],[],context).map(card=>card.sourceIds),[[assigned.id,lecture.id]]);
});

test('a date inside a written booking range supports a plan for a commitment on that date', () => {
  const commitment = {...gym,title:'Meridian planning meeting'};
  for (const range of ['Nov 6–9, 2026','6–9 November 2026','2026-11-06 to 2026-11-09']) {
    const booking = {...mail,title:'Your trip to Budapest',summary:`Reservation confirmed for ${range}.`};
    const [card] = evidenceRecommendations([booking,commitment],[],context);
    assert.deepEqual(card.sourceIds,[booking.id,commitment.id]);
    assert.match(card.prompt,/Budapest.*Meridian/);
  }
  for (const dates of ['Nov 6–9, 2025','book by Nov 6 for departure on Nov 9']) {
    assert.ok(evidenceRecommendations([{...mail,title:'Trip reservation',summary:dates},commitment],[],context)
      .every(card=>card.sourceIds.length===1));
  }
});

test('the screenshot case never turns rent into a project or a gym visit into a meeting',async()=>{
  const cards=await generateRecommendations({evidence:[rent,gym,gap],context,model:'none'});
  assert.deepEqual(cards,[],'with no useful action there are no cards at all');
  assert.doesNotMatch(cards.map(card=>card.prompt).join(' '),/rent|gym|25.minute/i);
});

test('useful source actions fill all four slots before any generic fallback is used',async()=>{
  const grant={id:'grant',source:'task',title:'Draft grant proposal',summary:'Include the budget for the new microscope.'};
  const cards=await generateRecommendations({evidence:[rent,gym,gap,task,mail,reading,garden,grant],context,model:'none'});
  assert.equal(cards.length,4);assert.ok(cards.every(card=>card.sourceIds.length>0));
  assert.ok(cards.some(card=>card.prompt.includes('Lab report feedback') && card.sourceIds.includes('mail')));
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
    assert.deepEqual(cards.flatMap(card=>card.sourceIds),evidence.filter(item=>item.source==='recall').map(item=>item.id));
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

test('the next review can use client feedback on the same project without assuming a reply is needed', async () => {
  const feedback = {...mail,title:'Meridian prototype feedback',summary:'The labels are hard to read.'};
  const review = {...gym,title:'Meridian design review'};
  const cards = evidenceRecommendations([feedback,review], [], context);
  assert.deepEqual(cards.map(card => card.sourceIds),[['mail','gym']]);
  assert.match(cards[0].prompt,/feedback.*Meridian design review.*changes/i);
  assert.equal(cards[0].usefulness,'timely');
  const separate = selectRecommendations([
    {id:'mail',sourceIds:['mail'],sourceLabel:'Gmail',prompt:'Extract the Meridian label feedback.'},
    {id:'gym',sourceIds:['gym'],sourceLabel:'Calendar',prompt:'Prepare questions for the Meridian review.'},
  ],[feedback,review]);
  const combined = {...cards[0],fallback:undefined,prompt:'Prepare a label revision to discuss at the Meridian review.'};
  assert.deepEqual(selectRecommendations([combined], [feedback,review], separate).map(card => card.prompt),[combined.prompt]);
});

test('a changed date invalidates a previously reviewed plan even when the event title stays the same', () => {
  const event = {...gym,title:'Robotics lecture'};
  const cards = evidenceRecommendations([event]);
  const moved = {...event,calendar:{...event.calendar,start:'2026-11-12T16:00',end:'2026-11-12T17:00'}};
  assert.deepEqual(selectRecommendations([], [moved],cards),[]);
});

test('an automated notice and a saved fact alone do not become a reply or a project', () => {
  const receipt = {...mail,sender:'no-reply@example.test',title:'Your account statement',summary:'Please review your statement.'};
  const fact = {id:'memory:1',source:'memory',title:'I live near the station',summary:'Remembered fact'};
  assert.deepEqual(evidenceRecommendations([receipt,fact],[],context),[]);
});

test('meeting, appointment and unfamiliar event titles get actions grounded in their own details', () => {
  const single = (title,summary,location) => evidenceRecommendations([{...gym,title,summary,calendar:{...gym.calendar,location}}])[0]?.prompt;
  assert.match(single('Flight planning meeting','',undefined),/talking points/);
  assert.match(single('Dental appointment','Bring a copy of the referral.'),/checklist.*bring/);
  assert.match(single('Na de storm','','Stadsschouwburg'),/arrival at Stadsschouwburg/);
  assert.match(single('Na de storm','','https://meet.example.test/room'),/joining details/);
  assert.equal(single('Na de storm','',undefined),undefined);
  const flight = {...mail,title:'Your flight to Vienna',summary:'Booking confirmed for 2026-11-08'};
  const meeting = {...gym,title:'Research lab meeting'};
  const [card] = evidenceRecommendations([flight,meeting],[],context);
  assert.deepEqual(card.sourceIds,[flight.id,meeting.id]);
  assert.match(card.prompt,/Vienna.*Research lab meeting/);
  assert.doesNotMatch(card.prompt,/catch.up|coursework/);
});

test('time alone does not connect unrelated invitations or prove a clash on the same day', async () => {
  const morning = {...gym,id:'m',title:'Aurora',calendar:{...gym.calendar,start:'2026-11-08T10:00',end:'2026-11-08T11:00'}};
  const evening = {...gym,id:'e',title:'Evening shift',calendar:{...gym.calendar,start:'2026-11-08T18:00',end:'2026-11-08T21:00'}};
  const invite = {...mail,title:'Invitation to choir rehearsal',summary:'On 2026-11-08 at 15:00.'};
  const marker = {...evening,id:'holiday',title:'Public holiday',calendar:{...evening.calendar,start:'2026-11-08T00:00',end:'2026-11-08T23:59',allDay:true}};
  assert.ok(evidenceRecommendations([morning,evening,invite,marker]).every(card => card.sourceIds.length === 1));
  const fabricated = {prompt:'Resolve the overlap between Aurora and my evening shift.',sourceIds:['m','e']};
  const cards = await generateRecommendations({evidence:[morning,evening],context,model:'selected',fetcher:async () =>
    Response.json({choices:[{message:{content:JSON.stringify([fabricated])}}]})});
  assert.deepEqual(cards,[]);
});
