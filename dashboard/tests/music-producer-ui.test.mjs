import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { musicBrowser } from "./helpers/music-browser.mjs";

let app;
test.before(async()=>{app=await musicBrowser();});
test.after(async()=>{await app?.close();});
for(const surface of ["terminal","garden"])for(const outcome of ["failed","aborted"])test(`${surface}: ${outcome} music keeps branch navigation in its only bottom action row`,async()=>{
  app.fixture.message.externalAgentOutcome=outcome;
  app.fixture.message.content=outcome==="failed"?"The music provider could not start.":"Collection stopped.";
  const page=await app.context.newPage();try{
    await page.goto(`${app.url}/?surface=${surface}`);
    const actions=page.getByLabel("Assistant response actions",{exact:true});
    await actions.waitFor();
    assert.equal(await actions.count(),1);
    assert.equal(await page.locator(".bb-agent-run-card").count(),0,"Failures use the normal response layout");
    assert.equal(await page.getByText(app.fixture.message.content,{exact:true}).count(),1);
    assert.equal(await page.evaluate(()=>window.streams.length),0);
    for(const width of [1000,390]){
      await page.setViewportSize({width,height:850});
      const copy=await actions.getByRole("button",{name:"Copy response",exact:true}).boundingBox();
      const branch=await actions.getByRole("button",{name:"Previous response branch",exact:true}).boundingBox();
      assert.ok(Math.abs((copy.y+copy.height/2)-(branch.y+branch.height/2))<2,"Branch controls stay on the action row at width "+width);
    }
    await actions.getByRole("button",{name:"Previous response branch",exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.branches),[-1]);
    await actions.getByRole("button",{name:"Regenerate response",exact:true}).click();
    assert.equal(await page.evaluate(()=>window.retries),1);
    const directory=path.join(app.root,".tmp-music-ui");fs.mkdirSync(directory,{recursive:true});
    await page.screenshot({path:path.join(directory,`${surface}-${outcome}-actions.png`),fullPage:true});
  }finally{await page.close();}
});
for(const surface of ["terminal","garden"])test(`${surface}: restored card plays and pins the selected version without reopening SSE`,async()=>{
  app.fixture.message.externalAgentOutcome="completed";app.fixture.message.content=app.fixture.summary;
  const page=await app.context.newPage();try{
    await page.goto(`${app.url}/?surface=${surface}`);await page.getByRole("button",{name:"Prepare variation",exact:true}).waitFor();
    assert.equal(await page.locator(".bb-agent-run-header").innerText(),"Music Producer");
    assert.equal(await page.getByRole("button",{name:"Settings",exact:true}).count(),0);
    assert.equal(await page.getByRole("button",{name:"Retry as a new run",exact:true}).count(),0);
    await page.getByRole("region",{name:"Music Producer thought",exact:true}).waitFor();
    assert.equal(await page.locator(".assistant-response-meta + .bb-agent-run-card").count(),1);
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
    await page.getByRole("region",{name:"Music Producer thinking",exact:true}).waitFor();
    await page.evaluate(()=>{const source=window.streams[0];source.emit({sequenceNumber:3,type:"music.stage",payload:{message:"Generating music"}});source.onerror();});
    await page.getByRole("button",{name:"Reconnect",exact:true}).click();
    assert.match(await page.evaluate(()=>window.streams.at(-1).url),/since=3$/);
    await page.getByRole("button",{name:"Stop",exact:true}).click();
    await page.getByText("Stopping collection; provider computation may still be draining",{exact:true}).waitFor();
    await page.evaluate(summary=>{const source=window.streams.at(-1),event={sequenceNumber:4,type:"run.completed",payload:{summary}};source.emit(event);source.emit(event);},app.fixture.summary);
    await page.getByRole("region",{name:"Music Producer thought",exact:true}).waitFor();
    const state=await page.evaluate(()=>({terminals:window.terminals,notifications:window.notifications,closed:window.streams.every(source=>source.closed)}));
    assert.equal(state.terminals.length,1);assert.equal(state.notifications.length,1);assert.equal(state.closed,true);
    assert.equal(state.terminals[0].id,surface==="terminal"?"music-client":app.fixture.message.musicProducerRun.runId);
  }finally{await page.close();}
});
test("setup is observational on open, restores a pending job and requires an explicit download click",async()=>{
  app.fixture.requests.length=0;app.fixture.setupState=null;
  const page=await app.context.newPage();try{
    await page.goto(app.url+"/?setup");await page.getByText("Ready on demand",{exact:true}).waitFor();
    assert.equal(app.fixture.requests.some(r=>r.method!=="GET"),false);
    await page.getByRole("button",{name:"Download and prepare ACE-Step"}).click();
    await page.getByRole("button",{name:"Stop setup",exact:true}).waitFor();
    assert.equal(app.fixture.requests.filter(r=>r.method==="POST"&&r.url==="/api/music-producer/setup").length,1);
    await page.reload();await page.getByRole("button",{name:"Stop setup",exact:true}).waitFor();
    assert.equal(app.fixture.requests.filter(r=>r.method==="POST"&&r.url==="/api/music-producer/setup").length,1);
    await page.getByRole("button",{name:"Stop setup",exact:true}).click();
    assert.equal(app.fixture.requests.some(r=>r.method==="DELETE"&&r.url==="/api/music-producer/setup"),true);
    app.fixture.failHealth=true;await page.reload();await page.getByText("Provider unavailable",{exact:true}).waitFor();
    assert.equal(await page.getByRole("button",{name:"Download and prepare ACE-Step"}).isVisible(),true);
  }finally{app.fixture.failHealth=false;await page.close();}
});

