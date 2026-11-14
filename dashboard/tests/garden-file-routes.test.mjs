import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const stubs = {
  '../server-auth.ts': `export class RouteError extends Error{constructor(status,message){super(message);this.status=status}}
    const state=()=>globalThis.__gardenFileRoutes;
    export async function requireReadableClusterFromSlug(slug){const s=state();if(!s.userId)throw new RouteError(401,'Sign in');if(slug!==s.cluster.slug||s.cluster.visibility!=='public'&&s.userId!==s.cluster.user_id)throw new RouteError(404,'Unavailable');return {cluster:s.cluster,userId:s.userId}}
    export async function requireReadableClusterFromSlugOrPublic(slug){const s=state();if(slug===s.cluster.slug&&s.cluster.visibility==='public')return {cluster:s.cluster,userId:null};return requireReadableClusterFromSlug(slug)}
    export async function requireOwnedClusterFromSlug(slug){const result=await requireReadableClusterFromSlug(slug);if(result.userId!==result.cluster.user_id)throw new RouteError(403,'Owner only');return result}
    export const routeErrorResponse=e=>Response.json({error:e.message},{status:e.status||500});`,
  './repository.ts': 'export const gardenFiles=()=>globalThis.__gardenFileRoutes.store;',
  '../garden-mutation-lease.ts': 'export const isGardenMutationBusyError=()=>false;',
  'next/server': 'export const NextResponse={next:()=>new Response(null,{headers:{"x-next":"1"}}),redirect:url=>new Response(null,{status:307,headers:{location:String(url)}})};',
  'next-auth/jwt': 'export const getToken=async()=>globalThis.__gardenFileRoutes.userId?{id:globalThis.__gardenFileRoutes.userId}:null;',
};
const bundled = await build({ stdin: { resolveDir: root, contents: `export {GET,POST} from './src/app/api/gardens/[gardenId]/files/route.ts';
  export {GET as contentGET} from './src/app/api/gardens/[gardenId]/files/[fileId]/content/route.ts';
  export {GardenFileStore} from './src/lib/garden-files/store.ts';export {proxy} from './src/proxy.ts';` }, bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false,
  plugins: [{ name: 'file-route-boundary', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => stubs[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'ts' }));
  } }],
});
const module = { exports: {} };
new Function('require','module','exports',bundled.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const api = module.exports;

test('public garden routes retain owner access and expose only explicitly shared files', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'garden-file-routes-')), database = new Database(':memory:');
  database.exec('CREATE TABLE users(id INTEGER PRIMARY KEY);CREATE TABLE clusters(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1),(2);INSERT INTO clusters VALUES(1)');
  const store = new api.GardenFileStore(database, directory), scope = { gardenId: 'demo', clusterId: 1, ownerId: 1, userId: 1 };
  const state = { store, userId: 1, cluster: { id: 1, slug: 'demo', user_id: 1, visibility: 'public' } };
  globalThis.__gardenFileRoutes = state;
  const context = { params: Promise.resolve({ gardenId: 'demo' }) };
  const listing = () => api.GET(new Request('http://localhost/api/gardens/demo/files'), context);
  try {
    const privateFile = store.import(scope, 'Private.txt', await store.stage(Readable.from(['Private bytes'])));
    const sharedFile = store.import(scope, 'Shared.txt', await store.stage(Readable.from(['Shared bytes'])));
    store.share(scope, sharedFile.id, sharedFile.revision, 'garden');
    let response = await listing(), body = await response.json();
    assert.equal(body.canEdit, true); assert.equal(body.files.length, 2);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    for (const userId of [2, null]) {
      state.userId = userId;
      body = await (await listing()).json();
      assert.equal(body.canEdit, false); assert.deepEqual(body.files.map(file => file.id), [sharedFile.id]);
      response = await api.contentGET(new Request('http://localhost/content'), { params: Promise.resolve({ gardenId: 'demo', fileId: privateFile.id }) });
      assert.equal(response.status, 404);
      response = await api.contentGET(new Request('http://localhost/content'), { params: Promise.resolve({ gardenId: 'demo', fileId: sharedFile.id }) });
      assert.equal(await response.text(), 'Shared bytes');
      let read = false;
      response = await api.POST({ headers: new Headers(), get body(){read=true;throw Error('Body must not be read')} }, context);
      assert.ok([401,403].includes(response.status)); assert.equal(read, false);
    }
    const link = `http://localhost/garden/demo/files/${sharedFile.id}`;
    const request = new Request(link); request.nextUrl = new URL(link);
    assert.equal((await api.proxy(request)).headers.get('x-next'), '1');
    const garden = new Request('http://localhost/garden/demo?note=one'); garden.nextUrl = new URL(garden.url);
    const redirect = await api.proxy(garden);
    assert.equal(redirect.status, 307); assert.equal(new URL(redirect.headers.get('location')).searchParams.get('callbackUrl'), '/garden/demo?note=one');
    state.userId = 1;
    response = await api.POST(new Request('http://localhost/files', { method:'POST', headers: {'x-file-path':'Empty.txt','x-file-size':'0'} }), context);
    assert.equal(response.status, 201); assert.equal((await response.json()).file.size, 0);
    response = await api.POST(new Request('http://localhost/files', { method:'POST', body:'short', headers:{'x-file-path':'Incomplete.txt','x-file-size':'99'} }), context);
    assert.equal(response.status, 400); assert.equal(store.list(scope).some(file=>file.name==='Incomplete.txt'), false);
    state.cluster.visibility = 'private'; state.userId = null;
    assert.equal((await listing()).status, 401);
  } finally { delete globalThis.__gardenFileRoutes; database.close(); fs.rmSync(directory,{recursive:true,force:true}); }
});
