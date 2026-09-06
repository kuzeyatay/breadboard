import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { chromium } from 'playwright';
import { DEFAULT_CLAP_PREFERENCES, DEFAULT_SNAP_PREFERENCES } from '../../src/lib/speech/clap/preferences.ts';
import { DEFAULT_SNAP_ACTION } from '../../src/lib/profile/clap-action.ts';
export async function clapBrowser() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const bundle = await esbuild.build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React,{useEffect,useState,useRef,StrictMode} from 'react'; import {createRoot} from 'react-dom/client';
    import Provider from './src/app/components/clap-listener-provider';
    import Settings from './src/app/components/settings-clap-controls';
    import Profile from './src/app/profile/clap-action-panel';
    import Dictation from './src/app/components/speech-dictation-button';
    import Voice from './src/app/components/voice-conversation-overlay';
    import {registerClapChat} from './src/lib/speech/clap-wake';
    import {registerClapTarget,dispatchClapSpeech} from './src/lib/speech/clap/targets';
    import {openGestureAction,takeGestureLaunch} from './src/lib/speech/clap/action-launch';
    window.openGestureAction=openGestureAction;window.takeGestureLaunch=takeGestureLaunch;
    import {clapSnapshot,saveClapPreferences,saveClapAction,updateClapRuntime,setClapTestMode} from './src/lib/speech/clap/client';
    import {requestForegroundMicrophone,stopForegroundStream,holdForegroundAudio} from './src/lib/speech/clap/audio-focus';
    window.clapSnapshot=clapSnapshot; window.savePreferences=saveClapPreferences;window.saveAction=saveClapAction;
    window.setMode=setClapTestMode; window.dispatchSpeech=a=>dispatchClapSpeech(a,new AbortController().signal);
    window.requestForeground=requestForegroundMicrophone;window.stopForeground=stopForegroundStream;window.holdAudio=holdForegroundAudio;
    function Chat({name}) {
      const [value,setValue]=useState(''), [voice,setVoice]=useState(false),[greet,setGreet]=useState(location.pathname==='/voice'); const field=useRef(null);
      useEffect(()=>{if(location.pathname==='/voice')setVoice(true)},[]);
      return <section aria-label={'Chat '+name}><textarea ref={field} aria-label={'Draft '+name} value={value} onChange={e=>setValue(e.target.value)}/>
        <Dictation textareaRef={field} value={value} onChange={setValue} runtimeSessionId={name} onOpenVoiceMode={(hello=false)=>{setGreet(hello);setVoice(true)}}/>
        <Voice open={voice} compact={location.pathname==='/voice'} greetOnOpen={greet} onClose={()=>setVoice(false)} onSend={t=>window.sent.push(t)} messages={[]} busy={false}/>
      </section>;
    }
    function App(){const [chat,setChat]=useState(!location.search.includes('collapsed')&&location.pathname!=='/dashboard'), [second,setSecond]=useState(false),[settings,setSettings]=useState(true),[provider,setProvider]=useState(true);
      window.showChat=setChat;window.showSecond=setSecond;window.showSettings=setSettings;window.showProvider=setProvider;
      useEffect(()=>{if(location.search.includes('no-dock'))return;let dispose;const timer=setTimeout(()=>{dispose=registerClapChat(()=>setChat(true))},window.dockDelay||0);return()=>{clearTimeout(timer);dispose?.();}},[]);
      return <><h1>Current tab</h1>{provider&&<Provider/>}{location.search.includes('profile')?(settings&&<><Profile initial={window.initialAction} userId="1"/>{location.search.includes('snaps')&&<Profile control="snap" initial={window.initialSnapAction} userId="1"/>}</>):<div hidden={!settings}><Settings visible={settings}/></div>}{chat&&<Chat name="A"/>}{second&&<Chat name="B"/>}</>;
    }
    createRoot(document.getElementById('root')).render(<StrictMode><App/></StrictMode>);
  ` }, bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [{ name: 'fixture-services', setup(build) {
      const stubs = {
        'next/navigation': `import{useState,useEffect}from'react';const router={push:path=>{window.navigated.push(path);history.pushState({},'',path);window.dispatchEvent(new Event('test-route'));},replace:path=>{window.navigated.push(path);history.replaceState({},'',path);window.dispatchEvent(new Event('test-route'));},prefetch:()=>{}};export const useRouter=()=>router;export function usePathname(){const[p,s]=useState(location.pathname);useEffect(()=>{const f=()=>s(location.pathname);window.addEventListener('test-route',f);return()=>window.removeEventListener('test-route',f);},[]);return p;}`,
        '@/lib/speech/prepare-client': `export const speechErrorMessage=(e,f)=>e?.message||f;export function prepareLocalSpeech(signal){window.prepares++;return new Promise((resolve,reject)=>{window.finishPrepare=resolve;if(signal)signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});}`,
        '@/lib/speech/request-client': `export const speechRequest=(...args)=>fetch(...args);`,
        '@/lib/speech/subscription-live': `export{subscriptionSelected}from'${path.join(root,'src/lib/speech/subscription-live.ts').replaceAll('\\','/')}';export async function connectSubscriptionVoice(options){window.voiceConnections++;window.voiceListening=options.listening!==false;if(window.failVoice)throw new Error('Selected OpenAI voice unavailable');return{close:async()=>{},setListening:value=>window.voiceListening=value,resetTranscript:()=>{},stopSpeaking:()=>window.finishGreeting?.(),speak:text=>{window.greetings.push({provider:'chatgpt',text});return new Promise(resolve=>window.finishGreeting=resolve);}};}`,
      };
      build.onResolve({filter:/.*/}, a => a.path in stubs ? {path:a.path,namespace:'stub'} : null);
      build.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path],loader:'js',resolveDir:root}));
    }}] });
  const cssInput = fs.readFileSync(path.join(root,'src/app/globals.css'),'utf8').replace('@source "../**/*.{js,mjs,cjs,ts,tsx,jsx,mdx}";', '@source "./components/settings-clap-controls.tsx"; @source "./components/voice-conversation-overlay.tsx"; @source "./components/speech-dictation-button.tsx"; @source "./components/music-recognition-button.tsx"; @source "./profile/clap-action-panel.tsx";');
  const css = (await postcss([tailwindcss({base:root})]).process(cssInput,{from:path.join(root,'src/app/globals.css')})).css;
  // Same production entry/core, bundled locally before the HTTP server starts.
  const worklet = process.env.BREADBOARD_CLAP_PACKAGED_WORKLET ? fs.readFileSync(process.env.BREADBOARD_CLAP_PACKAGED_WORKLET,'utf8') : (await esbuild.build({entryPoints:[path.join(root,'src/lib/speech/clap/worklet.ts')],bundle:true,write:false,format:'iife',platform:'browser'})).outputFiles[0].text;
  const fixture = { snapPreferences:{...DEFAULT_SNAP_PREFERENCES}, snapAction:structuredClone(DEFAULT_SNAP_ACTION), executionBodies:[], preferences:{...DEFAULT_CLAP_PREFERENCES}, action:{prompt:'Start dictation',action:{kind:'dictation'}}, requests:[], executions:0, failSave:false, speechProvider:'local', voiceFailure:false };
  const greetingWav=Buffer.alloc(44+3200);greetingWav.write('RIFF');greetingWav.writeUInt32LE(greetingWav.length-8,4);greetingWav.write('WAVEfmt ',8);
  greetingWav.writeUInt32LE(16,16);greetingWav.writeUInt16LE(1,20);greetingWav.writeUInt16LE(1,22);greetingWav.writeUInt32LE(16000,24);
  greetingWav.writeUInt32LE(32000,28);greetingWav.writeUInt16LE(2,32);greetingWav.writeUInt16LE(16,34);greetingWav.write('data',36);greetingWav.writeUInt32LE(3200,40);
  const server = http.createServer(async(req,res)=>{
    if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
    if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}
    if(req.url==='/audio/clap-controls.js'){res.setHeader('Content-Type','text/javascript');res.end(worklet);return;}
    if(req.url.startsWith('/api/')){
      fixture.requests.push(req.url);let raw='';for await(const c of req)raw+=c;const body=raw?JSON.parse(raw):{};const url=new URL(req.url,'http://fixture.test'),pathname=url.pathname,snap=url.searchParams.get('control')==='snap';res.setHeader('Content-Type','application/json');
      if(pathname==='/api/speech/clap-controls'){
        if(req.method==='PUT'&&fixture.failSave){res.statusCode=500;res.end('{"error":"Could not save preferences"}');return;}
        if(req.method==='PUT'){if(snap)fixture.snapPreferences=body;else fixture.preferences=body;}
        res.end(JSON.stringify({userId:'1',preferences:snap&&req.method==='PUT'?fixture.snapPreferences:fixture.preferences,action:fixture.action,snapPreferences:fixture.snapPreferences,snapAction:fixture.snapAction}));
      }else if(pathname==='/api/profile/clap-action'){
        if(req.method==='PUT'&&fixture.failSave){res.statusCode=500;res.end('{"error":"Could not save preferences"}');return;}
        if(req.method==='PUT'){if(snap)fixture.snapAction=body;else fixture.action=body;}res.end(JSON.stringify({settings:snap?fixture.snapAction:fixture.action}));
      }else if(pathname==='/api/profile/clap-action/interpret'){
        res.end(JSON.stringify(body.prompt==='Do something'?{clarification:'Which action should your clap run?'}:{action:{kind:'assistant',prompt:body.prompt}}));
      }else if(pathname==='/api/profile/clap-action/execute'){fixture.executions++;fixture.executionBodies.push({control:snap?'snap':'clap',...body});res.end(JSON.stringify(body.expectedAction.kind==='assistant'?{message:'Started your AI request.',href:'/dashboard?terminalChat=conv_gesture_test'}:{message:'Music command sent'}));}
      else if(pathname==='/api/browser/spotify')res.end(JSON.stringify({connected:fixture.musicConnected!==false,engine:{ready:fixture.playerReady!==false,deviceId:'breadboard-player'}}));
      else if(pathname==='/api/workflows/local')res.end('{"workflows":[{"id":"wf_example","name":"Morning review"}]}');
      else if(pathname==='/api/speech/settings')res.end(JSON.stringify({settings:{speechProvider:fixture.speechProvider,enabled:true}}));
      else if(pathname==='/api/speech/synthesize'){if(fixture.voiceFailure){res.statusCode=503;res.end('{"error":"Selected Voicebox unavailable"}');}else{res.setHeader('Content-Type','audio/wav');res.end(greetingWav);}}
      else res.end('{}');return;
    }
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="en" data-theme="light"><head><link rel="stylesheet" href="/style.css"></head><body style="padding:24px"><main id="root" style="max-width:560px;margin:24px auto"></main><script>window.initialAction='+JSON.stringify(fixture.action)+';window.initialSnapAction='+JSON.stringify(fixture.snapAction)+'</script><script src="/app.js"></script></body></html>');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const executablePath=['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe','C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe','/usr/bin/chromium'].find(fs.existsSync);
  const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required'],...(executablePath?{executablePath}:{})});
  const context=await browser.newContext({viewport:{width:1000,height:1100}});
  await context.addInitScript(()=>{
    window.sent=[];window.navigated=[];window.prepares=0;window.greetings=[];window.captures=[];window.captureRequests=[];window.worklets=[];window.voiceConnections=0;
    const originalFetch=window.fetch;
    window.fetch=(url,init)=>{if(url==='/api/speech/synthesize')window.greetings.push({provider:'local',text:JSON.parse(init.body).text});return originalFetch(url,init);};
    const RealAudio=window.Audio;
    window.Audio=function(...args){const audio=new RealAudio(...args);audio.play=async()=>{window.finishGreeting=()=>audio.dispatchEvent(new Event('ended'));};return audio;};
    const RealWorklet=AudioWorkletNode;
    window.AudioWorkletNode=class extends RealWorklet {
      constructor(...args){super(...args);window.worklets.push(this);this.port.addEventListener('message',event=>{
        if(event.data.type==='gesture'){window.lastGesture=event.data;if(window.duplicateGesture)this.port.onmessage?.(event);}
      });}
    };
    const input=new AudioContext({sampleRate:48000});
    navigator.mediaDevices.getUserMedia=async constraints=>{
      window.captureRequests.push(constraints);
      if(window.permissionError)throw new DOMException('Permission denied','NotAllowedError');
      if(window.delayPermission)await new Promise(r=>window.grantPermission=r);
      const destination=input.createMediaStreamDestination();destination.gestureCapture=constraints.audio?.echoCancellation===false;window.captures.push(destination);return destination.stream;
    };
    window.emitClaps=async(kind='clap')=>{
      await input.resume();const active=window.captures.filter(c=>c.gestureCapture&&c.stream.getAudioTracks()[0].readyState==='live').at(-1);
      if(!active)throw new Error('No active microphone');
      const b=input.createBuffer(1,input.sampleRate*1.4,input.sampleRate), data=b.getChannelData(0);let seed=13;
      for(let i=0;i<data.length;i++){seed=seed*16807%2147483647;const t=i/input.sampleRate;let level=.0002;
        const random=seed/2147483647*2-1;data[i]=random*level;
        for(const start of kind==='snap'?[.8]:[.8,1.12])if(t>=start&&t<start+.055){const age=t-start;data[i]+=(kind==='snap'?.8*Math.sin(2*Math.PI*3100*age)+random*.2:random)*.65*Math.exp(-age/(kind==='snap'?.0025:.01));}
      }
      const source=input.createBufferSource();source.buffer=b;source.connect(active);source.start();
    };
    Object.defineProperty(window,'speechSynthesis',{value:{speak:()=>{throw new Error('System speech must never be used');},cancel:()=>{}}});
  });
  return {fixture,browser,context,root,url:`http://127.0.0.1:${server.address().port}`,close:async()=>{await browser.close();await new Promise(r=>server.close(r));}};
}
