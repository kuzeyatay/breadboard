"use client";

import {useCallback,useEffect,useMemo,useSyncExternalStore} from "react";
import {validBrowserQuoteChoice} from "./browser-daily-quotes";

type Snapshot = {choice: string; status: "ready" | "saving" | "error"};
const serverSnapshot: Snapshot = {choice:"daily",status:"ready"};
const stores = new Map<string,ReturnType<typeof createStore>>();
function createStore(ownerKey: string) {
  const key = `breadboard:quote-choice:v1:${ownerKey}`;
  const endpoint = `/api/profile/browser-quote?${new URLSearchParams({ownerKey})}`;
  let current = serverSnapshot, dirty = false, version = 0, pending = Promise.resolve();
  let reading: Promise<void> | undefined, loaded = false;
  const listeners = new Set<()=>void>();
  const emit = (next: Snapshot) => { current=next; for(const listener of listeners) listener(); };
  const cached = () => {
    try { const value=JSON.parse(localStorage.getItem(key) ?? "null");return validBrowserQuoteChoice(value?.choice) ? value as {choice:string;dirty?:boolean} : null; }
    catch { return null; }
  };
  const backup = () => {
    try { localStorage.setItem(key,JSON.stringify({choice:current.choice,dirty})); } catch { /* Account saves work without browser storage. */ }
  };
  const previous=cached();
  if(previous){current={choice:previous.choice,status:"ready"};dirty=previous.dirty===true;}
  const choose = (choice:string) => {
    if(!validBrowserQuoteChoice(choice)) return;
    const mutation=++version;
    dirty=true;emit({choice,status:"saving"});backup();
    pending=pending.catch(()=>{}).then(async()=>{
      try {
        const response=await fetch(endpoint,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({choice}),keepalive:true,signal:AbortSignal.timeout(5000)});
        const payload=await response.json();
        if(!response.ok || payload.choice!==choice) throw new Error("Save failed");
        if(mutation===version){dirty=false;loaded=true;emit({choice,status:"ready"});backup();}
      } catch {if(mutation===version){emit({choice,status:"error"});backup();}}
    });
  };
  const load = (force=false) => {
    if(dirty){if(current.status!=="saving")choose(current.choice);return;}
    if(reading || (loaded&&!force)) return;
    const mutation=version;
    reading=(async()=>{
      try {
        const response=await fetch(endpoint,{cache:"no-store",signal:AbortSignal.timeout(5000)});
        const payload=await response.json();
        if(!response.ok||!validBrowserQuoteChoice(payload.choice))throw new Error("Read failed");
        if(mutation!==version||dirty)return;
        // A second tab may have changed the shared cache while this read was pending.
        const external=cached();
        if(external&&external.choice!==current.choice)return;
        loaded=true;emit({choice:payload.choice,status:"ready"});backup();
      } catch {if(mutation===version&&!dirty)emit({...current,status:"error"});}
      finally {reading=undefined;}
    })();
  };
  return {
    read:()=>current, choose, load, retry:()=>dirty?choose(current.choice):load(true),
    subscribe(listener:()=>void){listeners.add(listener);return ()=>{listeners.delete(listener);};},
    onStorage(event:StorageEvent){
      if(event.key!==key&&event.key!==null)return;
      const value=cached();
      if(!value||dirty)return;
      version++;emit({choice:value.choice,status:"ready"});
    },
  };
}
export function useBrowserQuoteChoice(ownerKey:string) {
  const key=ownerKey.trim().toLowerCase();
  const store=useMemo(()=>{
    // Server rendering never reads or shares user preferences.
    if(typeof window==="undefined")return null;
    let value=stores.get(key);if(!value){value=createStore(key);stores.set(key,value);}return value;
  },[key]);
  const subscribe=useCallback((listener:()=>void)=>store?.subscribe(listener)??(()=>{}),[store]);
  const read=useCallback(()=>store?.read()??serverSnapshot,[store]);
  const snapshot=useSyncExternalStore(subscribe,read,()=>serverSnapshot);
  useEffect(()=>{
    if(!store)return;
    store.load();
    const focus=()=>store.load(true);
    window.addEventListener("storage",store.onStorage);window.addEventListener("focus",focus);
    return ()=>{window.removeEventListener("storage",store.onStorage);window.removeEventListener("focus",focus);};
  },[store]);
  return {...snapshot,choose:(choice:string)=>store?.choose(choice),retry:()=>store?.retry()};
}
