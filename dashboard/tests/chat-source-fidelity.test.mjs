import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'breadboard-chat-source-'));
process.env.BREADBOARD_DATA_DIR = root;
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'server-only') return { url: 'data:text/javascript,export {};', shortCircuit: true };
  if (/^\.{1,2}\//.test(specifier) && !path.extname(specifier) && context.parentURL?.startsWith('file:')) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (fs.existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
  }
  if (specifier.startsWith('@/')) {
    const candidate = new URL(`../src/${specifier.slice(2)}${path.extname(specifier) ? '' : '.ts'}`, import.meta.url);
    if (fs.existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
  }
  return next(specifier, context);
} });
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Document preparation must not call a model or service'); };
const { default: db } = await import('../src/lib/db.ts');
const { ensureDocumentSource, documentSkillContext } = await import('../src/lib/document-skills/service.ts');
const { readSkillFile, listSkillFiles, findSkillBySlug } = await import('../src/lib/document-skills/store.ts');
const { prepareDocumentContext } = await import('../src/lib/document-skills/turn.ts');
const { hermesPromptText } = await import('../src/lib/agent-runtime/hermes-prompt.ts');
const { pdfViewContext } = await import('../src/lib/pdf-assistant.ts');
after(() => { globalThis.fetch = originalFetch; db.close(); hooks.deregister(); fs.rmSync(root, { recursive: true, force: true }); });

db.prepare('INSERT INTO users(id,username,email,password_hash) VALUES(1,?,?,?)').run('source-reader', 'reader@example.test', 'unused');

test('a long source is recoverable byte-for-byte, including equations and chunk boundaries, without model calls', () => {
  const text = '# First chapter\n\n' + 'An exact derivation: $Y(s)=X(s)H(s)$. 😀\r\n'.repeat(3000) + '\n# Last chapter\nFinal proof.\n';
  const input = { userId: 1, title: 'Source', text, origin: { kind: 'upload', fileName: 'source.pdf' } };
  const record = ensureDocumentSource(input);
  const chunks = listSkillFiles(record.slug).filter(file => file.path.startsWith('source/')).map(file => readSkillFile(record.slug, file.path));
  assert.equal(chunks.join(''), text);
  assert.ok(chunks.every(chunk => chunk.length <= 18_000 && chunk.isWellFormed()));
  assert.equal(record.status, 'ready');
  assert.equal(findSkillBySlug(1, record.slug).chapterCount, chunks.length);
  assert.equal(findSkillBySlug(2, record.slug), null, 'other users cannot read the source');
  assert.equal(ensureDocumentSource(input).slug, record.slug, 'unchanged sources reuse the same exact index');
  assert.notEqual(ensureDocumentSource({ ...input, text: text + 'Updated.' }).slug, record.slug);
  assert.match(documentSkillContext([record]), /index is not the source itself/i);
});

test('chat preparation keeps a chapter inline and indexes a whole book with no provider dependency', async () => {
  const chapter = { type: 'text', name: 'chapter.pdf', text: 'Source reasoning. '.repeat(2500) };
  const book = { type: 'text', name: 'book.pdf', text: 'Full source. '.repeat(10000) };
  const prepared = await prepareDocumentContext({ userId: 1, attachments: [chapter, book] });
  assert.deepEqual(prepared.inlineAttachments, [chapter]);
  assert.equal(prepared.records.length, 1);
  const record = prepared.records[0];
  assert.equal(listSkillFiles(record.slug).filter(file => file.path.startsWith('source/')).map(file => readSkillFile(record.slug, file.path)).join(''), book.text);
  assert.deepEqual(prepared.warnings, []);
});

test('PDF follow-ups keep the current page and index a textbook without resending its full text', async () => {
  const book = { type: 'document', context: 'pdf', name: 'calculus.pdf', format: 'pdf',
    blobId: 'doc_calculus', byteSize: 10_000_000, figures: [],
    text: Array.from({ length: 1200 }, (_, i) => `[[Page ${i + 1}]]\n${'Exact textbook material. '.repeat(130)}\n`).join('\n') };
  const page = pdfViewContext({ title: book.name, pageCount: 1200, pageNumber: 948,
    pages: [948], text: 'The enclosed charge is the net charge inside the closed surface.' });
  const image = { type: 'image', context: 'pdf', name: 'Current PDF view.png', dataUrl: 'data:image/png;base64,cGFnZQ==' };
  const attachments = [page, book, image];
  const originalText = book.text;
  const first = await prepareDocumentContext({ userId: 1, attachments });
  const followup = await prepareDocumentContext({ userId: 1, attachments });
  assert.equal(first.records.length, 1);
  assert.equal(followup.records[0].slug, first.records[0].slug, 'follow-ups reuse the existing source');
  assert.deepEqual(followup.inlineAttachments.map(item => item.name), attachments.map(item => item.name));
  assert.equal(followup.inlineAttachments[0], page);
  assert.equal(followup.inlineAttachments[2], image);
  assert.equal(followup.inlineAttachments[1].blobId, book.blobId);
  const prompt = hermesPromptText('what is q enclosed here?', followup.inlineAttachments);
  assert.ok(prompt.length + followup.context.length < 100_000, 'a page question must not carry millions of characters');
  assert.match(prompt, /what is q enclosed here/);
  assert.match(prompt, /net charge inside the closed surface/);
  assert.ok(prompt.includes(first.records[0].slug));
  assert.equal(listSkillFiles(first.records[0].slug).filter(file => file.path.startsWith('source/'))
    .map(file => readSkillFile(first.records[0].slug, file.path)).join(''), originalText);
  assert.equal(book.text, originalText, 'preparation must not mutate the stored reading');
});

