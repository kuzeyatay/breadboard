import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { voiceHostMessages } from '../src/lib/speech/voice-host-messages.ts';
import { createVoiceNarrationQueue } from '../src/lib/speech/voice-conversation.ts';

const ask={role:'user',content:'Make a printable test piece.',clientMessageId:'human'};
const preamble={role:'assistant',content:'I’ll build a small test piece.',clientMessageId:'human'};
const workerAsk={role:'user',content:'PRIVATE WORKER BRIEF',clientMessageId:'worker'};
const workerResult={role:'assistant',content:'PRIVATE WORKER LOG',clientMessageId:'worker',delegatedAgentRun:true};
const continuation={role:'user',content:'PRIVATE CONTINUATION',internalAgentContinuation:true,clientMessageId:'handback'};
const final={role:'assistant',content:'Your test piece is ready. Both parts are exported. Check the clearance before printing.',clientMessageId:'handback'};

test('voice narrates the public answer and hides both sides of private worker turns',()=>{
 const all=[ask,preamble,workerAsk,workerResult,continuation,final];
 assert.deepEqual(voiceHostMessages(all),[ask,preamble,final]);
 assert.equal(all.length,6,'presentation does not mutate the canonical worker transcript');
});
test('multiple workers and repeated identical briefs remain private after reload',()=>{
 const other=[{...workerAsk,clientMessageId:'worker2'},{...workerResult,clientMessageId:'worker2'}];
 assert.deepEqual(voiceHostMessages(JSON.parse(JSON.stringify([ask,preamble,workerAsk,workerResult,...other,continuation,final]))),[ask,preamble,final]);
});
test('public progress reads labels without reasoning details or tool arguments',()=>{
 const activities=[{kind:'tool',label:'Checking the exported model',status:'running',detail:'PRIVATE TOOL ARGUMENTS'},
  {kind:'reasoning',label:'PRIVATE REASONING LABEL',status:'running',detail:'PRIVATE REASONING'}];
 const visible=voiceHostMessages([ask,{...preamble,content:''}],activities,true);
 assert.deepEqual(visible.at(-1).progressNotes,['Checking the exported model']);
 assert.doesNotMatch(JSON.stringify(visible),/PRIVATE/);
});
test('completed and failed tools do not falsely announce that work is starting',()=>{
 const activities=['completed','failed','denied','cancelled'].map(status=>({kind:'tool',label:'Checking the model',status}));
 assert.equal(voiceHostMessages([ask,preamble],activities,true).at(-1).progressNotes,undefined);
 assert.equal(voiceHostMessages([ask,preamble],[{kind:'tool',label:'Checking the model',status:'running'}],false).at(-1).progressNotes,undefined);
});
test('inline side answers and model separators cannot interrupt voice',()=>{
 assert.deepEqual(voiceHostMessages([ask,{role:'assistant',content:'Separate answer',textSelection:{mode:'inline'}},{role:'assistant',content:'Model changed',modelChange:'some-model'},final]),[ask,final]);
});
test('one narration queue survives worker handoff and reads every final sentence exactly once',async()=>{
 const spoken=[];
 const queue=createVoiceNarrationQueue({startIndex:1,streamAnswers:true,speak:async item=>{if(item.text)spoken.push(item.text);},onIdle:()=>{},onError:error=>{throw error;}});
 queue.update(voiceHostMessages([ask,preamble]),true);
 queue.update(voiceHostMessages([ask,preamble,workerAsk,workerResult]),true);
 await new Promise(resolve=>setTimeout(resolve,50));
 queue.update(voiceHostMessages([ask,preamble,workerAsk,workerResult,continuation,final]),true);
 queue.update(voiceHostMessages([ask,preamble,workerAsk,workerResult,continuation,final]),false);
 await new Promise(resolve=>setTimeout(resolve,50));
 assert.equal(spoken.join(' '),preamble.content+' '+final.content);
 queue.update(voiceHostMessages([ask,preamble,workerAsk,workerResult,continuation,final]),false);
 await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(spoken.join(' '),preamble.content+' '+final.content);queue.cancel();
});
test('interrupting a delegated answer drops queued followup speech',async()=>{
 let finish;const spoken=[];
 const queue=createVoiceNarrationQueue({startIndex:1,streamAnswers:true,speak:async(item,signal)=>{spoken.push(item.text);await new Promise(resolve=>{finish=resolve;signal.addEventListener('abort',resolve,{once:true});});},onIdle:()=>{},onError:error=>{throw error;}});
 queue.update([ask,{...preamble,voiceStream:{text:preamble.content,segment:0}}],true);
 await new Promise(resolve=>setTimeout(resolve,0));
 queue.update([ask,preamble,final],false);queue.cancel();finish?.();
 await new Promise(resolve=>setTimeout(resolve,0));assert.deepEqual(spoken,[preamble.content]);
});

// Architecture guards cover the original defect: a second session hook can
// answer promptly while never consuming agent_launch requests at all.
test('standalone voice mounts the shared worker host and preserves its permissions and stop action',()=>{
 const read=file=>fs.readFileSync(new URL('../src/'+file,import.meta.url),'utf8');
 const page=read('app/voice/page.tsx'),host=read('app/components/hermes/dashboard-agent-terminal.tsx'),panel=read('app/components/hermes/agent-runtime-panel.tsx'),surface=read('app/components/hermes/voice-terminal-surface.tsx');
 assert.match(page,/<DashboardAgentTerminal[^>]*presentation="voice"/);
 assert.doesNotMatch(page,/useAgentSession/);
 assert.match(host,/session\.agentLaunchRequests/);assert.match(host,/onExternalAgentTerminal=\{handleExternalAgentTerminal\}/);
 assert.match(host,/busy=\{currentChatActive \|\| delegationInFlight\}/);
 assert.match(host,/stopControlRef=\{voicePresentation \? voiceStopRef : undefined\}/);
 assert.match(host,/voiceTurnOptions\?\.model/);assert.match(host,/internalAgentContinuation: true,[\s\S]{0,200}voice: true/);
 assert.match(panel,/stopControlRef\.current = stopEverything/);
 assert.match(panel,/Promise\.all\(\[parentStopped, abortExternalRuns\(externalStops\)\]\)/);
 assert.match(surface,/respondToPermission\('once'\)/);assert.match(surface,/respondToPermission\('reject'\)/);
 assert.match(host,/notice=\{agentLaunchQueue\.pending \? <AgentLaunchPrompt/);
 assert.match(host,/surface: voicePresentation \? "voice_companion"/,'disabled voice drafts must not erase normal blank-chat drafts');
});
