import assert from 'node:assert/strict';
import test from 'node:test';
import {planMaxResearch,participantWaves,restrictsExternalResearch} from '../src/lib/max-research/plan.ts';
import {maxResearchSynthesisPrompt} from '../src/lib/max-research/synthesis.ts';

test('an explicit no-internet instruction excludes unconditional retrieval participants',()=>{
  const plan=planMaxResearch({question:'Compare Source A budget 300 cost 250 and Source B budget 300 cost 270. Use no internet or repository files.'});
  assert.deepEqual(plan.assignments.map(row=>row.participant),['agent_reach','openscience','aris']);
  assert.ok(plan.assignments.every(row=>row.guidance.includes('Do not browse')));
  assert.deepEqual(participantWaves(plan).map(wave=>wave.map(row=>row.participant)),[['agent_reach','openscience'],['aris']]);
});
test('ordinary research retains the complete useful roster',()=>{
  for(const question of ['Find the current evidence for sodium-ion batteries.','Research internet restrictions.','There are no internet restrictions.']){
    assert.equal(planMaxResearch({question}).assignments.length,7);
  }
});
test('common explicit browsing restrictions are recognized without broad topic matching',()=>{
  for(const question of ['Analyze the supplied table. Do not browse.','Use the pasted evidence. Do not access the internet.','No web searches.','Never use the web.'])assert.equal(restrictsExternalResearch(question),true,question);
  assert.equal(restrictsExternalResearch('Explain how internet access works.'),false);
});

test('restricted synthesis identifies supplied analysis rather than outside evidence',()=>{
  const plan=planMaxResearch({question:'Compare Source A and Source B. No web searches.'});
  const prompt=maxResearchSynthesisPrompt({plan,results:[{participant:'agent_reach',status:'completed',output:'Source A gives 50; Source B gives 30.',limitations:[{name:'Reddit',detail:'Not signed in'}]},{participant:'openscience',status:'failed',output:'',reason:'Unavailable'}]});
  assert.match(prompt,/person excluded external research/i);
  assert.match(prompt,/<standing>Analysis of the supplied material/);
  assert.doesNotMatch(prompt,/<standing>The open internet/);
  assert.doesNotMatch(prompt,/Some platforms were closed/);
  assert.match(prompt,/a planned analysis of the supplied material/);
});
