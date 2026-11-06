"use client";

import {Check, Search} from 'lucide-react';
import {useEffect, useState} from 'react';
import {loadAsciiCatalog, type AsciiCatalog} from '@/lib/ascii-magic-client';
import {asciiWallpaperId} from '@/lib/ascii-wallpapers';
import AsciiArtwork from './ascii-artwork';
import styles from './ascii-wallpapers.module.css';

const FEATURED=['moonlit-sea','matrix-rain','mountain-sunrise','northern-lights','amsterdam-canal-bikes','snowy-cabin','rainy-window','spinning-torus','nebula-drift','bonsai-tree','ocean-sunset','starfield-warp'];
const PAGE_SIZE=18;
export default function AsciiWallpaperGallery({selected,loading,onSelect}: {selected:string;loading:string|null;onSelect:(value:string)=>void}) {
  const [catalog,setCatalog]=useState<AsciiCatalog|null>(null);
  const [error,setError]=useState(false),[retry,setRetry]=useState(0);
  const [query,setQuery]=useState(''),[category,setCategory]=useState('all'),[limit,setLimit]=useState(PAGE_SIZE);
  const [animated,setAnimated]=useState<string|null>(null);
  useEffect(()=>{
    let live=true;
    void loadAsciiCatalog().then(value=>{if(live){setCatalog(value);setError(false);}}).catch(()=>{if(live)setError(true);});
    return ()=>{live=false;};
  },[retry]);
  const search=query.trim().toLowerCase();
  const pieces=(catalog?.pieces ?? []).filter(piece=>(category==='all'||piece.category===category) &&
    (!search||[piece.name,piece.note,...piece.tags].join(' ').toLowerCase().includes(search)))
    .sort((a,b)=>{
      const aRank=FEATURED.indexOf(a.slug),bRank=FEATURED.indexOf(b.slug);
      return (aRank<0?999:aRank)-(bRank<0?999:bRank)||a.name.localeCompare(b.name);
    });
  return <section className={styles.gallery} aria-label="ASCII backgrounds">
    <p className={styles.hint}>Animated art from ASCII Magic. Select a scene to use it as your background.</p>
    <div className={styles.filters}>
      <label className={styles.search}><Search size={16} aria-hidden="true" /><input aria-label="Search ASCII backgrounds" placeholder="Search scenes, rain, space…" value={query} maxLength={100} onChange={event=>{setQuery(event.target.value);setLimit(PAGE_SIZE);}} /></label>
      <select aria-label="ASCII category" value={category} onChange={event=>{setCategory(event.target.value);setLimit(PAGE_SIZE);}}>
        <option value="all">All categories</option>
        {catalog?.categories.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </div>
    {error ? <p role="alert" className={styles.hint}>Couldn’t load the ASCII library. <button type="button" onClick={()=>setRetry(value=>value+1)}>Retry</button></p> :
      !catalog ? <p className={styles.hint} role="status">Loading ASCII library…</p> :
      <p className={styles.hint} role="status">{pieces.length ? `${pieces.length} ${pieces.length===1?'scene':'scenes'}` : 'No matching scenes. Try another search.'}</p>}
    <div className={`browser-wallpaper-grid ${styles.grid}`}>
      {pieces.slice(0,limit).map(piece=>{
        const id=asciiWallpaperId(piece.slug),isSelected=selected===id;
        return <button key={piece.slug} type="button" className="browser-wallpaper-option" aria-label={piece.name}
          title={piece.note} aria-pressed={isSelected} aria-busy={loading===id} onClick={()=>onSelect(id)}
          onPointerEnter={()=>setAnimated(piece.slug)} onPointerLeave={()=>setAnimated(null)}
          onFocus={()=>setAnimated(piece.slug)} onBlur={()=>setAnimated(null)}>
          <span className="browser-wallpaper-thumbnail">
            <AsciiArtwork slug={piece.slug} preview animate={animated===piece.slug} />
            {isSelected && <span className="browser-wallpaper-check"><Check aria-hidden="true" /></span>}
          </span>
          <span><strong>{piece.name}</strong><small>{loading===id ? 'Applying…' : catalog?.categories.find(c=>c.id===piece.category)?.name}</small></span>
        </button>;
      })}
    </div>
    {pieces.length>limit && <button type="button" className={styles.more} onClick={()=>setLimit(value=>value+PAGE_SIZE)}>Show more</button>}
    <a className="browser-wallpaper-attribution" href="https://www.ascii-magic.com/ascii" target="_blank" rel="noreferrer">ASCII Magic · Open-source animation library</a>
  </section>;
}
