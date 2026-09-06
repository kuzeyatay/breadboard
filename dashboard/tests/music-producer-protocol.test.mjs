import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { taskFromMusicProducerCommand, musicProducerUserMessage } from "../src/lib/music-producer/identity.ts";
import { musicDefaults, musicFlags, musicRequestSchema } from "../src/lib/music-producer/request.ts";
import { capabilitiesFor, providerPayload } from "../src/lib/acestep/capabilities.ts";
import { approvedOrigin, audioUrl, boundedJson, discoverModels, fetchAudio, parseTaskResult, queryMusic, submitMusic, unwrapEnvelope } from "../src/lib/acestep/client.ts";
import { inspectWav, spliceWav } from "../src/lib/music-producer/wav.ts";
import { fakeAceStep, testWav } from "./helpers/fake-acestep.mjs";

const parse = overrides => musicRequestSchema.parse({ brief: "ambient piano without drums", ...overrides });
const signal = () => new AbortController().signal;
test("identity preserves stacked capabilities, defaults and explicit flags", () => {
  assert.equal(taskFromMusicProducerCommand("/agents:music-producer /skills:example Make music"), "/skills:example Make music");
  assert.equal(taskFromMusicProducerCommand("ordinary music question"), null);
  assert.equal(musicProducerUserMessage("Make music"), "/agents:music-producer Make music");
  assert.deepEqual(musicDefaults({}), { duration: 60, vocalMode: "instrumental" });
  assert.equal(parse({ ...musicDefaults({ duration: 90 }), ...musicFlags("--duration 30 --bpm 80") }).duration, 30);
  assert.equal(parse({ ...musicFlags("--duration 30 --bpm 80") }).bpm, 80);
  assert.deepEqual(musicFlags("--source art_abc@2"), { source: { kind: "artifact", artifactId: "art_abc", version: 2 } });
});

