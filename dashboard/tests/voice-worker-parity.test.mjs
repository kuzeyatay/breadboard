import assert from 'node:assert/strict';
import test from 'node:test';
import {voiceCapabilitiesContext} from '../src/lib/speech/voice-capabilities.ts';
import {runtimeAgentBrief} from '../src/lib/hermes/runtime-agent-briefs.ts';

const inventory={skills:[],moreSkillSlugs:[],unlistedSkillCount:0,skillSlugs:['files'],connections:[],divisions:[],specialistCount:0,
  workflowsReachable:true,workflows:[],runtimeAgents:[
    {id:'parametric-cad',name:'Parametric CAD',command:'/agents:parametric-cad',launchable:true},
    {id:'vimax',name:'ViMax',command:'/agents:vimax',launchable:true},
    {id:'formsmith',name:'Formsmith',command:'/agents:formsmith',launchable:false},
  ]};

test('an unselected skill does not hide the available geometry worker and its real output',()=>{
  assert.ok(!inventory.skillSlugs.includes('parametric-cad'));
  const context=voiceCapabilitiesContext(inventory);
  assert.ok(context.includes(runtimeAgentBrief('parametric-cad').does));
  assert.ok(context.includes(runtimeAgentBrief('parametric-cad').choose));
  assert.match(context,/agent_launch with its exact worker id/);
  assert.match(context,/unselected.*does not mean Breadboard lacks/s);
});

test('all workers retain the same capability distinctions as normal chat',()=>{
  const context=voiceCapabilitiesContext(inventory);
  for(const worker of inventory.runtimeAgents){
    const brief=runtimeAgentBrief(worker.id);
    assert.ok(context.includes(brief.does),worker.id+' actual capability');
    if(worker.launchable&&brief.choose)assert.ok(context.includes(brief.choose),worker.id+' routing condition');
  }
  assert.match(context,/\/agents:formsmith: Formsmith \(user form only\)/);
  assert.doesNotMatch(context,/- formsmith:/,'form-only worker must not be offered as launchable');
  assert.match(context,/confirmation and permission controls/);
  assert.match(context,/report completion only from the returned result/);
});

test('worker discovery remains stable across relevance order and handles unknown workers',()=>{
  const before=structuredClone(inventory);
  assert.equal(voiceCapabilitiesContext(inventory),voiceCapabilitiesContext({...inventory,runtimeAgents:[...inventory.runtimeAgents].reverse()}));
  assert.deepEqual(inventory,before);
  const result=voiceCapabilitiesContext({...inventory,runtimeAgents:[{id:'new-worker',name:'New worker',command:'/new',launchable:true}]});
  assert.ok(result.includes('- new-worker: New worker'));
  assert.ok(!result.includes('manufacturable'),'never invent another worker capability');
});
