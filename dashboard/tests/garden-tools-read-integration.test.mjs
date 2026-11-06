import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { applyGardenRevision } from "../src/lib/garden-revision.ts";
import sharp from "sharp";
import { PDFDocument, rgb } from '@cantoo/pdf-lib';

test("authorized Garden tools search, read returned paths, and paginate without the graph pipeline", async (t) => {
  // Exercise the real authoring imports using Next's extensionless TS resolution.
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
    // This round trip verifies authorization, validation and durable writes;
    // derived renderer jobs have their own integration tests and outlive this DB.
    if (specifier === "./quartz-publish.ts" && context.parentURL?.endsWith("/garden-documents.ts")) {
      return { url: "data:text/javascript,export async function publishQuartzAfterMutation() {}", shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      const candidate = new URL(`../src/${specifier.slice(2)}${path.extname(specifier) ? "" : ".ts"}`, import.meta.url);
      if (fs.existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
    }
    if (/^\.{1,2}\//.test(specifier) && !path.extname(specifier) && context.parentURL?.startsWith("file:")) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (fs.existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  } });
  t.after(() => hooks.deregister());
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "garden-tool-roundtrip-"));
  process.env.BREADBOARD_DATA_DIR = root;
  process.env.QUARTZ_CONTENT_PATH = path.join(root, "content");
  process.env.BREADBOARD_EMBEDDINGS = "off";
  const { default: db } = await import("../src/lib/db.ts");
  const { executeGardenTool } = await import("../src/lib/hermes/garden-tools.ts");
  const { issueCapabilityToken } = await import("../src/lib/hermes/capability-token.ts");
  t.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const userId = Number(db.prepare("INSERT INTO users (username,email,password_hash) VALUES (?,?,?)").run("reader", "reader@example.test", "unused").lastInsertRowid);
  db.prepare("INSERT INTO clusters (user_id,name,slug) VALUES (?,?,?)").run(userId, "Course", "course");
  const garden = path.join(root, "content/course");
  fs.mkdirSync(path.join(garden, "sources"), { recursive: true });
  fs.mkdirSync(path.join(garden, "empty-destination"));
  fs.writeFileSync(path.join(garden, "sources/guide.md"), `---\ntitle: "Study guide"\nknowledge_type: "source-document"\nsource_type: "pdf"\nsource_file: "guide.pdf"\ntopics: ${JSON.stringify(Array(500).fill("ignored metadata"))}\n---\n# Assessment\nAttendance is compulsory for four MAC laboratory exercises.\n`);
  const rawToken = issueCapabilityToken({ userId, gardenId: "course", surface: "garden_chat", hermesSessionId: "read-test", allowedTools: ["garden_search", "garden_get_page", "garden_list_files", "garden_get_source_figure"] });
  const search = await executeGardenTool({ rawToken, tool: "garden_search", args: { query: "compulsory MAC laboratory" } });
  assert.equal(search.ok, true, JSON.stringify(search));
  assert.equal(search.data.chunks[0].relPath, "sources/guide.md");
  const read = await executeGardenTool({ rawToken, tool: "garden_get_page", args: { slug: `course/${search.data.chunks[0].pageSlug}`, query: "attendance" } });
  assert.equal(read.ok, true);
  assert.match(read.data.content, /Attendance is compulsory/);
  assert.doesNotMatch(read.data.content, /ignored metadata/);
  assert.equal(read.data.nextOffset, null);
  const missing = await executeGardenTool({ rawToken, tool: "garden_get_page", args: { slug: "guide-old" } });
  assert.equal(missing.ok, false);
  assert.equal(missing.data.availableMatches[0].relPath, "sources/guide.md");
  const list = await executeGardenTool({ rawToken, tool: "garden_list_files", args: {} });
  assert.equal(list.ok, true);
  assert.ok(list.data.folders.some((folder) => folder.folder === "empty-destination" && folder.noteCount === 0));
  const denied = await executeGardenTool({ rawToken, tool: "garden_get_page", args: { gardenId: "private", slug: "guide" } });
  assert.equal(denied.ok, false);

  const mathBody = 'a'.repeat(11999) + '𝑉' + ' and current';
  fs.writeFileSync(path.join(garden, 'sources/math.md'), mathBody);
  let mathOffset = 0, reconstructed = '';
  do {
    const chunk = await executeGardenTool({ rawToken, tool: 'garden_get_page', args: { slug:'sources/math.md', offset:mathOffset, limit:12000 } });
    assert.equal(chunk.ok,true);
    assert.doesNotThrow(() => encodeURIComponent(chunk.data.content), 'Read results must be valid UTF-8 for the runtime event stream');
    reconstructed += chunk.data.content;
    mathOffset = chunk.data.nextOffset;
  } while (mathOffset !== null);
  assert.equal(reconstructed,mathBody);

  fs.mkdirSync(path.join(garden, "assets"));
  fs.writeFileSync(path.join(garden, "assets/diagram.png"), "image-bytes");
  fs.appendFileSync(path.join(garden, "sources/guide.md"), "\n![Diagram](/course/assets/diagram.png)\n");
  const figures = await executeGardenTool({ rawToken, tool: "garden_get_source_figure", args: { slug: "course/sources/guide.md" } });
  assert.equal(figures.ok, true, JSON.stringify(figures));
  assert.equal(figures.data.figures[0].markdown, "![Diagram](</course/assets/diagram.png>)");
  const deniedFigure = await executeGardenTool({ rawToken, tool: "garden_get_source_figure", args: { gardenId: "private", slug: "guide" } });
  assert.equal(deniedFigure.ok, false);

  // The real tool boundary returns exact pixels without scheduling a teaching review.
  const sessionId=Number(db.prepare("INSERT INTO hermes_runtime_sessions (user_id,garden_id,surface,agent_name,workspace_key) VALUES (?,?,'garden_chat','fixture','fixture')")
    .run(userId,'course').lastInsertRowid);
  const {beginRuntimeRun,finishRuntimeRun,getRuntimeRun,parseRuntimeRunDispatch}=await import('../src/lib/hermes/run-store.ts');
  const run=beginRuntimeRun({runtimeSessionId:sessionId,instruction:'Explain this source diagram',dispatch:{}});
  const imageToken=issueCapabilityToken({userId,gardenId:'course',breadboardSessionId:String(sessionId),surface:'garden_chat',hermesSessionId:'read-test',allowedTools:['garden_get_source_figure']});
  await sharp({create:{width:80,height:40,channels:3,background:'blue'}}).png().toFile(path.join(garden,'assets/diagram.png'));
  const imageArgs={slug:'course/sources/guide.md',imagePath:'/course/assets/diagram.png',crop:{x:0.5,y:0,width:0.5,height:1}};
  const inspected=await executeGardenTool({rawToken:imageToken,tool:'garden_get_source_figure',args:imageArgs});
  assert.equal(inspected.ok,true,JSON.stringify(inspected));
  const inspectedPixels=Buffer.from(inspected.data.screenshot.dataUrl.split(',')[1],'base64');
  assert.equal((await sharp(inspectedPixels).metadata()).width,40);
  assert.ok((await sharp(inspectedPixels).stats()).channels[2].mean>240);
  assert.equal(parseRuntimeRunDispatch(getRuntimeRun(run.id)).teachingEvidence,undefined);
  const pdf=await PDFDocument.create();
  pdf.addPage([200,100]).drawRectangle({x:0,y:0,width:200,height:100,color:rgb(0,0,1)});
  fs.writeFileSync(path.join(garden,'assets/guide.pdf'),await pdf.save());
  const guidePath=path.join(garden,'sources/guide.md');
  fs.writeFileSync(guidePath,fs.readFileSync(guidePath,'utf8').replace('source_file: "guide.pdf"','source_file: "guide.pdf"\nsource_pdf: "/course/assets/guide.pdf"'));
  const pdfArgs={slug:'course/sources/guide.md',pdfPage:1};
  for(const args of [{pdfPage:1},{...pdfArgs,scope:'all'},{...pdfArgs,gardenId:'private'}]) {
    assert.equal((await executeGardenTool({rawToken:imageToken,tool:'garden_get_source_figure',args})).ok,false);
  }
  const pdfInspection=await executeGardenTool({rawToken:imageToken,tool:'garden_get_source_figure',args:pdfArgs});
  assert.equal(pdfInspection.ok,true,JSON.stringify(pdfInspection));
  const pdfPixels=Buffer.from(pdfInspection.data.screenshot.dataUrl.split(',')[1],'base64');
  assert.ok((await sharp(pdfPixels).stats()).channels[2].mean>240);
  assert.equal(parseRuntimeRunDispatch(getRuntimeRun(run.id)).teachingEvidence,undefined);
  finishRuntimeRun(run.id,'cancelled');

  // Old dispatch metadata cannot re-enable review; saves keep their exact text.
  const saveRun=beginRuntimeRun({runtimeSessionId:sessionId,instruction:'Write a full lesson',
    dispatch:{teachingPreparation:{plan:{applicable:true}},model:'selected-model'}});
  const activeToken=issueCapabilityToken({userId,gardenId:'course',breadboardSessionId:String(sessionId),
    surface:'garden_chat',hermesSessionId:'save-test',allowedTools:['garden_save_note','garden_propose_page_revision']});
  const noModel=t.mock.method(globalThis,'fetch',async()=>{throw new Error('Unexpected model call during a save');});
  const authored='This is the exact lesson text supplied to the save tool.';
  const unreviewedSave=await executeGardenTool({rawToken:activeToken,tool:'garden_save_note',
    args:{title:'Unreviewed lesson',content:authored,folder:'notes'}});
  assert.equal(unreviewedSave.ok,true,JSON.stringify(unreviewedSave));
  const savedFiles=fs.readdirSync(path.join(garden,'notes'));
  assert.ok(savedFiles.some(file=>fs.readFileSync(path.join(garden,'notes',file),'utf8').includes(authored)));
  const directProposal=await executeGardenTool({rawToken:activeToken,tool:'garden_propose_page_revision',
    args:{pageSlug:'sources/guide',rationale:'Clarify',originalText:'Attendance is compulsory for four MAC laboratory exercises.',patchOrReplacement:authored}});
  assert.equal(directProposal.ok,true,JSON.stringify(directProposal));
  assert.equal(JSON.parse(db.prepare('SELECT payload FROM hermes_proposals WHERE id=?').get(directProposal.proposalId).payload).patchOrReplacement,authored);
  assert.equal(noModel.mock.callCount(),0,'No reviewer or repair model runs on save or proposal');
  finishRuntimeRun(saveRun.id,'cancelled');
  const stoppedSave=await executeGardenTool({rawToken:activeToken,tool:'garden_save_note',
    args:{title:'Cancelled save',content:authored,folder:'notes'}});
  assert.equal(stoppedSave.ok,false);
  assert.match(stoppedSave.error,/stopped/);
  noModel.mock.restore();

  const revisionToken = issueCapabilityToken({ userId, gardenId: "course", surface: "garden_chat", hermesSessionId: "revision-test", allowedTools: ["garden_propose_page_revision"] });
  const propose = args => executeGardenTool({ rawToken: revisionToken, tool: "garden_propose_page_revision", args: { pageSlug: 'sources/guide', rationale: 'Clarify attendance.', ...args } });
  const originalText = 'Attendance is compulsory for four MAC laboratory exercises.';
  const patchOrReplacement = 'Attendance is compulsory for all four MAC laboratory exercises.';
  const original = fs.readFileSync(path.join(garden, 'sources/guide.md'), 'utf8');
  const pendingCount = () => db.prepare('SELECT COUNT(*) AS n FROM hermes_proposals').get().n;
  const count = pendingCount();
  for (const args of [
    { patchOrReplacement: 'Replace the opening paragraph with:\n\n' + patchOrReplacement },
    { originalText: 'A passage that is no longer here', patchOrReplacement },
    { originalText: '', patchOrReplacement },
    { patchOrReplacement: '@@\n-compulsory for four MAC laboratory exercises.\n+compulsory for all four MAC laboratory exercises.' },
    { originalText, patchOrReplacement: 'x'.repeat(100001) },
  ]) {
    const invalid = await propose(args);
    assert.equal(invalid.ok, false, JSON.stringify(invalid));
    assert.equal(pendingCount(), count, 'Invalid edits never create an applicable proposal');
    assert.equal(fs.readFileSync(path.join(garden, 'sources/guide.md'), 'utf8'), original);
  }
  const valid = await propose({ originalText, patchOrReplacement, pageSlug: 'course/sources/guide.md' });
  assert.equal(valid.ok, true, JSON.stringify(valid));
  const stored = db.prepare('SELECT payload, page_slug FROM hermes_proposals WHERE id=?').get(valid.proposalId);
  assert.equal(stored.page_slug, 'sources/guide');
  const payload = JSON.parse(stored.payload);
  assert.equal(payload.originalText, originalText);
  assert.equal(payload.patchOrReplacement, patchOrReplacement);
  assert.equal(applyGardenRevision(original, payload.patchOrReplacement, payload.originalText), original.replace(originalText, patchOrReplacement));
  assert.equal(fs.readFileSync(path.join(garden, 'sources/guide.md'), 'utf8'), original, 'Proposing never writes');

  // Numbered diffs count frontmatter lines, so proposal validation must use
  // canonical Markdown rather than the trimmed reader excerpt.
  const line = original.split('\n').indexOf(originalText) + 1;
  const diff = await propose({ patchOrReplacement: `@@ -${line} +${line} @@\n-${originalText}\n+${patchOrReplacement}` });
  assert.equal(diff.ok, true, JSON.stringify(diff));

  fs.appendFileSync(path.join(garden, 'sources/guide.md'), originalText);
  const ambiguous = await propose({ originalText, patchOrReplacement });
  assert.equal(ambiguous.ok, false);
  assert.match(ambiguous.error, /exactly once/);

  const saveToken = issueCapabilityToken({ userId, gardenId: "course", surface: "garden_chat", hermesSessionId: "depth-test", allowedTools: ["garden_save_note"] });
  const before = fs.readdirSync(garden, { recursive: true });
  const short = await executeGardenTool({ rawToken: saveToken, tool: "garden_save_note", args: {
    title: "Incomplete lesson", content: "A short explanation.", folder: "notes", minimumProseWords: 1400,
  } });
  assert.equal(short.ok, false);
  assert.match(short.error, /3 explanatory prose words/);
  assert.deepEqual(fs.readdirSync(garden, { recursive: true }), before, "A rejected lesson must not create a note or folder");
  const saved = await executeGardenTool({ rawToken: saveToken, tool: "garden_save_note", args: {
    title: "Validated lesson", content: "A complete explanation.", folder: "notes", minimumProseWords: 3,
  } });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(saved.data.proseWords, 3);
  assert.equal(saved.data.minimumProseWords, 3);
  assert.match(fs.readFileSync(path.join(garden, saved.data.relPath), "utf8"), /A complete explanation\./);

  // An approval in chat reaches the same real writer as the review button.
  fs.writeFileSync(path.join(garden, 'sources/guide.md'), original);
  const conversationId = Number(db.prepare("INSERT INTO conversations(public_id,user_id,title,surface) VALUES ('conv-proposal-approval',?,'Review','garden_chat')").run(userId).lastInsertRowid);
  const messageId = Number(db.prepare("INSERT INTO conversation_messages(conversation_id,client_message_id,role,surface,content,status,order_index) VALUES (?,'proposed','assistant','garden_chat','Review this revision','complete',0)").run(conversationId).lastInsertRowid);
  db.prepare("UPDATE hermes_proposals SET assistant_message_id=? WHERE id=?").run(messageId, valid.proposalId);
  const approvalToken = issueCapabilityToken({ userId, conversationId, gardenId: "course", surface: "garden_chat", hermesSessionId: "approve-test", allowedTools: ["garden_get_recent_events", "garden_decide_proposals"] });
  const events = await executeGardenTool({ rawToken: approvalToken, tool: "garden_get_recent_events", args: {} });
  assert.ok(events.data.events.some(event => event.id === valid.proposalId));
  const approval = await executeGardenTool({ rawToken: approvalToken, tool: "garden_decide_proposals", args: { proposalIds: [valid.proposalId], decision: "apply" } });
  assert.equal(approval.ok, true, JSON.stringify(approval));
  assert.equal(approval.data.complete, true, JSON.stringify(approval));
  assert.equal(fs.readFileSync(path.join(garden, 'sources/guide.md'), 'utf8'), original.replace(originalText, patchOrReplacement));
  assert.equal(db.prepare("SELECT status FROM hermes_proposals WHERE id=?").get(valid.proposalId).status, "applied");
});