test("ChatMock planning keeps context separate and explicit duration, language and literal lyrics override its plan",async t=>{
  const {planMusic}=await import('../src/lib/music-producer/planning.ts');
  const calls=[];
  const server=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;calls.push(JSON.parse(body));res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({brief:'Piano song',duration:120,vocalMode:'vocal',language:'en',lyrics:'Changed lyrics'})}}]}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const task='A Turkish song --duration 30 --language tr\nLyrics:\nBir ses\nGökyüzünde';
  const plan=await planMusic({task,model:'selected-chat-model',reasoningEffort:'medium',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,conversationContext:'Earlier music conversation.',defaults:{duration:90,vocalMode:'instrumental'},explicit:{duration:45},sources:[]},signal());
  assert.equal(plan.duration,30);assert.equal(plan.language,'tr');assert.equal(plan.lyrics,'Bir ses\nGökyüzünde');
  assert.equal(calls.length,1);assert.equal(calls[0].model,'selected-chat-model');assert.match(calls[0].messages[1].content,/Earlier music conversation/);assert.match(calls[0].messages[1].content,/A Turkish song/);
  assert.deepEqual(musicFlags('Song\nLyrics:\n--duration 600\n--not-a-command'),{});
  assert.throws(()=>musicFlags('Song --install'),/Unsupported/);
  const source={kind:'artifact',artifactId:'art_test',version:2},prior=parse({vocalMode:'vocal',lyrics:'Original lyrics from the saved version',language:'tr'});
  const revision=await planMusic({task:'Make this darker',model:'selected-chat-model',reasoningEffort:'medium',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,conversationContext:'Clipped history has no lyrics.',defaults:{duration:60,vocalMode:'instrumental'},explicit:{source,operation:'cover'},sources:[],resolveSourceRequest:value=>{assert.deepEqual(value,source);return prior;}},signal());
  assert.equal(revision.lyrics,prior.lyrics);assert.equal(revision.language,'tr');
  const repaint=await planMusic({task:'Replace 80–95 seconds',model:'selected-chat-model',reasoningEffort:'medium',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,conversationContext:'',defaults:{duration:60,vocalMode:'instrumental'},explicit:{source,operation:'repaint',interval:{start:80,end:95}},sources:[],resolveSourceRequest:()=>prior,resolveSourceDuration:()=>180},signal());
  assert.equal(repaint.duration,180);
});
test("invalid fields, paths, unsupported operations and conditioning bounds fail closed", () => {
  for (const input of [{ duration: 601 }, { bpm: 301 }, { seed: -2 }, { outputFormat: "mp3" }, { command: "python" }, { operation: "extend" }, { vocalMode: "vocal", lyrics: "hello" }, { operation: "repaint", source: { kind: "artifact", artifactId: "a", version: 1 }, interval: { start: 20, end: 10 } }, { source: { kind: "attachment", blobId: "../../secret" } }]) assert.throws(() => parse(input));
  assert.throws(() => capabilitiesFor("custom-unreviewed"));
  assert.throws(() => providerPayload(parse({ guidanceScale: 7 }), "acestep-v15-turbo"));
  assert.throws(() => providerPayload(parse({ inferenceSteps: 30 }), "acestep-v15-turbo"));
  assert.equal(capabilitiesFor("acestep-v15-base").perTaskCancellation, false);
});
test("literal vocal text, language and interval map to the pinned API", () => {
  const request = parse({ operation: "repaint", source: { kind: "artifact", artifactId: "art_test", version: 3 }, vocalMode: "vocal", language: "tr", lyrics: "Gökyüzü\nAynı sözler", interval: { start: 20, end: 35 }, bpm: 80, key: "D minor", timeSignature: "6/8", seed: 12 });
  const payload = providerPayload(request, "acestep-v15-turbo");
  assert.equal(payload.lyrics, request.lyrics); assert.equal(payload.vocal_language, "tr");
  assert.equal(payload.time_signature, "6"); assert.equal(payload.key_scale, "D minor");
  assert.equal(payload.task_type, "repaint"); assert.equal(payload.repainting_start, 20);
  assert.equal(payload.chunk_mask_mode, "explicit"); assert.equal(payload.batch_size, 1);
  assert.equal(payload.use_random_seed, false); assert.equal(payload.seed, 12); assert.equal(payload.thinking, false);
  assert.equal(payload.use_format, false); assert.equal(payload.audio_duration, 60);
});
test("envelopes and nested task results validate application failures, sizes and identities", async () => {
  assert.throws(() => unwrapEnvelope({ code: 500, data: {} }));
  assert.throws(() => unwrapEnvelope({ code: 200, error: "failed", data: {} }));
  assert.deepEqual(parseTaskResult([{ task_id: "t", status: 0 }], "t", "http://localhost:8001"), { state: "running" });
  assert.deepEqual(parseTaskResult([{ task_id: "t", status: 2 }], "t", "http://localhost:8001"), { state: "failed" });
  assert.throws(() => parseTaskResult([{ task_id: "other", status: 1 }], "t", "http://localhost:8001"));
  assert.throws(() => parseTaskResult([{ task_id: "t", status: 3 }], "t", "http://localhost:8001"));
  await assert.rejects(() => boundedJson(new Response(' '.repeat(200)), 100));
  for (const url of ["file:///tmp/a", "http://user:pass@localhost:1", "http://localhost:1/path", "http://localhost:1?token=secret"]) assert.throws(() => approvedOrigin(url));
  for (const url of ["https://evil.test/v1/audio", "/other", "//evil.test/v1/audio"]) assert.throws(() => audioUrl("http://localhost:8001", url));
});
test("protocol-faithful HTTP generation and multipart inputs produce a real decoded WAV", async t => {
  const fake = await fakeAceStep(); t.after(() => fake.close());
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-music-protocol-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(await discoverModels(fake.connection), ["acestep-v15-turbo"]);
  const source = path.join(root, "source.wav"); fs.writeFileSync(source, testWav());
  for (const operation of ["generate", "reference", "cover", "repaint"]) {
    const request = parse({ operation, ...(operation !== "generate" ? { source: { kind: "artifact", artifactId: "art_test", version: 1 } } : {}), ...(operation === "repaint" ? { interval: { start: 0, end: 1 } } : {}) });
    const receipt = await submitMusic(fake.connection, request, operation === "generate" ? null : source, signal());
    const result = await queryMusic(fake.connection, receipt, signal()); assert.equal(result.state, "succeeded"); assert.equal(result.seed, 42);
    const output = path.join(root, `${operation}.wav`); await fetchAudio(fake.connection, result.file, output, signal());
    assert.equal(inspectWav(output).duration, 0.2);
  }
  const submissions = fake.requests.filter(req => req.url === "/release_task");
  assert.equal(JSON.parse(submissions[0].body).batch_size, 1);
  assert.match(submissions[1].body.toString(), /name="reference_audio"/);
  assert.match(submissions[2].body.toString(), /name="src_audio"/);
  assert.ok(!submissions[1].body.includes(Buffer.from(root)));
  assert.equal(fake.submissions, 4);
});
test("redirects, corrupted audio and mismatched splice formats cannot publish", async t => {
  const fake = await fakeAceStep({ redirect: "http://example.invalid/stolen" }); t.after(() => fake.close());
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-music-media-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await assert.rejects(() => fetchAudio(fake.connection, "/v1/audio?path=x", path.join(root, "bad.wav"), signal()));
  const a = path.join(root, "a.wav"), b = path.join(root, "b.wav"), out = path.join(root, "edit.wav");
  const original = testWav(1, 220), replacement = testWav(1, 440); fs.writeFileSync(a, original); fs.writeFileSync(b, replacement);
  const edited = spliceWav(a,b,out,{ start: 0.25, end: 0.5 }); assert.equal(edited.duration, 1);
  const actual = fs.readFileSync(out), start = 44+4000, end = 44+8000;
  assert.deepEqual(actual.subarray(0,start), original.subarray(0,start));
  assert.deepEqual(actual.subarray(start,end), replacement.subarray(start,end));
  assert.deepEqual(actual.subarray(end), original.subarray(end));
  fs.writeFileSync(b, testWav(0.5)); assert.throws(() => spliceWav(a,b,path.join(root,"no.wav"),{ start:0.1,end:0.2 }));
  for (const bad of [Buffer.from("<html>success</html>"), original.subarray(0,original.length-2)]) { fs.writeFileSync(b,bad); assert.throws(() => inspectWav(b)); }
});
