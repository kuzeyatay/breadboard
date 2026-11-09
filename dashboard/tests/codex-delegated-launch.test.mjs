import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import test, {after} from 'node:test';
import ts from 'typescript';
import {build} from 'esbuild';

const dashboard=path.resolve(import.meta.dirname,'..');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'breadboard-codex-delegation-'));
process.env.BREADBOARD_DATA_DIR=root;
const {default:db}=await import('../src/lib/db.ts');
const store=await import('../src/lib/conversations/store.ts');
const turns=await import('../src/lib/conversations/external-agent-turns.ts');
const runs=await import('../src/lib/conversations/external-agent-runs.ts');
const identity=await import('../src/lib/codex/identity.ts');
db.prepare("INSERT INTO users(id,username,email,password_hash) VALUES (1,'diagnostic','test@example.test','x')").run();
after(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});
const sourceFile=relative=>process.env.CODEX_LAUNCH_CANDIDATE
  ? path.join(process.env.CODEX_LAUNCH_CANDIDATE,'dashboard',relative)
  : path.join(dashboard,relative);
const routeFile='src/app/api/codex/runs/route.ts';
const outfile=path.join(root,'route.cjs');
const stubs={
 'next/server':'export const NextResponse=Response;',
 '@/lib/server-auth.ts':'export const requireUserId=async()=>1; export class RouteError extends Error {}',
 '@/lib/chatmock-server.ts':'export const resolveChatmockBaseUrl=()=>({baseURL:"http://127.0.0.1:9/v1"});',
 '@/lib/opencode/repository.ts':'export const resolveConnectedRepository=()=>({name:"fixture",gardenSlug:"fixture",path:"fixture"});',
 '@/lib/code-index/garden.ts':'export const graftEnabledForGarden=()=>false; export const prepareGraftIndex=async()=>{};',
 '@/lib/hermes/commands.ts':'export const resolveCommandMessage=async(_user,text)=>({text,invocations:[]});',
 '@/lib/conversations/title-service.ts':'export const generateAndApplyConversationTitle=async()=>{};',
 '@/lib/agent-edits/runtime-client.ts':'export const agentEditsFromRunEvents=()=>undefined;',
 '@/lib/codex/run-manager.ts':`export const startRun=async input=>({runId:'job_'+input.requestId});
   export const abortRun=async()=>{throw Error('Unexpected abort');};
   export const setRunTerminalHandler=()=>{};export const getEventsSince=async()=>[];`,
};
await build({entryPoints:[sourceFile(routeFile)],outfile,bundle:true,platform:'node',format:'cjs',logLevel:'silent',plugins:[{
 name:'runtime-boundaries',setup(builder){
  builder.onResolve({filter:/^next\/server$|^@\/lib\//},({path:specifier})=>stubs[specifier]
   ? {path:specifier,namespace:'boundary'}
   : {path:path.join(dashboard,'src',specifier.replace(/^@\//,'')),external:true});
  builder.onLoad({filter:/.*/,namespace:'boundary'},({path:specifier})=>({contents:stubs[specifier],loader:'js'}));
 }
}]});
const POST=createRequire(import.meta.url)(outfile).POST;

function launchCallback(scope){
 const file='src/app/components/hermes/use-codex-agent.ts';
 const source=ts.createSourceFile(file,fs.readFileSync(sourceFile(file),'utf8'),ts.ScriptTarget.Latest,true);
 let expression;
 function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='launch')expression=node.initializer.arguments[0].getText(source);ts.forEachChild(node,visit);}
 visit(source);assert.ok(expression);
 const js=ts.transpileModule(`const launch=${expression};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 return new Function(...Object.keys(scope),`${js}\nreturn launch;`)(...Object.values(scope));
}
for(const mode of ['direct','hidden-worker','legacy-parent']){
 test(`Codex ${mode}: server launch retains ownership before client replay and after reload`,async()=>{
  const chat=store.createConversation({userId:1,title:'Owned test',surface:'dashboard_terminal'});
  const id=`codex-${mode}`,reason='Verify a command';
  if(mode!=='direct'){
   store.reserveConversationTurn({conversation:chat,clientMessageId:mode==='legacy-parent'?id:'parent-turn',surface:chat.surface,content:'Check with Codex'});
   // Hidden workers must be persistable even before their parent completes.
   if(mode==='legacy-parent')store.completeAssistantMessage({conversationId:chat.id,clientMessageId:id,content:'Checking with Codex.'});
  }
  const flags={attachToExistingTurn:mode==='legacy-parent',delegatedAgentRun:mode==='hidden-worker',delegatedAgentReason:mode==='direct'?undefined:reason};
  let requestBody,replays=0;const statuses=[];
  const session={previewExternalAgentTurn:()=>id,externalAgentTurnPersistence:()=>flags,ensureConversation:async()=>chat.public_id,
   appendExternalAgentTurn:async input=>{
    assert.notEqual(input.outcome,'failed',input.assistantContent);
    const before=store.listConversationMessages(chat.id).find(m=>m.role==='assistant'&&m.client_message_id===id);
    assert.ok(before,'Run route persists before responding');
    const metadata=store.presentConversationMessage(before).metadata;
    assert.equal(metadata.delegatedAgentRun===true,mode!=='direct');
    if(mode!=='direct')assert.equal(metadata.delegatedAgentReason,reason);
    if(flags.attachToExistingTurn)turns.attachExternalAgentRun({conversation:chat,...input,...flags});
    else turns.recordExternalAgentTurn({conversation:chat,surface:chat.surface,...input,...flags,internalAgentContinuation:flags.delegatedAgentRun});
    replays++;
   }};
  const launch=launchCallback({session,launching:false,setLaunching:()=>{},onStatus:message=>statuses.push(message),
   model:'test',reasoningEffort:'medium',gardenSlug:null,crypto:{randomUUID:()=>id},
   codexUserMessage:identity.codexUserMessage,chatMessageAttachments:()=>[],explain:(_code,message)=>message,
   fetch:async(url,init)=>{requestBody=JSON.parse(init.body);return POST(new Request(`http://localhost${url}`,init));}});
  await launch('Print 30');assert.equal(replays,1,JSON.stringify(statuses));
  assert.equal(requestBody.delegatedAgentRun,mode==='hidden-worker');
  assert.equal(requestBody.attachToExistingTurn,mode==='legacy-parent');
  const finished=turns.finishExternalAgentTurn({conversationId:chat.id,clientMessageId:id,outcome:'completed',content:'30'});
  const fields=runs.externalAgentMessageFields(store.presentConversationMessage(finished).metadata);
  assert.equal(fields.externalAgentOutcome,'completed');
  assert.equal(fields.delegatedAgentRun===true,mode!=='direct');
  if(mode!=='direct')assert.equal(fields.externalAgentResult,'30');
 });
}