test("readiness preserves edits, save persists them, and saved API keys can be removed",async()=>{
  Object.assign(app.fixture,{setupState:null,settings:null,requests:[]});
  const page=await app.context.newPage();try{
    await page.goto(app.url+"/?setup");
    await page.getByRole("combobox",{name:"Provider mode"}).selectOption("external");
    await page.getByRole("textbox",{name:"Endpoint URL"}).fill("http://127.0.0.1:8001");
    await page.getByRole("combobox",{name:"Audio model"}).selectOption("acestep-v15-base");
    await page.getByLabel("API key",{exact:true}).fill("fixture-secret");
    await page.getByText("Arrangement with Resonant",{exact:false}).click();
    await page.getByRole("textbox",{name:"Resonant connection name"}).fill("studio");
    await page.getByRole("button",{name:"Check readiness",exact:true}).click();
    await page.getByRole("button",{name:"Check readiness",exact:true}).waitFor();
    assert.equal(await page.getByRole("combobox",{name:"Provider mode"}).inputValue(),"external");
    assert.equal(await page.getByRole("combobox",{name:"Audio model"}).inputValue(),"acestep-v15-base");
    assert.equal(await page.getByRole("textbox",{name:"Endpoint URL"}).inputValue(),"http://127.0.0.1:8001");
    assert.equal(await page.getByRole("textbox",{name:"Resonant connection name"}).inputValue(),"studio");
    assert.equal(await page.getByLabel("API key",{exact:true}).inputValue(),"fixture-secret");
    assert.equal(app.fixture.requests.some(r=>r.method!=="GET"),false);
    await page.getByRole("button",{name:"Save and test connection"}).click();
    await page.getByText("Provider settings saved.",{exact:true}).waitFor();
    assert.equal(await page.getByLabel("API key",{exact:true}).inputValue(),"");
    await page.reload();await page.getByLabel("Remove saved API key").check();
    await page.getByRole("button",{name:"Save and test connection"}).click();
    await page.getByText("Provider settings saved.",{exact:true}).waitFor();
    assert.equal(app.fixture.requests.filter(r=>r.url==="/api/music-producer/settings").at(-1).body.apiKey,"");
    assert.equal(app.fixture.settings.keyConfigured,false);
  }finally{app.fixture.settings=null;await page.close();}
});

