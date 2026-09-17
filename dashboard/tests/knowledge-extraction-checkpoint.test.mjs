import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.BREADBOARD_LEARN_SOURCE_ROOT = path.join(dashboardRoot, "src");
await import("../scripts/learn-worker-import-hook.mjs");

const { extractDocumentKnowledge } = await import("../src/lib/knowledge.ts");

test("disk checkpoint identity survives nondeterministic OCR while chunks stay exact", () => {
  const executor = fs.readFileSync(
    path.join(dashboardRoot, "src", "lib", "runtime-v2", "ingest-executor.ts"),
    "utf8",
  );
  const locationStart = executor.indexOf("function knowledgeCheckpointLocation(");
  const locationEnd = executor.indexOf("function readKnowledgeCheckpoint(", locationStart);
  const location = executor.slice(locationStart, locationEnd);
  assert.ok(location, "expected the disk checkpoint location helper");
  assert.match(location, /Keep the outer checkpoint stable across nondeterministic OCR retries/);
  assert.doesNotMatch(location, /\.update\(plainText\)/);
  assert.doesNotMatch(location, /for \(const page of pages\)/);

  const adapterStart = executor.indexOf("function knowledgeChunkCheckpoint(");
  const adapterEnd = executor.indexOf("function ", adapterStart + 1);
  const adapter = executor.slice(adapterStart, adapterEnd);
  assert.ok(adapter, "expected the per-chunk checkpoint adapter");
  assert.match(adapter, /entry\?\.total === total && entry\.inputHash === inputHash\(sourceChunk\)/);
  assert.match(adapter, /if \(entry\.total !== total\) chunks\.delete\(cachedIndex\)/);
});

test("concept extraction restores completed chunks after a worker restart", async () => {
  const pages = Array.from({ length: 7 }, (_, index) => ({
    label: `Page ${index + 1}`,
    text: `${index + 1} ${"signal ".repeat(1_500)}`,
  }));
  const stored = new Map();
  const checkpoint = {
    load({ index, total, sourceChunk }) {
      const entry = stored.get(index);
      return entry?.total === total && entry.sourceChunk === sourceChunk
        ? entry.extraction
        : null;
    },
    save(input) {
      stored.set(input.index, input);
    },
  };
  let calls = 0;
  const client = {
    chat: {
      completions: {
        async create() {
          calls += 1;
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  documentTitle: "Signals",
                  summary: `Chunk ${calls}`,
                  suggestedTags: ["signal-detection"],
                  topics: [{
                    title: `Signal concept ${calls}`,
                    explanation: `Grounded explanation ${calls}`,
                    keyPoints: [`Point ${calls}`],
                    sourceEvidence: [`Evidence ${calls}`],
                    locations: [`Page ${calls}`],
                    relatedTopics: [],
                    tags: ["signal-detection"],
                  }],
                  relationships: [],
                }),
              },
            }],
          };
        },
      },
    },
  };

  const first = await extractDocumentKnowledge({
    client,
    model: "selected-model",
    title: "Signals",
    sourceType: "pdf",
    sourceLabel: "upload",
    pages,
    text: pages.map((page) => page.text).join("\n"),
    checkpoint,
  });
  assert.equal(calls, 2);
  assert.equal(stored.size, 2);
  assert.equal(first.topics.length, 2);

  const progress = [];
  const restored = await extractDocumentKnowledge({
    client,
    model: "selected-model",
    title: "Signals",
    sourceType: "pdf",
    sourceLabel: "upload",
    pages,
    text: pages.map((page) => page.text).join("\n"),
    checkpoint,
    onProgress(step) {
      progress.push(step);
    },
  });
  assert.equal(calls, 2, "restored chunks must not call the model again");
  assert.equal(restored.topics.length, 2);
  assert.deepEqual(progress, [
    "Restoring concept checkpoint (1/2 sections)…",
    "Restoring concept checkpoint (2/2 sections)…",
  ]);
});

test("concept extraction refuses to publish when a chunk is missing", async () => {
  const pages = Array.from({ length: 7 }, (_, index) => ({
    label: `Page ${index + 1}`,
    text: `${index + 1} ${"signal ".repeat(1_500)}`,
  }));
  const stored = new Map();
  const checkpoint = {
    load() {
      return null;
    },
    save(input) {
      stored.set(input.index, input);
    },
  };
  let calls = 0;
  const client = {
    chat: {
      completions: {
        async create() {
          calls += 1;
          if (calls === 2) throw new Error("temporary model failure");
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  documentTitle: "Signals",
                  summary: "First chunk",
                  suggestedTags: ["signal-detection"],
                  topics: [{
                    title: "Signal concept",
                    explanation: "Grounded explanation",
                    keyPoints: ["Point"],
                    sourceEvidence: ["Evidence"],
                    locations: ["Page 1"],
                    relatedTopics: [],
                    tags: ["signal-detection"],
                  }],
                  relationships: [],
                }),
              },
            }],
          };
        },
      },
    },
  };

  await assert.rejects(
    extractDocumentKnowledge({
      client,
      model: "selected-model",
      title: "Signals",
      sourceType: "pdf",
      sourceLabel: "upload",
      pages,
      text: pages.map((page) => page.text).join("\n"),
      checkpoint,
    }),
    /section 2 of 2; refusing to publish an incomplete knowledge map/,
  );
  assert.equal(calls, 2);
  assert.deepEqual([...stored.keys()], [0]);
});

