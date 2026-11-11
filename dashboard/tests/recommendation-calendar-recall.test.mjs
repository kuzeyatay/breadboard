import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarRecommendationEvidence } from '../src/lib/recommendations/calendar-context.ts';
import { recallRecommendationEvidence } from '../src/lib/recommendations/recall-context.ts';
import { recommendationClock } from '../src/lib/recommendations/clock.ts';
import { evidenceRecommendations } from '../src/lib/recommendations/types.ts';

const context={localDate:'2026-11-07',localTime:'10:30'};
const event=(id,title,start,end,extra={})=>({eventId:id,title,start:`2026-11-07T${start}`,end:`2026-11-07T${end}`,calendar:'Study',...extra});
const schedule=[
  event(1,'Old breakfast','07:00','07:30'),
  event(2,'Finished circuits review','09:00','10:00'),
  event(3,'RLC lab meeting','11:00','12:00'),
  event(4,'Project tutorial','11:30','12:30'),
  event(5,'Signals workshop','14:00','15:00'),
];

test('Calendar distinguishes preparation, recent follow-up, overlaps and real focus windows',()=>{
  const evidence=calendarRecommendationEvidence(schedule,context,true);
  assert.equal(evidence.some(item=>item.title==='Old breakfast'),false);
  assert.equal(evidence.find(item=>item.title==='Finished circuits review').calendar.status,'recently-ended');
  assert.equal(evidence.find(item=>item.title==='RLC lab meeting').calendar.status,'upcoming');
  const overlap=evidence.find(item=>item.calendar.kind==='overlap');
  assert.equal(overlap.calendar.start,'2026-11-07T11:30');assert.equal(overlap.calendar.end,'2026-11-07T12:00');
  const gap=evidence.find(item=>item.calendar.kind==='gap');
  assert.equal(gap.calendar.start,'2026-11-07T10:30');assert.equal(gap.calendar.end,'2026-11-07T11:00');
  assert.match(gap.summary,/not proof of availability/);
  const followUp=evidenceRecommendations(evidence.filter(item=>item.calendar.status==='recently-ended'));
  assert.match(followUp[0].prompt,/notes and follow-ups/);assert.doesNotMatch(followUp[0].prompt,/prepare/);
});

test('gaps cannot be inferred from failed, truncated or all-day schedules; duplicates are not conflicts',()=>{
  assert.equal(calendarRecommendationEvidence(schedule,context,false).some(item=>item.calendar.kind==='gap'),false);
  assert.deepEqual(calendarRecommendationEvidence([],context,true),[]);
  const allDay=event(8,'Exam day','00:00','23:59',{allDay:true});
  const evidence=calendarRecommendationEvidence([allDay,schedule[2],{...schedule[2],eventId:33}],context,true);
  assert.equal(evidence.some(item=>item.calendar.kind==='gap'||item.calendar.kind==='overlap'),false);
});

test('recurring series contribute the next relevant occurrence rather than flooding the cards',()=>{
  const evidence=calendarRecommendationEvidence([
    schedule[2], {...schedule[2],start:'2026-11-08T11:00',end:'2026-11-08T12:00'},
    event(9,'Current meeting','10:00','11:00'),
  ],context,true);
  assert.equal(evidence.filter(item=>item.title==='RLC lab meeting').length,1);
  assert.equal(evidence.find(item=>item.title==='Current meeting').calendar.status,'ongoing');
});

test('timezone-aware clocks keep local calendar dates correct across midnight and DST',()=>{
  const amsterdam=recommendationClock({timeZone:'Europe/Amsterdam'},new Date('2026-11-07T23:30:00Z'));
  assert.equal(amsterdam.localDate,'2026-11-08');assert.equal(amsterdam.localTime,'00:30');
  const summer=recommendationClock({timeZone:'Europe/Amsterdam'},new Date('2026-07-07T09:30:00Z'));
  assert.equal(summer.localTime,'11:30');
  assert.equal(recommendationClock({localDate:'2026-99-99',localTime:'30:00'},new Date('2026-11-07T09:30:00Z')).localDate.includes('99'),false);
});

test('Recall merges repeated frames, drops browser chrome, and connects relevant reading to the next event',()=>{
  const calendar=calendarRecommendationEvidence(schedule,context,true);
  const recall=recallRecommendationEvidence([
    {window:'RLC transient response',app:'Reader',text:'RLC lab measurements and damping',timestamp:'2026-11-07T09:30:00Z'},
    {window:'RLC transient response',app:'Reader',text:'Older view',timestamp:'2026-11-07T09:00:00Z'},
    {window:'New tab',app:'Browser',text:'Search Google',timestamp:'2026-11-07T10:00:00Z'},
    {window:'Cooking recipe',app:'Browser',text:'Roast vegetables',timestamp:'2026-11-07T08:00:00Z'},
  ],calendar);
  assert.equal(recall.length,2);assert.match(recall[0].summary,/measurements/);
  const meeting=calendar.find(item=>item.title==='RLC lab meeting');
  assert.deepEqual(recall[0].relatedIds,[meeting.id]);assert.deepEqual(recall[1].relatedIds,[]);
  const cards=evidenceRecommendations([meeting,...recall]);
  assert.match(cards[0].prompt,/recent reading/);
  assert.deepEqual(cards[0].sourceIds,[meeting.id,recall[0].id]);
});

test('refresh keeps cards that still apply, in place, and drops one whose evidence changed',()=>{
  const evidence=[...calendarRecommendationEvidence(schedule,context,true),{id:'task:1',source:'task',title:'Circuit simulation',summary:'Unfinished task'}];
  const first=evidenceRecommendations(evidence);
  const next=evidenceRecommendations(evidence,first);
  assert.deepEqual(next.map(item=>item.prompt),first.map(item=>item.prompt),'nothing changed, so nothing moves');
  assert.ok(next.every(item=>item.sourceIds.every(id=>evidence.some(row=>row.id===id))));
  assert.ok(first.every(item=>['urgent','timely','helpful'].includes(item.usefulness)));
  // The task's notes change: the card built on the old notes no longer applies.
  const edited=evidence.map(row=>row.id==='task:1'?{...row,summary:'Unfinished task. Now blocked: simulator license failed.'}:row);
  const after=evidenceRecommendations(edited,first);
  const kept=first.filter(item=>!item.sourceIds.includes('task:1')).map(item=>item.prompt);
  assert.ok(kept.every(prompt=>after.some(item=>item.prompt===prompt)),'untouched cards stay');
  assert.ok(first.some(item=>item.prompt.includes('25-minute plan')&&item.sourceIds.includes('task:1')));
});
