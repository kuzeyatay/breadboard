import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as watchdog from '../src/app/components/hermes/agent-stream-watchdog.ts';

const file=process.env.VOICE_STREAM_SOURCE??fileURLToPath(new URL('../src/app/components/hermes/use-agent-session.ts',import.meta.url));
const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
let callback;
function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(source)==='streamEvents')callback=n.initializer.arguments[0];ts.forEachChild(n,visit);}
visit(source);assert.ok(callback);
const code=ts.transpileModule('const streamEvents='+callback.getText(source)+';',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const turn={id:'saved-assistant',role:'assistant',clientMessageId:'owned-turn',status:'complete',pending:false,content:'First sentence. Second sentence. Third sentence.',
  tools:[{toolCallId:'owned-tool',toolName:'workspace_read',status:'completed'}],uiResources:[{id:'result'}],usage:{outputTokens:17}};
function fixture(restored,{duringLoad=()=>{},stop=false,abort=false}={}){
  const controller=new AbortController();if(abort)controller.abort();
  const commits=[],states=[],errors=[],activities=[{id:'writing',status:'running'}];let requests=0,loads=0;
  const scope={...watchdog,TextDecoder,URLSearchParams,AbortController,DOMException,
    abortRef:{current:null},runStateRef:{current:'running'},stopRequestedRef:{current:stop},surface:'dashboard_terminal',createOptions:undefined,
    transition:v=>states.push(v),setActivities:update=>{activities.splice(0,activities.length,...update(activities));},
    setActiveTools(){},setError:v=>errors.push(v),stopWasRequested:()=>stop,
    notifyHermesSessionsChanged(){},normalizeRestoredMessages:x=>x,scrubbed:x=>x,
    waitForAgentStreamReconnect:async()=>{},
    loadHermesSessionDetail:async(surface,id,options)=>{loads++;assert.equal(surface,'dashboard_terminal');assert.equal(id,'owned-chat');assert.ok(options.signal);await duringLoad(controller);return restored;},
    fetch:async()=>{requests++;if(requests>1)throw new Error('Unexpected empty-pump reconnect');return new Response(new ReadableStream({start(c){
      c.enqueue(new TextEncoder().encode(': connected\n\ndata: '+JSON.stringify({type:'assistant.voice.delta',payload:{text:'First sentence.',segment:0}})+'\n\n'));c.close();
    }}));},
  };
  const stream=new Function(...Object.keys(scope),code+'\nreturn streamEvents;')(...Object.values(scope));
  return {run:()=>stream('owned-chat',{id:'optimistic-assistant',role:'assistant',clientMessageId:'owned-turn',content:'',pending:true},m=>commits.push(m),()=>{},Date.now(),false,0,controller),
    commits,states,errors,activities,requests:()=>requests,loads:()=>loads};
}

test('a lost terminal frame restores every sentence from the exact saved turn without opening an idle stream',async()=>{
  const h=fixture({id:'owned-chat',messages:[turn]});
  assert.equal(await h.run(),'completed');assert.equal(h.requests(),1);assert.equal(h.loads(),1);
  assert.equal(h.commits.at(-1).content,turn.content);assert.equal(h.commits.at(-1).id,'optimistic-assistant');
  assert.equal(h.commits.at(-1).pending,false);assert.deepEqual(h.commits.at(-1).tools,turn.tools);
  assert.deepEqual(h.commits.at(-1).uiResources,turn.uiResources);assert.equal(h.activities[0].status,'completed');
});
test('recovery does not substitute another chat, another turn, a pending result, or an unclassified row',async()=>{
  for(const snapshot of [{id:'different-chat',messages:[turn]},
    {id:'owned-chat',messages:[{...turn,clientMessageId:'different-turn'}]},
    {id:'owned-chat',messages:[{...turn,status:'pending',pending:true}]},
    {id:'owned-chat',messages:[{...turn,status:'complete',pending:true}]},
    {id:'owned-chat',messages:[{...turn,status:undefined}]}]) {
    const h=fixture(snapshot);await assert.rejects(h.run(),/Unexpected empty-pump reconnect/);
    assert.ok(h.commits.every(m=>m.content!==turn.content));
  }
});
test('durably failed or stopped turns are restored with their real outcome',async()=>{
  for(const [status,outcome] of [['failed','failed'],['aborted','cancelled']]){
    const h=fixture({id:'owned-chat',messages:[{...turn,status,runtimeError:'Saved failure',failed:status==='failed',interrupted:status==='aborted'}]});
    assert.equal(await h.run(),outcome);assert.equal(h.requests(),1);assert.equal(h.commits.at(-1).content,turn.content);
  }
});
test('a stop during reconciliation cannot revive the completed answer',async()=>{
  const h=fixture({id:'owned-chat',messages:[turn]},{duringLoad:c=>c.abort()});
  await assert.rejects(h.run(),{name:'AbortError'});assert.ok(h.commits.every(m=>m.content!==turn.content));
});
