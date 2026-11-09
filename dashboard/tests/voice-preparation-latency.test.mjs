import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { connectedAppUsageInstructions } from '../src/lib/hermes/connected-app-context.ts';

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
    composioConfigured: () => false,
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

test('spoken turns never contact the account broker, including when it hangs', async () => {
  let accountRequests = 0;
  let configured = true;
  const registry = declaration('lib/hermes/unified-tool-registry.ts','connectedAppRegistryForTurn', {
    listMcpConnections: () => [], isUnguardedBambuConnection: () => false,
    composioConfigured: () => configured,
    composioConnectedIntegrationSlugs: () => { accountRequests++; return new Promise(()=>{}); },
    COMPOSIO_RUNTIME_NAME: 'connected-apps',
    EMPTY_CONNECTED_APP_REGISTRY: {connectionNames:[], tools:{}, systemContext:'', toolCount:0},
  });
  const input={runtime:{listCapabilities:async()=>({mcp:{},tools:[]})},directory:'fixture',userId:7,mode:'knowledge',deferMcpConnections:true};
  let timer;
  try {
    const result=await Promise.race([registry(input),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Account broker delayed speech')),200);})]);
    assert.equal(accountRequests,0);
    assert.deepEqual(result.connectionNames,['connected-apps']);
    assert.equal(result.tools.mcp_call,true);
    assert.match(result.systemContext,/connection="connected-apps", tool="__breadboard_list_tools"/);
    assert.match(result.systemContext,/does not imply that any particular account is connected/);
    assert.ok(result.systemContext.length<1500);
    configured=false;
    assert.deepEqual((await registry(input)).connectionNames,[]);
    assert.equal(accountRequests,0);
  } finally {clearTimeout(timer);}
});

test('typed turns retain eagerly discovered actions and app-specific usage instructions', async () => {
  const requested=[];
  const registry=declaration('lib/hermes/unified-tool-registry.ts','connectedAppRegistryForTurn', {
    listMcpConnections:()=>[],isUnguardedBambuConnection:()=>false,
    composioConnectedIntegrationSlugs:async userId=>{requested.push(userId);return ['gmail','google-calendar'];},
    nangoActionSummariesForConnections:()=>[{name:'gmail_send_message',risk:'write',fixedConnectionSlug:'gmail',description:'Send mail',argumentDescription:'to, body'}],
    connectedAppUsageInstructions,COMPOSIO_RUNTIME_NAME:'connected-apps',
  });
  const result=await registry({runtime:{listCapabilities:async()=>({mcp:{},tools:[]})},directory:'fixture',userId:7,mode:'knowledge'});
  assert.deepEqual(requested,[7]);
  assert.match(result.systemContext,/gmail_send_message \[write; gmail\]/);
  assert.match(result.systemContext,/google_calendar_preview_breadboard_export/);
  assert.match(result.systemContext,/never silently correct a recipient address/);
});

test('lazy connected-app discovery validates scope and does not weaken action approval', async () => {
  const state={authorized:true,userId:7,conversationId:10,run:true,selected:true,decision:true};
  const discovered=[],executed=[];
  const schema={type:'object',properties:{query:{type:'string'}}};
  const actions=[{name:'gmail_list_messages',risk:'read',readOnly:true,inputSchema:schema},{name:'gmail_send_message',title:'Send mail',risk:'write',readOnly:false,inputSchema:schema}];
  class ApiError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
  const POST=declaration('app/api/hermes/tools/mcp/route.ts','POST', {
    requireEnabled:()=>{},capabilityForInternalToolRequest:()=>'',
    verifyCapabilityToken:()=>({ok:true,token:{breadboardSessionId:'1',hermesSessionId:'h',userId:state.userId,conversationId:state.conversationId}}),
    tokenAllows:()=>state.authorized,getRuntimeSessionById:()=>({id:1,user_id:7,conversation_id:10}),
    runtimeExternalSessionId:()=> 'h',getActiveRuntimeRun:()=>state.run?{id:'run'}:null,
    getActiveCapabilityDecision:()=>state.decision?{mode:'knowledge',selectedConnections:state.selected?['connected-apps']:[]}:null,
    readJsonBody:request=>request.json(),text:value=>value,objectArgs:value=>value,
    GOAL_MODE_CONNECTION:'goal',COMPOSIO_RUNTIME_NAME:'connected-apps',
    listComposioConnections:async(userId,signal)=>{discovered.push({userId,signal});return [{slug:'gmail'},{slug:'gmail'}];},
    nangoActionSummariesForConnections:slugs=>{assert.deepEqual(slugs,['gmail']);return actions;},
    connectedAppUsageInstructions,nangoActionFor:name=>actions.find(action=>action.name===name),
    executeComposioAction:async input=>{executed.push(input);return {content:[]};},
    recordAuditEvent:()=>{},ApiError,NextResponse:Response,
    apiErrorResponse:error=>Response.json({error:error.message},{status:error.status??500}),
  });
  const request=(tool,extra={})=>new Request('http://local/api/hermes/tools/mcp',{method:'POST',body:JSON.stringify({connection:'connected-apps',tool,args:{},...extra})});
  for(const [field,value,status] of [['authorized',false,403],['userId',8,403],['conversationId',11,403],['run',false,409],['decision',false,403],['selected',false,403]]) {
    const previous=state[field];state[field]=value;
    assert.equal((await POST(request('__breadboard_list_tools'))).status,status,field);
    state[field]=previous;
  }
  assert.equal(discovered.length,0,'invalid scope cannot discover account data');
  const discoveryRequest=request('__breadboard_list_tools');
  const response=await POST(discoveryRequest);
  assert.equal(response.status,200,await response.clone().text());
  const data=(await response.json()).data;
  assert.deepEqual(data.connections,['gmail']);
  assert.deepEqual(data.tools,actions);
  assert.equal(data.writeApprovalRequired,true);
  assert.match(data.instructions.join('\n'),/gmail_send_message/);
  assert.equal(discovered[0].userId,7);
  assert.equal(discovered[0].signal,discoveryRequest.signal);
  assert.equal(executed.length,0,'discovery must not execute actions');
  assert.equal((await POST(request('gmail_send_message'))).status,428);
  assert.equal(executed.length,0,'discovering a write action is not approval');
  assert.equal((await POST(request('gmail_send_message',{permissionGranted:true}))).status,200);
  assert.equal(executed.length,1);
  assert.equal(executed[0].userId,7);
  assert.equal((await POST(request('gmail_list_messages'))).status,200);
  assert.equal((await POST(request('unknown_action'))).status,403);
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
