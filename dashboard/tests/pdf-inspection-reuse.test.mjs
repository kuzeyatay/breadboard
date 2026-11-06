import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {PDFDocument,rgb} from '@cantoo/pdf-lib';
import {PDFParse} from 'pdf-parse';
import {transform} from 'esbuild';
import {renderInspectionPdfPages} from '../src/lib/hermes/image-inspection.ts';

async function document(colors) {
  const pdf=await PDFDocument.create();
  for(const color of colors) pdf.addPage([80,80]).drawRectangle({x:0,y:0,width:80,height:80,color});
  return Buffer.from(await pdf.save());
}

test('repeated inspection reuses identical pixels, while pages, crops and changed bytes stay distinct',async t=>{
  const bytes=await document([rgb(1,0,0),rgb(0,0,1)]);
  const original=PDFParse.prototype.getScreenshot;
  const requests=[];
  t.mock.method(PDFParse.prototype,'getScreenshot',function(args){
    requests.push(args.partial); return original.call(this,args);
  });
  const first=await renderInspectionPdfPages(bytes,[1],{});
  const both=await renderInspectionPdfPages(bytes,[2,1,2],{});
  assert.deepEqual(requests,[[1],[2]],'only the missing page is rendered');
  assert.equal(both.totalPages,2);
  assert.deepEqual(both.pages.map(page=>page.pdfPage),[2,1,2]);
  assert.deepEqual(both.pages[1],first.pages[0]);
  assert.notEqual(both.pages[0].screenshot.dataUrl,first.pages[0].screenshot.dataUrl);
  const crop={x:0,y:0,width:0.5,height:1};
  const cropped=await renderInspectionPdfPages(bytes,[1],{crop});
  assert.notEqual(cropped.pages[0].screenshot.dataUrl,first.pages[0].screenshot.dataUrl);
  assert.deepEqual(await renderInspectionPdfPages(bytes,[1],{crop:{height:1,width:0.5,y:0,x:0}}),cropped);
  assert.equal(requests.length,3,'the same crop can reuse pixels regardless of property order');
  const intact=first.pages[0].screenshot.dataUrl;
  first.pages[0].screenshot.dataUrl='caller mutation';
  assert.equal((await renderInspectionPdfPages(bytes,[1],{})).pages[0].screenshot.dataUrl,intact);
  for(const bad of [null,{x:0,y:0,width:2,height:1},{x:NaN,y:0,width:0.5,height:1}]) {
    await assert.rejects(renderInspectionPdfPages(bytes,[1],{crop:bad}),/crop|rectangle/);
  }
  for(const pages of [[],[0],[1.5],[3]]) await assert.rejects(renderInspectionPdfPages(bytes,pages,{}));
  const changed=await document([rgb(0,1,0)]);
  assert.notEqual((await renderInspectionPdfPages(changed,[1],{})).pages[0].screenshot.dataUrl,intact);
});

test('the pixel byte budget evicts older pages without changing the regenerated result',async t=>{
  const bytes=await document([rgb(0,0.5,0),rgb(0,0.5,0),rgb(0,0.5,0)]);
  const probe=await renderInspectionPdfPages(bytes,[1],{});
  const pageBytes=Buffer.from(probe.pages[0].screenshot.dataUrl.split(',')[1],'base64').byteLength;
  const dashboard=path.resolve(fileURLToPath(import.meta.url),'../..');
  const cacheRoot=path.join(dashboard,'node_modules/.cache');
  fs.mkdirSync(cacheRoot,{recursive:true});
  const fixture=fs.mkdtempSync(path.join(cacheRoot,'pdf-budget-'));
  t.after(()=>{
    assert.ok(path.resolve(fixture).startsWith(path.resolve(cacheRoot)+path.sep));
    fs.rmSync(fixture,{recursive:true,force:true});
  });
  const source=fs.readFileSync(path.join(dashboard,'src/lib/hermes/image-inspection.ts'),'utf8');
  const budget='const PDF_PAGE_CACHE_BYTES = 64 * 1024 * 1024;';
  assert.ok(source.includes(budget));
  // Exercise the actual cache with capacity for two small real pages, instead
  // of retaining 64 MiB of synthetic fixtures just to force an eviction.
  const file=path.join(fixture,'inspection.mjs');
  const compiled=await transform(source.replace(budget,`const PDF_PAGE_CACHE_BYTES = ${2*pageBytes};`),{loader:'ts',format:'esm',target:'node22'});
  fs.writeFileSync(file,compiled.code);
  const {renderInspectionPdfPages:limited}=await import(pathToFileURL(file).href);
  const original=PDFParse.prototype.getScreenshot;
  const requests=[];
  t.mock.method(PDFParse.prototype,'getScreenshot',function(args){
    requests.push(args.partial); return original.call(this,args);
  });
  await limited(bytes,[1,2],{});
  await limited(bytes,[3],{});
  await limited(bytes,[2],{});
  const restored=await limited(bytes,[1],{});
  assert.deepEqual(requests,[[1,2],[3],[1]]);
  assert.deepEqual(restored,probe);
});
