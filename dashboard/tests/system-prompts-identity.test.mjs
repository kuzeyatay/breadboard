import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test, {after} from 'node:test';

const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'breadboard-identity-prompts-'));
process.env.BREADBOARD_DATA_DIR=temporary;
const {default:db}=await import('../src/lib/db.ts');
const {listSystemPrompts,updateSystemPrompt,withSystemPromptContext}=await import('../src/lib/system-prompts/service.ts');
const {withCouncil}=await import('../src/lib/system-prompts/council.ts');
const {BREAD_ASSISTANT_IDENTITY,breadSystemPrompt}=await import('../src/lib/assistant-identity.ts');
for(const id of [891,892])db.prepare("INSERT INTO users(id,username,email,password_hash) VALUES(?,?,?,'test')").run(id,'identity-'+id,`identity-${id}@test.local`);
after(()=>{db.close();fs.rmSync(temporary,{recursive:true,force:true});});
function edit(content,userId=891){const current=listSystemPrompts(userId).find(p=>p.id==='council-identity');return updateSystemPrompt(userId,{id:current.id,revision:current.revision,content});}
const request=()=>({model:'test',messages:[{role:'system',content:breadSystemPrompt('Return only JSON.')},{role:'user',content:'Describe the document.'}]});

test('Council identity saves live, replaces an embedded default, isolates accounts and resets',()=>{
  try{
    for(const identity of ['IDENTITY_ONE','IDENTITY_TWO','']){
      edit(identity);
      const input=request();
      const result=withCouncil(input,{taskType:'classification'},891);
      assert.equal(result.messages[0].content,identity?`${identity}\n\nReturn only JSON.`:'Return only JSON.');
      assert.equal(input.messages[0].content,breadSystemPrompt('Return only JSON.'));
      assert.equal(withCouncil(request(),{taskType:'classification'},892).messages[0].content,input.messages[0].content);
      assert.ok(!Object.hasOwn(result,'userId'));
      assert.ok(!Object.hasOwn(result,'identity'));
      const responses=withCouncil({instructions:'Answer the question.'},{taskType:'page_assistant_answer'},891);
      assert.equal(responses.instructions,identity?`${identity}\n\nAnswer the question.`:'Answer the question.');
      const ocr=withCouncil({messages:[{role:'user',content:'Read this page.'}]},{taskType:'ocr'},891);
      assert.equal(ocr.messages[0].content,identity);
    }
  }finally{edit(null);}
  assert.equal(withCouncil(request(),{taskType:'classification'},891).messages[0].content,breadSystemPrompt('Return only JSON.'));
});

test('concurrent feature runs retain their own identity snapshot and the next run sees edits',async()=>{
  edit('RUN_ONE');edit('OTHER_ACCOUNT',892);
  try{
    await withSystemPromptContext(891,async()=>{
      edit('RUN_TWO');
      await Promise.resolve();
      assert.ok(withCouncil(request(),{}).messages[0].content.startsWith('RUN_ONE\n'));
      await withSystemPromptContext(892,async()=>{
        await Promise.resolve();
        assert.ok(withCouncil(request(),{}).messages[0].content.startsWith('OTHER_ACCOUNT\n'));
      });
      assert.ok(withCouncil(request(),{}).messages[0].content.startsWith('RUN_ONE\n'));
    });
    withSystemPromptContext(891,()=>assert.ok(withCouncil(request(),{}).messages[0].content.startsWith('RUN_TWO\n')));
  }finally{edit(null);edit(null,892);}
});

test('Council request fingerprints change when the live identity changes',async()=>{
  const {councilRequestHashV1}=await import('../src/lib/council-request-hash.ts');
  function fingerprint(){return councilRequestHashV1({schemaVersion:1,messages:withCouncil(request(),{},891).messages,taskType:'classification',gardenId:null,pageId:null,sourceContext:null,councilMode:'direct_council',requestedModel:'test',resolvedModel:'test',reasoning:{effort:null,summary:null},temperature:null,maxTokens:null});}
  const original=fingerprint();
  try{edit('CACHE_IDENTITY');assert.notEqual(fingerprint(),original);}finally{edit(null);}
  assert.equal(fingerprint(),original);
});

test('PDF OCR transports its authenticated account to every transcribed page',async()=>{
  const require=createRequire(new URL('../package.json',import.meta.url));
  const {PDFDocument}=require('@cantoo/pdf-lib');
  const {readPdfAttachment}=await import('../src/lib/pdf-attachment-reader.ts');
  const document=await PDFDocument.create();document.addPage();document.addPage();
  const observed=[];
  await readPdfAttachment(await document.save(),{userId:891,transcribe:async(_url,page,_signal,_baseURL,userId)=>{
    observed.push({page,userId});return 'This page explains electrical circuits and voltage.';
  }});
  assert.deepEqual(observed,[{page:1,userId:891},{page:2,userId:891}]);
  assert.match(BREAD_ASSISTANT_IDENTITY,/Breadboard assistant/);
});
