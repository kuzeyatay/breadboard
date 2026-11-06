import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {build} from 'esbuild';

const stubs={
  'server-only':'export {};',
  'fixture':`export const released=[];let serial=0;let ensure=async()=>({status:'starting',error:null});
    export function setEnsure(fn){ensure=fn;}export function reset(){released.length=0;ensure=async()=>({status:'starting',error:null});delete globalThis.__breadboardSpotifyPlaybackViewLeaseState;}
    export const acquireServiceLease=async()=>({id:++serial});export const releaseSupervisorLease=async lease=>released.push(['service',lease.id]);
    export const ensureSpotifyPlaybackRuntimeSession=input=>ensure(input);export const releaseSpotifyPlaybackRuntimeSession=async input=>released.push(['view',input.viewId]);`,
  '../supervisor-control.ts':`export {acquireServiceLease,releaseSupervisorLease} from 'fixture';export class SupervisorResourceExhaustedError extends Error {}`,
  './runtime-service.ts':`export {ensureSpotifyPlaybackRuntimeSession,releaseSpotifyPlaybackRuntimeSession} from 'fixture';export const spotifyPlaybackViewId=id=>id;export class SpotifyPlaybackRuntimeError extends Error {}`,
};
const bundle=await build({stdin:{resolveDir:path.resolve(import.meta.dirname,'..'),contents:"export * from './src/lib/spotify/view-lease.ts';export * from 'fixture';"},bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'lease-boundaries',setup(builder){
  builder.onResolve({filter:/.*/},args=>Object.hasOwn(stubs,args.path)?{path:args.path,namespace:'stub'}:undefined);
  builder.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'js'}));
}}]});
const lease=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const input={userId:7,viewId:'a7a459f4-49a9-4c96-b45b-bff8b501297b',ticket:'fixture'};
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
test.beforeEach(()=>lease.reset());

test('a slow initial acquisition gets a full hold after completion',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout']});
  const waiting=gate();lease.setEnsure(()=>waiting.promise);
  const pending=lease.renewSpotifyPlaybackViewLease(input);await settle();
  t.mock.timers.tick(90_000);waiting.resolve({status:'starting',error:null});await pending;
  t.mock.timers.tick(69_000);await settle();assert.deepEqual(lease.released,[]);
  await lease.releaseSpotifyPlaybackViewLease(input);assert.equal(lease.released.length,2);
});

test('a delayed heartbeat crossing the old expiry cannot release active audio',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout']});
  await lease.renewSpotifyPlaybackViewLease(input);
  t.mock.timers.tick(60_000);
  const waiting=gate();lease.setEnsure(()=>waiting.promise);
  const pending=lease.renewSpotifyPlaybackViewLease(input);await settle();
  t.mock.timers.tick(30_000);await settle();assert.deepEqual(lease.released,[]);
  waiting.resolve({status:'starting',error:null});await pending;await settle();
  t.mock.timers.tick(50_000);await settle();assert.deepEqual(lease.released,[],'expiry starts after acknowledgement, not before waiting');
  await lease.releaseSpotifyPlaybackViewLease(input);
});

test('a failed Runtime renewal preserves the bounded authenticated hold, then expires without another heartbeat',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout']});
  await lease.renewSpotifyPlaybackViewLease(input);
  t.mock.timers.tick(60_000);lease.setEnsure(async()=>{throw Error('Transient connection reset');});
  await assert.rejects(lease.renewSpotifyPlaybackViewLease(input));
  t.mock.timers.tick(20_000);await settle();assert.deepEqual(lease.released,[]);
  t.mock.timers.tick(51_000);await settle();assert.equal(lease.released.length,2);
});
