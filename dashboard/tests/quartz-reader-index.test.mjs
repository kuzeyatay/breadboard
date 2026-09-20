import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import esbuild from "esbuild";

const quartz = path.resolve(import.meta.dirname, "../../quartz");
async function load(contents) {
  const result = await esbuild.build({ stdin: { contents, resolveDir: quartz, loader: "ts" },
    bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic", jsxImportSource: "preact",
    loader: { ".scss": "text" }, plugins: [{name:"inline-resource",setup(build){build.onLoad({filter:/\.inline\.ts$/},args=>({contents:fs.readFileSync(args.path,"utf8"),loader:"text"}))}}] });
  return (await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64"))).default;
}

test("real content emitter splits metadata while preserving full text and graph fields", async () => {
  const emit = await load(`import {ContentIndex} from './quartz/plugins/emitters/contentIndex';export default ContentIndex({enableSiteMap:false,enableRSS:false}).emit;`);
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-reader-index-"));
  try {
    const content = Array.from({length:20}, (_,i) => [
      {type:"root",children:[]}, {data:{slug:`demo/note-${i}`,relativePath:`demo/note-${i}.md`,text:"searchable-body ".repeat(2000),links:["demo/note-1"],frontmatter:{title:`Note ${i}`,tags:["physics"],flag_color:"#facc15",knowledge_type:"learning-page"}}},
    ]);
    const emitted = [];
    for await (const file of emit({argv:{output,scope:[]},cfg:{configuration:{defaultDateType:"modified"}}},content)) emitted.push(await file);
    const full = JSON.parse(fs.readFileSync(path.join(output,"static/contentIndex.json"),"utf8"));
    const metadata = JSON.parse(fs.readFileSync(path.join(output,"static/contentMetadata.json"),"utf8"));
    assert.equal(emitted.length,2);
    assert.deepEqual(Object.keys(metadata),Object.keys(full));
    const {content:body,richContent:html,...details} = full["demo/note-0"];
    assert.match(body,/searchable-body/);
    assert.deepEqual(metadata["demo/note-0"],{...details,content:""});
    assert.ok(fs.statSync(path.join(output,"static/contentMetadata.json")).size < fs.statSync(path.join(output,"static/contentIndex.json")).size / 50);
  } finally {
    assert.equal(path.dirname(path.resolve(output)),path.resolve(os.tmpdir()));
    fs.rmSync(output,{recursive:true,force:true});
  }
});

test("reader bootstrap fetches metadata first and full text only on request, with old-build fallback", async () => {
  const bootstrap = await load(`import {pageResources} from './quartz/components/renderPage';export default pageResources('..',{css:[],js:[]}).js.find(x=>x.contentType==='inline').script;`);
  for (const legacy of [false,true]) {
    const requests=[];
    const sandbox={fetch:async url=>{requests.push(url);const metadata=url.endsWith('contentMetadata.json');return {status:metadata&&legacy?404:200,ok:!(metadata&&legacy),json:async()=>({kind:metadata?'metadata':'full'})}}};
    const api=vm.runInNewContext(bootstrap+`;({fetchData,fetchSearchData})`,sandbox);
    assert.equal((await api.fetchData).kind,legacy?'full':'metadata');
    assert.deepEqual(requests,legacy?['../static/contentMetadata.json','../static/contentIndex.json']:['../static/contentMetadata.json']);
    assert.equal((await api.fetchSearchData()).kind,'full');
    assert.equal(requests.at(-1),'../static/contentIndex.json');
  }
});
