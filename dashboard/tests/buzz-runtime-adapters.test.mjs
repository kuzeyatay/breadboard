import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import esbuild from 'esbuild';

test('every room runtime preserves native identity, authenticated request and user model', async()=>{
  const root=path.resolve(import.meta.dirname,'..');
  const scratch=fs.mkdtempSync(path.join(root,'node_modules/.cache/buzz-adapters-'));
  globalThis.__roomAdapterCalls=[];
  try {
    const outfile=path.join(scratch,'adapters.cjs');
    await esbuild.build({absWorkingDir:root,stdin:{resolveDir:root,contents:`export * from './src/lib/buzz/runtime-agents.ts'; export * from './src/lib/buzz/runtime-catalog.ts';`},outfile,format:'cjs',bundle:true,platform:'node',packages:'external',logLevel:'silent',plugins:[{name:'native-launch-boundary',setup(build){
      build.onResolve({filter:/^server-only$/},()=>({path:'empty',namespace:'qa'}));
      build.onResolve({filter:/selected-model\.ts$/},()=>({path:'model',namespace:'qa'}));
      build.onResolve({filter:/agent-settings\/store\.ts$/},()=>({path:'settings',namespace:'qa'}));
      build.onResolve({filter:/app\/api\/.*\/runs\/route\.ts$/},args=>({path:args.path,namespace:'native-route'}));
      build.onResolve({filter:/run-manager\.ts$/},()=>({path:'manager',namespace:'qa'}));
      build.onLoad({filter:/.*/,namespace:'qa'},args=>({loader:'ts',contents:{empty:'',model:'export const selectedModelForUser = user => `selected-model-${user}`;',settings:'export const agentSettingsFor = () => ({breadth:2,depth:1,output:"answer"});',manager:'export const getEventsSince = async () => [];'}[args.path]}));
      build.onLoad({filter:/.*/,namespace:'native-route'},args=>({loader:'ts',contents:`export async function POST(request) { const body=await request.json(); globalThis.__roomAdapterCalls.push({route:${JSON.stringify(args.path)},body,auth:request.headers.get('cookie')}); if(globalThis.__roomAdapterRefusal) return Response.json({message:'Agent setup required'}, {status:409}); return Response.json({run:{runId:'native-run',gardenSlug:'connected-repo',repository:'Connected repo'},request:{capability:'solve'}}); }`}));
    }}]});
    const runtime=createRequire(import.meta.url)(outfile);
    assert.equal(runtime.ROOM_RUNTIME_IDS.length,runtime.ROOM_RUNTIME_AGENTS.length,'every advertised runtime resolves through the shared Breadboard catalog');
    for(const agent of runtime.ROOM_RUNTIME_AGENTS){
      const run=await runtime.startRoomRuntime({agentId:agent.id,request:new Request('http://localhost/api/buzz/rooms/room/messages',{headers:{cookie:'session=caller'}}),userId:42,conversation:{public_id:'conv_caller'},clientMessageId:'stable-run-id',task:'Keep the exact user task'});
      assert.equal(run.runId,'native-run');assert.equal(run.kind,agent.id.replaceAll('-','_'));
      const call=globalThis.__roomAdapterCalls.at(-1);
      assert.equal(call.auth,'session=caller');assert.equal(call.body.model,'selected-model-42');
      assert.equal(call.body.conversationPublicId,'conv_caller');assert.equal(call.body.clientMessageId,'stable-run-id');
      assert.ok(Object.values(call.body).includes('Keep the exact user task'));
      assert.equal(runtime.roomRuntime(runtime.runtimeSlug(agent.id))?.id,agent.id);
    }
    const research=globalThis.__roomAdapterCalls.find(call=>call.route.includes('/deep-research/'));
    assert.equal(research.body.breadth,2);assert.equal(research.body.output,'answer');
    assert.equal(runtime.roomRuntime('runtime:not-an-agent'),null);
    globalThis.__roomAdapterRefusal=true;
    await assert.rejects(()=>runtime.startRoomRuntime({agentId:'deep-research',request:new Request('http://localhost'),userId:42,conversation:{public_id:'conv_caller'},clientMessageId:'failed-run',task:'Research'}),/Agent setup required/);
  } finally {delete globalThis.__roomAdapterRefusal;fs.rmSync(scratch,{recursive:true,force:true});}
});
