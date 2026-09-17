import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {parse} from 'yaml';
import {build} from 'esbuild';
import {fromMarkdown} from 'mdast-util-from-markdown';
import {copyGardenFolderContents,rewriteRenamedFolderLinks} from '../src/lib/garden-folder-copy.ts';
import {resolveGardenSourcePdfPath} from '../src/lib/garden-source-pdf-path.ts';
import {mergeCurrentGardenUserContent} from '../src/lib/garden-user-content.ts';
const slug=value=>value.toLowerCase().replace(/[^a-z0-9]+/g,'-');
const metadata=value=>parse(value.match(/^---\n([\s\S]*?)\n---/)[1]);
const bundle=await build({entryPoints:[path.resolve(import.meta.dirname,'../../quartz/quartz/plugins/filters/draft.ts')],bundle:true,platform:'node',format:'cjs',write:false});
const module={exports:{}};new Function('module','exports',bundle.outputFiles[0].text)(module,module.exports);
const publish=(raw,relativePath)=>module.exports.RemoveDrafts().shouldPublish({},[null,{data:{frontmatter:metadata(raw),relativePath}}]);

for(const gardenName of ['electromagnetism-test','a-completely-different-garden']){
 for(const folder of ['sources','Concepts','artifacts']){
  test(`${gardenName}: ${folder} copies own their content, metadata, PDFs and media after originals disappear`,()=>{
   const temp=fs.mkdtempSync(path.join(os.tmpdir(),'generated-folder-copy-'));
   const garden=path.join(temp,gardenName);
   const kind=folder==='sources'?'source-document':folder==='Concepts'?'learning-page':'artifact';
   try{
    fs.mkdirSync(path.join(garden,folder,'1. Nested section'),{recursive:true});
    fs.mkdirSync(path.join(garden,'assets/source-visuals'),{recursive:true});
    const bytes={'original.pdf':'%PDF-1.7 original','searchable.pdf':'%PDF-1.7 text layer','recording.mp3':'audio bytes','document.docx':'document bytes','source-visuals/diagram.png':'image bytes'};
    for(const [file,data] of Object.entries(bytes))fs.writeFileSync(path.join(garden,'assets',file),data);
    const original=`---\ntitle: original\nsource_file: original.pdf\nknowledge_type: ${kind}\nbreadboardType: ${kind.replaceAll('-','_')}\ngenerated_by: document_ingestion\nsource_document: parent-source\nartifact_id: original-chat-artifact\ncollection: ${folder}\nsource_pdf: /${gardenName}/assets/original.pdf\nsearchable_pdf: /${gardenName}/assets/searchable.pdf\nsource_media: /${gardenName}/assets/recording.mp3\nsource_images: [/${gardenName}/assets/source-visuals/diagram.png]\nrelated: [companion]\n---\n\n[[${gardenName}/${folder}/1. Nested section/companion]]\n[Download](/${gardenName}/assets/document.docx)\n![Figure][figure]\n[figure]: /${gardenName}/assets/source-visuals/diagram.png\n<video src="/${gardenName}/assets/recording.mp3"></video>\n\n\`\`\`text\n/${gardenName}/assets/do-not-copy-example.pdf\n\`\`\`\n`;
    fs.writeFileSync(path.join(garden,folder,'original.md'),original);
    fs.writeFileSync(path.join(garden,folder,'1. Nested section/companion.md'),'Companion text');
    copyGardenFolderContents(garden,folder,`${folder}-copy`,slug);
    const copied=fs.readFileSync(path.join(garden,`${folder}-copy/original-copy.md`),'utf8');
    const fm=metadata(copied);
    assert.equal(fm.garden_copy,true);assert.equal(fm.knowledge_type,'note');
    assert.equal(fm.source_document,undefined);assert.equal(fm.artifact_id,undefined);
    assert.equal(fm.garden_copy_of.source_document,'parent-source');
    assert.equal(fm.garden_copy_of.artifact_id,'original-chat-artifact');
    assert.match(fm.related[0],/companion-copy$/);
    assert.equal(publish(copied,`${gardenName}/${folder}-copy/original-copy.md`),true);
    assert.equal(fs.readFileSync(path.join(garden,folder,'original.md'),'utf8'),original);
    const ownPdf=resolveGardenSourcePdfPath(temp,gardenName,fm.source_pdf);
    assert.ok(ownPdf.includes(`${folder}-copy`));
    assert.equal(fs.readFileSync(ownPdf,'utf8'),bytes['original.pdf']);
    assert.match(copied,new RegExp(`${folder}-copy/1. Nested section/companion-copy`));
    assert.match(copied,/do-not-copy-example\.pdf/);
    assert.ok(!copied.includes(`src="/${gardenName}/assets/recording.mp3"`));
    // Both deletion of the originals and Learn replacement preserve the copy.
    fs.rmSync(path.join(garden,folder),{recursive:true});fs.rmSync(path.join(garden,'assets'),{recursive:true});
    fs.renameSync(path.join(garden,`${folder}-copy`),path.join(garden,'my-notes'));
    rewriteRenamedFolderLinks(garden,`${folder}-copy`,'my-notes');
    const renamed=fs.readFileSync(path.join(garden,'my-notes/original-copy.md'),'utf8');
    const saved=metadata(renamed);
    for(const field of ['source_pdf','searchable_pdf','source_media']){
     assert.ok(saved[field].startsWith(`/${gardenName}/my-notes/assets/`));
     assert.ok(fs.existsSync(path.join(temp,saved[field].slice(1))));
    }
    assert.ok(resolveGardenSourcePdfPath(temp,gardenName,saved.source_pdf));
    assert.equal(publish(renamed,`${gardenName}/my-notes/original-copy.md`),true);
    copyGardenFolderContents(garden,'my-notes','my-notes-copy',slug);
    const second=metadata(fs.readFileSync(path.join(garden,'my-notes-copy/original-copy-copy.md'),'utf8'));
    assert.notEqual(second.source_pdf,saved.source_pdf);
    const candidate=path.join(temp,'candidate');fs.mkdirSync(candidate);
    mergeCurrentGardenUserContent(garden,candidate);
    assert.equal(fs.readFileSync(path.join(candidate,'my-notes/original-copy.md'),'utf8'),renamed);
    assert.equal(fs.readFileSync(path.join(candidate,saved.source_pdf.slice(gardenName.length+2)),'utf8'),bytes['original.pdf']);
   }finally{fs.rmSync(temp,{recursive:true,force:true});}
  });
 }
}

