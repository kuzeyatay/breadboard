import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { musicBrowser } from "./helpers/music-browser.mjs";

let app;
test.before(async()=>{app=await musicBrowser();});
test.after(async()=>{await app?.close();});
for(const surface of ["terminal","garden"])test(`${surface}: restored card plays and pins the selected version without reopening SSE`,async()=>{
  app.fixture.message.externalAgentOutcome="completed";app.fixture.message.content=app.fixture.summary;
  const page=await app.context.newPage();try{
    await page.goto(`${app.url}/?surface=${surface}`);await page.getByRole("button",{name:"Prepare variation",exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.streams.length),0);
    assert.equal(await page.locator("audio").getAttribute("autoplay"),null);
    await page.getByRole("combobox",{name:"Music version"}).selectOption("1");
    assert.match(await page.getByRole("link",{name:"Download WAV"}).getAttribute("href"),/version=1$/);
    await page.locator("audio").evaluate(async audio=>{await audio.play();audio.pause();});
    assert.equal(await page.locator("audio").evaluate(audio=>audio.duration),.2);
    await page.getByRole("button",{name:"Prepare variation",exact:true}).click();
    assert.match((await page.evaluate(()=>window.edits))[0].prompt,/--source art_fixture@1$/);
    await page.getByRole("button",{name:"Open artifact",exact:true}).click();
    assert.match(await page.getByRole("dialog").innerText(),/Artifact version 1/);
    await page.getByRole("button",{name:"Close artifact",exact:true}).click();
    assert.match(await page.getByRole("link",{name:"Lyrics",exact:true}).getAttribute("href"),/art_lyrics\/download/);
    const directory=path.join(app.root,".tmp-music-ui");fs.mkdirSync(directory,{recursive:true});await page.screenshot({path:path.join(directory,`${surface}-restored.png`),fullPage:true});
    assert.equal(app.fixture.requests.filter(r=>r.url==="/api/music-producer/runs").length,0);
  }finally{await page.close();}
});
for(const surface of ["terminal","garden"])test(`${surface}: reconnect replays from its cursor, stop is truthful and completion fires once`,async()=>{
  app.fixture.message.externalAgentOutcome="running";app.fixture.message.content="";
  const page=await app.context.newPage();try{
    await page.goto(`${app.url}/?surface=${surface}`);await page.getByRole("button",{name:"Stop",exact:true}).waitFor();
    await page.evaluate(()=>{const source=window.streams[0];source.emit({sequenceNumber:3,type:"music.stage",payload:{message:"Generating music"}});source.onerror();});
    await page.getByRole("button",{name:"Reconnect",exact:true}).click();
    assert.match(await page.evaluate(()=>window.streams.at(-1).url),/since=3$/);
    await page.getByRole("button",{name:"Stop",exact:true}).click();
    await page.getByText("Stopping collection; provider computation may still be draining",{exact:true}).waitFor();
    await page.evaluate(summary=>{const source=window.streams.at(-1),event={sequenceNumber:4,type:"run.completed",payload:{summary}};source.emit(event);source.emit(event);},app.fixture.summary);
    await page.getByRole("button",{name:"Retry as a new run",exact:true}).waitFor();
    const state=await page.evaluate(()=>({terminals:window.terminals,notifications:window.notifications,closed:window.streams.every(source=>source.closed)}));
    assert.equal(state.terminals.length,1);assert.equal(state.notifications.length,1);assert.equal(state.closed,true);
    assert.equal(state.terminals[0].id,surface==="terminal"?"music-client":app.fixture.message.musicProducerRun.runId);
  }finally{await page.close();}
});
test("setup is observational on open, restores a pending job and requires an explicit download click",async()=>{
  app.fixture.requests.length=0;app.fixture.setupState=null;
  const page=await app.context.newPage();try{
    await page.goto(app.url+"/?setup");await page.getByText(/stopped: Prepared/).waitFor();
    assert.equal(app.fixture.requests.some(r=>r.method!=="GET"),false);
    await page.getByRole("button",{name:"Download and prepare ACE-Step"}).click();
    await page.getByRole("button",{name:"Stop setup",exact:true}).waitFor();
    assert.equal(app.fixture.requests.filter(r=>r.method==="POST"&&r.url==="/api/music-producer/setup").length,1);
    await page.reload();await page.getByRole("button",{name:"Stop setup",exact:true}).waitFor();
    assert.equal(app.fixture.requests.filter(r=>r.method==="POST"&&r.url==="/api/music-producer/setup").length,1);
    await page.getByRole("button",{name:"Stop setup",exact:true}).click();
    assert.equal(app.fixture.requests.at(-1).method,"DELETE");
    app.fixture.failHealth=true;await page.reload();await page.getByText("Provider unavailable",{exact:true}).waitFor();
    assert.equal(await page.getByRole("button",{name:"Download and prepare ACE-Step"}).isVisible(),true);
  }finally{app.fixture.failHealth=false;await page.close();}
});
