import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {createVoiceBargeIn} from '../src/lib/speech/voice-barge-in.ts';
import {createSubscriptionInput} from '../src/lib/speech/subscription-input.ts';
import {initialVoiceTurn,frameLevel,advanceVoiceTurn,voiceTurnVerdict,speechThreshold,VOICE_MIN_SPEECH_MS} from '../src/lib/speech/voice-conversation.ts';

const filename = process.env.VOICE_ONSET_SOURCE ?? fileURLToPath(new URL('../src/app/components/voice-conversation-overlay.tsx', import.meta.url));
const source = ts.createSourceFile(filename,fs.readFileSync(filename,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function callback(name) {
  let value;
  function visit(node) {
    if(ts.isBinaryExpression(node)&&node.left.getText(source)===name)value=node.right;
    if (ts.isVariableDeclaration(node) && node.name.getText(source)===name) {
      value = ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer;
    }
    ts.forEachChild(node,visit);
  }
  visit(source);
  assert.ok(value,`Production callback ${name} exists`);
  return value.getText(source);
}
const code = ts.transpileModule(`let fallbackSpeechMs=0,nativeUtterance=false;const fallbackSpeech=createVoiceBargeIn();const beginTurn=${callback('beginTurn')};\nconst speechStarted=${callback('speechStarted')};const processFrame=${callback('processor.onaudioprocess')};`,
  {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;

function fixture(t,{cloud=true}={}) {
  t.mock.timers.enable({apis:['Date'],now:10000});
  const input=createSubscriptionInput();
  let segment=0, interrupts=0;
  const ref=current=>({current});
  const scope={
    stageRef:ref('paused'),transcribingRef:ref(null),listeningRef:ref(false),turnRef:ref(initialVoiceTurn()),
    chunksRef:ref([]),preRollRef:ref([]),speechOnsetRef:ref(false),recoveryControllerRef:ref(null),
    subscriptionErrorRef:ref(null),recoverSubscriptionRef:ref(()=>{}),greetingAbortRef:ref(null),
    awaitingRef:ref(false),interruptedRunRef:ref(Promise.resolve()),interruptRef:ref(()=>{interrupts++;}),
    clarificationRef:ref(null),cloud,initialVoiceTurn,VOICE_MIN_SPEECH_MS,createVoiceBargeIn,
    frameLevel,advanceVoiceTurn,voiceTurnVerdict,speechThreshold,VOICE_CONTINUATION_SPEECH_MS:160,
    session:1,sessionRef:ref(1),levelRef:ref(0),context:{sampleRate:48000},detectorRef:ref({ready:true,push(){}}),
    deferredFinishRef:ref(null),finishTurn(){throw Error('Unexpected endpoint during resumed speech');},
    setLiveHeard(){},stopNarration(){},playVoiceCue(){},clearWatchdog(){},setGreeting(){},
    enterStage(value){scope.stageRef.current=value;},
    subscriptionRef:ref({isHealthy:()=>true,resetTranscript:()=>input.reset(),
      beginTranscript:()=>input.discardBefore(Date.now()-1200),setListening(){},prepareSpeaker:async()=>{}}),
  };
  const handlers=new Function(...Object.keys(scope),code+'\nreturn {beginTurn,speechStarted,processFrame};')(...Object.values(scope));
  const append=text=>input.accept({type:'input_transcript.added',start_ms:++segment*200,end_ms:segment*200+200,item:{id:String(segment),text}});
  return {...handlers,scope,input,append,interrupts:()=>interrupts};
}

test('a delayed native onset cannot discard words after acoustic continuation has resumed the same thought',t=>{
  const h=fixture(t);h.beginTurn();h.speechStarted();h.append('Please compare the two routes');
  t.mock.timers.tick(2500);h.append(' and include their travel times');
  const controller=new AbortController();
  h.scope.stageRef.current='transcribing';h.scope.listeningRef.current=false;
  h.scope.transcribingRef.current={controller,chunks:[]};
  t.mock.timers.tick(600);h.speechStarted(); // local acoustic resumption
  assert.equal(controller.signal.aborted,true);
  h.append(' without toll roads');
  t.mock.timers.tick(250);h.speechStarted(); // delayed native confirmation
  assert.equal(h.input.text(),'Please compare the two routes and include their travel times without toll roads');
});

test('duplicate onset confirmation does not reset the silence clock for an already listening utterance',t=>{
  const h=fixture(t);h.beginTurn();h.speechStarted();
  h.scope.turnRef.current={...h.scope.turnRef.current,speechMs:600,silenceMs:400,elapsedMs:1000};
  h.speechStarted();
  assert.equal(h.scope.turnRef.current.silenceMs,400);
  assert.equal(h.scope.turnRef.current.elapsedMs,1000);
});

test('a real interruption still discards late words from the previous utterance and stops the answer once',async t=>{
  const h=fixture(t);h.beginTurn();h.speechStarted();h.append('old request');
  t.mock.timers.tick(2000);h.scope.stageRef.current='speaking';h.scope.listeningRef.current=false;
  h.append('New question');h.speechStarted();h.speechStarted();
  await h.scope.interruptedRunRef.current;
  assert.equal(h.input.text(),'New question');assert.equal(h.interrupts(),1);
  assert.equal(h.scope.stageRef.current,'listening');
});

test('a fresh listening turn handles its own onset after the previous answer',t=>{
  const h=fixture(t);h.beginTurn();h.speechStarted();h.append('first request');
  h.beginTurn();h.append('stale late text');t.mock.timers.tick(2000);h.append('second request');
  h.speechStarted();assert.equal(h.input.text(),'second request');
});

test('local providers preserve both recorded clips across a short pause and duplicate onset',t=>{
  const h=fixture(t,{cloud:false});h.beginTurn();h.speechStarted();
  const first=new Float32Array([1]),second=new Float32Array([2]);
  h.scope.preRollRef.current=[second];h.scope.stageRef.current='transcribing';h.scope.listeningRef.current=false;
  h.scope.transcribingRef.current={controller:new AbortController(),chunks:[first]};
  h.speechStarted();h.speechStarted();
  assert.deepEqual(h.scope.chunksRef.current,[first,second]);
});

test('live microphone continuation cancels a provisional endpoint before a healthy native detector confirms it',t=>{
  const h=fixture(t);h.beginTurn();h.speechStarted();h.append('Please compare the two routes');
  const controller=new AbortController();h.scope.stageRef.current='transcribing';h.scope.listeningRef.current=false;
  h.scope.transcribingRef.current={controller,chunks:[]};
  // Four real processor frames are 171 ms. The provider's confirmed final
  // may settle at 200 ms, before native VAD plus transport confirms resumption.
  const samples=new Float32Array(2048).fill(0.08);
  for(let i=0;i<4;i++){t.mock.timers.tick(43);h.processFrame({inputBuffer:{getChannelData:()=>samples}});}
  assert.equal(controller.signal.aborted,true,'live speech must protect the prefix before recognition settles');
  assert.equal(h.scope.stageRef.current,'listening');
  t.mock.timers.tick(2500);h.append(' including traffic');h.speechStarted();
  assert.equal(h.input.text(),'Please compare the two routes including traffic');
});

test('a click during transcript settling is not a continuation',t=>{
  const h=fixture(t);h.beginTurn();h.speechStarted();
  const controller=new AbortController();h.scope.stageRef.current='transcribing';h.scope.listeningRef.current=false;
  h.scope.transcribingRef.current={controller,chunks:[]};
  for(const level of [0.08,0,0.08,0,0.08,0])h.processFrame({inputBuffer:{getChannelData:()=>new Float32Array(2048).fill(level)}});
  assert.equal(controller.signal.aborted,false);assert.equal(h.scope.stageRef.current,'transcribing');
});

test('a delayed first native onset preserves speech already captured while its detector was loading',t=>{
  const h=fixture(t);h.beginTurn();h.scope.detectorRef.current.ready=false;
  h.append('Explain how the two approaches differ');
  const samples=new Float32Array(2048).fill(0.08);
  for(let i=0;i<8;i++)h.processFrame({inputBuffer:{getChannelData:()=>samples}});
  t.mock.timers.tick(1600);h.append(' in everyday language');
  h.scope.detectorRef.current.ready=true;h.speechStarted();
  assert.equal(h.input.text(),'Explain how the two approaches differ in everyday language');
});

function speakingFrames(t,{ready=false,cloud=true}={}){
 const h=fixture(t,{cloud});h.beginTurn();h.scope.stageRef.current='speaking';h.scope.listeningRef.current=false;
 let stopped=0;h.scope.detectorRef.current.ready=ready;
 h.frame=(level,currentReady=ready)=>{h.scope.detectorRef.current.ready=currentReady;t.mock.timers.tick(43);h.processFrame({inputBuffer:{getChannelData:()=>new Float32Array(2048).fill(level)}});return h.scope.stageRef.current==='listening';};
 return h;
}
for(const cloud of [true,false])test(`brief consonant gaps interrupt delayed speech detection for ${cloud?'streamed':'file'} input`,async t=>{
 const h=speakingFrames(t,{cloud});
 for(const level of [0.08,0.001,0.08,0.08,0.08,0.08,0.08,0.001])h.frame(level);
 await h.scope.interruptedRunRef.current;
 assert.equal(h.scope.stageRef.current,'listening');assert.equal(h.interrupts(),1);
 assert.equal(h.scope.speechOnsetRef.current,true);
 assert.ok(h.scope.chunksRef.current.length>0||cloud,'local input retains pre-roll');
});
test('interruption evidence survives native readiness flapping without overriding healthy native VAD',async t=>{
 const h=speakingFrames(t,{ready:true});
 for(let i=0;i<8;i++)h.frame(0.08,true);
 assert.equal(h.scope.stageRef.current,'speaking');assert.equal(h.interrupts(),0);
 h.frame(0.08,false);await h.scope.interruptedRunRef.current;
 assert.equal(h.scope.stageRef.current,'listening');assert.equal(h.interrupts(),1);
});
test('single clicks, sparse repeated clicks, short cues and quiet echo cannot interrupt',t=>{
 const h=speakingFrames(t);
 for(const pattern of [[0.08,0,0,0,0,0,0,0],Array.from({length:60},(_,i)=>i%2?0:0.08),[0.08,0.08,0.08,0.08,0,0,0,0],Array(20).fill(0.02)]){
  for(let i=0;i<8;i++)h.frame(0);
  for(const level of pattern)h.frame(level);
  assert.equal(h.scope.stageRef.current,'speaking');assert.equal(h.interrupts(),0);
 }
});
test('a long pause and the paused stage discard interruption evidence',t=>{
 const h=speakingFrames(t);
 for(let repeat=0;repeat<4;repeat++)for(const level of [0.08,0.08,0.08,0,0,0])h.frame(level);
 assert.equal(h.scope.stageRef.current,'speaking');
 h.scope.stageRef.current='paused';h.frame(0.08);h.scope.stageRef.current='speaking';
 for(let i=0;i<5;i++)h.frame(0.08);
 assert.equal(h.scope.stageRef.current,'speaking');assert.equal(h.interrupts(),0);
});
