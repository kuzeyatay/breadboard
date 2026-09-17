import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {copyGardenFolderContents, rewriteRenamedFolderLinks} from '../src/lib/garden-folder-copy.ts';
import {detachCopiedGardenVisuals,withoutDetachedVisualPayloads} from '../src/lib/garden-detached-visual.ts';
import {renderQuartzDocument} from '../src/lib/generated/quartz-reader.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const slug=value=>value.toLowerCase().replace(/[^a-z0-9]+/g,'-');
const snapshot=markdown=>JSON.parse(markdown.match(/```breadboard-detached-visual\n([\s\S]*?)\n```/)[1]);
function fixture() {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'detached-visual-'));
  const source='// Preserve opaque code: [[learning/lesson]]\nexport default {}';
  const nativeRuntime={engine:'breadboard-interactive-visualizer',version:'2.0.0',sourceSkill:'interactive-visualizer-in-chat',skillHash:'f'.repeat(64),
    html:`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"></head><body><label>Coordinate <input aria-label="Coordinate" type="range" min="0" max="10" value="1"></label><output>1</output><script>document.querySelector('input').oninput=e=>document.querySelector('output').textContent=e.target.value;</script></body></html>`};
  const compiled=`globalThis.__BREADBOARD_GENERATED_VISUAL__ = Object.freeze(${JSON.stringify({sdkVersion:'1.0.0',title:'Coordinate explorer',description:'Move the coordinate',nativeRuntime})});\n`;
  const manifest={id:'visual-original',version:2,status:'published',sdkVersion:'1.0.0',title:'Coordinate explorer',description:'Move the coordinate',
    targetPage:'learning/lesson.md',targetHeading:'Lesson',insertionAnchor:'unit:after-intro',sourceHash:hash(source),compiledHash:hash(compiled),
    sourceSkill:nativeRuntime.sourceSkill,skillHash:nativeRuntime.skillHash,runtimeEngine:nativeRuntime.engine,learningUnitId:'U1',previousVersion:1};
  const artifact=path.join(dir,'.breadboard/visuals/visual-original/versions/2');
  fs.mkdirSync(artifact,{recursive:true});
  for(const [name,value] of Object.entries({manifest,validation:{valid:true},tests:{passed:true},critic:{approved:true}}))fs.writeFileSync(path.join(artifact,`${name}.json`),JSON.stringify(value));
  fs.writeFileSync(path.join(artifact,'source.tsx'),source);fs.writeFileSync(path.join(artifact,'compiled.js'),compiled);
  const markdown='---\ntitle: Lesson\nvisualIds: ["visual-original"]\n---\n\n## Lesson\n\n<!-- unit:after-intro -->\n\n```breadboard-generated-visual\nid: visual-original\nversion: 2\n```\n\n[[learning/lesson]]\n';
  fs.mkdirSync(path.join(dir,'learning'));fs.writeFileSync(path.join(dir,'learning/lesson.md'),markdown);
  return {dir,artifact,markdown,source,compiled,close(){fs.rmSync(dir,{recursive:true,force:true});}};
}
async function render(dir,relativePath,content=fs.readFileSync(path.join(dir,relativePath),'utf8')) {
  return renderQuartzDocument({content,relativePath,contentRoot:dir.replaceAll('\\','/'),allFiles:[relativePath]});
}

test('a folder copy contains its own verified visual and survives deletion of the original artifacts',async()=>{
  const f=fixture();try{
    const original=await render(f.dir,'learning/lesson.md');assert.match(original.html,/data-generated-visual-definition/);
    copyGardenFolderContents(f.dir,'learning','learning-copy',slug);
    const content=fs.readFileSync(path.join(f.dir,'learning-copy/lesson-copy.md'),'utf8');const saved=snapshot(content);
    assert.notEqual(saved.manifest.id,'visual-original');assert.equal(saved.manifest.detached,true);
    assert.equal(saved.manifest.version,1);assert.equal(saved.manifest.copiedFrom.version,2);
    assert.equal(saved.source,f.source);assert.equal(saved.compiled,f.compiled);
    assert.doesNotMatch(withoutDetachedVisualPayloads(content),/opaque code|compiledHash/);
    assert.equal(saved.manifest.targetPage,undefined);assert.equal(saved.manifest.previousVersion,undefined);
    assert.match(content,new RegExp(`visualIds: \\[\\s*"${saved.manifest.id}"\\s*\\]`));
    assert.match(content,/\[\[learning-copy\/lesson-copy\]\]/);
    assert.equal(fs.readFileSync(path.join(f.dir,'learning/lesson.md'),'utf8'),f.markdown);
    fs.rmSync(path.join(f.dir,'.breadboard'),{recursive:true,force:true});
    const result=await render(f.dir,'learning-copy/lesson-copy.md');
    assert.match(result.html,/data-generated-visual-definition/);assert.doesNotMatch(result.html,/data-generated-visual-error/);
    // A copied snapshot is portable with just its Markdown, including heading edits.
    fs.renameSync(path.join(f.dir,'learning-copy'),path.join(f.dir,'notes'));
    rewriteRenamedFolderLinks(f.dir,'learning-copy','notes');
    const portable=fs.readFileSync(path.join(f.dir,'notes/lesson-copy.md'),'utf8').replace('## Lesson','## My renamed lesson').replace('<!-- unit:after-intro -->','');
    assert.doesNotMatch((await render(f.dir,'notes/lesson-copy.md',portable)).html,/data-generated-visual-error/);
    copyGardenFolderContents(f.dir,'notes','notes-copy',slug);
    const second=snapshot(fs.readFileSync(path.join(f.dir,'notes-copy/lesson-copy-copy.md'),'utf8'));
    assert.notEqual(second.manifest.id,saved.manifest.id);assert.equal(second.source,f.source);
  }finally{f.close();}
});

