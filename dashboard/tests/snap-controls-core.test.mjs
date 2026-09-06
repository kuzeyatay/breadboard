import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { GestureDetector } from '../src/lib/speech/clap/gesture-detector.ts';
import { DEFAULT_CLAP_PREFERENCES, DEFAULT_SNAP_PREFERENCES } from '../src/lib/speech/clap/preferences.ts';
import { readClapPreferences, writeClapPreferences } from '../src/lib/speech/clap/store.ts';
import { DEFAULT_SNAP_ACTION, parseClapAction, clapInterpretationMessages } from '../src/lib/profile/clap-action.ts';
import { readClapAction, writeClapAction } from '../src/lib/profile/clap-action-store.ts';
import { executeClapMusic } from '../src/lib/profile/clap-music.ts';

function pcm(rate, events, seconds=5) {
  let seed=42;const data=new Float32Array(rate*seconds);
  for(let i=0;i<data.length;i++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;const random=seed/4294967296*2-1,t=i/rate;
    let x=random*.0002;
    for(const [at,kind] of events){const age=t-at;if(age<0||age>.055)continue;
      x+=(kind==='snap'?.8*Math.sin(2*Math.PI*3100*age)+random*.2:random)*.65*Math.exp(-age/(kind==='snap'?.0025:.01));
    }data[i]=x;
  }return data;
}
function run(rate,data,options={clapEnabled:true,snapEnabled:true},block=128){
  const d=new GestureDetector(rate,options),events=[];
  for(let start=0;start<data.length;start+=block)for(let i=start;i<Math.min(data.length,start+block);i++){
    const result=d.pushSample(data[i]);if(result>=2)events.push({control:result===3?'snap':'clap',sample:i});
  }return events;
}
test('short snap signatures are detected across sample rates, onset phases and worklet block sizes',()=>{
  for(const rate of [16000,44100,48000])for(const offset of [0,.004,.009]){
    const data=pcm(rate,[[1+offset,'snap']]);const expected=run(rate,data);
    assert.equal(expected.length,1,`${rate}/${offset}`);assert.equal(expected[0].control,'snap');
    for(const block of [1,37,1001])assert.deepEqual(run(rate,data,undefined,block),expected);
  }
});
test('one gesture dispatches once and clap/snap enable switches and cooldowns are independent',()=>{
  for(const rate of [16000,44100,48000]){
    const snap=pcm(rate,[[1,'snap'],[1.3,'snap']]);assert.deepEqual(run(rate,snap).map(e=>e.control),['snap']);
    assert.deepEqual(run(rate,snap,{clapEnabled:true,snapEnabled:false}),[]);
    const clap=pcm(rate,[[1,'clap'],[1.32,'clap']]);assert.deepEqual(run(rate,clap).map(e=>e.control),['clap']);
    assert.deepEqual(run(rate,clap,{clapEnabled:false,snapEnabled:true}),[]);
    const mixed=pcm(rate,[[1,'clap'],[1.32,'clap'],[1.6,'snap'],[3.2,'snap']]);
    assert.deepEqual(run(rate,mixed).map(e=>e.control),['clap','snap']);
    assert.deepEqual(run(rate,mixed,{clapEnabled:false,snapEnabled:false}),[]);
    assert.deepEqual(run(rate,pcm(rate,[])),[]);
  }
});
test('snap preferences and commands persist separately from claps and other accounts',()=>{
  const db=new Database(':memory:');db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1),(2)');
  try{
    assert.deepEqual(readClapPreferences(db,1,'snap'),DEFAULT_SNAP_PREFERENCES);
    assert.equal(DEFAULT_SNAP_PREFERENCES.enabled,false);assert.equal(DEFAULT_SNAP_PREFERENCES.pattern,'single');
    assert.deepEqual(readClapAction(db,1,'snap'),DEFAULT_SNAP_ACTION);
    writeClapPreferences(db,1,{...DEFAULT_SNAP_PREFERENCES,enabled:true},'snap');
    assert.deepEqual(readClapPreferences(db,1),DEFAULT_CLAP_PREFERENCES);assert.equal(readClapPreferences(db,2,'snap').enabled,false);
    writeClapAction(db,1,{prompt:'Open calendar',action:{kind:'page',page:'calendar'}},'snap');
    assert.equal(readClapAction(db,1).action.kind,'dictation');assert.deepEqual(readClapAction(db,2,'snap'),DEFAULT_SNAP_ACTION);
    db.prepare('UPDATE snap_controls_preferences SET preferences_json=? WHERE user_id=1').run('{}');
    assert.deepEqual(readClapPreferences(db,1,'snap'),DEFAULT_SNAP_PREFERENCES);
    assert.match(clapInterpretationMessages('Open calendar','snap')[0].content,/finger-snap/);
  }finally{db.close();}
});
test('the default snap plays the verified manifest track directly and rejects arbitrary URIs',async()=>{
  const calls=[];
  await executeClapMusic(DEFAULT_SNAP_ACTION.action,{connected:()=>true,current:async()=>({deviceId:'player'}),engine:async()=>({ready:true,deviceId:'breadboard-player'}),random:()=>0,
    search:async()=>{throw new Error('Default track must not be searched');},api:async input=>{calls.push(input);return{};}});
  assert.equal(calls[0].query.device_id,'breadboard-player');assert.equal(calls.length,1);assert.deepEqual(calls[0].body,{uris:['spotify:track:4EsRpVBBKiqOZ67DJj0QHF']});
  for(const trackUri of ['https://example.com','spotify:playlist:4EsRpVBBKiqOZ67DJj0QHF','javascript:alert(1)'])assert.equal(parseClapAction({...DEFAULT_SNAP_ACTION.action,trackUri}),null);
});
