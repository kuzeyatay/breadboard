import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';

const bundled = await build({ stdin: { resolveDir: path.resolve(import.meta.dirname, '..'), loader: 'ts', contents: `
export {readQuartzMetadata,updateQuartzMetadata} from './src/lib/quartz-document-metadata';
export {MarkdownCodec} from './src/lib/quartz-editor/markdown';
export {editorSchema} from './src/lib/quartz-editor/schema';
export {SaveSession,EditorRequestError} from './src/lib/quartz-editor/session';
export {EditorState} from '@tiptap/pm/state';
export {history,undo} from '@tiptap/pm/history';
export {quartzDocumentParts,quartzDocumentRevision} from './src/lib/quartz-document-revision';
` }, bundle: true, write: false, platform: 'node', format: 'cjs' });
const module = {exports:{}};
new Function('require','module','exports', bundled.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const { readQuartzMetadata, updateQuartzMetadata, MarkdownCodec, editorSchema, SaveSession, EditorRequestError, EditorState, history, undo, quartzDocumentParts, quartzDocumentRevision } = module.exports;

const blocks = [
  '# Heading {#custom}', 'Paragraph with **bold**, *italic*, ~~strike~~, `code` and ==highlight==.',
  '[[Note#heading|Alias]] and ![[Other#^block]] and %%private comment%%.',
  '- one\n  - nested\n- [x] done\n- [ ] pending', '3. ordered\n4. more',
  '> [!warning]+ Watch out\n> Rich **content**\n>\n> - nested list',
  '| Left | Right |\n| :--- | ---: |\n| [[A|Alias]] | $x^2$ |',
  '```typescript title="Example"\nconst a = `x`\n```', '    indented code\n    more code',
  '$$\n\\int_0^1 x\,dx\n$$', 'Inline $x^2$ math.',
  '![Figure](/demo/assets/picture.png "title")', '![[image.png|caption|640x320]]',
  '![Video](https://youtu.be/abcdefghijk?t=90)', '![[audio.mp3]]', '![[book.pdf]]',
  '```breadboard-visual\n{"id":"plot","type":"custom"}\n```',
  '```breadboard-generated-visual\nid: example\nversion: 2\n```',
  '```breadboard-detached-visual\n{"schemaVersion":1,"source":"raw"}\n```',
  '```penecho\nid: 1720000000000-abcdefgh\ntitle: Board\nheight: 520\n```',
  '```artifact\n{"id":"a","conversationId":"c","kind":"html","version":2}\n```',
  '```mermaid\nflowchart LR\n A-->B\n```', 'A footnote[^note].\n\n[^note]: A **definition**.',
  '<details><summary>More</summary>\n\nText\n\n</details>', '<!-- invisible metadata -->',
  '```future-plugin\nkeep every byte\n```', '![source](/demo/assets/source-visuals/page.png)\n\n*Figure caption*',
];
for (const [index, source] of blocks.entries()) test(`round-trip Quartz content ${index + 1}`, () => {
  for (const original of [source, '\n\n' + source + '\n\n', source.replaceAll('\n', '\r\n')]) {
    const codec = new MarkdownCodec(); assert.equal(codec.serialize(codec.parse(original)), original);
  }
});
test('editing neighboring prose leaves every custom block and gap byte-for-byte intact', () => {
  const body = 'Before.\n\n' + blocks.join('\n\n') + '\n\nAfter.\n';
  const codec = new MarkdownCodec(), state = EditorState.create({ doc: codec.parse(body) });
  const next = state.apply(state.tr.insertText('Edited ', 1));
  assert.equal(codec.serialize(next.doc), body.replace('Before.', 'Edited Before.'));
});
test('nested opaque inline content survives a paragraph edit', () => {
  const codec = new MarkdownCodec(), state = EditorState.create({ doc: codec.parse('Text %%keep me%% and $x^2$ and ![[note]].') });
  const output = codec.serialize(state.apply(state.tr.insertText('New ', 1)).doc);
  assert.match(output, /%%keep me%%/); assert.match(output, /\$x\^2\$/); assert.match(output, /!\[\[note\]\]/);
});
test('source mode undo restores original whitespace and source context', () => {
  const codec = new MarkdownCodec(), original = '\nOriginal.\n\n';
  let state = EditorState.create({ doc: codec.parse(original), plugins: [history()] });
  const next = codec.parse('Replacement.\n');
  state = state.apply(state.tr.replaceWith(0, state.doc.content.size, next.content).setDocAttribute('sourceContext', next.attrs.sourceContext));
  assert.equal(codec.serialize(state.doc), 'Replacement.\n');
  undo(state, tr => { state = state.apply(tr); }); assert.equal(codec.serialize(state.doc), original);
});
test('pasted source IDs cannot alias existing source records', () => {
  const codec = new MarkdownCodec(), state = EditorState.create({ doc: codec.parse('Original') });
  const pasted = new MarkdownCodec().parse('```artifact\n{"id":"a"}\n```');
  const output = codec.serialize(state.apply(state.tr.insert(state.doc.content.size, pasted.content)).doc);
  assert.match(output, /```artifact/); assert.match(output, /Original/);
});
test('frontmatter separators and body indentation are preserved', () => {
  const raw = '---\r\ntitle: Test\r\ncustom:\r\n  a: b\r\n---\r\n\r\n    code\r\n';
  const parts = quartzDocumentParts(raw); assert.equal(parts.prefix + parts.body, raw); assert.equal(parts.body, '    code\r\n');
  assert.notEqual(quartzDocumentRevision(raw), quartzDocumentRevision(raw + 'x'));
});

const base = () => ({ body: 'original', title: 'Title', tags: [], revision: 'r1', accountId: '1', canEdit: true });
test('autosave serializes requests and never treats later typing as saved', async () => {
  const pending = [], patches = [], statuses = [];
  const session = new SaveSession(base(), patch => { patches.push(patch); return new Promise(resolve => pending.push(resolve)); }, { write: async () => {} }, s => statuses.push(s), () => {});
  session.update({ ...base(), body: 'first' }); const saving = session.flush();
  session.update({ ...base(), body: 'second' }); assert.equal(patches.length, 1);
  pending.shift()({ revision: 'r2' }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(patches.length, 2); assert.equal(patches[1].baseRevision, 'r2'); assert.equal(patches[1].body, 'second');
  pending.shift()({ revision: 'r3' }); await saving; assert.equal(session.dirty, false); assert.equal(statuses.at(-1), 'Saved'); session.destroy();
});
test('conflicts retain drafts and retry only against the reviewed revision', async () => {
  let calls = 0; const writes = [], patches = [];
  const session = new SaveSession(base(), async patch => { patches.push(patch); if (++calls === 1) throw new EditorRequestError({ status: 409, ...base(), revision: 'r2', body: 'external' }); return { revision: 'r3' }; },
    { write: async (...args) => writes.push(args) }, () => {}, () => {});
  session.update({ ...base(), body: 'mine' }); await assert.rejects(session.flush());
  assert.equal(session.draft.body, 'mine'); assert.equal(session.conflict.body, 'external');
  await session.resolve(true); assert.equal(patches.at(-1).baseRevision, 'r2'); assert.ok(writes.some(([, backup]) => backup)); session.destroy();
});
test('unchanged page performs no save or metadata normalization', async () => {
  let writes = 0; const session = new SaveSession(base(), async () => { writes++; }, { write: async () => {} }, () => {}, () => {});
  await session.flush(); assert.equal(writes, 0); session.destroy();
});

test('unchanged snapshots do not rewrite recovery or lose the active save generation', async () => {
  const writes = [], pending = [];
  const session = new SaveSession(base(), () => new Promise(resolve => pending.push(resolve)), {write: async value => writes.push(value)}, () => {}, () => {});
  session.update({...base()}); assert.equal(writes.length, 0);
  session.update({...base(), body:'changed'}); const saving = session.flush();
  session.update({...base(), body:'changed'}); assert.equal(writes.length, 1);
  pending.shift()({revision:'r2', title:'Normalized title'}); await saving;
  assert.equal(session.dirty, false); assert.equal(session.draft.title, 'Normalized title');
  assert.equal(writes.at(-1), null); session.destroy();
});

test('serialization reuses unchanged document bodies and preserves edits and undo', () => {
  const codec = new MarkdownCodec(), original = Array.from({length:1000}, (_, i) => `Paragraph ${i}.`).join('\n\n');
  let state = EditorState.create({doc:codec.parse(original), plugins:[history()]});
  state = state.apply(state.tr.insertText('Edited ', 1));
  const changed = codec.serialize(state.doc);
  const originalBlock = codec.block.bind(codec); let visits = 0;
  codec.block = node => { visits++; return originalBlock(node); };
  for (let i=0; i<100; i++) assert.equal(codec.serialize(state.doc), changed);
  assert.equal(visits, 0, 'selection, metadata and save snapshots do not walk every block again');
  undo(state, tr => { state=state.apply(tr); }); assert.equal(codec.serialize(state.doc), original);
  state=state.apply(state.tr.insertText('Different ', 1)); assert.match(codec.serialize(state.doc), /^Different Paragraph 0/);
});


test('metadata edits preserve hidden nested YAML, comments, CRLF and body whitespace', () => {
  const original = '---\r\n# retained\r\ntitle: Old # title comment\r\ncustom:\r\n  title: untouched\r\n  values: [a, b]\r\nsemanticHints:\r\n  - first\r\n  - second\r\nafter: retained\r\n---\r\n\r\n    code\r\n';
  const renamed = updateQuartzMetadata(original, 'title', 'New');
  assert.equal(renamed, original.replace('title: Old', 'title: "New"'));
  const tagged = updateQuartzMetadata(renamed, 'semanticHints', ['third']);
  assert.deepEqual(readQuartzMetadata(tagged).semanticHints, ['third']);
  assert.equal(readQuartzMetadata(tagged).after, 'retained');
  assert.match(tagged, /  title: untouched/);
  assert.ok(tagged.endsWith('---\r\n\r\n    code\r\n'));
  const removed = updateQuartzMetadata(tagged, 'semanticHints', null);
  assert.equal(readQuartzMetadata(removed).semanticHints, undefined);
  assert.equal(readQuartzMetadata(removed).after, 'retained');
});

test('callout and footnote text remains editable without duplicating syntax', () => {
  const codec = new MarkdownCodec();
  let state = EditorState.create({doc:codec.parse('> [!warning]+ Title\n> Content.\n\n[^n]: Definition.\n')});
  let at = 0; state.doc.descendants((node,pos)=>{if(node.isText && node.text==='Title\nContent.') at=pos;});
  state = state.apply(state.tr.insertText('New ', at || 2));
  const output = codec.serialize(state.doc);
  assert.equal((output.match(/\[!warning\]/g)||[]).length,1);
  assert.match(output,/\[\^n\]: Definition/);
});

test('editing a nested quote keeps the other nested multiline paragraph and unknown source intact', () => {
  const codec = new MarkdownCodec(), original = '> One\n> continued\n>\n> Two\n>\n> ```custom-extension\n> original source\n> ```\n';
  let state = EditorState.create({doc:codec.parse(original)}), at;
  state.doc.descendants((node,pos)=>{if(node.isText && node.text==='Two')at=pos;});
  state = state.apply(state.tr.insertText('New ',at));
  const output=codec.serialize(state.doc);
  assert.match(output,/> One\n> continued/);assert.match(output,/> New Two/);
  assert.match(output,/> ```custom-extension\n> original source\n> ```/);
});
test('reference links keep their targets and reference images get resolved previews', () => {
  const source='A [named link][target].\n\n![Figure][picture]\n\n[target]: https://example.com "Title"\n[picture]: /assets/figure.png\n';
  const codec=new MarkdownCodec(),state=EditorState.create({doc:codec.parse(source)});
  assert.equal(codec.serialize(state.doc),source);
  const output=codec.serialize(state.apply(state.tr.insertText('New ',1)).doc);
  assert.match(output,/\[named link\]\[target\]/);assert.ok(output.endsWith('[target]: https://example.com "Title"\n[picture]: /assets/figure.png\n'));
  let image;state.doc.descendants(node=>{if(node.attrs.preview)image=node;});assert.match(image.attrs.preview,/figure.png/);
});
