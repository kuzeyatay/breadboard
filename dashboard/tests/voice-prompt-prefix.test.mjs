import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, {after} from 'node:test';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'breadboard-voice-prefix-'));
process.env.BREADBOARD_DATA_DIR=temporary;
process.env.BREADBOARD_LOOPX_HOME=path.join(temporary,'loopx');
process.env.ENABLE_LOOPX='1';
const {composeHermesSystemPrompt}=await import('../src/lib/hermes/system-prompts.ts');
const {writeSnapshot,buildSnapshot}=await import('../src/lib/loopx/snapshot.ts');
const {COMPOSED_SYSTEM_PROMPT_LIMIT}=await import('../src/lib/hermes/prompt-budget.ts');
const {default:db}=await import('../src/lib/db.ts');
after(()=>{db.close();assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir())+path.sep+'breadboard-voice-prefix-'));fs.rmSync(temporary,{recursive:true,force:true});});
const catalog='# full_breadboard_capabilities\n'+Array.from({length:138},(_,i)=>`Capability ${i}: retain the available tool and its instructions.`).join('\n')+'\nCATALOG_END';
const decision={mode:'knowledge',implementationRequired:false,allowedTools:['websearch','weather_forecast'],authorizedRoots:['C:/authorized'],authorizedPathPatterns:[],authorizedDeleteTargets:[],allowedOperations:['knowledge_work'],allowedCommandPatterns:[],expiresAt:'2030-01-01T00:00:00Z'};
const input={surface:'dashboard_terminal',voice:true,decision,additional:catalog+'\nCurrent context remains present.'};
const prefix=prompt=>{const end=prompt.indexOf('CATALOG_END');assert.ok(end>=0);return prompt.slice(0,end+'CATALOG_END'.length);};
test('voice web evidence changes retain the entire stable capability prefix and the current instruction',()=>{
 const plain=composeHermesSystemPrompt(input),grounded=composeHermesSystemPrompt({...input,requiresWebEvidence:true});
 assert.equal(prefix(plain),prefix(grounded));
 assert.doesNotMatch(plain,/# web_grounding/);assert.match(grounded,/This turn requires current external evidence/);
 assert.match(grounded,/Current context remains present/);assert.match(grounded,/C:\/authorized/);assert.match(grounded,/2030-01-01T00:00:00Z/);
});
test('voice loop state can appear and change without invalidating the capability catalog',()=>{
 const conversationPublicId='conv-prefix-fixture',base={...input,conversationPublicId};
 const initial=composeHermesSystemPrompt(base);
 writeSnapshot(conversationPublicId,buildSnapshot({goalId:'prefix-test',objective:'Deliver the report',capturedAt:'2030-01-01T00:00:00Z',quota:{decision:'run',should_run:true,requires_user_action:false,reason:'Continue the authorized work'}}));
 const running=composeHermesSystemPrompt(base);assert.match(running,/# loop_state/);assert.match(running,/Deliver the report/);assert.equal(prefix(initial),prefix(running));
 writeSnapshot(conversationPublicId,buildSnapshot({goalId:'prefix-test',objective:'Deliver the report',capturedAt:'2030-01-01T00:01:00Z',quota:{decision:'wait',should_run:false,requires_user_action:true,reason:'Await the requested input'}}));
 const waiting=composeHermesSystemPrompt(base);assert.equal(prefix(running),prefix(waiting));assert.match(waiting,/Await the requested input/);assert.doesNotMatch(waiting,/Continue the authorized work/);
});
test('voice goal activation preserves the prefix while retaining its capability boundary',()=>{
 const plain=composeHermesSystemPrompt(input),goal=composeHermesSystemPrompt({...input,goalSkillSelected:true});
 assert.equal(prefix(plain),prefix(goal));assert.match(goal,/# goal_mode/);assert.match(goal,/only when the user explicitly requested a token budget/);assert.match(goal,/Goal grants no filesystem, network, or other capability/);
});
test('all voice policies and the exact authority survive a large Unicode context budget',()=>{
 const prompt=composeHermesSystemPrompt({...input,requiresWebEvidence:true,goalSkillSelected:true,additional:'START_CONTEXT '+catalog+'😀'.repeat(180000)+' END_CONTEXT'});
 assert.ok(prompt.length<=COMPOSED_SYSTEM_PROMPT_LIMIT);assert.equal(prompt.isWellFormed(),true);assert.match(prompt,/START_CONTEXT/);assert.match(prompt,/END_CONTEXT/);assert.match(prompt,/# web_grounding/);assert.match(prompt,/# goal_mode/);assert.match(prompt,/# server_capability_decision/);assert.match(prompt,/C:\/authorized/);assert.match(prompt,/# voice_conversation/);
});
test('typed conversations retain their existing policy ordering',()=>{
 const prompt=composeHermesSystemPrompt({...input,voice:false,requiresWebEvidence:true,goalSkillSelected:true});
 assert.ok(prompt.indexOf('# web_grounding')<prompt.indexOf('# full_breadboard_capabilities'));assert.ok(prompt.indexOf('# goal_mode')<prompt.indexOf('# full_breadboard_capabilities'));assert.doesNotMatch(prompt,/# voice_conversation/);
});