test('documents and text attachments share the inline budget', async () => {
  const attachments = [
    { type: 'document', name: 'first.docx', format: 'docx', blobId: 'doc_first', text: 'A'.repeat(35_000) },
    { type: 'text', name: 'second.txt', text: 'B'.repeat(35_000) },
    { type: 'document', name: 'third.pdf', format: 'pdf', blobId: 'doc_third', text: 'C'.repeat(35_000) },
  ];
  const prepared = await prepareDocumentContext({ userId: 1, attachments });
  assert.equal(prepared.records.length, 2);
  assert.equal(prepared.inlineAttachments[0], attachments[0]);
  assert.ok(hermesPromptText('Compare these sources', prepared.inlineAttachments).length < 61_000);
});

test('an unavailable source store never falls back to sending an oversized document', async () => {
  const unavailable = path.join(root, 'not-a-directory');
  fs.writeFileSync(unavailable, 'occupied');
  process.env.BREADBOARD_DATA_DIR = unavailable;
  try {
    await assert.rejects(prepareDocumentContext({ userId: 1, attachments: [
      { type: 'document', name: 'unavailable.pdf', format: 'pdf', blobId: 'doc_unavailable', text: 'Unavailable source. '.repeat(10_000) },
    ] }), /unavailable\.pdf.*[Rr]etry/);
  } finally { process.env.BREADBOARD_DATA_DIR = root; }
});

test('the source index exposes middle headings and later applications, preserving exact source chunks', () => {
  const text = '## Page 1\n-> Feedback\n' + 'First application.\n'.repeat(750) +
    '\n## Page 12\n-> Weighted combination\n' + 'Derivation.\n'.repeat(900) +
    '\n## Page 43\n-> Another subject\n' + 'Other material.\n'.repeat(850) +
    '\n## Page 44\nA continued example.\n\n-> Precision application\nA later use of feedback.\n' +
    '\n```md\n## Fake heading inside an example\n```\n';
  const record = ensureDocumentSource({ userId: 1, title: 'Mixed lecture', text, origin: { kind: 'upload', fileName: 'lecture.pdf' } });
  const index = readSkillFile(record.slug, 'SKILL.md');
  for (const heading of ['Weighted combination', 'Another subject', 'Precision application']) assert.ok(index.includes(heading));
  assert.ok(!index.includes('Fake heading'));
  const part = index.split(/\n\n(?=- source\/)/).find(entry => entry.includes('Precision application'));
  const file = part.match(/source\/part-\d+\.md/)[0];
  assert.ok(readSkillFile(record.slug, file).includes('A later use of feedback.'));
  const offset = Number(index.match(/@(\d+): Precision application/)[1]);
  assert.equal(text.slice(offset, offset + 24), '-> Precision application');
  assert.equal(listSkillFiles(record.slug).filter(file => file.path.startsWith('source/')).map(file => readSkillFile(record.slug, file.path)).join(''), text);
});

test('dense source outlines stay bounded in context and retain every heading in a readable outline file', () => {
  const text = Array.from({ length: 2_000 }, (_, i) => `# T${i}\n`).join('');
  const record = ensureDocumentSource({ userId: 1, title: 'Dense', text, origin: { kind: 'upload', fileName: 'dense.md' } });
  const index = readSkillFile(record.slug, 'SKILL.md');
  assert.ok(index.length < 3_000);
  const outlinePages = [...index.matchAll(/outline\/part-\d+-\d+\.md/g)].map(match => readSkillFile(record.slug, match[0]));
  assert.ok(outlinePages.length > 1);
  assert.ok(outlinePages.every(page => page.length <= 24_000), 'every outline page fits in a document_skill_read response');
  const outlines = outlinePages.join('\n');
  for (let i = 0; i < 2_000; i++) assert.match(outlines, new RegExp(`: T${i}(?:\\n|$)`));
  assert.equal(listSkillFiles(record.slug).filter(file => file.path.startsWith('source/')).map(file => readSkillFile(record.slug, file.path)).join(''), text);
});
