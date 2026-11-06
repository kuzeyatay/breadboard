import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const mocks={
  'openai':`export default class {constructor(options){globalThis.replyRouteTest.client=options;this.responses={create:async(body,options)=>{globalThis.replyRouteTest.calls.push({body,options});return (async function*(){yield {type:'response.completed',response:{output:[{type:'message',content:[{type:'output_text',text:'A useful draft.'}]}]}};})();}};}}`,
  '@/lib/db':'export default {};',
  '@/lib/server-auth':`export class RouteError extends Error{constructor(status,message){super(message);this.status=status;}}export async function requireUserId(){if(!globalThis.replyRouteTest.signedIn)throw new RouteError(401,'Sign in');return 7;}export const routeErrorResponse=e=>Response.json({error:e.message},{status:e.status||500});`,
  '@/lib/hermes/route-core':`export async function readJsonBody(r,max){const text=await r.text();if(text.length>max)throw Object.assign(Error('Too large'),{status:413});return JSON.parse(text);}`,
  '@/lib/speech/assistant-store':`export const readVoiceAssistantPreferences=()=>({voiceModel:globalThis.replyRouteTest.model});`,
  '@/lib/hermes/runtime-store':`export const getHermesUserSettings=()=>({fallbackModel:'gpt-5.4'});`,
  '@/lib/chatmock-server':`export const resolveChatmockBaseUrl=()=>({baseURL:'http://127.0.0.1:8765/v1'});`,
};
const bundle=await build({entryPoints:['src/app/api/speech/dictation-reply/route.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'route-boundaries',setup(b){
  b.onResolve({filter:/.*/},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'mock'}:undefined);
  b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path]}));
}}]});
const {POST}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const screen={dataUrl:'data:image/jpeg;base64,/9j/AA==',width:1600,height:900,caret:{x:200,y:500}};
const request=(body={text:'Write a reply',screen},origin='http://localhost')=>new Request('http://localhost/api/speech/dictation-reply',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
test('screen-aware reply uses the saved voice model and authenticated image request, with no action tools',async()=>{
  globalThis.replyRouteTest={signedIn:true,model:'gpt-5.4',calls:[]};
  const response=await POST(request());assert.equal(response.status,200);
  const text=await response.text();assert.match(text,/A useful draft/);
  const {body,options}=globalThis.replyRouteTest.calls[0];assert.equal(body.model,'gpt-5.4');assert.equal(body.reasoning.effort,'low');
  assert.equal(body.tools,undefined);assert.equal(body.store,false);assert.equal(body.stream,true);
  assert.equal(body.input[0].content[1].image_url,screen.dataUrl);assert.match(body.instructions,/untrusted context/);assert.match(body.instructions,/stays as a draft/);
  assert.equal(options.signal.aborted,true,'finished response releases provider work');
});
test('authentication, origin and snapshot validation run before any model request',async()=>{
  globalThis.replyRouteTest={signedIn:false,model:'gpt-5.4',calls:[]};assert.equal((await POST(request())).status,401);
  globalThis.replyRouteTest.signedIn=true;assert.equal((await POST(request(undefined,'https://foreign.test'))).status,403);
  assert.equal((await POST(request({text:'Reply',screen:{...screen,dataUrl:'https://foreign.test/a.jpg'}}))).status,400);
  assert.equal(globalThis.replyRouteTest.calls.length,0);
});
