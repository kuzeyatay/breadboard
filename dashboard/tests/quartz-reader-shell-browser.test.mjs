import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { chromium } from "playwright";
import { canonicalQuartzReaderShell } from "../scripts/quartz-reader-shell.mjs";
import { withCanonicalQuartzReader } from "../../quartz/quartz/components/scripts/canonicalReader.mjs";

const root=path.resolve(import.meta.dirname,".."),quartz=path.resolve(root,"../quartz");
const bundle=await build({entryPoints:[path.join(quartz,"quartz/reader.ts")],bundle:true,platform:"node",format:"cjs",write:false,
  plugins:[{name:"omit-reader-assets",setup(builder){builder.onLoad({filter:/(?:\.scss|\.inline\.(?:ts|js))$/},()=>({contents:"",loader:"text"}));}}]});
const module={exports:{}};
new Function("require","module","exports",bundle.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const {renderQuartzDocument}=module.exports;
const metadataScript=await build({entryPoints:[path.join(quartz,"quartz/components/scripts/contentMeta.inline.ts")],bundle:true,platform:"browser",format:"iife",write:false});

test("new notes paint their canonical text and reading metadata together without waiting for the published index",{timeout:30000},async()=>{
  const slug="physics/notes/cartesian-coordinates";
  const content="---\ntitle: Fields and Cartesian coordinates\ndate: 2026-09-23\n---\n\n# Fields\n\n"+"word ".repeat(401)+"\n\n$\\mathbf E=\\frac{\\mathbf F}{q}$\n";
  const reader=await renderQuartzDocument({content,relativePath:`${slug}.md`,contentRoot:"/fixture",allFiles:[`${slug}.md`]});
  assert.match(reader.contentMetaHtml,/3 min read/);
  assert.match(reader.contentMetaHtml,/~21 min to handwrite/);
  assert.ok(reader.contentMetaHtml.includes(`<time datetime="${new Date('2026-09-23T00:00:00').toISOString()}">Sep 23, 2026</time>`));
  const shell=withCanonicalQuartzReader(canonicalQuartzReaderShell(`<html><head><title>Template</title></head><body data-slug="physics/template">
    <nav><a href="./index">Physics</a></nav><h1 class="article-title">Template</h1>
    <p class="content-meta"><span>999 min read</span></p>
    <div class="markdown-actions" data-note-slug="physics/template"><button>Edit</button></div>
    <article class="popover-hint"><p>Wrong page</p></article></body></html>`,"/physics/template.html",slug));
  const executablePath=[chromium.executablePath(),"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(fs.existsSync);
  const browser=await chromium.launch({headless:true,executablePath});
  try{
    const page=await browser.newPage(),errors=[],paints=[];
    page.on("pageerror",error=>errors.push(error.message));
    await page.exposeFunction("recordPaint",value=>paints.push(value));
    await page.addInitScript(()=>{
      const sample=()=>{
        const article=document.querySelector('article.popover-hint');
        if(article&&getComputedStyle(article).visibility!=='hidden')window.recordPaint({text:article.textContent,metadata:document.querySelector('.content-meta')?.textContent});
        requestAnimationFrame(sample);
      };requestAnimationFrame(sample);
    });
    await page.route("https://reader.test/**",route=>route.fulfill({contentType:"text/html",body:shell}));
    // No Quartz nav event or completed index is provided. The head bridge must
    // request its document as soon as the DOM is ready, keeping controls usable.
    await page.route("https://host.test/**",route=>route.fulfill({contentType:"text/html",body:`<script>
      window.requests=[];
      addEventListener('message',event=>{
        if(event.data.type!=='second-brain:document-editor')return;
        requests.push(event.data);
      });
      window.reply=reader=>{const request=requests.at(-1);document.querySelector('iframe').contentWindow.postMessage({
        type:'second-brain:document-editor-result',ok:true,slug:request.slug,sessionId:request.sessionId,requestId:request.requestId,reader,revision:'r1'
      },'https://reader.test')};
      </script><iframe src="https://reader.test/${slug}"></iframe>`}));
    await page.goto("https://host.test/");
    await page.waitForFunction(()=>window.requests.length>0);
    const frame=page.frameLocator("iframe"),child=page.frames().find(frame=>frame.url().startsWith("https://reader.test"));
    await frame.getByRole("button",{name:"Edit",exact:true}).waitFor();
    assert.equal(await frame.locator("article").isVisible(),false);
    await child.evaluate(()=>{window.fetchData=new Promise(resolve=>window.resolveIndex=resolve)});
    await child.addScriptTag({content:metadataScript.outputFiles[0].text});
    await page.evaluate(reader=>window.reply(reader),reader);
    await frame.locator("article .katex").waitFor();
    assert.match(await frame.locator(".content-meta").innerText(),/3 min read.*words.*~21 min to handwrite/);
    await child.evaluate(slug=>window.resolveIndex({[slug]:{wordCount:1,readingTimeMs:300}}),slug);
    await child.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
    assert.match(await frame.locator(".content-meta").innerText(),/3 min read/);
    assert.ok(paints.length>0);
    assert.ok(paints.every(paint=>paint.text.includes("word")&&paint.metadata.includes("3 min read")),"The first visible article already has its current metadata");
    const requests=await page.evaluate(()=>window.requests.length);
    await page.waitForTimeout(1100);
    assert.equal(await page.evaluate(()=>window.requests.length),requests,"The startup retry stops after acknowledgement");
    // A prepared SPA destination also gets the metadata before it replaces the
    // current document. An absent content-meta node is created beside its title.
    await child.evaluate(()=>{
      window.destination=new DOMParser().parseFromString('<h1 class="article-title">Other</h1><div class="markdown-actions" data-note-slug="physics/other"></div><article class="popover-hint"></article>','text/html');
      window.prepared=window.prepareCanonicalQuartzDocument(window.destination);
    });
    await page.waitForFunction(()=>window.requests.at(-1).slug==='physics/other');
    await page.evaluate(reader=>window.reply({...reader,slug:'physics/other'}),reader);
    assert.match(await child.evaluate(async()=>{await window.prepared;return window.destination.querySelector('.content-meta').textContent}),/3 min read/);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test("an unpublished note keeps reader controls and receives only its own canonical document", {timeout: 30000}, async () => {
  const slug = "physics/notes/cartesian-coordinates";
  const shell = canonicalQuartzReaderShell(`<html><head><title>Template title</title></head>
    <body data-slug="physics/template"><nav><a href="./index">Physics</a></nav>
    <h1 class="article-title">Template title</h1><div class="markdown-actions" data-note-slug="physics/template"><button>Edit</button></div>
    <article class="popover-hint"><p>Template body</p><article>Nested article</article></article>
    <div class="toc"><ul class="toc-content"><li>Old heading</li></ul></div></body></html>`, "/physics/template.html", slug);
  assert.ok(shell);
  const executablePath = [chromium.executablePath(), "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(fs.existsSync);
  const browser = await chromium.launch({headless: true, executablePath});
  try {
    const page = await browser.newPage();
    await page.route("https://reader.test/**", route => route.fulfill({contentType:"text/html",body:shell}));
    await page.route("https://host.test/**", route => route.fulfill({contentType:"text/html",body:`<iframe src="https://reader.test/${slug}"></iframe><script>
      window.messages=[];addEventListener('message',event=>messages.push(event.data));
      window.send=data=>document.querySelector('iframe').contentWindow.postMessage(data,'https://reader.test');
    </script>`}));
    await page.goto("https://host.test/");
    const frame = page.frameLocator("iframe");
    await frame.getByRole("button", {name:"Edit",exact:true}).waitFor();
    assert.equal(await frame.locator("article").textContent(), "");
    assert.equal(await frame.getByText("Template body").count(), 0);
    await page.evaluate(()=>window.send({type:"second-brain:canonical-document",slug:"physics/wrong-note",html:"<p>Wrong document</p>"}));
    await page.evaluate((slug)=>window.send({type:"second-brain:canonical-document",slug,title:"Fields and Cartesian coordinates",html:"<p>The saved note opens immediately.</p>",toc:[],requestId:"saved-note"}),slug);
    await frame.getByText("The saved note opens immediately.", {exact:true}).waitFor();
    assert.equal(await frame.getByText("Wrong document").count(),0);
    assert.equal(await frame.getByRole("heading").textContent(),"Fields and Cartesian coordinates");
    assert.equal(await frame.getByRole("link",{name:"Physics",exact:true}).getAttribute("href"),"/physics/index");
    await page.waitForFunction(()=>window.messages.some(message=>message.type==='second-brain:canonical-document-rendered'&&message.requestId==='saved-note'));
  } finally { await browser.close(); }
});
