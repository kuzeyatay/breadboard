import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PDFDocument,rgb} from '@cantoo/pdf-lib';
import sharp from 'sharp';
import {sourceExcerptPages,readGardenSourcePages,readDocumentSourcePages} from '../src/lib/hermes/garden-source-reading.ts';
import {gardenPageExcerpt,parseGardenReadNode} from '../src/lib/hermes/garden-reader.ts';

test('bounded source reads preserve exact pagination and associate a mid-page excerpt with the correct original',()=>{
  const body='Summary.\r\n'+Array.from({length:12},(_,i)=>`## Page ${i+1}\r\nText ${i+1}: 𝑉.\r\n`).join('');
  let offset=0,restored='';const pages=[];
  do{
    const read=sourceExcerptPages(body,gardenPageExcerpt({content:body},{offset,limit:12000}));
    assert.ok(read.pages.length<=8);restored+=read.excerpt.content;pages.push(...read.pages);offset=read.excerpt.nextOffset;
  }while(offset!==null);
  assert.equal(restored,body);assert.deepEqual(pages,Array.from({length:12},(_,i)=>i+1));
  const partial=sourceExcerptPages(body,gardenPageExcerpt({content:body},{offset:body.indexOf('Text 9'),limit:7}));
  assert.deepEqual(partial.pages,[9]);assert.equal(partial.excerpt.content,'Text 9:');
});

test('verbatim document sections retain all source text and pages, including sections starting mid-page',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'document-source-pages-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'course/assets'),{recursive:true});
  fs.mkdirSync(path.join(root,'course/sources'),{recursive:true});
  const pdf=await PDFDocument.create();
  for(let i=0;i<11;i++)pdf.addPage([80,80]);
  fs.writeFileSync(path.join(root,'course/assets/book.pdf'),await pdf.save());
  const body=Array.from({length:11},(_,i)=>`## Page ${i+1}\nDistinct passage ${i+1}.\n`).join('');
  fs.writeFileSync(path.join(root,'course/sources/book.md'),'---\nsource_pdf: /course/assets/book.pdf\n---\n'+body);
  const origin={kind:'garden',clusterSlug:'course',documentSlug:'book'};
  const section=body.slice(body.indexOf('Distinct passage 1'));
  const result=await readDocumentSourcePages(root,origin,section);
  assert.deepEqual(result.sourcePages.map(page=>page.pdfPage),Array.from({length:11},(_,i)=>i+1));
  assert.equal(result.content,undefined,'page metadata cannot replace the exact document tool content');
  const partial=await readDocumentSourcePages(root,origin,section,section.slice(0,10));
  assert.deepEqual(partial.sourcePages.map(page=>page.pdfPage),[1]);
  const stale=await readDocumentSourcePages(root,origin,'A stale section.');
  assert.deepEqual(stale.sourcePages,[]);assert.match(stale.sourcePageError,/uniquely match/);
  assert.deepEqual((await readDocumentSourcePages(root,origin,'Distinct passage')).sourcePages,[]);
  const longBody=Array.from({length:33},(_,i)=>`## Page ${i+1}\nText.\n`).join('');
  const excerpt={content:longBody,offset:0,totalChars:longBody.length,truncated:false,nextOffset:null};
  const overflow=await readGardenSourcePages(root,'course',{type:'source-document',sourcePdf:'/course/assets/book.pdf',content:longBody},excerpt,{completeSection:true});
  assert.equal(overflow.content,longBody);assert.equal(overflow.nextOffset,null);
  assert.deepEqual(overflow.sourcePages,[]);assert.equal(overflow.sourcePagesUnavailable.length,33);
});

test('alternate OCR transcripts and ambiguous headings never invent page associations',()=>{
  for(const body of ['Plain unpaginated extraction','## Page 1\nA\n## Page 1\nB']){
    assert.deepEqual(sourceExcerptPages(body,gardenPageExcerpt({content:body},{})).pages,[]);
  }
  const body='## Page 1\nCanonical\n## AnyDoc cross-check\n## Page 1\nAlternate\n';
  const first=sourceExcerptPages(body,gardenPageExcerpt({content:body},{}));
  assert.deepEqual(first.pages,[1]);assert.equal(first.excerpt.content,'## Page 1\nCanonical\n');
  assert.deepEqual(sourceExcerptPages(body,gardenPageExcerpt({content:body},{offset:first.excerpt.nextOffset})).pages,[]);
});

test('source reads retain original pixels and missing/foreign PDFs retain explicitly unverified text',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'garden-source-reading-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'course/assets'),{recursive:true});
  const pdf=await PDFDocument.create();
  for(const color of [rgb(1,0,0),rgb(0,0,1)])pdf.addPage([120,120]).drawRectangle({x:0,y:0,width:120,height:120,color});
  fs.writeFileSync(path.join(root,'course/assets/book.pdf'),await pdf.save());
  const node=parseGardenReadNode({slug:'book',folder:'sources',relPath:'sources/book.md'},'---\nknowledge_type: source-document\nsource_pdf: /course/assets/book.pdf\n---\n## Page 1\nFirst.\n## Page 2\nSecond.');
  const excerpt=gardenPageExcerpt(node,{});
  const result=await readGardenSourcePages(root,'course',node,excerpt);
  assert.equal(result.content,excerpt.content);assert.deepEqual(result.sourcePages.map(page=>page.pdfPage),[1,2]);
  for(const page of result.sourcePages){
    const pixels=Buffer.from(page.screenshot.dataUrl.split(',')[1],'base64');
    const color=(await sharp(pixels).stats()).channels;
    assert.ok(color[page.pdfPage===1?0:2].mean>240);
  }
  // The real desktop supplies a Runtime V2 namespaced root. The same PDF must
  // remain readable and reproduce the same pixels as the ordinary path.
  const runtimeRoot=path.toNamespacedPath(root);
  const runtimeRead=await readGardenSourcePages(runtimeRoot,'course',node,excerpt);
  assert.deepEqual(runtimeRead.sourcePages.map(page=>page.screenshot.dataUrl),result.sourcePages.map(page=>page.screenshot.dataUrl));
  for(const sourcePdf of ['/other/assets/book.pdf','/course/assets/missing.pdf']){
    const failed=await readGardenSourcePages(root,'course',{...node,sourcePdf},excerpt);
    assert.equal(failed.content,excerpt.content);assert.deepEqual(failed.sourcePages,[]);
    assert.deepEqual(failed.sourcePagesUnavailable,[1,2]);assert.match(failed.sourceTextFormat,/text only/);
  }
  assert.deepEqual((await readGardenSourcePages(root,'course',{...node,type:'user-note'},excerpt)).sourcePages,[]);
});