test("concept extraction retries malformed JSON within the same job", async () => {
  const pages = [{
    label: "Page 1",
    text: `1 ${"signal ".repeat(1_500)}`,
  }];
  const stored = new Map();
  const progress = [];
  const requests = [];
  let calls = 0;
  const client = {
    chat: {
      completions: {
        async create(request) {
          requests.push(request);
          calls += 1;
          if (calls === 1) {
            return {
              choices: [{
                message: {
                  content: "{\"documentTitle\":\"Signals\",\"summary\":\"bad\\q\"}",
                },
              }],
            };
          }
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  documentTitle: "Signals",
                  summary: "Recovered chunk",
                  suggestedTags: ["signal-detection"],
                  topics: [{
                    title: "Recovered signal concept",
                    explanation: "Grounded explanation",
                    keyPoints: ["Point"],
                    sourceEvidence: ["Evidence"],
                    locations: ["Page 1"],
                    relatedTopics: [],
                    tags: ["signal-detection"],
                  }],
                  relationships: [],
                }),
              },
            }],
          };
        },
      },
    },
  };

  const extraction = await extractDocumentKnowledge({
    client,
    model: "selected-model",
    title: "Signals",
    sourceType: "pdf",
    sourceLabel: "upload",
    pages,
    text: pages[0].text,
    checkpoint: {
      load() {
        return null;
      },
      save(input) {
        stored.set(input.index, input);
      },
    },
    onProgress(step) {
      progress.push(step);
    },
  });

  assert.equal(calls, 2);
  assert.ok(
    requests.every(
      (request) => request.response_format?.type === "json_object",
    ),
    "knowledge extraction must request provider-enforced JSON objects",
  );
  assert.equal(stored.size, 1);
  assert.equal(extraction.summary, "Recovered chunk");
  assert.ok(
    progress.includes(
      "Retrying concept extraction after malformed JSON (2/3)…",
    ),
  );
});

test("malformed JSON retries stay bounded and preserve completeness failure", async () => {
  const pages = Array.from({ length: 7 }, (_, index) => ({
    label: `Page ${index + 1}`,
    text: `${index + 1} ${"signal ".repeat(1_500)}`,
  }));
  let calls = 0;
  const client = {
    chat: {
      completions: {
        async create() {
          calls += 1;
          return {
            choices: [{
              message: {
                content: "{\"documentTitle\":\"Signals\",\"summary\":\"bad\\q\"}",
              },
            }],
          };
        },
      },
    },
  };

  await assert.rejects(
    extractDocumentKnowledge({
      client,
      model: "selected-model",
      title: "Signals",
      sourceType: "pdf",
      sourceLabel: "upload",
      pages,
      text: pages.map((page) => page.text).join("\n"),
    }),
    /section 1 of 2; refusing to publish an incomplete knowledge map/,
  );
  assert.equal(calls, 3);
});

test("concept extraction retries a transient 502 within the same section", async () => {
  const pages = Array.from({ length: 7 }, (_, index) => ({
    label: `Page ${index + 1}`,
    text: `${index + 1} ${"signal ".repeat(1_500)}`,
  }));
  const stored = new Map();
  const progress = [];
  let calls = 0;
  const client = {
    chat: {
      completions: {
        async create() {
          calls += 1;
          if (calls === 2) {
            throw Object.assign(
              new Error("The upstream was temporarily unavailable."),
              { status: 502 },
            );
          }
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  documentTitle: "Signals",
                  summary: `Recovered chunk ${calls}`,
                  suggestedTags: ["signal-detection"],
                  topics: [{
                    title: `Signal concept ${calls}`,
                    explanation: "Grounded explanation",
                    keyPoints: ["Point"],
                    sourceEvidence: ["Evidence"],
                    locations: ["Page 1"],
                    relatedTopics: [],
                    tags: ["signal-detection"],
                  }],
                  relationships: [],
                }),
              },
            }],
          };
        },
      },
    },
  };

  const extraction = await extractDocumentKnowledge({
    client,
    model: "selected-model",
    title: "Signals",
    sourceType: "pdf",
    sourceLabel: "upload",
    pages,
    text: pages.map((page) => page.text).join("\n"),
    checkpoint: {
      load() {
        return null;
      },
      save(input) {
        stored.set(input.index, input);
      },
    },
    onProgress(step) {
      progress.push(step);
    },
  });

  assert.equal(calls, 3);
  assert.deepEqual([...stored.keys()], [0, 1]);
  assert.equal(extraction.topics.length, 2);
  assert.ok(
    progress.includes(
      "Retrying concept extraction for section 2 of 2 after a temporary upstream error (2/3)…",
    ),
  );
});

test("concept extraction does not retry a quota reset wrapped in 502", async () => {
  const pages = Array.from({ length: 7 }, (_, index) => ({
    label: `Page ${index + 1}`,
    text: `${index + 1} ${"signal ".repeat(1_500)}`,
  }));
  let calls = 0;
  const client = {
    chat: {
      completions: {
        async create() {
          calls += 1;
          throw Object.assign(
            new Error("Session usage limit reached; resets later."),
            { status: 502 },
          );
        },
      },
    },
  };

  await assert.rejects(
    extractDocumentKnowledge({
      client,
      model: "selected-model",
      title: "Signals",
      sourceType: "pdf",
      sourceLabel: "upload",
      pages,
      text: pages.map((page) => page.text).join("\n"),
    }),
    /section 1 of 2; refusing to publish an incomplete knowledge map/,
  );
  assert.equal(calls, 1);
});
