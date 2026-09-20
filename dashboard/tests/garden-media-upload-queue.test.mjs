import assert from "node:assert/strict";
import test from "node:test";
import { createGardenMediaUploadQueue } from "../src/lib/garden-media-upload-queue.ts";

const file = name => new File(["media"], name);
const tick = () => new Promise(resolve => setImmediate(resolve));
const options = { clusterSlug: "ec-2", analyzeVisuals: true, keepMedia: true };
const accepted = (id, input) => Response.json({ job: { ...input, id, status: "queued" } }, { status: 202 });

test("seven mixed files transfer serially and continue after the garden unsubscribes", async () => {
  const requests = [];
  const queue = createGardenMediaUploadQueue({ request: (url, init) => new Promise(resolve => requests.push({ url, init, resolve })) });
  const unsubscribe = queue.subscribe(() => {});
  queue.enqueue({ ...options, files: Array.from({ length: 7 }, (_, i) => file(`lecture-${i}.${i % 2 ? "mp4" : "mp3"}`)) });
  unsubscribe();
  assert.equal(requests.length, 1);
  assert.equal(queue.getSnapshot().filter(x => x.job.status === "queued").length, 6);
  for (let i = 0; i < 7; i++) {
    assert.equal(requests.length, i + 1, "only one upload may be in flight");
    assert.equal(requests[i].url, "/api/gardens/ec-2/video-transcriptions");
    assert.equal(requests[i].init.body.get("media").name, `lecture-${i}.${i % 2 ? "mp4" : "mp3"}`);
    assert.equal(requests[i].init.body.get("analysis"), i % 2 ? "watch" : "transcript");
    assert.equal(requests[i].init.body.get("retainMedia"), "true");
    requests[i].resolve(accepted(`server-${i}`, queue.getSnapshot()[i].job));
    await tick();
  }
  assert.deepEqual(queue.getSnapshot().map(x => x.job.id), Array.from({ length: 7 }, (_, i) => `server-${i}`));
});

test("a failed upload does not block its siblings; retry keeps the original file and options", async () => {
  const names = [];
  const queue = createGardenMediaUploadQueue({ request: async (_url, init) => {
    names.push(init.body.get("media").name);
    return names.length === 1 ? Response.json({ error: "Network interrupted" }, { status: 503 }) : Response.json({ duplicate: true, source: { title: "Existing transcript" } });
  } });
  const [id] = queue.enqueue({ ...options, files: [file("first.mp3"), file("second.mp4")] });
  await tick();
  assert.equal(queue.getSnapshot()[0].job.errorMessage, "Network interrupted");
  assert.equal(queue.getSnapshot()[1].job.status, "completed");
  queue.retry(id);
  await tick();
  assert.deepEqual(names, ["first.mp3", "second.mp4", "first.mp3"]);
  assert.equal(queue.getSnapshot()[0].job.status, "completed");
});

test("queued cancellation skips the file and allows another garden to enqueue", async () => {
  const requests = [];
  const queue = createGardenMediaUploadQueue({ request: (url, init) => new Promise(resolve => requests.push({ url, init, resolve })) });
  const ids = queue.enqueue({ ...options, files: [file("first.mp3"), file("cancel.mp3")] });
  queue.cancel(ids[1]);
  queue.enqueue({ ...options, clusterSlug: "another garden", files: [file("other.mp4")] });
  requests[0].resolve(accepted("server-first", queue.getSnapshot()[0].job));
  await tick();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, "/api/gardens/another%20garden/video-transcriptions");
  assert.equal(queue.getSnapshot()[1].job.status, "cancelled");
  requests[1].resolve(accepted("server-other", queue.getSnapshot()[2].job));
  await tick();
});

test("server backpressure preserves the file until a slot opens", async () => {
  let attempts = 0;
  const queue = createGardenMediaUploadQueue({ retryDelayMs: 15, request: async () => {
    attempts++;
    return attempts === 1 ? Response.json({ errorCode: "queue_full" }, { status: 429 }) : Response.json({ duplicate: true, source: { title: "Available" } });
  } });
  queue.enqueue({ ...options, files: [file("wait.mp3")] });
  await tick();
  assert.equal(queue.getSnapshot()[0].job.status, "queued");
  assert.equal(queue.getSnapshot()[0].job.currentStage, "Waiting for a transcription slot");
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(attempts, 2);
  assert.equal(queue.getSnapshot()[0].job.status, "completed");
});

test("malformed success is actionable and YouTube retains its independent input", async () => {
  const requests = [];
  const queue = createGardenMediaUploadQueue({ request: async (_url, init) => { requests.push(init); return Response.json({}); } });
  queue.enqueue({ ...options, youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
  await tick();
  assert.equal(JSON.parse(requests[0].body).analysis, "watch");
  assert.equal(queue.getSnapshot()[0].job.status, "failed");
  assert.match(queue.getSnapshot()[0].job.errorMessage, /no transcription job was created/);
});

test("server reconciliation preserves a completed job after it ages out of recent history", async () => {
  let resolve;
  const queue = createGardenMediaUploadQueue({ request: () => new Promise(done => { resolve = done; }) });
  queue.enqueue({ ...options, files: [file("lecture.mp3")] });
  resolve(accepted("server-1", queue.getSnapshot()[0].job));
  await tick();
  const completed = { ...queue.getSnapshot()[0].job, status: "completed", sourceSlug: "lecture" };
  queue.reconcile([completed]);
  queue.reconcile([]);
  assert.equal(queue.getSnapshot()[0].job.status, "completed");
  assert.equal(queue.getSnapshot()[0].job.sourceSlug, "lecture");
});
