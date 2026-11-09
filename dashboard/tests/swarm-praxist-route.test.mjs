import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import {withSwarmInvocation,swarmRuntimeIdentity} from '../src/lib/swarm/invocation.ts';
import {SwarmStartRejected} from '../src/lib/swarm/scheduler.ts';
import {parsePraxistTaskPath} from '../src/lib/praxist/identity.ts';
import {resolvePraxistTaskProject} from '../src/lib/praxist/runtime.ts';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'swarm-praxist-'));
fs.writeFileSync(path.join(directory,'task.yaml'),'name: disposable contract check\n');
test.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
function load(relative,scope){
  const file=new URL(relative,import.meta.url);
  const tree=ts.createSourceFile(relative,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
  const code=ts.transpileModule(tree.statements.filter(node=>!ts.isImportDeclaration(node)).map(node=>node.getText(tree)).join('\n'),
    {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  return new Function('exports',...Object.keys(scope),`${code}\nreturn exports;`)({},...Object.values(scope));
}
class RouteError extends Error{}
class RuntimeJobControlError extends Error{constructor(code){super(code);this.code=code;}}
const starts=[];
const {POST}=load('../src/app/api/praxist/runs/route.ts',{
  NextResponse:Response,RouteError,requireUserId:async()=>1,parsePraxistTaskPath,resolvePraxistTaskProject,
  runtimeAuthorityErrorResponse:()=>null,resolveChatmockBaseUrl:()=>({baseURL:'http://provider.invalid/v1'}),
  startRun:async input=>{starts.push(input);return {runId:'job_praxist_qa'};},
});
const {runtimeSwarmAdapter}=load('../src/lib/swarm/runtime-adapter.ts',{
  db:{prepare:()=>({get:()=>({status:'running'})})},
  getConversationById:()=>({id:1,user_id:1,archived_at:null}),
  SWARM_RUNTIME_ROUTES:{praxist:{field:'task',load:async()=>({POST})}},
  OUTER_AGENT_RUNTIME_ADAPTERS:{praxist:{scopePrefix:'praxist',jobType:'praxist-run',workerKind:'praxist-worker',resourceClass:'core'}},
  withSwarmInvocation,swarmRuntimeIdentity,SwarmStartRejected,RuntimeJobControlError,
  getOuterAgentRuntimeRunByRequest:()=>null,
  lookupRuntimeJobByIdempotencyKey:async()=>{throw new RuntimeJobControlError('JOB_NOT_FOUND');},
});
test('Praxist preserves its validated project path when a team dependency has evidence',async()=>{
  const handle=await runtimeSwarmAdapter('praxist').start({
    run:{id:'swarm_qa',authority:{userId:1,conversationId:1,conversationPublicId:'conv_qa',model:'fixture',reasoningEffort:'medium'}},
    task:{key:'research',brief:directory,executor:{kind:'runtime',id:'praxist'},inputs:[]},
    attempt:{requestId:'swarm_qa:research:1',status:'starting'},
    dependencies:[{key:'prepare',summary:'Prepared the research task project',evidence:[{kind:'validation',title:'task.yaml exists',reference:'receipt:prepared',summary:'Verified local project files'}]}],
  });
  assert.deepEqual(handle,{kind:'runtime',id:'praxist',runId:'job_praxist_qa'});
  assert.equal(starts.length,1);assert.equal(starts[0].taskPath,directory);
});
test('the real Praxist route rejects prose and an unprepared directory',async()=>{
  for(const task of ['Please investigate the research question',path.join(directory,'missing')]){
    const before=starts.length;const response=await POST(new Request('http://localhost/api/praxist/runs',{method:'POST',body:JSON.stringify({task,model:'fixture'})}));
    assert.equal(response.status,400);assert.equal(starts.length,before);
  }
});
