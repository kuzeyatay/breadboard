import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const root=process.env.BREADBOARD_PROGRESS_TEST_ROOT??fileURLToPath(new URL('../',import.meta.url));
const ts=createRequire(path.join(root,'package.json'))('typescript');
const routeFile=process.env.BREADBOARD_PROGRESS_ROUTE_SOURCE??path.join(root,'src/app/api/music-producer/runs/[runId]/events/route.ts');
function declaration(file,name,scope){
  const text=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
  const node=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);
  assert.ok(node,name+' exists');
  const js=ts.transpileModule(node.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  return new Function('exports',...Object.keys(scope),js+'\nreturn '+name)({},...Object.values(scope));
}
const outer=declaration(path.join(root,'src/lib/runtime-v2/outer-agent-events-route.ts'),'outerAgentEventsResponse',{NextResponse:Response});
const view={events:[{sequenceNumber:1,type:'run.completed',payload:{artifactId:'art_owned'},at:'2026-11-07T00:00:00Z'}],terminal:true,status:'completed'};
function fixture({failureAt=0,error=new DOMException('Timed out','AbortError'),authError=null}={}){
  const calls=[];
  const get=declaration(routeFile,'GET',{
    requireUserId:async()=>{if(authError)throw authError;return 7;},
    readRun:async(...args)=>{calls.push(args);if(calls.length===failureAt)throw error;return view;},
    outerAgentEventsResponse:outer,
    musicRouteError:error=>Response.json({ok:false,error:error.message,code:'OTHER_ERROR'},{status:error.status??400}),
  });
  return {calls,get:accept=>get(new Request('http://localhost/api/music-producer/runs/music_owned/events',{headers:{accept:accept??'application/json'}}),{params:Promise.resolve({runId:'music_owned'})})};
}
for(const failureAt of [1,2])test('Runtime read timeout '+failureAt+' returns retryable JSON without losing the completed run',async()=>{
  const f=fixture({failureAt});const response=await f.get();
  assert.equal(response.status,503);assert.equal(response.headers.get('retry-after'),'1');
  assert.match(response.headers.get('content-type'),/application\/json/);
  assert.equal((await response.json()).code,'RUNTIME_UNAVAILABLE');
  assert.equal(f.calls.length,failureAt);assert.ok(f.calls.every(args=>args[0]===7&&args[1]==='music_owned'));
});
test('authentication failure retains its original status and never reads a run',async()=>{
  const f=fixture({authError:Object.assign(Error('Forbidden'),{status:403})});
  assert.equal((await f.get()).status,403);assert.equal(f.calls.length,0);
});
test('a completed run keeps its exact JSON event receipt',async()=>{
  const f=fixture();const response=await f.get();assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{ok:true,events:view.events});assert.equal(f.calls.length,2);
});
test('non-timeout failures retain the route-specific error contract',async()=>{
  const f=fixture({failureAt:2,error:Error('run_not_found')});const response=await f.get();
  assert.equal(response.status,400);assert.equal((await response.json()).error,'run_not_found');
});
test('an already opened event stream closes cleanly after a later failed read',async()=>{
  const f=fixture({failureAt:2});const response=await f.get('text/event-stream');
  assert.equal(response.status,200);assert.equal(await response.text(),'');assert.equal(f.calls.length,2);
});
