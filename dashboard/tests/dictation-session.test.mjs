import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: ['src/lib/speech/dictation-session.ts'], bundle: true, write: false, platform: 'browser', format: 'esm' });
const { DictationSession } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
function fixture() {
  let notify, signal, preview;
  const reports=[], calls=[], snapshot=deferred(), answer=deferred();
  const session=new DictationSession({
    recorder: report => { notify=report; return { start:(...args)=>{calls.push(['start',...args]);return Promise.resolve();}, stop:id=>calls.push(['stop',id]), cancel:id=>calls.push(['cancel',id]), disableCommands:id=>calls.push(['disable',id]) }; },
    report: n=>reports.push(n), screen:id=>{calls.push(['screen',id]);return snapshot.promise;}, answering:()=>calls.push(['answering']),
    reply:(text, screen, s, onText)=>{calls.push(['reply',text,screen]);signal=s;preview=onText;return answer.promise;},
  });
  return {session,reports,calls,snapshot,answer,notify:n=>notify(n),preview:text=>preview(text),signal:()=>signal};
}
test('normal dictation keeps its previews and spoken Enter without capturing a screen', async()=>{
  const f=fixture(); f.session.start(1);
  f.notify({type:'preview',id:1,text:'Hello'});f.notify({type:'finish',id:1});f.session.stop(1);f.notify({type:'result',id:1,text:'Hello',submit:true});
  await tick(); assert.equal(f.calls.some(c=>c[0]==='screen'),false); assert.equal(f.reports.at(-1).submit,true);
});
test('screen-aware mode captures once, hides raw speech and streams only an unsent answer', async()=>{
  const f=fixture(); f.session.start(2,'reply'); await tick();
  assert.deepEqual(f.calls[0],['start',2,false]);
  f.notify({type:'preview',id:2,text:'Write a reply'});f.notify({type:'finish',id:2});assert.deepEqual(f.reports,[]);
  f.snapshot.resolve({image:'selected monitor'}); f.session.stop(2);
  f.notify({type:'result',id:2,text:'Write a reply',submit:true});f.notify({type:'result',id:2,text:'duplicate'});await tick();
  assert.equal(f.calls.filter(c=>c[0]==='reply').length,1);f.preview('Thank');f.preview('Thank you.');f.answer.resolve('Thank you.');await tick();
  assert.deepEqual(f.reports,[{type:'preview',id:2,text:'Thank'},{type:'preview',id:2,text:'Thank you.'},{type:'result',id:2,text:'Thank you.',submit:false}]);
});
test('late Shift promotes the same microphone hold and removes only its owned preview', async()=>{
  const f=fixture();f.session.start(3);f.notify({type:'preview',id:3,text:'raw'});f.session.promote(3);f.session.promote(3);await tick();
  assert.equal(f.calls.filter(c=>c[0]==='start').length,1);assert.equal(f.calls.filter(c=>c[0]==='screen').length,1);
  assert.deepEqual(f.reports.at(-1),{type:'preview',id:3,text:''});assert.ok(f.calls.some(c=>c[0]==='disable'));
  f.session.cancel();f.snapshot.resolve({});await tick();
});
test('focus loss, replacement and capture failures never type a stale answer', async()=>{
  for(const phase of ['capture','generation']){
    const f=fixture();f.session.start(4,'reply');f.notify({type:'result',id:4,text:'Question'});
    if(phase==='generation'){f.snapshot.resolve({});await tick();}
    f.session.cancel(4);if(phase==='generation'){assert.equal(f.signal().aborted,true);f.preview('late');}
    f.session.start(5);f.snapshot.resolve({});f.answer.resolve('stale');await tick();assert.deepEqual(f.reports,[]);
  }
  const f=fixture();f.session.start(6,'reply');f.snapshot.reject(Error('No screen'));await tick();
  assert.deepEqual(f.reports,[{type:'error',id:6,message:'No screen'}]);assert.ok(f.calls.some(c=>c[0]==='cancel'));
});
