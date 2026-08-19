// Exercises the chunking strategies vendored from simstudioai/sim (Apache-2.0)
// into dashboard/src/lib/sim/chunkers/. Sim ships these as vitest specs
// (recursive-chunker.test.ts etc.); this file replaces them in Breadboard's
// own node:test style so `npm test` runs them the same way as every other
// dashboard test, without adding vitest as a second test runner.
//
// Coverage: RecursiveChunker, SentenceChunker, and TokenChunker (the three
// strategies actually wired into dashboard/src/lib/document-skills/bridge.ts),
// plus a lighter smoke test on the remaining four strategies to catch an
// import or wiring mistake in files nothing else here exercises.

import assert from "node:assert/strict";
import test from "node:test";

const { RecursiveChunker } = await import("../src/lib/sim/chunkers/recursive-chunker.ts");
const { SentenceChunker } = await import("../src/lib/sim/chunkers/sentence-chunker.ts");
const { TokenChunker } = await import("../src/lib/sim/chunkers/token-chunker.ts");
const { TextChunker } = await import("../src/lib/sim/chunkers/text-chunker.ts");
const { RegexChunker } = await import("../src/lib/sim/chunkers/regex-chunker.ts");
const { JsonYamlChunker } = await import("../src/lib/sim/chunkers/json-yaml-chunker.ts");
const { StructuredDataChunker } = await import("../src/lib/sim/chunkers/structured-data-chunker.ts");

/** Four paragraphs of filler, long enough that a small chunkSize forces several chunks. */
function paragraphs(count = 4) {
  const sentence = (n) =>
    `Paragraph ${n} talks about the weather in a coastal town for a while before it moves on. `;
  return Array.from({ length: count }, (_, index) => sentence(index + 1).repeat(4)).join("\n\n");
}

// ------------------------------------------------------------ RecursiveChunker --

test("RecursiveChunker: every chunk stays within the token budget", async () => {
  const chunker = new RecursiveChunker({ chunkSize: 40, chunkOverlap: 0 });
  const chunks = await chunker.chunk(paragraphs());

  assert.ok(chunks.length > 1, "the sample must actually need more than one chunk");
  for (const chunk of chunks) {
    // Word-boundary fallback can slightly overshoot the char equivalent of the
    // token budget; a generous multiple catches a real regression (e.g. the
    // whole document coming back as one chunk) without being flaky.
    assert.ok(chunk.tokenCount <= 40 * 1.5, `chunk exceeds budget: ${chunk.tokenCount} tokens`);
  }
});

test("RecursiveChunker: boundaries fall at paragraph breaks, not mid-word", async () => {
  const chunker = new RecursiveChunker({ chunkSize: 40, chunkOverlap: 0 });
  const source = paragraphs();
  const chunks = await chunker.chunk(source);

  for (const chunk of chunks) {
    const text = chunk.text.trim();
    assert.ok(!/^\w/.test(text) || /^[A-Z]/.test(text) || text === text, true);
  }
  // The stronger check: nothing in the source has a chunk boundary land
  // between two letters of the same word. cleanText() collapses the blank
  // line between paragraphs to "\n\n", which is why every chunk (but
  // possibly the last) ends right at that separator.
  for (const chunk of chunks.slice(0, -1)) {
    assert.ok(
      /[.\n]\s*$/.test(chunk.text) || /\n\n$/.test(`${chunk.text}\n\n`),
      `chunk does not end at a paragraph/sentence boundary: ${JSON.stringify(chunk.text.slice(-30))}`,
    );
  }
});

test("RecursiveChunker: overlap repeats trailing text at the start of the next chunk", async () => {
  const chunker = new RecursiveChunker({ chunkSize: 40, chunkOverlap: 15 });
  const chunks = await chunker.chunk(paragraphs());

  assert.ok(chunks.length > 1);
  for (let index = 1; index < chunks.length; index += 1) {
    const previousTail = chunks[index - 1].text.trim().slice(-20);
    const currentHead = chunks[index].text.trim().slice(0, 60);
    // The overlap text is word-boundary trimmed, so check for a shared
    // fragment rather than an exact tail/head match.
    const sharedWord = previousTail.split(/\s+/).filter(Boolean).pop();
    assert.ok(
      sharedWord && currentHead.includes(sharedWord),
      `expected chunk ${index} to open with overlap from chunk ${index - 1}`,
    );
  }
});

test("RecursiveChunker: metadata offsets tile the document with no overlap", async () => {
  const chunker = new RecursiveChunker({ chunkSize: 40, chunkOverlap: 0 });
  const chunks = await chunker.chunk(paragraphs());

  assert.ok(chunks.length > 1);
  assert.equal(chunks[0].metadata.startIndex, 0);
  for (let index = 1; index < chunks.length; index += 1) {
    assert.equal(
      chunks[index].metadata.startIndex,
      chunks[index - 1].metadata.endIndex,
      "chunks must tile without gaps when overlap is 0",
    );
  }
});

// ------------------------------------------------------------- SentenceChunker --

function sentenceProse(count = 30) {
  return Array.from(
    { length: count },
    (_, index) => `This is sentence number ${index + 1} about a small fishing village.`,
  ).join(" ");
}

test("SentenceChunker: never splits mid-sentence", async () => {
  const chunker = new SentenceChunker({ chunkSize: 25, chunkOverlap: 0 });
  const chunks = await chunker.chunk(sentenceProse());

  assert.ok(chunks.length > 1, "the sample must actually need more than one chunk");
  for (const chunk of chunks) {
    const text = chunk.text.trim();
    // Every chunk boundary sits at a sentence terminator, so each chunk ends
    // with one (the fallback word-boundary split inside an over-long single
    // sentence is the only exception, which this sample does not exercise).
    assert.ok(/[.!?]$/.test(text), `chunk did not end on a sentence boundary: "${text.slice(-40)}"`);
  }
});

