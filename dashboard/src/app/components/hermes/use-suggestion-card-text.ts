'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { textEraseMs, textTypeMs } from '@/lib/text-replacement-motion';

const media = '(prefers-reduced-motion: reduce)';
const snapshot = () => window.matchMedia(media).matches;
function subscribe(changed: () => void) {
  const query=window.matchMedia(media); query.addEventListener('change',changed);
  return () => query.removeEventListener('change',changed);
}
const serverSnapshot=()=>true;
const characters=(text:string)=>Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text),part=>part.segment);
type Start = { from: string; text: string; target: string };
type Phase = 'erase' | 'type' | 'ready';

/** Real characters preserve reading order on cards that wrap to several lines. */
export function useSuggestionCardText(prompt: string, paused: boolean) {
  const reduced=useSyncExternalStore(subscribe,snapshot,serverSnapshot);
  const [state,setState]=useState<{target:string;displayed:string;phase:Phase;start:Start|null}>({target:prompt,displayed:prompt,phase:'ready',start:null});
  if(state.target!==prompt) {
    const from=state.phase==='erase' && state.start ? state.start.from : state.target;
    setState({target:prompt,displayed:reduced?prompt:state.displayed,phase:reduced?'ready':'erase',start:{from,text:state.displayed,target:prompt}});
  }
  const start=state.start;
  const progress=useRef<{start:Start|null;elapsed:number}>({start:null,elapsed:0});
  useEffect(()=>{
    if(!start) return;
    if(progress.current.start!==start) progress.current={start,elapsed:0};
    if(paused && !reduced) return;
    let frame=0;
    const old=characters(start.text), next=characters(start.target);
    const eraseMs=textEraseMs(start.text),typeMs=textTypeMs(start.target),pauseMs=120;
    const began=performance.now()-progress.current.elapsed;
    function step(now:number) {
      const elapsed=now-began;
      progress.current.elapsed=elapsed;
      let phase:Phase='ready',displayed=start!.target;
      if(!reduced && elapsed<eraseMs) {
        phase='erase';displayed=old.slice(0,Math.ceil(old.length*(1-elapsed/eraseMs))).join('');
      } else if(!reduced && elapsed<eraseMs+pauseMs+typeMs) {
        phase='type';displayed=next.slice(0,Math.floor(next.length*Math.max(0,elapsed-eraseMs-pauseMs)/typeMs)).join('');
      }
      setState(current=>current.start!==start || (current.displayed===displayed && current.phase===phase) ? current : {...current,displayed,phase});
      if(phase!=='ready') frame=requestAnimationFrame(step);
    }
    frame=requestAnimationFrame(step);
    return ()=>cancelAnimationFrame(frame);
  },[start,reduced,paused]);
  return {displayed:reduced?prompt:state.displayed,phase:reduced?'ready':state.phase,reduced,
    previous:state.start?.from ?? prompt,actionable:!reduced && state.phase==='erase' && state.start ? state.start.from : prompt};
}
