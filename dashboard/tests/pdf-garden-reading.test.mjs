import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import { PDFDocument } from '@cantoo/pdf-lib';
import { gardenPdfReference, gardenPdfPageReadings, readGardenPdfPages } from '../src/lib/pdf-garden-reading.ts';
import { readPdfAttachment } from '../src/lib/pdf-attachment-reader.ts';

test('PDF source references stay same-origin and reject escaped paths', () => {
  const request = new Request('http://localhost/api/chat-attachments/documents', {headers:{referer:'http://localhost/gardens/circuits/pdf/circuits'}});
  assert.deepEqual(gardenPdfReference(request), {clusterSlug:'circuits',documentSlug:'circuits'});
  assert.deepEqual(gardenPdfReference(request, '/api/documents/circuits/source-pdf?clusterSlug=circuits'), {clusterSlug:'circuits',documentSlug:'circuits'});
  for (const url of ['https://elsewhere/gardens/circuits/pdf/circuits','/api/documents/%252e%252e/source-pdf?clusterSlug=circuits','/api/documents/circuits/source-pdf?clusterSlug=..','/gardens/a%2fb/pdf/circuits']) assert.equal(gardenPdfReference(request,url),null);
  const desktop = new Request('http://localhost:56469/api/chat-attachments/documents', {headers:{host:'127.0.0.1:56469',referer:'http://127.0.0.1:56469/gardens/circuits/pdf/circuits'}});
  assert.deepEqual(gardenPdfReference(desktop), {clusterSlug:'circuits',documentSlug:'circuits'});
  assert.equal(gardenPdfReference(desktop,'http://elsewhere/gardens/circuits/pdf/circuits'),null);
  const forwarded = new Request('http://localhost:3000/api/upload', {headers:{'x-forwarded-host':'breadboard.test','x-forwarded-proto':'https'}});
  assert.deepEqual(gardenPdfReference(forwarded,'https://breadboard.test/gardens/circuits/pdf/circuits'), {clusterSlug:'circuits',documentSlug:'circuits'});
});

test('saved page OCR excludes generated summaries and ignores headings inside code fences', () => {
  assert.deepEqual(gardenPdfPageReadings('---\ntitle: scan\n---\n## Summary\nNot source OCR.\n## Page 1\nVoltage.\n```\n## Page 9\n```\n## Page 2\nCurrent.\n## Concepts\nNot source OCR.'), {1:'Voltage.\n```\n## Page 9\n```',2:'Current.'});
});

test('a Garden scan reuses every saved page without calling OCR, only for matching PDF bytes', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pdf-garden-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const pdf=await PDFDocument.create();for(let n=1;n<=65;n++)pdf.addPage();const bytes=await pdf.save();
  fs.mkdirSync(path.join(root,'circuits/assets'),{recursive:true});fs.mkdirSync(path.join(root,'circuits/sources'));
  fs.writeFileSync(path.join(root,'circuits/assets/original.pdf'),bytes);
  const content='---\nsource_pdf: "/circuits/assets/original.pdf"\n---\n## Summary\nGenerated overview\n'+Array.from({length:65},(_,i)=>`## Page ${i+1}\nSaved handwritten circuit notes ${i+1}.`).join('\n');
  fs.writeFileSync(path.join(root,'circuits/sources/notes.md'),content);
  const input={contentPath:root,clusterSlug:'circuits',documentSlug:'notes',bytes};
  const pages=readGardenPdfPages(input);assert.equal(Object.keys(pages).length,65);assert.match(pages[39],/39/);
  assert.equal(readGardenPdfPages({...input,bytes:new Uint8Array([1,2,3])}),null,'same filename must not reuse unrelated OCR');
  assert.equal(readGardenPdfPages({...input,clusterSlug:'other'}),null);
  const result=await readPdfAttachment(bytes,{pageReadings:pages,transcribe:async()=>assert.fail('Saved Garden OCR must not trigger another OCR job')});
  assert.equal(result.pages,65);assert.deepEqual(result.ocrPages,[]);assert.equal(result.warning,'');
  assert.match(result.text,/\[\[Page 39\]\]\nSaved handwritten circuit notes 39/);
  assert.doesNotMatch(result.text,/Generated overview/);
});
