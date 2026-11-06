"use client";

export interface AsciiPiece { slug: string; name: string; category: string; note: string; tags: string[] }
export interface AsciiCatalog { version: string; categories: {id:string; name:string}[]; pieces: AsciiPiece[] }
interface PieceModule { meta: {slug:string; name:string; cols:number; rows:number; fps:number}; default: unknown }
interface AsciiRuntime {
  loadPiece: (slug:string) => Promise<PieceModule>;
  mount: (host:HTMLElement, piece:PieceModule, options:{still:boolean; preview:boolean}) => () => void;
}
let runtime: Promise<AsciiRuntime> | undefined;
let catalog: Promise<AsciiCatalog> | undefined;
export function asciiRuntime(): Promise<AsciiRuntime> {
  // Native ES modules keep all 734 scenes out of the initial Next.js bundle.
  // Desktop serves Next chunks through breadboard-assets://. Native import()
  // resolves against that script URL, so public modules need the page's origin.
  const url = new URL('/ascii-magic-art/breadboard-player.js', window.location.origin).href;
  return runtime ??= import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url)
    .catch(error => { runtime = undefined; throw error; });
}
export async function prepareAsciiWallpaper(slug:string) {
  return (await asciiRuntime()).loadPiece(slug);
}
export function loadAsciiCatalog(): Promise<AsciiCatalog> {
  return catalog ??= fetch('/ascii-magic-art/catalog.json', {signal:AbortSignal.timeout(10_000)})
    .then(async response => {
      if (!response.ok) throw new Error('Couldn’t load the ASCII library.');
      return await response.json() as AsciiCatalog;
    }).catch(error=>{catalog=undefined; throw error;});
}
