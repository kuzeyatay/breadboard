import { Plugin, PluginKey } from "@tiptap/pm/state";
import { isHistoryTransaction } from "@tiptap/pm/history";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { mathAnnotationText } from "../../../../quartz/quartz/util/mathAnnotation";

export interface Annotation { id: string; start: number; end: number; text: string; prefix: string; suffix: string; color: string; note?: string; noteOnly?: boolean; detached?: boolean; revision?: string; [key: string]: unknown }
interface Anchor { entry: Annotation; from: number; to: number; detached: boolean }
interface State { anchors: Anchor[]; decorations: DecorationSet; answers: Map<string, string> }
export const annotationsKey = new PluginKey<State>('quartzAnnotations');
const answerStatesMeta = 'quartzAnswerStates';
function decorated(doc: PMNode, anchors: Anchor[], answers: Map<string, string>): State {
  return { anchors, answers, decorations: DecorationSet.create(doc, anchors.filter(a => !a.detached && a.to > a.from).flatMap(a => {
    const attrs = {
    nodeName: 'mark', class: 'bb-hl', 'data-hl-id': a.entry.id, 'data-hl-color': a.entry.color,
    ...(answers.has(a.entry.id) ? { 'data-hl-answer': answers.get(a.entry.id)! } : {}),
    ...(a.entry.chatLink ? { 'data-hl-chat': 'true', role: 'button', tabindex: '0', 'aria-label': 'Open question in chat' } : {}),
    ...(a.entry.noteOnly ? { 'data-hl-note-only': 'true' } : {}),
    ...(a.entry.note ? { 'data-hl-note': 'true', 'data-hl-note-text': a.entry.note, 'aria-describedby': 'bb-highlight-note-tooltip' } : {}),
    };
    const decorations: Decoration[] = [];
    doc.nodesBetween(a.from, a.to, (node, pos) => {
      if (node.type.name === 'embed' || node.type.name === 'inline_object') {
        if (node.attrs.kind === 'math') {
          const { nodeName: _tag, ...mathAttrs } = attrs;
          decorations.push(Decoration.node(pos, pos + node.nodeSize, { ...mathAttrs, class: 'bb-hl bb-hl-math' }));
        }
        return false;
      }
      if (node.isText) decorations.push(Decoration.inline(Math.max(pos, a.from), Math.min(pos + node.nodeSize, a.to), attrs));
    });
    return decorations;
  })) };
}
export const annotationPlugin = new Plugin<State>({
  key: annotationsKey,
  state: {
    init: () => ({ anchors: [], decorations: DecorationSet.empty, answers: new Map() }),
    apply(tr, state, previousState) {
      const anchors = tr.getMeta(annotationsKey) as Anchor[] | undefined;
      const answers = tr.getMeta(answerStatesMeta) as Map<string, string> | undefined;
      if (anchors || answers) return decorated(tr.doc, anchors ?? state.anchors, answers ?? state.answers);
      if (!tr.docChanged || state.anchors.length === 0) return state;
      if (tr.getMeta('bb-source-replaced')) {
        // Replacing the saved Markdown maps every old position to a deletion.
        // Resolve surviving quotes before painting the replacement, using the
        // latest local passage rather than waiting for annotation-store sync.
        const previous = textIndex(previousState.doc), next = textIndex(tr.doc);
        return decorated(tr.doc, state.anchors.map(anchor => {
          const entry = anchor.detached ? anchor.entry : anchoredEntry(anchor, previous);
          return resolveAnchor({ ...anchor, entry }, next);
        }), state.answers);
      }
      const move = tr.getMeta('bb-object-move') as { from: number; to: number; size: number } | undefined;
      let mapped = state.anchors.map(anchor => {
        if (anchor.detached) return anchor;
        if (move && anchor.from >= move.from && anchor.to <= move.from + move.size) return { ...anchor, from: move.to + anchor.from - move.from, to: move.to + anchor.to - move.from };
        const from = tr.mapping.mapResult(anchor.from, 1), to = tr.mapping.mapResult(anchor.to, -1);
        return { ...anchor, from: from.pos, to: to.pos, detached: from.pos >= to.pos || from.deletedAcross && to.deletedAcross };
      });
      // Undo can restore a removed quote or an earlier source revision. Keep
      // that restoration atomic too, without rescanning the page while typing.
      if (isHistoryTransaction(tr) && mapped.some(anchor => anchor.detached)) {
        const index = textIndex(tr.doc);
        mapped = mapped.map(anchor => anchor.detached ? resolveAnchor(anchor, index) : anchor);
      }
      return decorated(tr.doc, mapped, state.answers);
    },
  },
  props: { decorations: state => annotationsKey.getState(state)?.decorations },
});

/** Keep annotation attributes inside ProseMirror instead of mutating its DOM. */
export function setAnswerStates(view: EditorView, entries: { highlightId: string; state: string }[]) {
  const answers = new Map(entries.map(entry => [entry.highlightId, entry.state]));
  const previous = annotationsKey.getState(view.state)?.answers;
  if (previous?.size === answers.size && [...answers].every(([id, state]) => previous.get(id) === state)) return;
  view.dispatch(view.state.tr.setMeta(answerStatesMeta, answers).setMeta('addToHistory', false));
}