test("provider save failures retain the draft and switching to local saves before setup",async()=>{
  Object.assign(app.fixture,{setupState:null,requests:[],settings:{mode:"external",externalUrl:"http://127.0.0.1:8001",model:"acestep-v15-base",resonantSlug:"",keyConfigured:false}});
  const page=await app.context.newPage();try{
    await page.goto(app.url+"/?setup");
    await page.getByRole("combobox",{name:"Provider mode"}).selectOption("managed");
    app.fixture.failSettings=true;
    await page.getByRole("button",{name:"Download and prepare ACE-Step"}).click();
    await page.getByText("The endpoint URL is invalid.",{exact:true}).waitFor();
    assert.equal(app.fixture.requests.some(r=>r.method==="POST"&&r.url==="/api/music-producer/setup"),false);
    assert.equal(await page.getByRole("combobox",{name:"Provider mode"}).inputValue(),"managed");
    app.fixture.failSettings=false;
    await page.getByRole("button",{name:"Download and prepare ACE-Step"}).click();
    await page.getByRole("button",{name:"Stop setup",exact:true}).waitFor();
    const mutations=app.fixture.requests.filter(r=>r.method==="POST");
    assert.deepEqual(mutations.slice(-2).map(r=>r.url),["/api/music-producer/settings","/api/music-producer/setup"]);
    assert.equal(mutations.at(-2).body.mode,"managed");
    assert.equal(mutations.at(-2).body.model,"acestep-v15-turbo");
  }finally{Object.assign(app.fixture,{settings:null,failSettings:false,setupState:null});await page.close();}
});

test("lost setup observation keeps installation locked and retries without a duplicate download",async()=>{
  Object.assign(app.fixture,{setupState:"running",requests:[],failSetup:false});
  const page=await app.context.newPage();try{
    await page.goto(app.url+"/?setup");await page.getByRole("button",{name:"Stop setup",exact:true}).waitFor();
    app.fixture.failSetup=true;
    await page.getByRole("button",{name:"Retry setup status"}).waitFor();
    assert.equal(await page.getByRole("button",{name:"Download and prepare ACE-Step"}).isDisabled(),true);
    assert.equal(await page.getByRole("button",{name:"Stop setup",exact:true}).isEnabled(),true);
    app.fixture.failSetup=false;
    await page.getByRole("button",{name:"Retry setup status"}).click();
    await page.getByRole("button",{name:"Retry setup status"}).waitFor({state:"detached"});
    assert.equal(app.fixture.requests.some(r=>r.method==="POST"),false);
    await page.getByRole("button",{name:"Stop setup",exact:true}).click();
    await page.getByText("Setup stopped",{exact:true}).waitFor();
  }finally{Object.assign(app.fixture,{setupState:null,failSetup:false});await page.close();}
});

test("failed setup survives reload with its reason and settings fit light, dark and narrow layouts",async()=>{
  Object.assign(app.fixture,{setupState:"failed",setupMessage:"ACE-Step setup failed.",setupDetail:"Insufficient disk space for model files and download staging.",healthState:"missing-models",healthMessage:"Local models are not prepared."});
  const page=await app.context.newPage();try{
    await page.goto(app.url+"/?setup");
    await page.getByText(app.fixture.setupDetail,{exact:true}).waitFor();
    assert.equal(await page.getByText("Setup complete",{exact:true}).count(),0);
    assert.equal(await page.getByRole("button",{name:"Download and prepare ACE-Step"}).isEnabled(),true);
    await page.reload();await page.getByText(app.fixture.setupDetail,{exact:true}).waitFor();
    const directory=path.join(app.root,".tmp-music-ui");fs.mkdirSync(directory,{recursive:true});
    for(const theme of ["light","dark"])for(const width of [1000,390]){
      await page.setViewportSize({width,height:1000});
      await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.classList.toggle("dark",theme==="dark");},theme);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
      await page.screenshot({path:path.join(directory,`settings-${theme}-${width}.png`),fullPage:true});
    }
  }finally{Object.assign(app.fixture,{setupState:null,setupMessage:null,setupDetail:null,healthState:null,healthMessage:null});await page.close();}
});
