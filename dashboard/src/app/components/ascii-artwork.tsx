"use client";

import { useEffect, useRef, useState } from 'react';
import {asciiRuntime} from '@/lib/ascii-magic-client';
import styles from './ascii-wallpapers.module.css';

export default function AsciiArtwork({slug, preview = false, animate = true}: {slug:string; preview?:boolean; animate?:boolean}) {
  const host = useRef<HTMLDivElement>(null);
  const [failure,setFailure] = useState<string | null>(null);
  const [retry,setRetry] = useState(0);
  useEffect(()=>{
    const element=host.current;
    if (!element) return;
    let disposed=false, started=false, stop: (()=>void) | undefined;
    const start=async()=>{
      if (disposed || started) return;
      started=true;
      try {
        const runtime=await asciiRuntime();
        const piece=await runtime.loadPiece(slug);
        if (disposed) return;
        stop=runtime.mount(element,piece,{still:!animate,preview});
        element.dataset.ready='true';
        setFailure(null);
      } catch { if (!disposed) setFailure(slug); }
    };
    // Library cards stay cheap: render a still frame only near the scroll viewport.
    const observer = preview ? new IntersectionObserver(entries=>{
      if (entries.some(entry=>entry.isIntersecting)) {observer?.disconnect(); void start();}
    },{rootMargin:'80px'}) : null;
    if (observer) observer.observe(element); else void start();
    return ()=>{disposed=true;observer?.disconnect();stop?.();delete element.dataset.ready;};
  },[slug,preview,animate,retry]);
  return <div className={preview ? styles.preview : styles.artwork} data-ascii-artwork={slug}>
    <div ref={host} className={styles.canvas} aria-hidden="true" />
    {failure === slug && (preview ? <span className={styles.previewError}>Select to retry</span> :
      <div className={styles.failure} role="alert">Couldn’t load the ASCII background. <button type="button" onClick={()=>setRetry(value=>value+1)}>Retry</button></div>)}
  </div>;
}
