import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import {voiceReasoningEffort} from '../src/lib/speech/assistant-preferences.ts';
import {fileURLToPath} from 'node:url';
const candidate=fileURLToPath(new URL('../',import.meta.url));
function declaration(relative,name,scope) {
 const source=fs.readFileSync(path.join(candidate,'src',relative),'utf8');
 const ast=ts.createSourceFile(relative,source,ts.ScriptTarget.Latest,true);
 let node;function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text===name)node=n;else ts.forEachChild(n,visit);}visit(ast);assert.ok(node);
 const js=ts.transpileModule(node.getText(ast),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 return new Function('exports',...Object.keys(scope),`${js}\nreturn ${name};`)({},...Object.values(scope));
}
test('plain conversation never opens the slash registry; explicit selectors retain it',async()=>{
 let lookups=0;
 const resolve=declaration('lib/hermes/commands.ts','resolveCommandMessage',{
  parseUnifiedWorkflowCommand:()=>null, leadingCapabilityTokens:()=>({tokens:[]}),
  outcomeWithoutCapabilityTokens:t=>t,findCapabilityConflict:()=>null,
  registryItemsForUser:()=>{lookups++;throw Error('Registry unavailable');},
  requestedSelectors:(text,registry)=>{assert.deepEqual(registry,[]);return {requested:[],remaining:text,consumedContext:false};},
 });
 for(const text of ['Hello','What is seven times three?','  Please explain /office without selecting it.','```\n/office\n```','Actually, I meant the earlier answer.']){
  assert.deepEqual(await resolve(1,text),{text,userText:text,invocations:[]});
 }
 assert.equal(lookups,0);
 await assert.rejects(resolve(1,'  /office create a document'),/Registry unavailable/);
 assert.equal(lookups,1,'real selectors must use live registry validation');
});
test('voice catalog lasts through microphone setup, remains scoped, and typed freshness stays unchanged',()=>{
 let reads=0;
 const cache=new Map();let now=1000;
 const open=declaration('lib/hermes/super-agent.ts','openableSkills',{
  OPENABLE_SKILLS_TTL_MS:15000,openableSkillsCache:cache,Date:{now:()=>now},GOAL_MODE_SKILL:'goal',
  listApprovedSkills:()=>{reads++;return [{slug:'safe',enabled:true,healthy:true,classification:'eligible_general'},{slug:'goal',enabled:true,healthy:true,classification:'eligible_general'},{slug:'disabled',enabled:false,healthy:true,classification:'eligible_general'}];},
 });
 assert.deepEqual(open('dashboard_terminal',['a'],60000).map(s=>s.slug),['safe']);
 now+=19000;open('dashboard_terminal',['a'],60000);assert.equal(reads,1);
 open('dashboard_terminal',['a']);assert.equal(reads,2,'typed freshness remains 15 seconds');
 open('dashboard_terminal',['b'],60000);assert.equal(reads,3,'connection changes never borrow another scope');
 now+=60001;open('dashboard_terminal',['b'],60000);assert.equal(reads,4);
});
test('voice preparation authenticates first, defers optional connections and warms only local metadata',async()=>{
 const calls=[];let authorized=true;
 const GET=declaration('app/api/hermes/sessions/[sessionId]/events/route.ts','GET',{
  requireUserId:async()=>7,requireEnabled:()=>{},
  getConversationForUser:()=>{if(!authorized)throw Error('Forbidden');return {id:42};},
  parseSurface:()=> 'dashboard_terminal',conversationRequestSurface:(_,s)=>s,conversationRequestContext:()=>({}),
  resolveConversationRuntime:async input=>{calls.push(['runtime',input.deferMcpConnections]);return {id:42};},
  loadSuperAgentInventory:async input=>calls.push(['catalog',input]),
  buildSessionEventStream:()=>new Response('ready'),apiErrorResponse:()=>new Response('denied',{status:403}),
 });
 const request=new Request('http://localhost/api/hermes/sessions/owned/events?surface=dashboard_terminal&prepareVoice=1');
 assert.equal((await GET(request,{params:Promise.resolve({sessionId:'owned'})})).status,200);
 assert.deepEqual(calls,[['runtime',true],['catalog',{userId:7,surface:'dashboard_terminal',voice:true}]]);
 calls.length=0;authorized=false;
 assert.equal((await GET(request,{params:Promise.resolve({sessionId:'foreign'})})).status,403);assert.equal(calls.length,0);
 authorized=true;
 await GET(new Request('http://localhost/api/hermes/sessions/owned/events?surface=dashboard_terminal'),{params:Promise.resolve({sessionId:'owned'})});
 assert.deepEqual(calls,[['runtime',false]],'ordinary viewers do not prewarm voice catalogs');
});
test('screen context and the selected voice model are read concurrently without changing settings',async()=>{
 let finishScreen,finishProfile;const starts=[];
 const get=declaration('lib/speech/voice-request.ts','voiceRequestOptions',{
  currentVoiceScreenContext:()=>{starts.push('screen');return new Promise(r=>finishScreen=r);},
  fetch:()=>{starts.push('profile');return new Promise(r=>finishProfile=r);},
  parseVoiceAssistantPreferences:p=>p,normalizeAssistantModelId:v=>v,
  GLOBAL_MODEL_SENTINEL:'global',parseVoiceScreenContext:v=>v,voiceReasoningEffort,
 });
 const result=get();assert.deepEqual(starts,['screen','profile']);
 finishProfile(Response.json({preferences:{voiceModel:'user-model'},effectiveVoiceModel:'user-model'}));
 finishScreen({browserAccess:null});
 assert.deepEqual(await result,{model:'user-model',reasoningEffort:'low',voice:true,browserAccess:null});
});
