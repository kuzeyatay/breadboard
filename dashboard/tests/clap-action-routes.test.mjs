import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

async function route(relative) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const stubs = {
    'next/server': 'export const NextResponse=Response;',
    '@/lib/db': 'export default {};',
    '@/lib/server-auth': `export class RouteError extends Error{constructor(status,message){super(message);this.status=status;}}export async function requireUserId(){if(!globalThis.clapFixture.userId)throw Object.assign(new Error('Unauthorized'),{status:401});return globalThis.clapFixture.userId;}export function routeErrorResponse(error){return Response.json({error:error.message},{status:error.status||500});}`,
    '@/lib/hermes/route-core.ts': `export class ApiError extends Error{constructor(status,code,message){super(message);this.status=status;}}export const requireEnabled=()=>{};export const readJsonBody=request=>request.json();export function requireString(value,key,max){if(typeof value!=='string'||value.length>max)throw new ApiError(400,'invalid',key+' is invalid');return value;}`,
    '@/lib/profile/clap-action-store.ts': `const rows=control=>globalThis.clapFixture[control==='snap'?'snapSettings':'settings'];export const readClapAction=(_,userId,control)=>rows(control)?.get(userId);export const writeClapAction=(_,id,value,control)=>{rows(control).set(id,value);return value;};`,
    '@/lib/profile/clap-action-store': `export const readClapAction=(_,userId,control)=>globalThis.clapFixture[control==='snap'?'snapSettings':'settings']?.get(userId);`,
    '@/lib/speech/clap/store': `const rows=control=>globalThis.clapFixture[control==='snap'?'snapPreferences':'preferences'];export const readClapPreferences=(_,id,control)=>rows(control)?.get(id);export const writeClapPreferences=(_,id,p,control)=>{rows(control).set(id,p);return p;};`,
    '@/lib/workflows/store': `export const getWorkflow=(userId,id)=>userId===1&&id==='wf_own'?{id,name:'My workflow'}:null;`,
    '@/lib/chatmock-client.ts': `export const createChatmockClient=()=>({chat:{completions:{create:async(request,options)=>{globalThis.clapFixture.modelRequests.push(request);return {choices:[{message:{content:globalThis.clapFixture.modelOutput}}]};}}}});`,
    '@/lib/conversations/store.ts': `export function createConversation(input){globalThis.clapFixture.created.push(input);return {id:1,public_id:'conv_test_'+input.userId,user_id:input.userId,surface:input.surface};}`,
    '@/lib/conversations/turn-service.ts': `export async function startConversationTurn(input){globalThis.clapFixture.turns.push(input);if(globalThis.clapFixture.gate)await globalThis.clapFixture.gate;return globalThis.clapFixture.turnResult||{accepted:true};}`,
    '@/lib/hermes/session-service.ts': `export const resolveConversationRuntime=async input=>input;`,
    '@/lib/hermes/event-stream.ts': `export function startSessionEventPump(){globalThis.clapFixture.pumps++;}`,
    '@/lib/spotify/service.ts': `export const spotifyConnectionStatus=()=>({connected:globalThis.clapFixture.musicConnected===true});export const spotifyApiRequest=async input=>{globalThis.clapFixture.musicCalls.push(input);return{};};export const searchSpotifyTracks=async()=>[];export const spotifyCurrentPlaybackState=async()=>globalThis.clapFixture.musicConnected?{deviceId:'player'}:null;`,
    '@/lib/spotify/playback-engine.ts': `export const spotifyPlaybackEngineStatus=async()=>({ready:true,deviceId:'breadboard-player'});`,
  };
  const built = await esbuild.build({
    entryPoints: [`${root}/${relative}`], bundle: true, write: false, format: 'esm', platform: 'node',
    plugins: [{ name: 'isolated-services', setup(build) {
      build.onResolve({ filter: /.*/ }, args => args.path in stubs ? { path: args.path, namespace: 'stub' } : null);
      build.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}#${Math.random()}`);
}

test('interpretation uses the configured AI model, returns a validated instruction, and never executes it', async () => {
  globalThis.clapFixture = { userId: 1, modelRequests: [], modelOutput: '{"action":{"kind":"assistant","prompt":"Bring up my calendar"}}' };
  try {
    const { POST } = await route('src/app/api/profile/clap-action/interpret/route.ts');
    const request = () => new Request('http://localhost/api/profile/clap-action/interpret', { method: 'POST', body: JSON.stringify({ prompt: 'Bring up my calendar when I clap' }) });
    let response = await POST(request());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { action: { kind: 'assistant', prompt: 'Bring up my calendar' } });
    assert.equal(globalThis.clapFixture.modelRequests.length, 1);
    assert.equal(globalThis.clapFixture.modelRequests[0].messages[1].content, 'Bring up my calendar when I clap');
    assert.equal(globalThis.clapFixture.modelRequests[0].tools, undefined);
    globalThis.clapFixture.modelOutput = '{"action":{"kind":"page","page":"javascript:alert(1)"}}';
    response = await POST(request());
    assert.equal(response.status, 502);
    globalThis.clapFixture.modelOutput = '{"clarification":"Which calendar?"}';
    assert.deepEqual(await (await POST(request())).json(), { clarification: 'Which calendar?' });
    globalThis.clapFixture.userId = null;
    const count = globalThis.clapFixture.modelRequests.length;
    assert.equal((await POST(request())).status, 401);
    assert.equal(globalThis.clapFixture.modelRequests.length, count);
  } finally { delete globalThis.clapFixture; }
});

test('both gesture prompts configure independent agent instructions and run with dynamic tools',async()=>{
  const {DEFAULT_CLAP_ACTION,DEFAULT_SNAP_ACTION}=await import('../src/lib/profile/clap-action.ts');
  globalThis.clapFixture={userId:1,settings:new Map([[1,DEFAULT_CLAP_ACTION]]),snapSettings:new Map([[1,DEFAULT_SNAP_ACTION]]),modelRequests:[],created:[],turns:[],pumps:0};
  const headers={host:'127.0.0.1:54321',origin:'http://127.0.0.1:54321','sec-fetch-site':'same-origin'};
  const request=(path,control,body,origin=headers.origin)=>new Request(`http://0.0.0.0:54321/api/profile/clap-action${path}?control=${control}`,{method:path===''?'PUT':'POST',headers:{...headers,origin},body:JSON.stringify(body)});
  try{
    const interpreter=await route('src/app/api/profile/clap-action/interpret/route.ts');
    const settings=await route('src/app/api/profile/clap-action/route.ts');
    const executor=await route('src/app/api/profile/clap-action/execute/route.ts');
    for(const control of ['clap','snap']){
      const prompt=control==='clap'?'Open my calendar in Breadboard and summarize tomorrow':'Open Notepad and write the current date';
      const action={kind:'assistant',prompt};globalThis.clapFixture.modelOutput=JSON.stringify({action});
      const before=globalThis.clapFixture.modelRequests.length;
      assert.equal((await interpreter.POST(request('/interpret',control,{prompt},'https://untrusted.test'))).status,403);
      assert.equal(globalThis.clapFixture.modelRequests.length,before);
      assert.deepEqual(await(await interpreter.POST(request('/interpret',control,{prompt}))).json(),{action});
      assert.equal(globalThis.clapFixture.modelRequests.at(-1).messages[1].content,prompt);
      assert.equal(globalThis.clapFixture.created.length,control==='clap'?0:1,'interpretation never launches an agent');
      assert.equal((await settings.PUT(request('',control,{prompt,action},'https://untrusted.test'))).status,403);
      assert.equal((await settings.PUT(request('',control,{prompt,action}))).status,200);
      const eventId=`${control}-agent-event`;
      for(let i=0;i<2;i++)assert.equal((await executor.POST(request('/execute',control,{expectedAction:action,eventId}))).status,200);
      const turn=globalThis.clapFixture.turns.at(-1);
      assert.equal(turn.text,prompt);assert.equal(turn.superAgent,true);assert.equal(turn.yoloMode,false);
      assert.equal(globalThis.clapFixture.created.at(-1).originLabel,control==='clap'?'Clap shortcut':'Finger-snap shortcut');
    }
    assert.equal(globalThis.clapFixture.turns.length,2,'each gesture event dispatches once');
    assert.equal(globalThis.clapFixture.settings.get(1).action.prompt,'Open my calendar in Breadboard and summarize tomorrow');
    assert.equal(globalThis.clapFixture.snapSettings.get(1).action.prompt,'Open Notepad and write the current date');
  }finally{delete globalThis.clapFixture;}
});

test('snap routes preserve the clap binding, execute the saved Spotify track once and require authentication',async()=>{
  const {DEFAULT_SNAP_ACTION,DEFAULT_CLAP_ACTION}=await import('../src/lib/profile/clap-action.ts');
  const {DEFAULT_CLAP_PREFERENCES,DEFAULT_SNAP_PREFERENCES}=await import('../src/lib/speech/clap/preferences.ts');
  globalThis.clapFixture={userId:1,settings:new Map([[1,DEFAULT_CLAP_ACTION]]),snapSettings:new Map([[1,DEFAULT_SNAP_ACTION]]),
    preferences:new Map([[1,DEFAULT_CLAP_PREFERENCES]]),snapPreferences:new Map([[1,DEFAULT_SNAP_PREFERENCES]]),musicConnected:true,musicCalls:[]};
  const request=(path,body)=>new Request(`http://localhost${path}`,{method:'POST',body:JSON.stringify(body)});
  try{
    const preferences=await route('src/app/api/speech/clap-controls/route.ts');
    assert.equal((await(await preferences.GET()).json()).snapAction.action.trackUri,DEFAULT_SNAP_ACTION.action.trackUri);
    assert.equal((await preferences.PUT(request('/api/speech/clap-controls?control=snap',{...DEFAULT_SNAP_PREFERENCES,enabled:true}))).status,200);
    assert.equal(globalThis.clapFixture.preferences.get(1).enabled,false);assert.equal(globalThis.clapFixture.snapPreferences.get(1).enabled,true);
    assert.equal((await preferences.PUT(request('/api/speech/clap-controls?control=anything',DEFAULT_SNAP_PREFERENCES))).status,400);
    const actions=await route('src/app/api/profile/clap-action/route.ts');
    const pageAction={prompt:'Calendar',action:{kind:'page',page:'calendar'}};
    assert.equal((await actions.PUT(request('/api/profile/clap-action?control=snap',pageAction))).status,200);
    assert.equal(globalThis.clapFixture.settings.get(1).action.kind,'dictation');
    await actions.PUT(request('/api/profile/clap-action?control=snap',DEFAULT_SNAP_ACTION));
    const execution=await route('src/app/api/profile/clap-action/execute/route.ts');
    assert.equal((await execution.POST(request('/api/profile/clap-action/execute?control=snap',{eventId:'snap-one',expectedAction:DEFAULT_CLAP_ACTION.action}))).status,409);
    for(let i=0;i<2;i++)assert.equal((await execution.POST(request('/api/profile/clap-action/execute?control=snap',{eventId:'snap-one',expectedAction:DEFAULT_SNAP_ACTION.action}))).status,200);
    assert.equal(globalThis.clapFixture.musicCalls[0].query.device_id,'breadboard-player');assert.equal(globalThis.clapFixture.musicCalls.length,1);assert.deepEqual(globalThis.clapFixture.musicCalls[0].body,{uris:[DEFAULT_SNAP_ACTION.action.trackUri]});
    globalThis.clapFixture.userId=null;assert.equal((await execution.POST(request('/api/profile/clap-action/execute?control=snap',{eventId:'snap-two',expectedAction:DEFAULT_SNAP_ACTION.action}))).status,401);
  }finally{delete globalThis.clapFixture;}
});

test('preference routes authenticate, reject invalid or cross-origin changes, and enforce workflow ownership', async () => {
  const { DEFAULT_CLAP_PREFERENCES } = await import('../src/lib/speech/clap/preferences.ts');
  globalThis.clapFixture = { userId: 1, settings: new Map([[1,{prompt:'Dictate',action:{kind:'dictation'}}]]), preferences: new Map([[1,DEFAULT_CLAP_PREFERENCES]]) };
  const request = (body, headers={}) => new Request('http://localhost/api/speech/clap-controls',{method:'PUT',body:JSON.stringify(body),headers});
  try {
    const preferences=await route('src/app/api/speech/clap-controls/route.ts');
    assert.equal((await (await preferences.GET()).json()).preferences.enabled,false);
    assert.equal((await preferences.PUT(request({...DEFAULT_CLAP_PREFERENCES,sensitivity:2}))).status,400);
    assert.equal((await preferences.PUT(request(DEFAULT_CLAP_PREFERENCES,{origin:'https://untrusted.test'}))).status,403);
    assert.equal((await preferences.PUT(request({...DEFAULT_CLAP_PREFERENCES,enabled:true}))).status,200);
    assert.equal(globalThis.clapFixture.preferences.get(1).enabled,true);
    const actions=await route('src/app/api/profile/clap-action/route.ts');
    const workflow=id=>request({prompt:'My workflow',action:{kind:'workflow',workflowId:id,name:'Untrusted name'}});
    assert.equal((await actions.PUT(workflow('wf_other'))).status,404);
    assert.equal(globalThis.clapFixture.settings.get(1).action.kind,'dictation');
    assert.equal((await (await actions.PUT(workflow('wf_own'))).json()).settings.action.name,'My workflow');
    globalThis.clapFixture.userId=null;
    assert.equal((await preferences.GET()).status,401);
    assert.equal((await preferences.PUT(request(DEFAULT_CLAP_PREFERENCES))).status,401);
    assert.equal((await actions.PUT(workflow('wf_own'))).status,401);
  } finally { delete globalThis.clapFixture; }
});

test('gesture settings and actions accept the desktop request authority and reject unrelated origins', async () => {
  const { DEFAULT_SNAP_ACTION } = await import('../src/lib/profile/clap-action.ts');
  const { DEFAULT_CLAP_PREFERENCES, DEFAULT_SNAP_PREFERENCES } = await import('../src/lib/speech/clap/preferences.ts');
  globalThis.clapFixture = { userId: 1, settings: new Map([[1,DEFAULT_SNAP_ACTION]]), snapSettings: new Map([[1,DEFAULT_SNAP_ACTION]]),
    preferences: new Map([[1,DEFAULT_CLAP_PREFERENCES]]), snapPreferences: new Map([[1,DEFAULT_SNAP_PREFERENCES]]), musicConnected: true, musicCalls: [] };
  try {
    const preferences = await route('src/app/api/speech/clap-controls/route.ts');
    const execution = await route('src/app/api/profile/clap-action/execute/route.ts');
    const headers = { host: '127.0.0.1:64593', origin: 'http://127.0.0.1:64593', 'sec-fetch-site': 'same-origin' };
    const accepted = [
      headers,
      { ...headers, host: 'localhost:64593', origin: 'http://localhost:64593' },
      { ...headers, host: '[::1]:64593', origin: 'http://[::1]:64593' },
      { ...headers, 'x-forwarded-host': 'breadboard.example, proxy.internal', 'x-forwarded-proto': 'https, http', origin: 'https://breadboard.example' },
    ];
    const rejected = [
      { ...headers, origin: 'https://untrusted.test' },
      { ...headers, origin: 'http://127.0.0.1:64594' },
      { ...headers, origin: 'https://127.0.0.1:64593' },
      { ...headers, origin: 'http://0.0.0.0:64593' },
      { ...headers, origin: 'null' },
      { ...headers, 'sec-fetch-site': 'cross-site' },
      { ...headers, 'x-forwarded-host': 'invalid host' },
      { ...headers, 'x-forwarded-host': 'user@127.0.0.1:64593' },
      { ...headers, 'x-forwarded-host': '127.0.0.1:64593/path' },
    ];
    for (const control of ['clap', 'snap']) {
      const request = (path, method, body, requestHeaders) => new Request(`http://0.0.0.0:64593${path}?control=${control}`, { method, headers: requestHeaders, body: JSON.stringify(body) });
      const rows = globalThis.clapFixture[control === 'snap' ? 'snapPreferences' : 'preferences'];
      for (const requestHeaders of accepted) {
        const updated = { ...rows.get(1), enabled: true, sensitivity: .7 };
        assert.equal((await preferences.PUT(request('/api/speech/clap-controls', 'PUT', updated, requestHeaders))).status, 200);
        assert.deepEqual(rows.get(1), updated);
        assert.equal((await execution.POST(request('/api/profile/clap-action/execute', 'POST', { eventId: crypto.randomUUID(), expectedAction: DEFAULT_SNAP_ACTION.action }, requestHeaders))).status, 200);
      }
      const saved = rows.get(1), calls = globalThis.clapFixture.musicCalls.length;
      for (const requestHeaders of rejected) {
        assert.equal((await preferences.PUT(request('/api/speech/clap-controls', 'PUT', { ...saved, enabled: false }, requestHeaders))).status, 403);
        assert.equal((await execution.POST(request('/api/profile/clap-action/execute', 'POST', { eventId: crypto.randomUUID(), expectedAction: DEFAULT_SNAP_ACTION.action }, requestHeaders))).status, 403);
        assert.deepEqual(rows.get(1), saved);
        assert.equal(globalThis.clapFixture.musicCalls.length, calls);
      }
    }
  } finally { delete globalThis.clapFixture; }
});

test('execution reads the account’s saved request and dispatches one normal assistant turn for concurrent claps', async () => {
  let release;
  globalThis.clapFixture = {
    userId: 1, created: [], turns: [], pumps: 0,
    settings: new Map([[1, { prompt: 'My shortcut', action: { kind: 'assistant', prompt: 'Summarize my calendar for tomorrow' } }]]),
    gate: new Promise(resolve => { release = resolve; }),
  };
  try {
    const { POST } = await route('src/app/api/profile/clap-action/execute/route.ts');
    const request = (extra = {}) => new Request('http://localhost/api/profile/clap-action/execute', {method:'POST',body:JSON.stringify({eventId:crypto.randomUUID(),expectedAction:globalThis.clapFixture.settings.get(1).action,...extra})});
    assert.equal((await POST(request({expectedAction:{kind:'assistant',prompt:'An unsaved task'}}))).status,409);
    assert.equal(globalThis.clapFixture.created.length,0);
    const first = POST(request({eventId:'same-event'})); const second = POST(request({eventId:'same-event'}));
    // Let both requests reach the shared in-flight promise.
    await new Promise(resolve => setTimeout(resolve, 20));
    release();
    const results = await Promise.all([first, second]);
    for (const response of results) {
      assert.equal(response.status, 200);
      assert.equal((await response.json()).href, '/dashboard?terminalChat=conv_test_1');
    }
    assert.equal(globalThis.clapFixture.created.length, 1);
    assert.equal(globalThis.clapFixture.created[0].userId, 1);
    assert.equal(globalThis.clapFixture.pumps, 1);
    assert.equal(globalThis.clapFixture.turns.length, 1);
    assert.equal(globalThis.clapFixture.turns[0].text, 'Summarize my calendar for tomorrow');
    assert.equal(globalThis.clapFixture.turns[0].yoloMode, false);
    assert.equal(globalThis.clapFixture.turns[0].superAgent, true,'the AI can select from the full reviewed tool and skill inventory');
    assert.equal((await POST(request({eventId:'same-event'}))).status,200);
    assert.equal(globalThis.clapFixture.created.length,1,'repeated event cannot replay the action');
    globalThis.clapFixture.turnResult = { accepted: false, blocked: true };
    const blocked = await (await POST(request())).json();
    assert.match(blocked.message, /permission/);
    assert.equal(blocked.href, '/dashboard?terminalChat=conv_test_1');
    globalThis.clapFixture.settings.set(1, { action: { kind: 'music', operation: 'random' } });
    const missingMusic = await POST(request());
    assert.match((await missingMusic.json()).error, /Connect Spotify/);
    globalThis.clapFixture.userId = null;
    assert.equal((await POST(request())).status, 401);
  } finally { release(); delete globalThis.clapFixture; }
});
