/**
 * Breadboard's AFFiNE page editor: one BlockSuite doc (page + whiteboard) kept as a
 * `.affine` Garden file. The file is a zip — AFFiNE's snapshot format (snapshot JSON +
 * assets/) plus `breadboard.md`, the page as markdown, which the dashboard mirrors into
 * Quartz without running BlockSuite on the server. Every save is a new Garden version.
 */
import '../blocksuite/playground/style.css';

import type { DocMode } from '@blocksuite/affine/model';
import { AffineSchemas } from '@blocksuite/affine/schemas';
import { MarkdownAdapter, titleMiddleware } from '@blocksuite/affine/shared/adapters';
import {
  CommunityCanvasTextFonts,
  DocModeProvider,
  EditorSettingExtension,
  FontConfigExtension,
  GeneralSettingSchema,
  type EditorSetting,
} from '@blocksuite/affine/shared/services';
import { getAssetName, nanoid, Schema, Text, Transformer, type DocSnapshot, type Store } from '@blocksuite/affine/store';
import { TestWorkspace } from '@blocksuite/affine/store/test';
import { MemoryBlobSource } from '@blocksuite/affine/sync';
import type { TestAffineEditorContainer } from '@blocksuite/integration-test';
import { effects } from '@blocksuite/integration-test/effects';
import { getTestStoreManager } from '@blocksuite/integration-test/store';
import { getTestViewManager } from '@blocksuite/integration-test/view';
import { signal } from '@preact/signals-core';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

effects();

interface GardenFile { id: string; gardenId: string; name: string; revision: number; version: number }
interface Info { format: 'breadboard-affine'; version: 1; mode: DocMode }

const params = new URLSearchParams(location.search);
const gardenId = params.get('gardenId') ?? '', fileId = params.get('fileId') ?? '';
const readOnly = params.get('mode') === 'preview';
const api = `/api/gardens/${encodeURIComponent(gardenId)}/files/${encodeURIComponent(fileId)}`;
const SNAPSHOT = 'page.snapshot.json', MARKDOWN = 'breadboard.md', INFO = 'info.json';

const bar = document.querySelector<HTMLElement>('.bb-bar')!;
const status = bar.querySelector<HTMLElement>('.bb-status')!;
const post = (message: Record<string, unknown>) => parent.postMessage({ ...message, fileId }, location.origin);

/** Breadboard's theme drives BlockSuite's, which follows <html data-theme>. */
function applyTheme(theme: string | null) {
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
}
applyTheme((() => { try { return localStorage.getItem('breadboard:theme'); } catch { return null; } })());
addEventListener('message', event => {
  if (event.origin === location.origin && event.data?.type === 'breadboard:theme') applyTheme(event.data.theme);
});
addEventListener('storage', event => { if (event.key === 'breadboard:theme') applyTheme(event.newValue); });

function fail(message: string) {
  document.getElementById('app')!.innerHTML = '';
  const p = Object.assign(document.createElement('p'), { className: 'bb-failure', textContent: message });
  document.getElementById('app')!.append(p);
  post({ type: 'breadboard:affine-error', error: message });
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const body = await response.json().catch(() => ({})) as T & { error?: string; message?: string };
  if (!response.ok) throw Object.assign(new Error(body.error || body.message || `Request failed (${response.status}).`), { status: response.status });
  return body;
}

function editorSetting() {
  const initial = Object.fromEntries(Object.entries(GeneralSettingSchema.shape).map(([key, schema]) => [key, schema.parse(undefined)]));
  return signal(initial as EditorSetting);
}