function textIndex(doc: PMNode, includeMath = true) {
  const segments: { start: number; end: number; pos: number; size: number; atomic?: boolean }[] = []; let text = '';
  doc.descendants((node, pos) => {
    if (node.type.name === 'embed' || node.type.name === 'inline_object') {
      if (includeMath && node.attrs.kind === 'math') {
        const start = text.length; text += mathAnnotationText(node.attrs.raw, node.isBlock);
        segments.push({ start, end: text.length, pos, size: node.nodeSize, atomic: true });
      }
      return false;
    }
    if (node.isText) { const start = text.length; text += node.text; segments.push({ start, end: text.length, pos, size: node.nodeSize }); }
  });
  const position = (offset: number, end = false) => {
    const entry = segments.find(item => end ? item.start < offset && item.end >= offset : item.start <= offset && item.end > offset);
    return entry ? entry.pos + (entry.atomic ? end ? entry.size : 0 : offset - entry.start) : end ? doc.content.size : 0;
  };
  const offset = (pos: number) => {
    let low = 0, high = segments.length;
    while (low < high) { const mid = (low + high) >>> 1; if (segments[mid].pos + segments[mid].size < pos) low = mid + 1; else high = mid; }
    const item = segments[low]; return item ? item.atomic ? pos > item.pos ? item.end : item.start : item.start + Math.max(0, Math.min(pos - item.pos, item.end - item.start)) : text.length;
  };
  return { text, position, offset };
}

function locate(text: string, entry: Annotation) {
  if (text.slice(entry.start, entry.end) === entry.text) return entry.start;
  const context = text.indexOf(entry.prefix + entry.text + entry.suffix);
  if (context >= 0) return context + entry.prefix.length;
  const first = text.indexOf(entry.text);
  // An ambiguous missing quote stays unattached; never move it to unrelated prose.
  return first >= 0 && text.indexOf(entry.text, first + 1) < 0 ? first : -1;
}

function anchoredEntry(anchor: Anchor, index: ReturnType<typeof textIndex>): Annotation {
  const start = index.offset(anchor.from), end = index.offset(anchor.to);
  return { ...anchor.entry, start, end, text: index.text.slice(start, end),
    prefix: index.text.slice(Math.max(0, start - 48), start), suffix: index.text.slice(end, end + 48), detached: false };
}

function resolveAnchor(anchor: Anchor, index: ReturnType<typeof textIndex>): Anchor {
  const start = locate(index.text, anchor.entry);
  return start < 0 ? { ...anchor, detached: true }
    : { ...anchor, from: index.position(start), to: index.position(start + anchor.entry.text.length, true), detached: false };
}

export function paintAnnotations(view: EditorView, entries: Annotation[]) {
  if (!entries.length) {
    if (annotationsKey.getState(view.state)?.anchors.length) view.dispatch(view.state.tr.setMeta(annotationsKey, []).setMeta('addToHistory', false));
    return [];
  }
  const index = textIndex(view.state.doc);
  let legacy: ReturnType<typeof textIndex> | undefined;
  const previous = new Map(annotationsKey.getState(view.state)?.anchors.map(anchor => [anchor.entry.id, anchor]));
  const anchors = entries.map(entry => {
    const prior = previous.get(entry.id);
    if (prior && (prior.entry.text === entry.text || prior.entry.revision === entry.revision)) return { ...prior, entry };
    const start = locate(index.text, entry), end = start + entry.text.length;
    if (start < 0) {
      legacy ??= textIndex(view.state.doc, false);
      const oldStart = locate(legacy.text, entry);
      if (oldStart >= 0) return { entry, from: legacy.position(oldStart), to: legacy.position(oldStart + entry.text.length, true), detached: false };
    }
    return { entry, from: index.position(start), to: index.position(end, true), detached: start < 0 };
  });
  view.dispatch(view.state.tr.setMeta(annotationsKey, anchors).setMeta('addToHistory', false));
  return readAnnotations(view);
}

export function readAnnotations(view: EditorView, revision?: string): Annotation[] {
  const state = annotationsKey.getState(view.state);
  if (!state?.anchors.length) return [];
  const index = textIndex(view.state.doc);
  let reattached = false;
  const anchors = state.anchors.map(anchor => {
    if (!anchor.detached) return anchor;
    const start = locate(index.text, anchor.entry);
    if (start < 0) return anchor;
    reattached = true;
    return { ...anchor, from: index.position(start), to: index.position(start + anchor.entry.text.length, true), detached: false };
  });
  if (reattached) view.dispatch(view.state.tr.setMeta(annotationsKey, anchors).setMeta('addToHistory', false));
  return anchors.map(a => {
    if (a.detached) return { ...a.entry, detached: true, ...(revision ? { revision } : {}) };
    const start = index.offset(a.from), end = index.offset(a.to);
    return { ...a.entry, start, end, text: index.text.slice(start, end), prefix: index.text.slice(Math.max(0, start - 48), start), suffix: index.text.slice(end, end + 48), detached: false, ...(revision ? { revision } : {}) };
  });
}
