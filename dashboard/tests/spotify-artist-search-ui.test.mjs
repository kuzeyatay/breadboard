import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

test("Spotify artists open browsable profiles without interrupting playback or separating search results", {timeout:60_000}, async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const bundle = await build({
    stdin: {resolveDir:root,loader:"tsx",contents:`
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {BrowserSpotifyDock} from './src/app/browser/browser-home-widgets';
      window.controls=[];
      function App() {
        const [open,setOpen]=React.useState(true);
        const [ready,setReady]=React.useState(false); window.setReady=setReady;
        return <BrowserSpotifyDock spotify={{connected:true,history:[],playback:null,engine:{ready}}}
          initializing={false} busy={false} error="" openConnections={()=>{}} open={open} setOpen={setOpen}
          control={async(action,extra)=>{window.controls.push({action,...extra});return true;}}/>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    `},
    bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",outfile:"app.js",
    define:{"process.env.NODE_ENV":'"test"'},
    plugins:[{name:"dock-export",setup(builder){
      builder.onLoad({filter:/browser-home-widgets\.tsx$/},({path:filename})=>({loader:"tsx",
        contents:fs.readFileSync(filename,"utf8").replace("function BrowserSpotifyDock(","export function BrowserSpotifyDock(")}));
    }}],
  });
  const css = fs.readFileSync(path.join(root,"node_modules/tailwindcss/preflight.css"),"utf8")
    + fs.readFileSync(path.join(root,"src/app/globals.css"),"utf8").replace(/^@(?:import|source).*$/gm,"")
    + ".sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border-width:0}";
  const artist = {id:"artist0123456789abcde",uri:"spotify:artist:artist0123456789abcde",name:"Post Malone",imageUrl:null};
  const song = {id:"0123456789abcdefghijAB",uri:"spotify:track:0123456789abcdefghijAB",name:"Circles",artist:"Post Malone",album:"Hollywood's Bleeding",imageUrl:null,durationMs:215000};
  const profile = {artist,tracksSource:"top",tracks:Array.from({length:7},(_,i)=>({...song,id:`track${i}`,uri:`spotify:track:track${i}`,name:i?`Song ${i+1}`:song.name})),
    releases:[{id:"album0123456789abcde",uri:"spotify:album:album0123456789abcde",name:"Hollywood's Bleeding",type:"album",imageUrl:null,releaseDate:"2019-09-06"},
      {id:"single0123456789abcd",uri:"spotify:album:single0123456789abcd",name:"I Had Some Help",type:"single",imageUrl:null,releaseDate:"2024-05-10"}],
    playlists:[{id:"playlist0123456789abc",uri:"spotify:playlist:playlist0123456789abc",name:"This Is Post Malone",owner:"Spotify",imageUrl:null}],errors:{}};
  let profileFailure = false;
  let holdProfile = false;
  let releaseProfile;
  let profileRequests = 0;
  const executablePath = ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe","C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe","/usr/bin/chromium"].find(fs.existsSync);
  const browser = await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  try {
    const page = await browser.newPage({viewport:{width:900,height:850}});
    const errors = [];
    page.on("pageerror",error=>errors.push(error.message));
    await page.route("https://spotify.test/**",async route=>{
      const url = new URL(route.request().url());
      if(url.pathname==="/app.js")return route.fulfill({contentType:"text/javascript",body:bundle.outputFiles[0].text});
      if(url.pathname==="/style.css")return route.fulfill({contentType:"text/css",body:css});
      if(url.pathname==="/api/browser/spotify"){
        if(url.searchParams.get("view")==="prepare-track")return route.fulfill({json:{ok:true}});
        if(url.searchParams.get("view")==="artist"){
          profileRequests++;
          if(holdProfile)await new Promise(resolve=>{releaseProfile=resolve;});
          if(profileFailure)return route.fulfill({status:503,json:{message:"This artist profile is unavailable."}});
          return route.fulfill({json:profile});
        }
        const q = url.searchParams.get("q");
        if(q==="failure")return route.fulfill({status:503,json:{message:"Spotify search is unavailable."}});
        const artists = q==="many artists" ? Array.from({length:10},(_,i)=>({...artist,id:`artist${i}`,uri:`spotify:artist:artist${i}`,name:i?`Artist with a long name ${i}`:artist.name})) : [artist];
        return route.fulfill({json:{artists:q==="empty"?[]:artists,tracks:q==="post malone"||q==="many artists"?[song]:[]}});
      }
      return route.fulfill({contentType:"text/html",body:`<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head><body style="background:#e6efe7;font-family:Arial"><main id="root" style="position:fixed;right:100px;bottom:45px;width:430px;--browser-widget-font:Arial"></main><script src="/app.js"></script></body></html>`});
    });
    await page.goto("https://spotify.test");
    const search = page.getByRole("textbox",{name:"Search Spotify"});
    await search.fill("post malone");
    const artistButton = page.getByRole("button",{name:"Open Post Malone artist profile",exact:true});
    await expect(artistButton).toBeVisible();
    await expect(page.getByRole("heading",{name:"Artists",exact:true})).toHaveCount(0);
    await expect(page.getByRole("heading",{name:"Songs",exact:true})).toHaveCount(0);
    assert.equal(await page.locator('section[aria-label="Artists"]').evaluate(el=>el.nextElementSibling.className),"browser-spotify-result-list","songs immediately follow artists with no heading or divider");
    await expect(page.getByRole("button",{name:"Play Circles by Post Malone",exact:true})).toBeVisible();
    await expect(page.locator(".browser-spotify-artist-art")).toHaveCSS("border-radius","50%");
    await expect(artistButton.locator(":scope > svg")).toHaveCount(0);
    await expect(artistButton).toBeEnabled();
    await artistButton.focus();
    await page.keyboard.press("Enter");
    assert.deepEqual(await page.evaluate(()=>window.controls),[],"opening an artist never starts playback");
    const artifacts = path.join(root,".tmp-spotify-artist-search-qa");
    fs.mkdirSync(artifacts,{recursive:true});
    const artistProfile = page.locator(".browser-spotify-artist-profile");
    await expect(artistProfile).toHaveAttribute("aria-busy","false");
    await expect(page.getByRole("heading",{name:"Post Malone",exact:true})).toBeVisible();
    await expect(page.getByRole("heading",{name:"Post Malone",exact:true})).toHaveCSS("color","rgb(255, 255, 255)");
    await expect(page.getByRole("heading",{name:"Top songs",exact:true})).toBeVisible();
    await expect(page.getByRole("button",{name:"Back to search",exact:true})).toBeFocused();
    const playArtist = page.getByRole("button",{name:"Play music by Post Malone",exact:true});
    await expect(playArtist).toBeDisabled();
    await page.evaluate(()=>window.setReady(true));
    await playArtist.click();
    assert.deepEqual(await page.evaluate(()=>window.controls),[{action:"play-artist",artistUri:artist.uri}]);
    await expect(page.locator(".browser-spotify-profile-track")).toHaveCount(5);
    await page.getByRole("button",{name:"Show more",exact:true}).click();
    await expect(page.locator(".browser-spotify-profile-track")).toHaveCount(7);
    await page.getByRole("button",{name:"Play Song 2 by Post Malone",exact:true}).click();
    assert.deepEqual((await page.evaluate(()=>window.controls)).at(-1).queueUris,profile.tracks.slice(1).map(track=>track.uri));
    await page.getByRole("button",{name:"Show less",exact:true}).click();
    await artistProfile.evaluate(el=>{el.scrollTop=0;});
    await page.getByRole("dialog",{name:"Spotify player and library"}).screenshot({path:path.join(artifacts,"artist-profile.png")});

    await page.getByRole("button",{name:"Albums",exact:true}).click();
    await expect(page.getByRole("button",{name:"Play I Had Some Help",exact:true})).toHaveCount(0);
    await page.getByRole("button",{name:"Play Hollywood's Bleeding",exact:true}).click();
    assert.equal((await page.evaluate(()=>window.controls)).at(-1).albumUri,profile.releases[0].uri);
    await page.getByRole("button",{name:"Singles & EPs",exact:true}).click();
    await expect(page.getByRole("button",{name:"Play Hollywood's Bleeding",exact:true})).toHaveCount(0);
    await page.getByRole("button",{name:"All releases",exact:true}).click();
    await page.getByRole("button",{name:"Play This Is Post Malone",exact:true}).click();
    assert.deepEqual((await page.evaluate(()=>window.controls)).at(-1),{action:"play-playlist",playlistUri:profile.playlists[0].uri});
    await page.getByRole("dialog",{name:"Spotify player and library"}).screenshot({path:path.join(artifacts,"artist-discography.png")});
    await page.getByRole("button",{name:"Back to search",exact:true}).click();
    await expect(search).toHaveValue("post malone");
    await expect(artistButton).toBeVisible();
    await page.getByRole("dialog",{name:"Spotify player and library"}).screenshot({path:path.join(artifacts,"artists-and-songs.png")});

    profileFailure=true;
    await artistButton.click();
    await expect(page.getByRole("alert")).toContainText("This artist profile is unavailable.");
    profileFailure=false;
    await page.getByRole("button",{name:"Try again",exact:true}).click();
    await expect(artistProfile).toHaveAttribute("aria-busy","false");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator(".browser-spotify-profile-track")).toHaveCount(5);
    await page.getByRole("button",{name:"Back to search",exact:true}).click();

    holdProfile=true;
    await artistButton.click();
    await expect.poll(()=>profileRequests).toBe(4);
    await expect(page.getByRole("heading",{name:"Post Malone",exact:true})).toBeVisible();
    await page.getByRole("button",{name:"Back to search",exact:true}).click();
    releaseProfile(); holdProfile=false;
    await expect(search).toHaveValue("post malone");
    await expect(artistProfile).toHaveCount(0);

    await search.fill("artist only");
    await expect(artistButton).toBeVisible();
    await expect(page.getByRole("heading",{name:"Songs",exact:true})).toHaveCount(0);
    await expect(page.getByText("No songs or artists found.")).toHaveCount(0);
    await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem("breadboard:spotify-search-history:v1")??"[]"))).toContain("artist only");
    await page.getByRole("button",{name:"Clear search",exact:true}).click();
    await expect(artistButton).toHaveCount(0);
    await page.getByRole("button",{name:"artist only",exact:true}).click();
    await expect(artistButton).toBeVisible();

    await search.fill("many artists");
    await expect(page.locator(".browser-spotify-artist-result")).toHaveCount(10);
    const artistRail = page.locator(".browser-spotify-artist-list");
    assert.equal(await artistRail.evaluate(el=>el.scrollWidth>el.clientWidth),true,"extra artists scroll horizontally");
    assert.equal(await page.locator(".browser-spotify-library").evaluate(el=>el.scrollWidth===el.clientWidth),true,"artist names do not widen the popover");
    await expect(page.getByRole("button",{name:"Play Circles by Post Malone",exact:true})).toBeInViewport();
    await artistRail.screenshot({path:path.join(artifacts,"artist-row.png")});

    await search.fill("empty");
    await expect(page.getByText("No songs or artists found.")).toBeVisible();
    await expect(artistButton).toHaveCount(0);
    await search.fill("failure");
    await expect(page.getByRole("alert")).toContainText("Spotify search is unavailable.");
    await expect(page.getByText("No songs or artists found.")).toHaveCount(0);
    assert.deepEqual(errors,[]);
  } finally {
    await browser.close();
  }
});
