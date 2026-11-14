import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import Database from "better-sqlite3";

async function load(file) {
  const result = await build({ entryPoints: [path.resolve(import.meta.dirname, "../src/lib/storage", file)], bundle: true,
    platform: "node", format: "cjs", packages: "external", write: false });
  const module = { exports: {} };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  return module.exports;
}
const chat = await load("chat-payloads.ts"), codec = await load("codec.ts"), files = await load("filesystem.ts"), store = await load("store.ts");
const pdf=await load("pdf-revisions.ts"), immutable=await load("immutable-files.ts");
const attachmentReferences=await load("attachment-references.ts");

function database() {
  const db = new Database(":memory:"); db.pragma("foreign_keys=ON");
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1),(2);
    CREATE TABLE conversations(id INTEGER PRIMARY KEY,updated_at TEXT);
    CREATE TABLE conversation_messages(id INTEGER PRIMARY KEY,conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
      metadata TEXT,sources TEXT,content TEXT,status TEXT,updated_at TEXT,order_index INTEGER,token_usage TEXT);
    INSERT INTO conversations VALUES(1,'2025-01-01'),(2,'2025-01-01');`);
  chat.ensureChatPayloadSchema(db); attachmentReferences.indexAttachmentReferences(db,()=>false); return db;
}

function indexAttachments(db) {
  for(let batch=0;batch<100 && !attachmentReferences.attachmentIndexComplete(db);batch++)
    attachmentReferences.indexAttachmentReferences(db,()=>false);
  assert.equal(attachmentReferences.attachmentIndexComplete(db),true);
}

test("cold payloads preserve exact bytes, hot SQL fields, edits, sources and cascades", () => {
  const db = database();
  try {
    const metadata = JSON.stringify({ model: "model-a", externalAgentOutcome: "completed", toolCalls: [{ result: "exact result ".repeat(10000) }], attachments: [{ id: "fil_keep" }] }, null, 2);
    const sources = JSON.stringify([{ source: "citation ".repeat(8000) }]);
    db.prepare("INSERT INTO conversation_messages VALUES(1,1,?,?,'message','complete','2025-01-01',0,'{}')").run(metadata, sources);
    assert.ok(chat.compressMessageField(db,1,"metadata") > 0);
    assert.ok(chat.compressMessageField(db,1,"sources") > 0);
    db.prepare("UPDATE conversation_messages SET metadata=metadata WHERE id=1").run();
    assert.equal(db.prepare("SELECT count(*) n FROM storage_message_payloads").get().n,2);
    assert.equal(db.prepare("SELECT json_extract(metadata,'$.model') model FROM conversation_messages").get().model, "model-a");
    assert.deepEqual(db.prepare("SELECT metadata,sources FROM conversation_message_reads WHERE id=1").get(), { metadata, sources });
    assert.equal(db.prepare("SELECT content FROM conversation_message_reads WHERE id=1").get().content, "message");
    db.prepare("UPDATE conversation_messages SET metadata=json_patch((SELECT metadata FROM conversation_message_reads WHERE id=1),?) WHERE id=1").run('{"model":"model-b"}');
    const edited = db.prepare("SELECT metadata,sources FROM conversation_message_reads WHERE id=1").get();
    assert.equal(JSON.parse(edited.metadata).toolCalls[0].result, JSON.parse(metadata).toolCalls[0].result);
    assert.equal(JSON.parse(edited.metadata).model,"model-b"); assert.equal(edited.sources,sources);
    db.prepare("UPDATE conversation_messages SET sources=NULL WHERE id=1").run();
    assert.equal(db.prepare("SELECT sources FROM conversation_message_reads WHERE id=1").get().sources,null);
    chat.compressMessageField(db,1,"metadata");
    const externalAgents=[{runId:"run-retained",carried:true}];
    db.prepare("INSERT INTO conversation_messages VALUES(2,1,?,NULL,'older garden response','complete','2025-01-01',1,NULL)")
      .run(JSON.stringify({toolCalls:{verification:{externalAgents},rawEvents:"exact details ".repeat(5000)}}));
    assert.ok(chat.compressMessageField(db,2,"metadata")>0);
    assert.deepEqual(JSON.parse(db.prepare("SELECT json_extract(metadata,'$.toolCalls.verification.externalAgents') agents FROM conversation_messages WHERE id=2").get().agents),externalAgents);
    db.prepare("DELETE FROM conversations WHERE id=1").run();
    assert.equal(db.prepare("SELECT count(*) n FROM storage_message_payloads").get().n,0);
  } finally { db.close(); }
});

test("recent reads and pending work exclude a conversation from compression", () => {
  const db = database();
  try {
    const metadata=JSON.stringify({toolCalls:[{result:"repeat ".repeat(9000)}]});
    db.prepare("INSERT INTO conversation_messages VALUES(1,1,?,NULL,'one','complete','2025-01-01',0,NULL)").run(metadata);
    db.prepare("INSERT INTO conversation_messages VALUES(2,2,?,NULL,'two','pending','2025-01-01',0,NULL)").run(metadata);
    db.prepare("SELECT metadata FROM conversation_message_reads WHERE id=1").get();
    chat.compressColdMessages(db,{maxMessages:16});
    assert.equal(db.prepare("SELECT count(*) n FROM storage_message_payloads").get().n,0);
  } finally { db.close(); }
});

test("asynchronous compression yields and refuses an edit or read made between slices", async () => {
  const db=database();
  try {
    const metadata=JSON.stringify({toolResults:["exact result ".repeat(600000)]});
    db.prepare("INSERT INTO conversation_messages VALUES(1,1,?,NULL,'search stays plain','complete','2025-01-01',0,NULL)").run(metadata);
    const worker=new chat.ColdPayloadWorker();
    let deadline=Date.now()+15;
    assert.equal((await worker.step(db,0,()=>Date.now()>deadline)).bytesSaved,0);
    db.prepare("UPDATE conversation_messages SET metadata=? WHERE id=1").run('{"edited":"unique content"}');
    for(let i=0;i<50;i++) {deadline=Date.now()+50;const result=await worker.step(db,0,()=>Date.now()>deadline);if(result.cursor===1)break;}
    assert.equal(db.prepare("SELECT metadata FROM conversation_message_reads WHERE id=1").get().metadata,'{"edited":"unique content"}');
    assert.equal(db.prepare("SELECT count(*) n FROM storage_message_payloads").get().n,0);
  } finally {db.close();}
});

test("SQLite disk-full failure rolls back replacement and retains the sole complete payload",()=>{
  const db=database();
  try {
    const metadata=JSON.stringify({toolResults:["original ".repeat(50000)]});
    db.prepare("INSERT INTO conversation_messages VALUES(1,1,?,NULL,'kept','complete','2025-01-01',0,NULL)").run(metadata);
    db.exec("CREATE TABLE forced_space(data BLOB)");
    db.pragma(`max_page_count=${db.pragma('page_count',{simple:true})}`);
    db.exec("CREATE TRIGGER storage_full BEFORE INSERT ON storage_message_payloads BEGIN INSERT INTO forced_space VALUES(zeroblob(2097152)); END");
    assert.throws(()=>chat.compressMessageField(db,1,"metadata"),error=>error.code==='SQLITE_FULL');
    assert.equal(db.prepare("SELECT metadata FROM conversation_message_reads WHERE id=1").get().metadata,metadata);
    assert.equal(db.prepare("SELECT count(*) n FROM storage_message_payloads").get().n,0);
  } finally {db.close();}
});

test("cleanup leases, interrupted quarantine and directory junctions preserve content",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"bb-storage-leases-")),outside=fs.mkdtempSync(path.join(os.tmpdir(),"bb-storage-outside-")),db=database();
  try {
    const old=Date.now()-8*86400000;
    fs.writeFileSync(path.join(root,"leased"),"still in use");
    await files.releaseDisposableFile(db,root,"leased","test","temporary",old);
    assert.equal(files.leaseDisposableFile(db,"leased",Date.now()+60000),true);
    assert.equal((await files.cleanDisposableFiles(db,root)).filesRemoved,0);
    fs.mkdirSync(path.join(root,"storage","quarantine"),{recursive:true});
    fs.writeFileSync(path.join(root,"released"),"released");
    await files.releaseDisposableFile(db,root,"released","test","temporary",old);
    const quarantine=path.join("storage","quarantine","interrupted");
    db.prepare("UPDATE storage_disposable_files SET cleanup_path=? WHERE relative_path='released'").run(quarantine);
    fs.renameSync(path.join(root,"released"),path.join(root,quarantine));
    assert.equal((await files.cleanDisposableFiles(db,root)).filesRemoved,1);
    fs.writeFileSync(path.join(outside,"user.txt"),"unique");
    fs.symlinkSync(outside,path.join(root,"redirect"),process.platform==='win32'?'junction':'dir');
    await assert.rejects(files.releaseDisposableFile(db,root,path.join("redirect","user.txt"),"test","temporary",old));
    assert.equal(fs.readFileSync(path.join(outside,"user.txt"),"utf8"),"unique");
  } finally {
    db.close();
    for(const target of [root,outside]) {assert.ok(path.resolve(target).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(target,{recursive:true,force:true});}
  }
});

test("pre-existing writable hardlinks never enter the immutable object store",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"bb-storage-writable-")),db=database();
  try {
    const upload=path.join("chat-files","u1",`fil_${"a".repeat(32)}.txt`);
    fs.mkdirSync(path.dirname(path.join(root,upload)),{recursive:true});
    fs.writeFileSync(path.join(root,upload),"mutable work ".repeat(4000));
    fs.linkSync(path.join(root,upload),path.join(root,"workspace.txt"));
    assert.equal(await immutable.deduplicateImmutableFile(db,root,upload),0);
    assert.equal(db.prepare("SELECT count(*) n FROM storage_file_objects").get().n,0);
  } finally {db.close();assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});}
});

test("attachment ownership covers old messages and repairs an interrupted logical-file deletion",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"bb-storage-reference-")),db=database();
  try {
    const blobId=`fil_${"b".repeat(32)}`,relative=path.join("chat-files","u1",`${blobId}.txt`),content=Buffer.from("retained exact original ".repeat(4000));
    db.prepare("INSERT INTO conversation_messages VALUES(1,1,?,NULL,'old attachment','complete','2025-01-01',0,NULL)").run(JSON.stringify({attachments:[{type:"file",blobId,name:"kept.txt"}]}));
    const insert=db.prepare("INSERT INTO conversation_messages VALUES(?,2,'{}',NULL,'newer','complete','2025-01-01',?,NULL)");
    db.transaction(()=>{for(let i=2;i<2010;i++)insert.run(i,i);})();
    indexAttachments(db);
    assert.equal(attachmentReferences.attachmentReferenced(db,blobId),true);
    fs.mkdirSync(path.dirname(path.join(root,relative)),{recursive:true});fs.writeFileSync(path.join(root,relative),content);
    await immutable.deduplicateImmutableFile(db,root,relative);
    fs.unlinkSync(path.join(root,relative)); // crash before the database owner was deleted
    assert.equal(await immutable.collectImmutableFiles(db,root),0);
    assert.deepEqual(fs.readFileSync(path.join(root,relative)),content);
    db.prepare("DELETE FROM conversations WHERE id=1").run();
    assert.equal(attachmentReferences.attachmentReferenced(db,blobId),false);
    assert.equal(await immutable.collectImmutableFiles(db,root),0);
    assert.ok(await immutable.collectImmutableFiles(db,root,Date.now()+8*86400000)>0);
  } finally {db.close();assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});}
});

test("streaming coalesces attachment indexing and protects edits until the idle index catches up",()=>{
  const db=database();
  try {
    db.prepare("INSERT INTO conversation_messages VALUES(1,1,?,NULL,'attachment','complete','2025-01-01',0,NULL)")
      .run(JSON.stringify({attachments:[{blobId:"fil_old"}]}));
    indexAttachments(db);
    assert.equal(attachmentReferences.attachmentReferenced(db,"fil_old"),true);
    assert.equal(attachmentReferences.attachmentReferenced(db,"fil_new"),false);
    const update=db.prepare("UPDATE conversation_messages SET metadata=? WHERE id=1");
    for(let sequence=0;sequence<200;sequence++)update.run(JSON.stringify({attachments:[{blobId:"fil_new"}],sequence}));
    assert.equal(db.prepare("SELECT count(*) n FROM storage_attachment_dirty").get().n,1);
    assert.equal(attachmentReferences.attachmentIndexComplete(db),false);
    assert.equal(attachmentReferences.attachmentReferenced(db,"fil_old"),true);
    assert.equal(attachmentReferences.attachmentReferenced(db,"fil_new"),true);
    indexAttachments(db);
    assert.equal(attachmentReferences.attachmentReferenced(db,"fil_old"),false);
    assert.equal(attachmentReferences.attachmentReferenced(db,"fil_new"),true);
    update.run('{}');db.prepare("DELETE FROM conversation_messages WHERE id=1").run();
    assert.equal(attachmentReferences.attachmentIndexComplete(db),true);
    assert.equal(attachmentReferences.attachmentReferenced(db,"fil_new"),false);
  } finally {db.close();}
});

test("shared-object collection reaches released references beyond the first bounded page",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"bb-storage-reference-pages-")),db=database();
  try {
    const content=Buffer.from("same immutable bytes ".repeat(1000)),relatives=[];
    fs.mkdirSync(path.join(root,"chat-files","u1"),{recursive:true});
    for(let id=1;id<=130;id++) {
      const blobId=`fil_${id.toString(16).padStart(32,"0")}`,relative=path.join("chat-files","u1",`${blobId}.txt`);
      relatives.push(relative);fs.writeFileSync(path.join(root,relative),content);
      db.prepare("INSERT INTO conversation_messages VALUES(?,1,?,NULL,'attached','complete','2025-01-01',?,NULL)")
        .run(id,JSON.stringify({attachments:[{blobId}]}),id);
      indexAttachments(db);
      await immutable.deduplicateImmutableFile(db,root,relative);
    }
    db.prepare("DELETE FROM conversation_messages WHERE id=130").run();
    await immutable.collectImmutableFiles(db,root);
    assert.ok(fs.existsSync(path.join(root,relatives[129])),"the first slice stays bounded");
    await immutable.collectImmutableFiles(db,root);
    assert.equal(fs.existsSync(path.join(root,relatives[129])),false,"the next slice reaches later references");
    for(let i=0;i<3;i++)await immutable.collectImmutableFiles(db,root,Date.now()+8*86400000);
    assert.equal(db.prepare("SELECT count(*) n FROM storage_file_references").get().n,129);
    assert.deepEqual(fs.readFileSync(path.join(root,relatives[0])),content);
  } finally {db.close();assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});}
});

test("chunk checksums reject truncation and corruption; cache stays bounded", () => {
  const raw=Buffer.from("exact bytes \0 unicode λ\n".repeat(250000)), packed=codec.packPayload(raw), hash=codec.payloadHash(raw);
  assert.deepEqual(codec.unpackPayload(packed,raw.length,hash),raw);
  assert.throws(()=>codec.unpackPayload(packed.subarray(0,packed.length-1),raw.length,hash));
  assert.throws(()=>codec.unpackPayload(packed,raw.length,"0".repeat(64)));
  const cache=new codec.PayloadCache(32); cache.put("one","a".repeat(12)); cache.put("two","b".repeat(12));
  assert.equal(cache.get("one"),undefined); assert.ok(cache.byteLength<=32);
});

test("storage policy is installation-owner only", () => {
  const db=database();
  try { store.assertStorageOwner(db,1); assert.throws(()=>store.assertStorageOwner(db,2),{status:403}); }
  finally {db.close();}
});

test("PDF revisions share exact bytes and deleting one reference preserves the others",()=>{
  const db=database();
  try {
    db.exec("CREATE TABLE pdf_document_edit_history(id INTEGER PRIMARY KEY,pdf_data BLOB NOT NULL,byte_length INTEGER NOT NULL)");
    const bytes=Buffer.from("%PDF exact revision bytes");
    const insert=db.prepare("INSERT INTO pdf_document_edit_history VALUES(?,?,?)");insert.run(1,bytes,bytes.length);insert.run(2,bytes,bytes.length);
    pdf.ensurePdfObjectSchema(db);pdf.deduplicatePdfRevision(db,1);assert.equal(pdf.deduplicatePdfRevision(db,2),bytes.length);
    assert.equal(db.prepare("SELECT count(*) n FROM storage_pdf_objects").get().n,1);
    assert.deepEqual(db.prepare("SELECT pdf_data FROM pdf_document_history_reads WHERE id=1").get().pdf_data,bytes);
    db.prepare("DELETE FROM pdf_document_edit_history WHERE id=1").run();
    assert.deepEqual(db.prepare("SELECT pdf_data FROM pdf_document_history_reads WHERE id=2").get().pdf_data,bytes);
    db.prepare("DELETE FROM pdf_document_edit_history WHERE id=2").run();
    assert.equal(db.prepare("SELECT count(*) n FROM storage_pdf_objects").get().n,0);
  } finally {db.close();}
});

test("immutable copies deduplicate, atomic edits are independent, and collection waits for the last link",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"bb-storage-objects-")),db=database();
  try {
    const one=path.join("chat-files","u1",`fil_${"1".repeat(32)}.txt`),two=path.join("chat-files","u2",`fil_${"2".repeat(32)}.txt`);
    const content=Buffer.from("immutable exact bytes ".repeat(4000));
    for(const file of [one,two]){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),content);}
    await immutable.deduplicateImmutableFile(db,root,one);assert.ok(await immutable.deduplicateImmutableFile(db,root,two)>0);
    assert.equal(fs.statSync(path.join(root,one),{bigint:true}).ino,fs.statSync(path.join(root,two),{bigint:true}).ino);
    const replacement=path.join(root,"replacement");fs.writeFileSync(replacement,"new version");fs.renameSync(replacement,path.join(root,one));
    assert.deepEqual(fs.readFileSync(path.join(root,two)),content);
    assert.equal(await immutable.collectImmutableFiles(db,root),0);
    fs.unlinkSync(path.join(root,two));assert.equal(await immutable.collectImmutableFiles(db,root),0);
    assert.ok(await immutable.collectImmutableFiles(db,root,Date.now()+8*86400000)>0);
    assert.equal(fs.readFileSync(path.join(root,one),"utf8"),"new version");
    await assert.rejects(immutable.deduplicateImmutableFile(db,root,"workspace/user.txt"));
  } finally {db.close();assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});}
});

test("accounting deduplicates hardlinks and cleanup retains replaced, linked and unowned files", async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"bb-storage-test-")), db=database();
  try {
    fs.mkdirSync(path.join(root,"a")); fs.mkdirSync(path.join(root,"b"));
    fs.writeFileSync(path.join(root,"a","file"),Buffer.alloc(8192,1)); fs.linkSync(path.join(root,"a","file"),path.join(root,"b","link"));
    const scanner=new files.StorageScanner(root);
    while(!scanner.result.complete) await scanner.step(()=>false,1);
    const allocated=Number(fs.statSync(path.join(root,"a","file"),{bigint:true}).blocks)*512;
    assert.equal(scanner.result.allocatedBytes,allocated); assert.equal(scanner.result.hardlinkBytesAvoided,allocated);
    assert.equal(Object.values(scanner.result.categories).reduce((a,b)=>a+b,0),allocated);
    const old=Date.now()-8*86400000;
    await files.releaseDisposableFile(db,root,path.join("b","link"),"test","temporary",old);
    const cleaned=await files.cleanDisposableFiles(db,root);
    assert.equal(cleaned.filesRemoved,1); assert.equal(cleaned.bytesReleased,0); assert.ok(fs.existsSync(path.join(root,"a","file")));
    fs.writeFileSync(path.join(root,"replace"),"old"); await files.releaseDisposableFile(db,root,"replace","test","temporary",old);
    fs.unlinkSync(path.join(root,"replace")); fs.writeFileSync(path.join(root,"replace"),"unique new work");
    assert.equal((await files.cleanDisposableFiles(db,root)).filesRemoved,0);
    assert.equal(fs.readFileSync(path.join(root,"replace"),"utf8"),"unique new work");
    await assert.rejects(files.managedPath(root,"../outside"));
  } finally {
    db.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));
    fs.rmSync(root,{recursive:true,force:true});
  }
});
