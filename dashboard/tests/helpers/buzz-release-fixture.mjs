import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { AsyncLocalStorage } from 'node:async_hooks';
import esbuild from 'esbuild';

/** Real routes, stores and SQLite; only auth and paid/external runtimes are replaced. */
export async function createBuzzFixture() {
  const root = path.resolve(import.meta.dirname, '../..');
  const scratch = fs.mkdtempSync(path.join(root, 'node_modules/.cache/buzz-release-'));
  process.env.BREADBOARD_DATA_DIR = path.join(scratch, 'data');
  const context = new AsyncLocalStorage();
  globalThis.__buzzQA = { context, calls: [], nativeCalls: [], stopped: [], runs: new Map() };
  const dbImport = JSON.stringify(path.join(root, 'src/lib/db.ts').replaceAll('\\', '/'));
  const save = `
    import db from ${dbImport};
    export function save(conversationId, clientMessageId, role, content, status = 'complete', metadata = null) {
      const order = db.prepare('SELECT COALESCE(MAX(order_index), -1)+1 n FROM conversation_messages WHERE conversation_id = ?').get(conversationId).n;
      db.prepare("INSERT INTO conversation_messages(conversation_id,client_message_id,role,surface,content,status,order_index,metadata) VALUES (?,?,?,'dashboard_terminal',?,?,?,?) ON CONFLICT(conversation_id,client_message_id,role) DO UPDATE SET content=excluded.content,status=excluded.status,metadata=excluded.metadata").run(conversationId,clientMessageId,role,content,status,order,metadata ? JSON.stringify(metadata) : null);
    }
  `;
  const stubs = {
    auth: `export const authOptions = {}; export async function getServerSession() { const id = globalThis.__buzzQA.context.getStore(); return id ? { user: { id: String(id), name: ['','anna','ben','chloe'][id] } } : null; }`,
    serverAuth: `export class RouteError extends Error { constructor(status,message) { super(message); this.status=status; } } export async function requireUserId() { const id=globalThis.__buzzQA.context.getStore(); if(!id)throw new RouteError(401,'Sign in.'); return id; } export function routeErrorResponse(error) { return Response.json({message:error.message}, {status:error.status||500}); }`,
    conversations: `import db from ${dbImport}; import {randomUUID} from 'node:crypto'; export function createConversation(input) { const id = db.prepare('INSERT INTO conversations(public_id,user_id,title,surface,scope_kind) VALUES (?,?,?,?,?)').run('conv_'+randomUUID(),input.userId,input.title,input.surface,input.scopeKind).lastInsertRowid; return db.prepare('SELECT * FROM conversations WHERE id=?').get(id); }`,
    turns: `${save}
      export async function startConversationTurn(input) {
        globalThis.__buzzQA.calls.push(input);
        save(input.conversation.id,input.clientMessageId,'user',input.text);
        if(input.text.includes('permission-test') && !input.confirmedPermissionIds?.length) return {accepted:false,blocked:true,request:'Allow this response to read the requested file?',pendingPermissions:[{id:'read-test',message:'Read the requested file'}]};
        if(input.text.includes('failure-test') && globalThis.__buzzQA.failNext) {globalThis.__buzzQA.failNext=false; throw new Error('Test runtime unavailable.');}
        save(input.conversation.id,input.clientMessageId,'assistant','Agent answer for account '+input.conversation.user_id);
        return {accepted:true,run:{id:'run-'+input.clientMessageId}};
      }`,
    native: `export { runtimeOutput } from '${path.join(root, 'src/lib/buzz/runtime-output.ts').replaceAll('\\', '/')}';
      export async function startRoomRuntime(input) { globalThis.__buzzQA.nativeCalls.push(input); const run={kind:input.agentId.replaceAll('-','_'),runId:'native-'+input.clientMessageId,query:input.task,output:'report'}; globalThis.__buzzQA.runs.set(run.runId,input.userId); return run; }
      export async function roomRuntimeEvents(agentId,userId,runId) { if(globalThis.__buzzQA.runs.get(runId)!==userId)throw new Error('wrong_owner'); return [{type:'run.completed',sequenceNumber:1,payload:{summary:'Native agent answer for account '+userId}}]; }`,
    externalTurns: `${save}
      export function recordExternalAgentTurn(input) { save(input.conversation.id,input.clientMessageId,'user',input.userContent); save(input.conversation.id,input.clientMessageId,'assistant','', 'complete', {externalAgent:true,externalAgentRun:input.run,externalAgentOutcome:'running'}); }
      export function finishExternalAgentTurn(input) { save(input.conversationId,input.clientMessageId,'assistant',input.content,input.outcome==='completed'?'complete':input.outcome); }`,
    runtimeStore: `export const listRuntimeSessionsForConversation = () => [];`,
    cancel: `export const cancelExternalAgentRun = async () => true; export const cancelRuntimeSessionWork = async () => {}; export const cancelRunningExternalAgentRuns = async (user,id) => { globalThis.__buzzQA.stopped.push({user,id}); return []; };`,
    agency: `export const loadAgencyAgentsCatalog = () => ({agents:[],available:true});`,
    empty: '',
  };
  const matches = [
    [/^(server-only)$/, 'empty'], [/next-auth\/next$/, 'auth'], [/auth-options$/, 'auth'],
    [/server-auth(?:\.ts)?$/, 'serverAuth'], [/conversations\/store(?:\.ts)?$/, 'conversations'],
    [/conversations\/turn-service\.ts$/, 'turns'], [/runtime-agents\.ts$/, 'native'],
    [/conversations\/external-agent-turns\.ts$/, 'externalTurns'], [/hermes\/runtime-store\.ts$/, 'runtimeStore'],
    [/hermes\/session-cancel\.ts$/, 'cancel'], [/conversations\/external-agent-cancel\.ts$/, 'cancel'],
    [/hermes\/agency-agents\.ts$/, 'agency'],
  ];
  const routePaths = {
    rooms: 'buzz/rooms', room: 'buzz/rooms/[roomId]', members: 'buzz/rooms/[roomId]/members',
    member: 'buzz/rooms/[roomId]/members/[memberId]', messages: 'buzz/rooms/[roomId]/messages',
    message: 'buzz/rooms/[roomId]/messages/[messageId]', thread: 'buzz/rooms/[roomId]/threads/[messageId]',
    inbox: 'buzz/inbox', people: 'buzz/people', search: 'buzz/search', organizations: 'organizations', invites: 'organizations/invites',
  };
  const entry = `export {default as db} from ${dbImport}; export * as store from '${path.join(root,'src/lib/buzz/store.ts').replaceAll('\\','/')}';` +
    Object.entries(routePaths).map(([key, value]) => `export * as ${key} from '${path.join(root, 'src/app/api', value, 'route.ts').replaceAll('\\','/')}';`).join('\n');
  const outfile = path.join(scratch, 'routes.cjs');
  await esbuild.build({ absWorkingDir:root, stdin:{contents:entry,resolveDir:root,loader:'ts'}, bundle:true, platform:'node',format:'cjs',packages:'external',outfile,logLevel:'silent',
    plugins:[{ name:'qa-boundaries', setup(build) {
      for(const [filter,key] of matches) build.onResolve({filter}, () => ({path:key,namespace:'stub'}));
      build.onLoad({filter:/.*/,namespace:'stub'},args => ({contents:stubs[args.path],loader:'ts',resolveDir:root}));
    }}],
  });
  const api = createRequire(import.meta.url)(outfile);
  for (const [id,name] of [[1,'anna'],[2,'ben'],[3,'chloe']]) api.db.prepare("INSERT INTO users(id,username,email,password_hash) VALUES (?,?,?,'test')").run(id,name,name+'@example.test');
  const call = async (user, key, method='GET', body, params={}, query='') => context.run(user, async () => {
    const request = new Request(`http://organization.test/api/${routePaths[key]}${query}`, {method,...(body===undefined?{}:{body:JSON.stringify(body),headers:{'content-type':'application/json'}})});
    const response = await api[key][method](request,{params:Promise.resolve(params)});
    return {status:response.status,body:await response.json()};
  });
  return { api, call, context, scratch, root, qa:globalThis.__buzzQA, close() { api.db.close(); fs.rmSync(scratch,{recursive:true,force:true}); } };
}
