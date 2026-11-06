import { EditorState, TextSelection, NodeSelection, Plugin, type Command, type Transaction, type SelectionBookmark } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import { Slice, Fragment, DOMSerializer, type Node as PMNode } from "@tiptap/pm/model";
import { baseKeymap, toggleMark, setBlockType, wrapIn, chainCommands, exitCode, lift } from "@tiptap/pm/commands";
import { keymap } from "@tiptap/pm/keymap";
import { history, undo, redo, closeHistory, isHistoryTransaction } from "@tiptap/pm/history";
import { gapCursor, GapCursor } from "@tiptap/pm/gapcursor";
import { dropCursor } from "@tiptap/pm/dropcursor";
import { wrapInList, splitListItem, sinkListItem, liftListItem } from "@tiptap/pm/schema-list";
import { tableEditing, addRowAfter, addColumnAfter, deleteRow, deleteColumn, deleteTable, goToNextCell } from "@tiptap/pm/tables";
import { inputRules, InputRule, wrappingInputRule, textblockTypeInputRule, undoInputRule } from "@tiptap/pm/inputrules";
import { editorSchema as schema, safeHref } from "./schema";
import { MarkdownCodec, embedKind } from "./markdown";
import { DraftRecovery, EditorTransport, SaveSession, sameDraft, type SavedDocument, type Draft, type RecoveryRecord } from "./session";
import { objectViews, flushBoards, type LocalImagePreview } from "./embeds";
import { annotationPlugin, paintAnnotations, readAnnotations, setAnswerStates, type Annotation } from "./annotations";
import { disposeObject } from "./registry";
import { ARTIFACT_CATEGORIES, artifactCategory, artifactKindLabel } from "../generated/artifact-reference";
import { mathAnnotationText } from "../../../../quartz/quartz/util/mathAnnotation";
import "./style.css";

declare global {
  interface Window {
    __quartzDocumentEditor?: {
      setEditable(value: boolean): Promise<void>;
      renderHighlights(entries: Annotation[]): Annotation[];
      getHighlights(): Annotation[];
      setAnswerStates(entries: { highlightId: string; state: string }[]): void;
      flush(): Promise<void>;
      getDraft(): Draft;
    };
  }
}
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
};
function button(label: string, run: () => unknown, className = '') {
  const node = element('button', className, label); node.type = 'button'; node.setAttribute('aria-label', label);
  node.addEventListener('mousedown', event => event.preventDefault());
  node.addEventListener('click', () => void run()); return node;
}

type MountInput = { slug: string; origin: string; initial?: SavedDocument };
const openingEditors = new WeakMap<HTMLElement, Promise<void>>();

export function mount(input: MountInput): Promise<void> {
  const article = document.querySelector<HTMLElement>('article.popover-hint');
  const actions = document.querySelector<HTMLElement>('.markdown-actions');
  if (!article || !actions) return Promise.reject(new Error('This page has no editable document.'));
  // A canonical refresh can rebind the Edit button while its first activation
  // awaits the document or recovery store. Every binding shares that operation.
  const opening = openingEditors.get(article);
  if (opening) return opening;
  if (window.__quartzDocumentEditor) return Promise.resolve();
  const rollback: (() => void)[] = [];
  const operation = mountDocument(input, article, actions, rollback).catch(error => {
    for (const undo of rollback.reverse()) { try { undo(); } catch { /* Preserve the opening error. */ } }
    throw error;
  }).finally(() => { openingEditors.delete(article); rollback.length = 0; });
  openingEditors.set(article, operation);
  return operation;
}

