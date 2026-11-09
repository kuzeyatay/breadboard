import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { appendWeatherToolDisplays } from '../src/lib/weather/tool-display.ts';
import { responseTextForSpeech } from '../src/lib/speech/response-text.ts';
import { normalizeHermesEvent, createHermesEventNormalizationState } from '../src/lib/agent-runtime/hermes-events.ts';

const display={location:'Utrecht',country:'The Netherlands',timezone:'Europe/Amsterdam',days:[
  {date:'2026-11-08',temperatureC:7.6,minC:6,maxC:9.2,code:51,condition:'Drizzle',isDay:true}
]};
const evidence=(result={display},success=true,toolName='weather_forecast')=>({success,details:{toolName,result}});
const block=value=>'```weather-results\n'+JSON.stringify(value)+'\n```';
const answer='Bring an umbrella. Expect some drizzle.';
const readBlocks=value=>[...value.matchAll(/```weather-results\n([^\n]+)\n```/g)].map(match=>JSON.parse(match[1]));

for(const result of [{display},JSON.stringify({display})])test('successful tool data supplies an omitted card without changing prose',()=>{
  const resultText=appendWeatherToolDisplays(answer,[evidence(result)]);
  assert.deepEqual(readBlocks(resultText),[display]);assert.ok(resultText.startsWith(answer+'\n\n'));
});
test('weather JSON stays silent while all answer sentences remain readable',async()=>{
  assert.equal(await responseTextForSpeech(appendWeatherToolDisplays(answer,[evidence()])),answer);
});
test('idempotence and repeated tool events do not duplicate cards',()=>{
  const once=appendWeatherToolDisplays(answer,[evidence(),evidence()]);
  assert.equal(appendWeatherToolDisplays(once,[evidence()]),once);assert.equal(readBlocks(once).length,1);
});
test('copied or altered model JSON is replaced by actual tool quantities',()=>{
  const modified={...display,days:[{...display.days[0],maxC:90}]};
  assert.deepEqual(readBlocks(appendWeatherToolDisplays(answer+'\n\n'+block(modified),[evidence()])),[display]);
});
test('distinct locations and dates survive; the latest result replaces a retried forecast',()=>{
  const next={...display,days:[{...display.days[0],maxC:10}]};
  const elsewhere={...display,location:'Gouda'};
  const later={...display,days:[{...display.days[0],date:'2026-11-09'}]};
  assert.deepEqual(readBlocks(appendWeatherToolDisplays(answer,[evidence(),evidence({display:elsewhere}),evidence({display:next}),evidence({display:later})])),[next,elsewhere,later]);
});
for(const item of [evidence({display},false),evidence({display},true,'websearch'),evidence('{bad'),
  evidence({error:'Weather unavailable',display}),evidence({success:false,display}),evidence({ok:false,display}),
  evidence({display:{...display,days:[]}}),evidence({display:{...display,days:[{...display.days[0],maxC:'9'}]}}),
  evidence({display:{...display,days:[{...display.days[0],maxC:Infinity}]}})]) {
  test('failed, unrelated or malformed evidence does not invent a card: '+JSON.stringify(item),()=>{
    assert.equal(appendWeatherToolDisplays(answer,[item]),answer);
  });
}
test('tool strings cannot close the Markdown fence',()=>{
  const unusual={...display,location:'A``` place'};
  const rendered=appendWeatherToolDisplays(answer,[evidence({display:unusual})]);
  assert.deepEqual(readBlocks(rendered),[unusual]);assert.equal(rendered.match(/```/g).length,2);
});
test('normal Hermes tool completion retains the exact display for final assembly',()=>{
  const state=createHermesEventNormalizationState();
  const events=normalizeHermesEvent({type:'tool.complete',session_id:'test',timestamp:'2026-11-07T00:00:00Z',payload:{name:'weather_forecast',tool_id:'weather-1',result:JSON.stringify({display})}},'test','public-test',state);
  const completed=events.find(event=>event.type==='tool.completed');assert.ok(completed);
  assert.deepEqual(readBlocks(appendWeatherToolDisplays(answer,[completed.payload])),[display]);
});

test('the successful event-pump branch emits and persists the same materialized answer',async()=>{
  const source=readFileSync(new URL('../src/lib/hermes/event-stream.ts',import.meta.url),'utf8');
  const tree=ts.createSourceFile('stream.ts',source,ts.ScriptTarget.Latest,true);
  let body;
  function visit(node){
    if(ts.isIfStatement(node)&&node.expression.getText(tree)==='event.payload.status === "idle"'
      &&node.thenStatement.getText(tree).includes('publishProducedFilesForTurn'))body=node.thenStatement.getText(tree);
    ts.forEachChild(node,visit);
  }
  visit(tree);assert.ok(body);
  const context={assistantText:answer,evidence:[evidence()],appendWeatherToolDisplays,sawTurnOutput:true,streamRun:null,
    event:{type:'session.status',payload:{status:'idle'}},session:{hermesSessionId:'test'},
    emitArtifactEvents(){},emitAgentLaunchRequests(){},emit(){},
    assessVerification(){return {};},geographicGroundingRequired(){return false;},webGroundingAppliesToCompletion(){return false;},
    externalAgentsForTurn(){return [];},researchExhaustionForTurn(){},researchCoverageForTurn(){},capabilitiesForTurn(){}};
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const run=new AsyncFunction(...Object.keys(context),`const captured={};function emitStableAnswer(){captured.emitted=assistantText;}function finalize(status){captured.saved=assistantText;captured.status=status;}for(let once=0;once<1;once++)${ts.transpileModule(body,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText}return captured;`);
  const captured=await run(...Object.values(context));
  assert.equal(captured.emitted,captured.saved);assert.equal(captured.status,'idle');assert.deepEqual(readBlocks(captured.saved),[display]);
});