async function main() {
  if (!gardenId || !fileId) return fail('No page was named. Open it from Spaces.');
  const { file: meta } = await request<{ file: GardenFile }>(api);
  let file = meta;
  const bytes = new Uint8Array(await (await fetch(`${api}/content`, { cache: 'no-store' })).arrayBuffer());
  let entries: Record<string, Uint8Array> = {};
  try { if (bytes.length) entries = unzipSync(bytes); } catch { return fail(`${file.name} is not an AFFiNE page Breadboard can open.`); }
  const info: Info = entries[INFO] ? { format: 'breadboard-affine', version: 1, mode: 'page', ...JSON.parse(strFromU8(entries[INFO])) } : { format: 'breadboard-affine', version: 1, mode: 'page' };

  const schema = new Schema().register(AffineSchemas);
  const collection = new TestWorkspace({ id: `garden-${fileId}`, idGenerator: nanoid, blobSources: { main: new MemoryBlobSource() } });
  collection.storeExtensions = getTestStoreManager().get('store');
  collection.meta.initialize();
  collection.start();

  let store: Store;
  const snapshot = entries[SNAPSHOT];
  if (snapshot) {
    const importer = new Transformer({
      schema, blobCRUD: collection.blobSync,
      docCRUD: {
        create: (id: string) => collection.createDoc(id).getStore({ id }),
        get: (id: string) => collection.getDoc(id)?.getStore({ id }) ?? null,
        delete: (id: string) => collection.removeDoc(id),
      },
      middlewares: [titleMiddleware(collection.meta.docMetas)],
    });
    for (const [path, data] of Object.entries(entries)) {
      if (!path.startsWith('assets/') || path.endsWith('/')) continue;
      const name = path.slice('assets/'.length);
      importer.assets.set(name.replace(/\.[^/.]+$/, ''), new File([data as BlobPart], name));
    }
    const imported = await importer.snapshotToDoc(JSON.parse(strFromU8(snapshot)) as DocSnapshot);
    if (!imported) return fail(`${file.name} could not be read.`);
    store = imported;
  } else {
    const doc = collection.createDoc('page');
    store = doc.getStore({ id: 'page' });
    doc.load(() => {
      const rootId = store.addBlock('affine:page', { title: new Text(file.name.replace(/\.affine$/i, '')) });
      store.addBlock('affine:surface', {}, rootId);
      const noteId = store.addBlock('affine:note', {}, rootId);
      store.addBlock('affine:paragraph', {}, noteId);
    });
  }
  store.load();
  store.resetHistory();
  if (readOnly) store.readonly = true;

  const editor = document.createElement('affine-editor-container') as TestAffineEditorContainer;
  editor.doc = store;
  editor.autofocus = !readOnly;
  const view = getTestViewManager();
  let mode: DocMode = info.mode;
  const modes = {
    getPrimaryMode: () => mode, onPrimaryModeChange: () => ({ unsubscribe() {} }) as never,
    getEditorMode: () => editor.mode, setEditorMode: (next: DocMode) => switchMode(next),
    setPrimaryMode: (next: DocMode) => switchMode(next), togglePrimaryMode: () => { switchMode(mode === 'page' ? 'edgeless' : 'page'); return mode; },
  };
  const shared = [
    FontConfigExtension(CommunityCanvasTextFonts),
    EditorSettingExtension({ setting$: editorSetting() }),
    { setup: (di: { override: (id: unknown, value: unknown) => void }) => di.override(DocModeProvider, () => modes) },
  ];
  editor.pageSpecs = [...view.get('page'), ...shared] as never;
  editor.edgelessSpecs = [...view.get('edgeless'), ...shared] as never;
  editor.mode = mode;
  document.getElementById('app')!.append(editor);
  await editor.updateComplete;

  const buttons = [...bar.querySelectorAll<HTMLButtonElement>('[data-mode]')];
  function switchMode(next: DocMode) {
    if (next === mode && editor.mode === next) return;
    mode = next;
    editor.switchEditor(next);
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.mode === next));
    if (!readOnly) schedule();
  }
  for (const button of buttons) button.onclick = () => switchMode(button.dataset.mode as DocMode);
  for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  bar.hidden = false;
  post({ type: 'breadboard:affine-ready' });
  if (readOnly) return;

  /** The page as a `.affine` zip: AFFiNE snapshot + assets + markdown for Quartz. */
  async function pack(): Promise<Uint8Array> {
    const job = store.getTransformer([titleMiddleware(collection.meta.docMetas)]);
    const snap = job.docToSnapshot(store);
    if (!snap) throw new Error('The page could not be read for saving.');
    const markdown = await new MarkdownAdapter(job, store.provider).fromDocSnapshot({ snapshot: snap, assets: job.assetsManager });
    const out: Record<string, Uint8Array> = {
      [INFO]: strToU8(JSON.stringify({ format: 'breadboard-affine', version: 1, mode } satisfies Info)),
      [SNAPSHOT]: strToU8(JSON.stringify(snap)),
      [MARKDOWN]: strToU8(markdown.file),
    };
    for (const blobId of new Set(job.assetsManager.getPathBlobIdMap().values())) {
      await job.assetsManager.readFromBlob(blobId);
      const blob = job.assets.get(blobId);
      if (blob) out[`assets/${getAssetName(job.assets, blobId)}`] = new Uint8Array(await blob.arrayBuffer());
    }
    return zipSync(out, { level: 6 });
  }

  let timer = 0, saving: Promise<void> | null = null, dirty = false, conflict = false;
  const setStatus = (text: string) => { status.textContent = text; };
  async function save() {
    if (conflict) return;
    // Loop: two callers waiting on one save must not both start the next one with the same revision.
    while (saving) await saving;
    if (!dirty) return;
    dirty = false;
    setStatus('Saving…');
    saving = (async () => {
      try {
        const body = await pack();
        const result = await request<{ file: GardenFile }>(`${api}/content`, { method: 'PUT', body: body as BlobPart, headers: { 'x-file-revision': String(file.revision), 'Content-Type': 'application/zip' } });
        file = result.file;
        setStatus('Saved');
        post({ type: 'breadboard:affine-saved', file });
        post({ type: 'breadboard:affine-dirty', dirty });
      } catch (cause) {
        const error = cause as Error & { status?: number };
        conflict = error.status === 409;
        dirty = true;
        setStatus(conflict ? 'Not saved' : 'Save failed');
        post({ type: 'breadboard:affine-error', error: error.message, conflict });
      } finally { saving = null; }
    })();
    await saving;
  }
  function schedule() {
    dirty = true;
    setStatus('Edited');
    post({ type: 'breadboard:affine-dirty', dirty: true });
    clearTimeout(timer);
    timer = window.setTimeout(() => void save(), 1200);
  }
  store.spaceDoc.on('update', (_update: Uint8Array, origin: unknown) => { if (origin !== 'breadboard-load') schedule(); });
  addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); clearTimeout(timer); void save(); }
  });
  addEventListener('message', event => {
    if (event.origin === location.origin && event.data?.type === 'breadboard:affine-flush') {
      clearTimeout(timer);
      void (dirty ? save() : Promise.resolve()).then(() => post({ type: 'breadboard:affine-flushed', file }));
    }
  });
  addEventListener('beforeunload', event => { if (dirty) event.preventDefault(); });
  // A page made from a tile starts as an empty file; give it its first real version at once.
  if (!snapshot) void save();

  // Bread edits this page from the corner assistant: its calls arrive over the dashboard's page bridge.
  const root = () => store.root as unknown as { props: { title: Text }; children: { flavour: string; id: string; children: unknown[] }[] };
  const titleText = () => root().props.title.toString();
  async function markdownOf(): Promise<string> {
    const job = store.getTransformer([titleMiddleware(collection.meta.docMetas)]);
    const snap = job.docToSnapshot(store);
    return snap ? (await new MarkdownAdapter(job, store.provider).fromDocSnapshot({ snapshot: snap, assets: job.assetsManager })).file : '';
  }
  async function append(markdown: string) {
    let note = root().children.filter(block => block.flavour === 'affine:note').at(-1);
    if (!note) note = store.getBlock(store.addBlock('affine:note', {}, store.root!.id))!.model as never;
    // A new page starts with one empty paragraph; content goes in its place, not under a blank line.
    const last = note!.children.at(-1) as { flavour: string; props?: { text?: Text } } | undefined;
    if (last?.flavour === 'affine:paragraph' && !last.props?.text?.length) store.deleteBlock(last as never);
    const job = store.getTransformer();
    const slice = await new MarkdownAdapter(job, store.provider).toSliceSnapshot({ file: markdown, assets: job.assetsManager, workspaceId: collection.id, pageId: store.id });
    if (!slice) throw new Error('That Markdown has no blocks to add.');
    // The adapter wraps blocks in a note; the page already has one, so insert its children.
    slice.content = slice.content[0].children;
    if (!(await job.snapshotToSlice(slice, store, note!.id))) throw new Error('The Markdown could not be added to the page.');
  }
  async function saved() {
    // Switching views keeps emitting updates for a moment, so save until nothing is left.
    for (let attempt = 0; attempt < 5 && (dirty || saving) && !conflict; attempt++) { clearTimeout(timer); await save(); }
    if (conflict) throw new Error('The change is on screen but was not saved: the file changed elsewhere. Ask the user to reopen the page.');
    if (dirty) throw new Error('The change is on screen but saving failed. Try again in a moment.');
    return { name: file.name, version: file.version, title: titleText(), mode };
  }
  const tools: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    page_read: async () => ({ title: titleText(), mode, markdown: await markdownOf() }),
    page_append: async args => { await append(String(args.markdown)); return saved(); },
    page_replace: async args => {
      for (const note of root().children.filter(block => block.flavour === 'affine:note')) {
        for (const child of [...note.children] as never[]) store.deleteBlock(child);
      }
      await append(String(args.markdown));
      return saved();
    },
    page_set_title: async args => { const title = root().props.title; title.replace(0, title.length, String(args.title).trim()); return saved(); },
    page_set_mode: async args => { switchMode(args.mode as DocMode); return saved(); },
  };
  (async function poll() {
    for (;;) {
      try {
        const query = new URLSearchParams({ garden: gardenId, file: fileId, title: titleText() || file.name, mode });
        const { calls } = await request<{ calls: { id: string; name: string; args: Record<string, unknown> }[] }>(`/api/spaces/page-bridge?${query}`);
        for (const call of calls) {
          let outcome: { result?: unknown; error?: string };
          try {
            if (!Object.hasOwn(tools, call.name)) throw new Error(`Unknown page tool ${call.name}.`);
            outcome = { result: await tools[call.name](call.args ?? {}) };
          }
          catch (cause) { outcome = { error: cause instanceof Error ? cause.message : String(cause) }; }
          await fetch('/api/spaces/page-bridge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: call.id, ...outcome }) });
        }
      } catch { await new Promise(resolve => setTimeout(resolve, 3000)); }
    }
  })();
}

main().catch(cause => fail(cause instanceof Error ? cause.message : String(cause)));