test('missing or symlinked attachments fail the complete copy; PDF paths cannot escape the garden',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'copy-asset-boundary-'));const garden=path.join(temp,'physics');
 try{
  fs.mkdirSync(path.join(garden,'sources'),{recursive:true});fs.mkdirSync(path.join(garden,'assets'));
  fs.writeFileSync(path.join(garden,'sources/note.md'),'---\nsource_pdf: /physics/assets/missing.pdf\n---\nText');
  assert.throws(()=>copyGardenFolderContents(garden,'sources','sources-copy',slug),/missing/);
  assert.equal(fs.existsSync(path.join(garden,'sources-copy')),false);
  fs.mkdirSync(path.join(temp,'outside'));fs.writeFileSync(path.join(temp,'outside/private.pdf'),'%PDF secret');
  fs.symlinkSync(path.join(temp,'outside'),path.join(garden,'assets/linked'),'junction');
  fs.writeFileSync(path.join(garden,'sources/note.md'),'---\nsource_pdf: /physics/assets/linked/private.pdf\n---\nText');
  assert.throws(()=>copyGardenFolderContents(garden,'sources','sources-copy',slug),/symbolic links/);
  assert.equal(fs.existsSync(path.join(garden,'sources-copy')),false);
  for(const url of ['/other/assets/private.pdf','/physics/assets/../outside/private.pdf','/physics/assets/%2e%2e/private.pdf','/physics/assets/linked/private.pdf','/physics/notes/private.pdf']){
   assert.equal(resolveGardenSourcePdfPath(temp,'physics',url),null,url);
  }
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('valid Markdown filenames with spaces and parentheses copy correctly, without touching code examples',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'copy-markdown-links-'));const garden=path.join(temp,'unrelated-garden');
 try{
  fs.mkdirSync(path.join(garden,'artifacts'),{recursive:true});fs.mkdirSync(path.join(garden,'assets'));
  fs.writeFileSync(path.join(garden,'assets/figure (1).png'),'image');
  fs.writeFileSync(path.join(garden,'assets/report(1).pdf'),'%PDF report');
  fs.writeFileSync(path.join(garden,'artifacts/note.md'),'![Figure](</unrelated-garden/assets/figure (1).png>)\n[Report](/unrelated-garden/assets/report(1).pdf "Report title")\n`[Example](/unrelated-garden/assets/missing.pdf)`\n');
  copyGardenFolderContents(garden,'artifacts','artifacts-copy',slug);
  const result=fs.readFileSync(path.join(garden,'artifacts-copy/note-copy.md'),'utf8');
  const links=[];const visit=node=>{if(node.url)links.push(node.url);node.children?.forEach(visit);};visit(fromMarkdown(result));
  assert.equal(links.length,2);
  for(const link of links)assert.ok(fs.existsSync(path.join(temp,decodeURIComponent(link).slice(1))));
  assert.match(result,/`\[Example\]\(\/unrelated-garden\/assets\/missing\.pdf\)`/);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