async function mountDocument(input: MountInput, article: HTMLElement, actions: HTMLElement, rollback: (() => void)[]) {
  const ensureCurrent = () => {
    if (!article.isConnected || document.querySelector('article.popover-hint') !== article ||
        document.querySelector('.markdown-actions') !== actions || actions.dataset.noteSlug !== input.slug) {
      throw new Error('The page changed while editing was opening.');
    }
  };
  const transport = new EditorTransport(input.slug, input.origin);
  rollback.push(() => transport.destroy());
  // Fetch again on activation: a cached capability probe is not a document revision.
  let initial: SavedDocument;
  try {
    initial = await transport.request('get') as SavedDocument;
    if (!initial.canEdit) throw new Error('This page is read-only.');
    await flushBoards(article);
  } catch (error) { transport.destroy(); throw error; }
  ensureCurrent();
  const openingScroll = window.scrollY;
  const visibleElement = document.elementFromPoint(Math.max(0, article.getBoundingClientRect().left + 30), Math.min(window.innerHeight - 30, Math.max(60, article.getBoundingClientRect().top + 40)))?.closest('p,h2,h3,h4,li');
  const readingAnchor = visibleElement && article.contains(visibleElement) ? { text: visibleElement.textContent, top: visibleElement.getBoundingClientRect().top } : null;
  const selectedQuote = article.contains(window.getSelection()?.anchorNode ?? null) ? window.getSelection()?.toString() : '';
  let codec = new MarkdownCodec(), editing = false, disposed = false;
  let sourceDirty = false, formBookmark: ReturnType<EditorState['selection']['getBookmark']> | null = null;
  let applyingSource: Promise<void> | undefined;
  let lastEditAt = -Infinity;
  let serializeTimer: ReturnType<typeof setTimeout> | undefined;
  let snapshotDeadline: ReturnType<typeof setTimeout> | undefined;
  rollback.push(() => clearSnapshotTimers());
  const pendingObjects = new Set<{ bookmark: SelectionBookmark }>();
  const pendingUploads = new Map<string, Promise<void>>();
  const completedUploads = new Map<string, string>();
  const localImages = new Map<string, LocalImagePreview>();
  const releaseImages = () => { for (const image of localImages.values()) URL.revokeObjectURL(image.url); localImages.clear(); };
  rollback.push(releaseImages);
  const recovery = new DraftRecovery(`${input.origin}:${initial.accountId}:${input.slug}`);
  rollback.push(() => recovery.destroy());
  let recoveryError: unknown;
  const restored = await recovery.read().catch(error => { recoveryError = error; return undefined; });
  ensureCurrent();
  const hasRecovery = restored && !sameDraft(restored.draft, initial);
  // Finish fallible preparation before adding controls or replacing the reader.
  const doc = codec.parse(hasRecovery ? restored.draft.body : initial.body);
  const status = actions.querySelector<HTMLElement>('.markdown-action-status') ?? element('span');
  const retry = button('Retry save', () => void flush().catch(showError)); retry.hidden = true; actions.append(retry);
  const annotationsButton = button('Annotations', () => {
    const dialog = element('dialog', 'bb-document-dialog'); dialog.append(element('h2', '', 'Page annotations'));
    const entries = readAnnotations(view);
    if (!entries.length) dialog.append(element('p', '', 'Select text to highlight it or add a note.'));
    for (const entry of entries) {
      const item = element('section', 'bb-annotation'); item.dataset.annotationId = entry.id;
      item.append(element('blockquote', '', entry.text));
      if (entry.detached) item.append(element('small', '', 'Unattached — the selected text was removed.'));
      if (entry.note) item.append(element('p', '', entry.note));
      dialog.append(item);
    }
    document.dispatchEvent(new CustomEvent('bb:annotation-list', { detail: { root: dialog } }));
    dialog.append(button('Close', () => dialog.close())); dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog); dialog.showModal();
  }); actions.append(annotationsButton);
  rollback.push(() => { retry.remove(); annotationsButton.remove(); });
  function showError(error: unknown) { status.textContent = error instanceof Error ? error.message : String(error); retry.hidden = false; }
  const title = document.querySelector<HTMLElement>('h1.article-title');
  if (title) title.textContent = initial.title;
  const toolbar = element('div', 'bb-document-toolbar'); toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', 'Document formatting'); toolbar.hidden = true;
  const metadata = element('div', 'bb-document-metadata'); metadata.hidden = true;
  const tagLabel = element('label', '', 'Tags '), tags = element('input'); tags.setAttribute('aria-label', 'Page tags'); tags.value = initial.tags.join(', '); tagLabel.append(tags); metadata.append(tagLabel);
  (actions.closest('.bb-document-heading') ?? actions).after(toolbar, metadata);
  const sourcePanel = element('section', 'bb-document-source'); sourcePanel.hidden = true;
  const sourceInput = element('textarea'); sourceInput.spellcheck = false; sourceInput.setAttribute('aria-label', 'Markdown source');
  const applySource = button('Apply source', async () => { try { await applySourceChanges(); if (!sourceDirty) closeSource(); } catch (error) { showError(error); } });
  sourcePanel.append(element('p', '', 'Edit the Markdown source for this page.'), sourceInput, applySource,
    button('Cancel source changes', () => { sourceDirty = false; closeSource(); scheduleSnapshot();
      void persistRecovery().catch(showError); }));
  article.after(sourcePanel);
  sourceInput.addEventListener('input', () => { sourceDirty = true; scheduleSnapshot(); });
  const conflictPanel = element('section', 'bb-document-conflict'); conflictPanel.hidden = true; conflictPanel.setAttribute('role', 'alert'); toolbar.after(conflictPanel);
  rollback.push(() => { toolbar.remove(); metadata.remove(); sourcePanel.remove(); conflictPanel.remove(); });
  // An acknowledgement for an older rich-text save must never erase a newer
  // source draft (or typing still waiting for the snapshot debounce).
  const save: SaveSession = new SaveSession(initial, patch => transport.request('save', patch), { write: (value, backup): Promise<void> =>
    backup ? recovery.write(value, true) : persistRecovery(value?.base) }, (message, error) => {
    status.textContent = !error && sourceDirty ? 'Source changes waiting to apply'
      : !error && serializeTimer ? 'Unsaved changes' : message; retry.hidden = !error;
    if (save.conflict) showConflict();
  }, revision => {
    document.dispatchEvent(new CustomEvent('bb:document-title', { detail: { slug: input.slug, title: save.base.title } }));
    if (codec.serialize(view.state.doc) === save.base.body) document.dispatchEvent(new CustomEvent('bb:editor-saved', { detail: { revision, highlights: readAnnotations(view, revision) } }));
  });
  rollback.push(() => save.destroy());
  if (recoveryError) showError(recoveryError);
  if (hasRecovery) {
    save.draft = restored.draft;
    if (title) title.textContent = restored.draft.title; tags.value = restored.draft.tags.join(', ');
    if (restored.base.revision !== initial.revision) save.conflict = initial;
    status.textContent = 'Recovered your unsaved draft';
  }
  const run = (command: Command) => { if (!editing) return; command(view.state, view.dispatch, view); view.focus(); };
  const objectActions = {
    edit(node: PMNode, position: number) {
      if (!editing) return;
      formBookmark = NodeSelection.create(view.state.doc, position).getBookmark();
      if (node.attrs.kind === 'image' && !node.attrs.raw.includes('\n')) { editImage(node); return; }
      editText(node.attrs.kind === 'math' ? 'Equation' : 'Embed source', node.attrs.raw, async raw => {
        if (node.attrs.kind === 'whiteboard') await flushBoards(article!);
        const resolved = formBookmark?.resolve(view.state.doc);
        if (!(resolved instanceof NodeSelection)) return;
        view.dispatch(view.state.tr.setNodeMarkup(resolved.from, undefined, { ...resolved.node.attrs, raw, preview: null, image: null, localImageId: null, kind: embedKind(raw), sourceId: null }).setMeta('bb-board-flushed', true));
      });
    },
    async move(position: number, direction: -1 | 1) {
      const savedPosition = await preserveObject(position); if (savedPosition === null) return; position = savedPosition;
      const resolved = view.state.doc.resolve(position), node = view.state.doc.nodeAt(position);
      if (!node) return;
      const index = resolved.index(), adjacent = resolved.parent.maybeChild(index + direction); if (!adjacent) return;
      const children: PMNode[] = []; resolved.parent.forEach(child => children.push(child));
      [children[index], children[index + direction]] = [children[index + direction], children[index]];
      if (!resolved.parent.type.validContent(Fragment.from(children))) throw new Error('Keep the first line of this list item as text.');
      const target = direction < 0 ? position - adjacent.nodeSize : position + adjacent.nodeSize;
      const tr = view.state.tr.delete(position, position + node.nodeSize).insert(target, node)
        .setMeta('bb-board-flushed', true).setMeta('bb-object-move', { from: position, to: target, size: node.nodeSize });
      view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, target)));
    },
    async remove(position: number) {
      const savedPosition = await preserveObject(position); if (savedPosition === null) return;
      const node = view.state.doc.nodeAt(savedPosition); if (node) view.dispatch(view.state.tr.delete(savedPosition, savedPosition + node.nodeSize).setMeta('bb-board-flushed', true));
    }, error: showError,
  };
  async function preserveObject(position: number) {
    const original = view.state.doc.nodeAt(position), pending = { bookmark: NodeSelection.create(view.state.doc, position).getBookmark() };
    pendingObjects.add(pending);
    try { await flushBoards(article!); const selected = pending.bookmark.resolve(view.state.doc);
      return selected instanceof NodeSelection && selected.node.eq(original!) ? selected.from : null;
    } finally { pendingObjects.delete(pending); }
  }
  const pasteFiles = (files: File[]) => { for (const file of files) void upload(file).catch(showError); };
  const markRule = (pattern: RegExp, name: string) => new InputRule(pattern, (state, match, start, end) =>
    state.tr.insertText(match[1], start, end).addMark(start, start + match[1].length, schema.marks[name].create()).removeStoredMark(schema.marks[name]));
  const state = EditorState.create({ doc, schema, plugins: [
    history(), annotationPlugin, gapCursor(), dropCursor(), tableEditing(),
    inputRules({ rules: [wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote), wrappingInputRule(/^\s*([-+*])\s$/, schema.nodes.bullet_list),
      wrappingInputRule(/^(\d+)\.\s$/, schema.nodes.ordered_list, match => ({ order: Number(match[1]) }),
        (match, node) => node.childCount + node.attrs.order === Number(match[1])),
      textblockTypeInputRule(/^(#{1,6})\s$/, schema.nodes.heading, match => ({ level: match[1].length })),
      textblockTypeInputRule(/^```([\w-]+)?\s$/, schema.nodes.code_block, match => ({ language: match[1] ?? '' })),
      markRule(/\*\*([^*]+)\*\*$/, 'strong'), markRule(/(?<!\*)\*([^*]+)\*$/, 'em'), markRule(/~~([^~]+)~~$/, 'strike'), markRule(/`([^`]+)`$/, 'code')] }),
    keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Mod-Shift-z': redo, 'Mod-b': toggleMark(schema.marks.strong), 'Mod-i': toggleMark(schema.marks.em),
      'Mod-Shift-x': toggleMark(schema.marks.strike), 'Mod-`': toggleMark(schema.marks.code), 'Mod-k': () => { editLink(); return true; }, 'Mod-s': () => { void flush().catch(showError); return true; },
      Backspace: undoInputRule,
      'Mod-Alt-0': setBlockType(schema.nodes.paragraph),
      'Mod-Alt-1': setBlockType(schema.nodes.heading, { level: 1 }),
      'Mod-Alt-2': setBlockType(schema.nodes.heading, { level: 2 }),
      'Mod-Alt-3': setBlockType(schema.nodes.heading, { level: 3 }),
      'Mod-Home': (state, dispatch) => { const selection = TextSelection.atStart(state.doc); dispatch?.(state.tr.setSelection(selection instanceof NodeSelection ? new GapCursor(state.doc.resolve(0)) : selection).scrollIntoView()); return true; },
      'Mod-End': (state, dispatch) => { const selection = TextSelection.atEnd(state.doc); dispatch?.(state.tr.setSelection(selection instanceof NodeSelection ? new GapCursor(state.doc.resolve(state.doc.content.size)) : selection).scrollIntoView()); return true; },
      Enter: chainCommands(splitListItem(schema.nodes.list_item), baseKeymap.Enter),
      Tab: chainCommands(goToNextCell(1), sinkListItem(schema.nodes.list_item)), 'Shift-Tab': chainCommands(goToNextCell(-1), liftListItem(schema.nodes.list_item)),
      'Mod-Enter': exitCode, 'Mod-[': lift, ...{} }), keymap(baseKeymap),
    new Plugin({ filterTransaction(tr) {
      // Never tear down a drawing with a pending save through keyboard deletion or undo.
      if (!tr.docChanged || tr.getMeta('bb-board-flushed')) return true;
      if (tr.steps.every(step => !('from' in step && 'to' in step) || (step as any).from === (step as any).to)) return true;
      const boards = article.querySelectorAll('.penecho-board--ready iframe');
      if (!boards.length) return true;
      let removed = false;
      view.state.doc.descendants((node, pos) => { if (node.type.name === 'embed' && node.attrs.kind === 'whiteboard' && tr.mapping.mapResult(pos + 1).deleted) removed = true; });
      if (removed) { const before = view.state.doc; void flushBoards(article).then(() => { if (view.state.doc === before) view.dispatch(tr.setMeta('bb-board-flushed', true)); }).catch(showError); return false; }
      return true;
    } }),
  ] });
  article.dataset.documentEditor = 'true';
  disposeObject(article);
  const previousChildren = [...article.childNodes];
  let view: EditorView;
  rollback.push(() => {
    view?.destroy(); article.replaceChildren(...previousChildren);
    delete article.dataset.documentEditor;
  });
  article.replaceChildren();
  view = new EditorView(article, { state, editable: () => editing,
    attributes: state => ({ class: `bb-document ProseMirror${state.doc.childCount >= 80 ? ' bb-document-long' : ''}`, role: 'textbox', 'aria-label': 'Page content', 'aria-multiline': 'true', spellcheck: 'true' }),
    nodeViews: objectViews(transport, objectActions, localImages, () => view.composing || performance.now() - lastEditAt < 750),
    dispatchTransaction(tr) {
      if (formBookmark) formBookmark = formBookmark.map(tr.mapping);
      for (const pending of pendingObjects) pending.bookmark = pending.bookmark.map(tr.mapping);
      view.updateState(view.state.apply(tr));
      if (tr.docChanged) { lastEditAt = performance.now(); scheduleSnapshot(); }
      if (isHistoryTransaction(tr) && completedUploads.size) queueMicrotask(restoreUploads);
      updateToolbar();
    },
    handleClick(_view, _pos, event) {
      const target = event.target as Element;
      const link = target.closest<HTMLAnchorElement>('a');
      if (link && editing && !(event.ctrlKey || event.metaKey)) { event.preventDefault(); return true; }
      const task = target.closest<HTMLElement>('li[data-checked]');
      if (task && editing && event.clientX < task.getBoundingClientRect().left + 20) {
        const pos = view.posAtDOM(task, 0) - 1, node = view.state.doc.nodeAt(pos);
        if (node?.type === schema.nodes.list_item) { view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: !node.attrs.checked })); return true; }
      }
      return false;
    },
    handlePaste(_view, event) {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length) { event.preventDefault(); pasteFiles(files); return true; }
      const markdown = event.clipboardData?.getData('text/x-breadboard-markdown') || event.clipboardData?.getData('text/markdown');
      if (markdown) { insertMarkdown(markdown); return true; }
      return false;
    },
    handleDrop(_view, event) {
      const files = Array.from(event.dataTransfer?.files ?? []); if (!files.length) return false;
      const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
      if (at) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(at.pos))));
      event.preventDefault(); pasteFiles(files); return true;
    },
    clipboardTextSerializer: slice => { const temporary = new MarkdownCodec(); temporary.parse(''); return temporary.serialize(schema.nodes.doc.create(null, slice.content)).trim(); },
    transformPastedHTML: html => {
      const template = document.createElement('template'); template.innerHTML = html;
      template.content.querySelectorAll('script,style,iframe,object,embed').forEach(n => n.remove());
      template.content.querySelectorAll('*').forEach(el => [...el.attributes].forEach(attr => { if (/^on/i.test(attr.name)) el.removeAttribute(attr.name); }));
      return template.innerHTML;
    },
    handleDOMEvents: {
      copy(_view, event) {
        if (!event.clipboardData || view.state.selection.empty) return false;
        const slice = view.state.selection.content();
        const content = slice.content.firstChild?.isInline ? schema.nodes.paragraph.create(null, slice.content) : slice.content;
        const markdown = codec.serialize(schema.nodes.doc.create(null, content));
        const html = document.createElement('div'); html.append(DOMSerializer.fromSchema(schema).serializeFragment(slice.content));
        event.clipboardData.setData('text/x-breadboard-markdown', markdown);
        event.clipboardData.setData('text/plain', view.state.doc.textBetween(view.state.selection.from, view.state.selection.to, '\n\n', node => node.attrs.kind === 'math' ? mathAnnotationText(node.attrs.raw, node.isBlock) : ''));
        event.clipboardData.setData('text/html', html.innerHTML); event.preventDefault(); return true;
      },
    },
  });

  function snapshot(): Draft {
    return { body: codec.serialize(view.state.doc), title: title?.textContent ?? save.draft.title, tags: tags.value.split(/[,#]/).map(tag => tag.trim()).filter(Boolean) };
  }
  function persistRecovery(base: SavedDocument = save.base): Promise<void> {
    const draft = snapshot();
    if (sourceDirty) draft.body = sourceInput.value;
    const record: RecoveryRecord | null = sameDraft(draft, base) ? null : { draft, base, updatedAt: Date.now() };
    return recovery.write(record);
  }
  function clearSnapshotTimers() {
    clearTimeout(serializeTimer); clearTimeout(snapshotDeadline);
    serializeTimer = snapshotDeadline = undefined;
  }
  function commitSnapshot() {
    clearSnapshotTimers();
    if (disposed) return;
    // Retain the pending snapshot until IME composition has actually committed.
    if (view.composing) { serializeTimer = setTimeout(commitSnapshot, 100); return; }
    if (sourceDirty) { void persistRecovery().catch(showError); return; }
    save.update(snapshot()); void save.flush().catch(showError);
  }
  function scheduleSnapshot() {
    if (disposed) return;
    clearTimeout(serializeTimer);
    if (!save.conflict) status.textContent = sourceDirty ? 'Source changes waiting to apply' : 'Unsaved changes';
    // Serializing is debounced separately from the editor's synchronous typing path.
    serializeTimer = setTimeout(commitSnapshot, 750);
    snapshotDeadline ??= setTimeout(commitSnapshot, 5000);
  }
  async function applySourceChanges() {
    while (applyingSource) await applyingSource;
    if (!sourceDirty) return;
    const source = sourceInput.value;
    applyingSource = replaceSource(source);
    try { await applyingSource; sourceDirty = sourceInput.value !== source; }
    finally { applyingSource = undefined; }
  }
  function closeSource() {
    sourcePanel.hidden = true; article.hidden = false; updateToolbar(); view.focus();
  }
  async function flush() {
    while (sourceDirty) await applySourceChanges();
    clearSnapshotTimers();
    const uploads: Promise<void>[] = [];
    if (pendingUploads.size) view.state.doc.descendants(node => { const upload = pendingUploads.get(node.attrs.uploadId); if (upload) uploads.push(upload); });
    await Promise.all(uploads); await flushBoards(article!);
    while (sourceDirty) await applySourceChanges();
    clearSnapshotTimers(); save.update(snapshot()); await save.flush();
  }
  async function replaceSource(source: string) {
    await flushBoards(article!);
    // Retain one codec's original source records across source edits and undo.
    const next = codec.parse(source);
    view.dispatch(closeHistory(view.state.tr.replaceWith(0, view.state.doc.content.size, next.content).setDocAttribute('sourceContext', next.attrs.sourceContext)
      .setMeta('bb-board-flushed', true).setMeta('bb-source-replaced', true)));
    scheduleSnapshot();
  }
  function insertMarkdown(source: string) {
    const next = new MarkdownCodec().parse(source);
    view.dispatch(closeHistory(finishInsertion(view.state.tr.replaceSelection(new Slice(next.content, 0, 0)))).scrollIntoView()); view.focus();
  }
  function finishInsertion(tr: Transaction) {
    if (tr.selection instanceof NodeSelection) {
      const after = tr.selection.to;
      tr.insert(after, schema.nodes.paragraph.create()).setSelection(TextSelection.create(tr.doc, after + 1));
    }
    return tr;
  }
  function editText(label: string, value: string, apply: (value: string) => void | Promise<void>) {
    formBookmark ??= view.state.selection.getBookmark();
    const dialog = element('dialog', 'bb-document-dialog'); const heading = element('h2', '', label);
    const field = element('textarea'); field.value = value; field.setAttribute('aria-label', label); field.spellcheck = false;
    dialog.append(heading, field, button('Apply', async () => { try { await apply(field.value); dialog.close(); dialog.remove(); formBookmark = null; view.focus(); } catch (error) { showError(error); } }),
      button('Cancel', () => { dialog.close(); dialog.remove(); formBookmark = null; view.focus(); }));
    dialog.addEventListener('cancel', () => { dialog.remove(); formBookmark = null; view.focus(); });
    document.body.append(dialog); dialog.showModal(); field.focus();
  }
  function editLink() {
    const current = view.state.selection.$from.marks().find(mark => mark.type === schema.marks.link);
    if (current && view.state.selection.empty) {
      const parent = view.state.selection.$from.parent, start = view.state.selection.$from.start();
      let from = view.state.selection.from, to = from;
      parent.forEach((child, offset) => { if (current.isInSet(child.marks) && start + offset <= to && start + offset + child.nodeSize >= from) { from = Math.min(from, start + offset); to = Math.max(to, start + offset + child.nodeSize); } });
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
    }
    formBookmark = view.state.selection.getBookmark();
    editText('Link URL or [[note]]', current ? current.attrs.wiki ? `[[${current.attrs.href}]]` : current.attrs.href : '', value => {
      const selection = formBookmark?.resolve(view.state.doc) ?? view.state.selection;
      const tr = view.state.tr.setSelection(selection);
      if (!value.trim()) tr.removeMark(selection.from, selection.to, schema.marks.link);
      else {
        const wiki = /^\[\[.*\]\]$/.test(value), [href, alias] = wiki ? value.slice(2, -2).split('|') : [safeHref(value.trim())];
        const mark = schema.marks.link.create({ href, wiki });
        if (selection.empty || alias) tr.replaceSelectionWith(schema.text(alias || href, [mark]), false); else tr.addMark(selection.from, selection.to, mark);
      }
      view.dispatch(tr);
    });
  }
  function editImage(node: PMNode) {
    const raw = String(node.attrs.raw), template = document.createElement('template');
    if (raw.startsWith('<')) template.innerHTML = raw;
    const img = template.content.querySelector('img');
    const md = raw.match(/^!\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))/), wiki = raw.match(/^!\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/);
    const label = wiki?.[2]?.replace(/\|?\d+(?:x\d+)?$/, '') ?? '';
    const dimensions = wiki?.[2]?.match(/(\d+)(?:x(\d+))?$/);
    const dialog = element('dialog', 'bb-document-dialog'); dialog.append(element('h2', '', 'Image settings'));
    const fields: HTMLInputElement[] = [];
    for (const [name, value] of [['Image URL', img?.getAttribute('src') ?? md?.[2] ?? md?.[3] ?? wiki?.[1] ?? ''], ['Alternative text', img?.alt ?? md?.[1] ?? label], ['Width', img?.getAttribute('width') ?? dimensions?.[1] ?? ''], ['Height', img?.getAttribute('height') ?? dimensions?.[2] ?? '']]) {
      const label = element('label', 'bb-image-field', name), field = element('input'); field.value = value; field.setAttribute('aria-label', name); label.append(field); dialog.append(label); fields.push(field);
    }
    dialog.append(button('Apply', () => {
      const selection = formBookmark?.resolve(view.state.doc);
      if (selection instanceof NodeSelection) {
        const next = document.createElement('img'); next.setAttribute('src', safeHref(fields[0].value)); next.alt = fields[1].value;
        for (const [index, attr] of [[2, 'width'], [3, 'height']] as const) if (/^[1-9]\d{0,4}$/.test(fields[index].value)) next.setAttribute(attr, fields[index].value);
        view.dispatch(view.state.tr.setNodeMarkup(selection.from, undefined, { ...selection.node.attrs, raw: next.outerHTML, preview: null, image: null, localImageId: null, sourceId: null }));
      }
      dialog.close();
    }), button('Cancel', () => dialog.close()));
    dialog.addEventListener('close', () => { dialog.remove(); formBookmark = null; view.focus(); });
    document.body.append(dialog); dialog.showModal(); fields[1].focus();
  }
  function addTable() {
    const row = (header: boolean) => schema.nodes.table_row.create(null, [1,2,3].map(() => schema.nodes[header ? 'table_header' : 'table_cell'].create(null, schema.nodes.paragraph.create())));
    view.dispatch(view.state.tr.replaceSelectionWith(schema.nodes.table.create(null, [row(true), row(false)])));
    view.focus();
  }
  const blockType = element('select'); blockType.setAttribute('aria-label', 'Paragraph style');
  for (const [value, label] of [['paragraph','Paragraph'],['1','Heading 1'],['2','Heading 2'],['3','Heading 3'],['4','Heading 4'],['5','Heading 5'],['6','Heading 6'],['code','Code']]) { const option = element('option', '', label); option.value = value; blockType.append(option); }
  blockType.onchange = () => run(blockType.value === 'paragraph' ? setBlockType(schema.nodes.paragraph) : blockType.value === 'code' ? setBlockType(schema.nodes.code_block) : setBlockType(schema.nodes.heading, { level: Number(blockType.value) }));
  toolbar.append(blockType);
  const formats: [string, Command, string, string][] = [
    ['Bold', toggleMark(schema.marks.strong), 'strong', 'Ctrl/⌘ B'],
    ['Italic', toggleMark(schema.marks.em), 'em', 'Ctrl/⌘ I'],
    ['Strikethrough', toggleMark(schema.marks.strike), 'strike', 'Ctrl/⌘ Shift X'],
    ['Inline code', toggleMark(schema.marks.code), 'code', 'Ctrl/⌘ `'],
  ];
  const formatButtons: { control: HTMLButtonElement; mark: string; command: Command }[] = [];
  function formatButton(label: string, command: Command, mark: string, shortcut: string) {
    const control = button(label, () => run(command)); control.title = `${label} (${shortcut})`;
    formatButtons.push({ control, mark, command }); return control;
  }
  for (const format of formats) toolbar.append(formatButton(...format));
  const undoButton = button('Undo', () => run(undo)), redoButton = button('Redo', () => run(redo));
  undoButton.title = 'Undo (Ctrl/⌘ Z)'; redoButton.title = 'Redo (Ctrl/⌘ Shift Z)';
  toolbar.append(button('Link', editLink), button('Bullet list', () => run(wrapInList(schema.nodes.bullet_list))),
    button('Numbered list', () => run(wrapInList(schema.nodes.ordered_list))), button('Quote', () => run(wrapIn(schema.nodes.blockquote))),
    undoButton, redoButton);
  const insert = element('select'); insert.setAttribute('aria-label', 'Insert content');
  for (const [value, label] of [['','Insert…'],['image','Upload images'],['image-reference','Image reference'],['video','Upload video'],['audio','Audio reference'],['youtube','YouTube'],['whiteboard','Whiteboard'],['artifact','Artifact / visualizer'],['table','Table'],['math','Equation'],['mermaid','Diagram'],['callout','Callout'],['task','Checklist']]) { const option = element('option', '', label); option.value = value; insert.append(option); }
  toolbar.append(insert);
  const advanced = element('select'); advanced.setAttribute('aria-label', 'Advanced editing');
  for (const [value, label] of [['', 'Advanced…'], ['source', 'Markdown source']]) { const option = element('option', '', label); option.value = value; advanced.append(option); }
  advanced.onchange = () => { if (advanced.value === 'source') {
    if (sourcePanel.hidden) sourceInput.value = codec.serialize(view.state.doc);
    sourcePanel.hidden = false; article.hidden = true; updateToolbar(); sourceInput.focus();
  } advanced.value = ''; };
  toolbar.append(advanced);
  const tableTools = element('span', 'bb-table-tools'); tableTools.hidden = true;
  for (const [label, command] of [['Add row', addRowAfter], ['Add column', addColumnAfter], ['Delete row', deleteRow], ['Delete column', deleteColumn], ['Delete table', deleteTable]] as [string, Command][]) tableTools.append(button(label, () => run(command)));
  toolbar.append(tableTools);
  let toolbarSourceOpen: boolean | undefined;
  const setDisabled = (control: HTMLButtonElement | HTMLSelectElement, disabled: boolean) => {
    if (control.disabled !== disabled) control.disabled = disabled;
  };
  function updateToolbar() {
    const { selection, storedMarks } = view.state;
    const parent = selection.$from.parent;
    if (toolbarSourceOpen !== !sourcePanel.hidden) {
      toolbarSourceOpen = !sourcePanel.hidden;
      toolbar.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button,select').forEach(control => {
        setDisabled(control, toolbarSourceOpen! && control !== advanced);
      });
    }
    for (const { control, mark, command } of formatButtons) {
      const type = schema.marks[mark];
      const active = selection.empty ? !!type.isInSet(storedMarks ?? selection.$from.marks())
        : view.state.doc.rangeHasMark(selection.from, selection.to, type);
      if (control.getAttribute('aria-pressed') !== String(active)) control.setAttribute('aria-pressed', String(active));
      setDisabled(control, !sourcePanel.hidden || !command(view.state));
    }
    setDisabled(undoButton, !sourcePanel.hidden || !undo(view.state));
    setDisabled(redoButton, !sourcePanel.hidden || !redo(view.state));
    blockType.value = parent.type === schema.nodes.heading ? String(parent.attrs.level) : parent.type === schema.nodes.code_block ? 'code' : 'paragraph';
    tableTools.hidden = !Array.from({ length: view.state.selection.$from.depth }, (_, i) => view.state.selection.$from.node(i + 1)).some(n => n.type.spec.tableRole === 'table');
  }
  const filePicker = element('input'); filePicker.type = 'file'; filePicker.hidden = true; toolbar.append(filePicker);
  filePicker.onchange = () => { pasteFiles(Array.from(filePicker.files ?? [])); filePicker.value = ''; };
  insert.onchange = () => {
    const value = insert.value; insert.value = ''; view.focus();
    if (value === 'image' || value === 'video') { filePicker.accept = value === 'image' ? 'image/png,image/jpeg,image/webp,image/gif' : '.mp4,.m4v,.webm,.ogv,.mov'; filePicker.multiple = value === 'image'; filePicker.click(); }
    else if (value === 'youtube') editText('YouTube URL', '', url => { void insertRequest('youtube', { url }).catch(showError); });
    else if (value === 'image-reference') editText('Image URL or existing path', '', url => insertMarkdown(`![](<${safeHref(url).replace(/>/g, '%3E')}>)`));
    else if (value === 'audio') editText('Audio URL or existing path', '', url => insertMarkdown(`![[${safeHref(url).replace(/[\[\]\r\n]/g, '')}]]`));
    else if (value === 'whiteboard') insertMarkdown('```penecho\nid: ' + Date.now() + '-' + crypto.randomUUID() + '\ntitle: Whiteboard\nheight: 520\n```');
    else if (value === 'math') insertMarkdown('$$\nx^2\n$$');
    else if (value === 'mermaid') insertMarkdown('```mermaid\nflowchart LR\n  A --> B\n```');
    else if (value === 'callout') insertMarkdown('> [!note] Note\n> Write here.');
    else if (value === 'task') insertMarkdown('- [ ] Task');
    else if (value === 'table') addTable();
    else if (value === 'artifact') openArtifacts();
  };
  function insertRequest(action: string, payload: unknown, preview?: LocalImagePreview): Promise<void> {
    const id = crypto.randomUUID();
    if (preview) localImages.set(id, preview);
    const task = performInsertRequest(id, action, payload); pendingUploads.set(id, task);
    void task.finally(() => pendingUploads.delete(id)).catch(() => {}); return task;
  }
  function uploadedContent(id: string, markdown: string) {
    const parsed = new MarkdownCodec().parse(markdown);
    const local = localImages.get(id);
    if (!local || parsed.childCount !== 1 || parsed.firstChild?.type !== schema.nodes.embed) return parsed.content;
    local.raw = parsed.firstChild.attrs.raw;
    return Fragment.from(parsed.firstChild.type.create({ ...parsed.firstChild.attrs, localImageId: id }, parsed.firstChild.content));
  }
  function restoreUploads() {
    if (disposed) return;
    const tr = view.state.tr;
    view.state.doc.descendants((node, position) => {
      const markdown = completedUploads.get(node.attrs.uploadId);
      if (markdown) tr.replaceWith(tr.mapping.map(position), tr.mapping.map(position + node.nodeSize), uploadedContent(node.attrs.uploadId, markdown));
    });
    if (tr.docChanged) view.dispatch(tr.setMeta('addToHistory', false));
  }
  async function performInsertRequest(id: string, action: string, payload: unknown) {
    const placeholder = schema.nodes.embed.create({ raw: '', kind: 'upload', uploadId: id });
    view.dispatch(closeHistory(finishInsertion(view.state.tr.replaceSelectionWith(placeholder))));
    try {
      const result = await transport.request(action, typeof payload === 'function' ? await payload() : payload);
      completedUploads.set(id, result.markdown);
      let position: number | undefined; view.state.doc.descendants((n, pos) => { if (n.attrs.uploadId === id) position = pos; });
      if (position === undefined || disposed) return;
      const content = uploadedContent(id, result.markdown);
      view.dispatch(view.state.tr.replaceWith(position, position + 1, content).setMeta('addToHistory', false));
    } catch (error) {
      let position: number | undefined; view.state.doc.descendants((n, pos) => { if (n.attrs.uploadId === id) position = pos; });
      if (position !== undefined) view.dispatch(view.state.tr.delete(position, position + 1).setMeta('addToHistory', false));
      throw error;
    }
  }
  async function upload(file: File) {
    if (file.type.startsWith('image/')) {
      await insertRequest('images', async () => {
        const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
        return { images: [{ fileName: file.name, mimeType: file.type, dataUrl }] };
      }, { url: URL.createObjectURL(file), name: file.name });
    } else await insertRequest('video', { file });
  }
  function openArtifacts() {
    formBookmark = view.state.selection.getBookmark();
    const dialog = element('dialog', 'bb-document-dialog'), search = element('input'), list = element('div', 'bb-artifact-list');
    search.type = 'search'; search.placeholder = 'Search garden artifacts'; search.setAttribute('aria-label', 'Search garden artifacts');
    const filters = element('div', 'bb-artifact-filters'), listStatus = element('p', 'bb-artifact-status'); listStatus.setAttribute('aria-live', 'polite');
    let category: string = 'All', requestId = '', items: any[] = [], timeout: ReturnType<typeof setTimeout>;
    const load = () => { requestId = crypto.randomUUID(); listStatus.textContent = 'Loading artifacts…'; clearTimeout(timeout);
      timeout = setTimeout(() => { listStatus.textContent = 'Could not load artifacts. Select Refresh to try again.'; }, 20_000);
      window.parent.postMessage({ type: 'second-brain:list-markdown-artifacts', slug: input.slug, requestId }, input.origin);
    };
    dialog.append(element('h2', '', 'Attach an artifact'), search, filters, button('Refresh', load), listStatus, list, button('Close', () => dialog.close()));
    const render = () => {
      const terms = search.value.toLowerCase().split(/\s+/).filter(Boolean);
      const filtered = items.filter(item => (category === 'All' || artifactCategory(item) === category) && terms.every(term => `${item.title} ${item.kind} ${item.filename ?? ''}`.toLowerCase().includes(term)));
      listStatus.textContent = filtered.length ? '' : 'No matching artifacts.';
      list.replaceChildren(...filtered.map(item => button(`Attach ${item.title}`, () => {
      const selection = formBookmark?.resolve(view.state.doc); if (selection) view.dispatch(view.state.tr.setSelection(selection));
      insertMarkdown(item.markdown); dialog.close();
    }, 'bb-artifact-item')));
      [...list.children].forEach((node, index) => node.append(element('span', 'bb-artifact-kind', artifactKindLabel(filtered[index]))));
    };
    for (const name of ARTIFACT_CATEGORIES) { const control = button(name, () => { category = name; filters.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === control))); render(); }); control.setAttribute('aria-pressed', String(name === category)); filters.append(control); }
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== input.origin || event.data?.type !== 'second-brain:markdown-artifacts-result' || event.data.requestId !== requestId || event.data.slug !== input.slug) return;
      clearTimeout(timeout);
      if (!event.data.ok) { listStatus.textContent = (event.data.error || 'Could not load artifacts.') + ' Select Refresh to try again.'; return; } items = event.data.artifacts; render();
    };
    window.addEventListener('message', receive); search.oninput = render;
    dialog.addEventListener('close', () => { clearTimeout(timeout); window.removeEventListener('message', receive); dialog.remove(); formBookmark = null; view.focus(); });
    document.body.append(dialog); dialog.showModal(); search.focus();
    load();
  }
  function showConflict() {
    if (!save.conflict) return;
    conflictPanel.hidden = false; conflictPanel.replaceChildren(element('strong', '', 'This page changed elsewhere. Choose which version to keep.'));
    const compare = element('div', 'bb-document-compare');
    for (const [label, draft] of [['Your draft', save.draft], ['Saved version', save.conflict]] as [string,Draft][]) {
      const field = element('textarea'); field.readOnly = true; field.value = `${draft.title}\n${draft.tags.join(', ')}\n\n${draft.body}`; field.setAttribute('aria-label', label); compare.append(field);
    }
    const choose = async (mine: boolean) => {
      try {
        if (mine) { while (sourceDirty) await applySourceChanges(); }
        else await flushBoards(article!);
        const draft = snapshot(); if (sourceDirty) draft.body = sourceInput.value;
        save.update(draft); await save.resolve(mine);
        if (!mine) {
          sourceDirty = false; await replaceSource(save.draft.body); sourceInput.value = save.draft.body;
          if (title) title.textContent = save.draft.title; tags.value = save.draft.tags.join(', ');
        }
        await persistRecovery(); conflictPanel.hidden = true;
      }
      catch (error) { showError(error); }
    };
    conflictPanel.append(compare, button('Keep my version', () => choose(true)), button('Use saved version', () => choose(false)));
  }
  title?.addEventListener('input', scheduleSnapshot); tags.addEventListener('input', scheduleSnapshot);
  const titleKeydown = (event: KeyboardEvent) => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); view.focus(); } };
  title?.addEventListener('keydown', titleKeydown);
  // Formatting joins the existing selection toolbar; annotation actions retain their IDs and menus.
  const selectionMenu = document.querySelector('.bb-highlight-menu');
  const selectionFormatting = element('span', 'bb-selection-formatting'); selectionFormatting.hidden = true;
  for (const format of formats) selectionFormatting.append(formatButton(...format));
  selectionFormatting.append(button('Link', editLink)); selectionMenu?.prepend(selectionFormatting);
  const onCanonical = async (event: Event) => {
    const revision = (event as CustomEvent).detail?.revision;
    if (!revision || revision === save.base.revision || disposed) return;
    // Our in-flight save can trigger a refresh before its acknowledgement arrives.
    try { await flush(); const current = await transport.request('get'); if (current.revision !== save.base.revision) { save.conflict = current; showConflict(); } } catch { /* Save status already exposes conflicts. */ }
  };
  document.addEventListener('bb:canonical-editor-update', onCanonical);
  const beforeUnload = (event: BeforeUnloadEvent) => { if (save.dirty || serializeTimer || sourceDirty) { event.preventDefault(); event.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  const saveShortcut = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); event.stopPropagation(); void flush().catch(showError); }
  };
  document.addEventListener('keydown', saveShortcut, true);
  const navigation = (event: MouseEvent) => {
    const link = (event.target as Element).closest?.('a[href]') as HTMLAnchorElement | null;
    if (!link || event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || link.target === '_blank' || link.href.includes('#') && new URL(link.href).pathname === location.pathname) return;
    if (editing && article.contains(link)) return;
    event.preventDefault(); event.stopImmediatePropagation(); void flush().then(() => { disposed = true; window.removeEventListener('beforeunload', beforeUnload); location.assign(link.href); }).catch(showError);
  };
  document.addEventListener('click', navigation, true);
  const onOnline = () => void flush().catch(showError); window.addEventListener('online', onOnline);
  const onPageHide = () => persistRecovery().catch(() => {});
  window.addEventListener('pagehide', onPageHide);
  const removeListeners = () => {
    title?.removeEventListener('input', scheduleSnapshot); title?.removeEventListener('keydown', titleKeydown);
    document.removeEventListener('nav', onNavigation); document.removeEventListener('click', navigation, true);
    document.removeEventListener('keydown', saveShortcut, true);
    document.removeEventListener('bb:canonical-editor-update', onCanonical);
    window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('online', onOnline); window.removeEventListener('pagehide', onPageHide);
  };
  rollback.push(() => { removeListeners(); selectionFormatting.remove(); });
  const onNavigation = () => {
    if (article.isConnected && document.querySelector('article.popover-hint') === article) return;
    disposed = true; void onPageHide().finally(() => recovery.destroy()); save.destroy(); transport.destroy(); view.destroy(); releaseImages();
    clearSnapshotTimers();
    toolbar.remove(); metadata.remove(); sourcePanel.remove(); conflictPanel.remove(); selectionFormatting.remove(); retry.remove(); annotationsButton.remove();
    removeListeners();
    delete window.__quartzDocumentEditor;
  };
  document.addEventListener('nav', onNavigation);
  const editorApi: NonNullable<Window['__quartzDocumentEditor']> = {
    async setEditable(value) {
      if (!value) await flush();
      const scroll = window.scrollY; editing = value; toolbar.hidden = !value; metadata.hidden = !value; selectionFormatting.hidden = !value;
      article.classList.toggle('bb-document-editing', value); view.setProps({ editable: () => editing });
      if (title) { title.contentEditable = String(value); title.setAttribute('aria-label', 'Page title'); title.spellcheck = true; }
      if (value) view.focus();
      else { sourcePanel.hidden = true; article.hidden = false; }
      window.scrollTo(window.scrollX, scroll);
      if (restored && !save.conflict && save.dirty) save.update(snapshot());
      if (save.conflict) showConflict();
    },
    renderHighlights: entries => paintAnnotations(view, entries), getHighlights: () => readAnnotations(view), flush, getDraft: snapshot,
    setAnswerStates: entries => setAnswerStates(view, entries),
  };
  if (selectedQuote) {
    let text = '', positions: number[] = [];
    view.state.doc.descendants((node, pos) => { if (node.isText) { for (let i = 0; i < node.text!.length; i++) positions.push(pos + i); text += node.text; } });
    const at = text.indexOf(selectedQuote);
    if (at >= 0) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, positions[at], positions[at + selectedQuote.length - 1] + 1)));
  }
  window.scrollTo(window.scrollX, openingScroll);
  if (readingAnchor?.text && openingScroll > 0) {
    let found = false;
    view.state.doc.descendants((node, position) => {
      if (!found && node.isTextblock && node.textContent === readingAnchor.text) {
        const rendered = view.nodeDOM(position);
        if (rendered instanceof HTMLElement) { found = true; window.scrollBy(0, rendered.getBoundingClientRect().top - readingAnchor.top); }
      }
      return !found;
    });
  }
  updateToolbar();
  window.__quartzDocumentEditor = editorApi;
  document.dispatchEvent(new CustomEvent('bb:editor-ready', { detail: {} }));
}
