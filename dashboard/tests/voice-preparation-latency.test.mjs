import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Run production functions with deterministic I/O. An optional server never
// resolves: the test fails if it becomes a dependency of a spoken turn.
function declaration(file, name, scope) {
  const text = fs.readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  let node;
  function visit(n) { if(ts.isFunctionDeclaration(n) && n.name?.text === name) node=n; else ts.forEachChild(n,visit); }
  visit(ast);
  assert.ok(node, name);
  const code = ts.transpileModule(node.getText(ast), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  return new Function('exports', ...Object.keys(scope), `${code}\nreturn ${name};`)({}, ...Object.values(scope));
}

test('a cold optional MCP server cannot delay voice and remains discoverable on demand', async () => {
  let attempts = 0;
  const connections = [{slug:'offline-server'}, {slug:'warm-server'}, {slug:'spotify'}, {slug:'unsafe-printer'}];
  const registry = declaration('lib/hermes/unified-tool-registry.ts','connectedAppRegistryForTurn', {
    listMcpConnections: () => connections,
    isUnguardedBambuConnection: c => c.slug === 'unsafe-printer',
    runtimeMcpConfig: c => c,
    connectionToolAllowed: name => !name.includes('delete'),
    composioConnectedIntegrationSlugs: async () => [],
    nangoActionSummariesForConnections: () => [],
    COMPOSIO_RUNTIME_NAME: 'connected-apps',
    EMPTY_CONNECTED_APP_REGISTRY: {connectionNames:[], tools:{}, systemContext:'', toolCount:0},
  });
  const runtime = {
    addMcpConnection: () => { attempts++; return new Promise(()=>{}); },
    listCapabilities: async () => ({mcp:{'warm-server':{status:'connected'}},tools:['warm-server_read_item','warm-server_delete_item']}),
  };
  const result = await Promise.race([
    registry({runtime, directory:'fixture', userId:7, mode:'knowledge', deferMcpConnections:true}),
    new Promise((_,reject) => {const timer=setTimeout(()=>reject(Error('Voice blocked on optional setup')),200);timer.unref();}),
  ]);
  assert.equal(attempts,0);
  assert.deepEqual(result.connectionNames.sort(),['offline-server','warm-server']);
  assert.equal(result.tools.mcp_call,true);
  assert.equal(result.tools['warm-server_read_item'],true);
  assert.equal(result.tools['warm-server_delete_item'],false);
  assert.match(result.systemContext,/connection="offline-server", tool="__breadboard_list_tools"/);
  assert.doesNotMatch(result.systemContext,/unsafe-printer|spotify/);
  assert.match(result.systemContext,/warm-server.*read_item/);
});

test('on-demand MCP discovery keeps same-user selection and action policy checks', async () => {
  let selected = true;
  let connects = 0;
  let calls = 0;
  const tools = [
    {name:'read_item',inputSchema:{type:'object',properties:{id:{type:'string'}}}},
    {name:'write_file',inputSchema:{type:'object'}},
    {name:'remove_everything',annotations:{destructiveHint:true},inputSchema:{type:'object'}},
  ];
  class ApiError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
  const POST = declaration('app/api/hermes/tools/mcp/route.ts','POST', {
    requireEnabled:()=>{},capabilityForInternalToolRequest:()=>'',
    verifyCapabilityToken:()=>({ok:true,token:{breadboardSessionId:'1',hermesSessionId:'h',userId:7,conversationId:10}}),
    tokenAllows:()=>true,
    getRuntimeSessionById:()=>({id:1,user_id:7,conversation_id:10}),
    runtimeExternalSessionId:()=> 'h',
    getActiveRuntimeRun:()=>({id:'run'}),
    getActiveCapabilityDecision:()=>({mode:'knowledge',selectedConnections:selected?['fixture']:[]}),
    readJsonBody:request=>request.json(),text:value=>value,objectArgs:value=>value,
    GOAL_MODE_CONNECTION:'goal',COMPOSIO_RUNTIME_NAME:'connected-apps',isCodeIndexConnectionSlug:()=>false,
    listMcpConnections:()=>[{id:1,slug:'fixture'}],getMcpConnection:()=>({id:1}),
    assertGuardedPrinterMcp:()=>{},runtimeMcpConfig:()=>({}),
    addProxyMcpConnection:async()=>{connects++;return {fixture:{status:'connected'}};},
    proxyMcpTools:()=>tools,connectionToolAllowed:name=>name!=='write_file',
    callProxyMcpTool:async()=>{calls++;return {content:[{type:'text',text:'verified'}]};},
    recordAuditEvent:()=>{},ApiError,NextResponse:Response,
    apiErrorResponse:error=>Response.json({error:error.message},{status:error.status??500}),
  });
  const request=tool=>new Request('http://local/api/hermes/tools/mcp',{method:'POST',body:JSON.stringify({connection:'fixture',tool,args:{}})});
  let response=await POST(request('__breadboard_list_tools'));
  assert.equal(response.status,200,await response.clone().text());
  assert.deepEqual((await response.json()).data.tools,[tools[0]]);
  assert.equal(calls,0,'discovery must not invoke a remote action');
  response=await POST(request('read_item'));
  assert.equal(response.status,200,await response.clone().text());
  assert.equal(calls,1);
  response=await POST(request('write_file'));
  assert.equal(response.status,403);
  selected=false;
  const before=connects;
  response=await POST(request('__breadboard_list_tools'));
  assert.equal(response.status,403);
  assert.equal(connects,before,'unselected connections cannot even be started');
});

test('voice runtime creation skips optional registry initialization and typed sessions retain it', async () => {
  let registryLoads=0;
  const create = declaration('lib/hermes/session-service.ts','createConversationRuntime', {
    getHermesUserSettings:()=>({fallbackModel:'fixture',reasoningEffort:'high'}),
    createWithConfiguredRuntimeFallback:async()=>({runtime:{kind:'hermes'},created:{externalSessionId:'h',directory:'fixture'}}),
    conversationWorkspaceIdentity:()=>({}),
    registerConversationRuntime:()=>({created:true,row:{id:1}}),
    loadUnifiedToolRegistryForRuntime:async()=>{registryLoads++;},recordAuditEvent:()=>{},
  });
  await create({id:1,origin_label:'Voice'},'dashboard_terminal',null,null,[]);
  assert.equal(registryLoads,0);
  await create({id:1,origin_label:'Chat'},'dashboard_terminal',null,null,[],undefined,true);
  assert.equal(registryLoads,0,'voice in an existing typed conversation also defers setup');
  await create({id:1,origin_label:'Chat'},'dashboard_terminal',null,null,[]);
  assert.equal(registryLoads,1);
});

test('startup warms the answer runtime independently of speech and honors the startup switch', async () => {
  for(const enabled of [true,false]) {
    const calls=[];
    const controller=new AbortController();
    const warm = declaration('app/components/voice-assistant-runtime.tsx','warmStartup', {
      preferences:{startVoiceOnStartup:enabled},speechSettings:{enabled:true},userId:'fixture',
      startupKey:'',nextWarmAt:0,warming:false,alive:true,lifecycle:controller,
      resetSpeechPreparation:()=>{},status:()=>{},
      fetch:(url,options)=>{calls.push({url,options});return url==='/api/hermes/health'
        ? new Promise(()=>{}) : Promise.resolve(Response.json({ready:true}));},
    });
    warm();
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(calls.map(call=>call.url),enabled?['/api/hermes/health','/api/speech/prepare']:[]);
    for(const call of calls){assert.equal(call.options.method,'POST');assert.equal(call.options.signal,controller.signal);}
  }
});