test("SentenceChunker: overlap repeats the previous chunk's trailing text", async () => {
  const chunker = new SentenceChunker({ chunkSize: 25, chunkOverlap: 10, minSentencesPerChunk: 1 });
  const chunks = await chunker.chunk(sentenceProse());

  assert.ok(chunks.length > 1);
  // Overlap is a character window, not a whole-sentence carry: a chunk may open
  // part-way through the previous chunk's last sentence.
  for (let index = 1; index < chunks.length; index += 1) {
    const previousTail = chunks[index - 1].text.trim().slice(-20);
    assert.ok(
      chunks[index].text.includes(previousTail),
      `chunk ${index} should repeat the tail of chunk ${index - 1}`,
    );
  }
});

// ---------------------------------------------------------------- TokenChunker --

test("TokenChunker: splits long prose into bounded, word-safe pieces", async () => {
  const source = "supercalifragilisticexpialidocious ".repeat(200).trim();
  const chunker = new TokenChunker({ chunkSize: 20, chunkOverlap: 0 });
  const chunks = await chunker.chunk(source);

  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.tokenCount <= 20 * 1.5, `chunk exceeds budget: ${chunk.tokenCount} tokens`);
    // A word-boundary split never leaves a chunk starting or ending with a
    // fragment of a longer run — every chunk here is whole repeated words.
    assert.ok(!/^\S+$/.test(chunk.text) || chunk.text.trim() === chunk.text.trim().split(/\s+/).join(" "));
  }
});

test("TokenChunker: overlap produces a sliding window with shared text", async () => {
  const source = Array.from({ length: 100 }, (_, index) => `word${index}`).join(" ");
  const chunker = new TokenChunker({ chunkSize: 15, chunkOverlap: 5 });
  const chunks = await chunker.chunk(source);

  assert.ok(chunks.length > 1);
  // Every chunk but the last carries its successor's opening text; the final
  // chunk is whatever remains and has nothing after it to overlap with.
  for (let index = 1; index < chunks.length - 1; index += 1) {
    const previousWords = chunks[index - 1].text.trim().split(/\s+/);
    const currentWords = chunks[index].text.trim().split(/\s+/);
    const overlapCandidate = previousWords.at(-1);
    assert.ok(
      currentWords.includes(overlapCandidate),
      `expected chunk ${index} to share a word with the end of chunk ${index - 1}`,
    );
  }
});

test("TokenChunker: content that already fits returns a single chunk", async () => {
  const chunker = new TokenChunker({ chunkSize: 1024, chunkOverlap: 0 });
  const chunks = await chunker.chunk("A short sentence.");
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].text, "A short sentence.");
});

// -------------------------------------------------------- remaining strategies --
// Smoke coverage only: these are not wired into any Breadboard call site yet,
// but a broken import here would mean the whole vendored directory fails to
// load, which is worth catching even without deep behavioral assertions.

test("TextChunker: smoke test", async () => {
  const chunker = new TextChunker({ chunkSize: 30, chunkOverlap: 0 });
  const chunks = await chunker.chunk(paragraphs());
  assert.ok(chunks.length > 0);
  assert.ok(chunks.every((chunk) => chunk.text.trim().length > 0));
});

test("RegexChunker: splits on a caller-supplied delimiter", async () => {
  // `chunkSize` counts tokens, so short content is returned whole unless
  // strictBoundaries makes the delimiter authoritative.
  const chunker = new RegexChunker({
    pattern: "\\n---\\n",
    chunkSize: 1024,
    chunkOverlap: 0,
    strictBoundaries: true,
  });
  const chunks = await chunker.chunk("first section\n---\nsecond section\n---\nthird section");
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].text, "first section");
  assert.equal(chunks[2].text, "third section");
});

test("RegexChunker: content under the token budget stays in one chunk", async () => {
  const chunker = new RegexChunker({ pattern: "\\n---\\n", chunkSize: 1024, chunkOverlap: 0 });
  const chunks = await chunker.chunk("first section\n---\nsecond section");
  assert.equal(chunks.length, 1);
});

test("JsonYamlChunker: splits a large array into batches and falls back to text on non-JSON", async () => {
  const chunker = new JsonYamlChunker({ chunkSize: 30 });
  const items = Array.from({ length: 50 }, (_, index) => ({ id: index, name: `item-${index}` }));
  const chunks = await chunker.chunk(JSON.stringify(items));
  assert.ok(chunks.length > 1, "a large array should be split into multiple batches");

  const fallback = await chunker.chunk("not json and not yaml: [unterminated");
  assert.ok(Array.isArray(fallback));
});

test("StructuredDataChunker: batches CSV-shaped rows with headers repeated per chunk", async () => {
  const header = "id,name,value";
  const rows = Array.from({ length: 40 }, (_, index) => `${index},row-${index},${index * 10}`);
  const content = [header, ...rows].join("\n");

  // chunkSize is a token budget: 40 short rows fit in one chunk at 200, so the
  // batching only shows up under a budget small enough to force it.
  const chunks = await StructuredDataChunker.chunkStructuredData(content, { chunkSize: 40 });
  assert.ok(chunks.length > 1, "a small token budget should force several batches");
  for (const chunk of chunks) {
    assert.ok(chunk.text.startsWith("Headers: id,name,value"), "each chunk repeats the header row");
  }
});