test('CRLF and tilde-fenced generated visuals are detached, and missing artifacts roll back the copy',()=>{
  const f=fixture();try{
    const crlf=f.markdown.replaceAll('```','~~~~').replaceAll('\n','\r\n');
    assert.match(detachCopiedGardenVisuals(f.dir,'learning/lesson.md',crlf),/~~~~breadboard-detached-visual/);
    const example='````markdown\n```breadboard-generated-visual\nid: visual-missing-example\nversion: 1\n```\n````';
    assert.equal(detachCopiedGardenVisuals(f.dir,'learning/lesson.md',example),example);
    fs.unlinkSync(path.join(f.artifact,'compiled.js'));
    assert.throws(()=>copyGardenFolderContents(f.dir,'learning','learning-copy',slug));
    assert.equal(fs.existsSync(path.join(f.dir,'learning-copy')),false);
    assert.equal(fs.readFileSync(path.join(f.dir,'learning/lesson.md'),'utf8'),f.markdown);
  }finally{f.close();}
});

test('linked references retain authorization and detached snapshots retain integrity and publication gates',async()=>{
  const f=fixture();try{
    assert.match((await render(f.dir,'notes/unowned.md',f.markdown)).html,/unauthorized page/);
    const detached=detachCopiedGardenVisuals(f.dir,'learning/lesson.md',f.markdown);
    for(const mutate of [value=>value.compiled+='tampered',value=>value.source+='tampered',value=>value.tests.passed=false,value=>value.critic.approved=false,value=>value.validation.valid=false,value=>value.manifest.skillHash='0'.repeat(64)]){
      const value=snapshot(detached);mutate(value);
      const result=await render(f.dir,'notes/snapshot.md',`\`\`\`breadboard-detached-visual\n${JSON.stringify(value)}\n\`\`\``);
      assert.match(result.html,/data-generated-visual-error/);assert.doesNotMatch(result.html,/data-generated-visual-definition/);
    }
  }finally{f.close();}
});

test('the detached native visual remains interactive without actions that mutate the Learn original',async()=>{
  const f=fixture();let browser;try{
    const content=detachCopiedGardenVisuals(f.dir,'learning/lesson.md',f.markdown);
    const {html}=await render(f.dir,'notes/snapshot.md',content);
    const bundle=await build({entryPoints:[path.resolve(import.meta.dirname,'../../quartz/quartz/components/scripts/breadboardGeneratedVisual.inline.ts')],bundle:true,write:false,format:'iife',platform:'browser',plugins:[{name:'raw',setup(builder){
      builder.onResolve({filter:/\?raw$/},args=>({path:path.resolve(args.resolveDir,args.path.slice(0,-4)),namespace:'raw'}));
      builder.onLoad({filter:/.*/,namespace:'raw'},args=>({contents:fs.readFileSync(args.path,'utf8'),loader:'text'}));
    }}]});
    const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(file=>fs.existsSync(file));
    browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
    const page=await browser.newPage();await page.setContent(html);
    await page.evaluate(()=>{window.addCleanup=()=>{};});await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.evaluate(()=>document.dispatchEvent(new Event('nav')));
    assert.equal(await page.getByRole('button',{name:'Regenerate',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'Restore v1',exact:true}).count(),0);
    const frame=page.frameLocator('iframe.bgv-frame');
    await frame.getByLabel('Coordinate').evaluate(input=>{input.value='7';input.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal(await frame.locator('output').innerText(),'7');
    assert.equal(await page.locator('iframe.bgv-frame').getAttribute('sandbox'),'allow-scripts');
  }finally{await browser?.close();f.close();}
});
