import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { EditorView, NodeView } from "@tiptap/pm/view";
import katex from "katex";
import type { EditorTransport } from "./session";
import { embedAdapter, disposeObject, hydrateObject } from "./registry";
import { quartzImageSources } from "../quartz-image-sources";
import { mathAnnotationText } from "../../../../quartz/quartz/util/mathAnnotation";

export interface LocalImagePreview { url: string; name: string; raw?: string }

export async function flushBoards(root: ParentNode) {
  await Promise.all(Array.from(root.querySelectorAll<HTMLIFrameElement>('.penecho-board iframe')).map(frame => new Promise<void>((resolve, reject) => {
    let origin: string;
    try { origin = new URL(frame.src).origin; } catch { resolve(); return; }
    const requestId = crypto.randomUUID();
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', receive); };
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.origin !== origin || event.data?.type !== 'penecho:board-flushed' || event.data.requestId !== requestId) return;
      cleanup(); if (event.data.ok) resolve(); else reject(new Error(event.data.error || 'Save the whiteboard before leaving it.'));
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('The whiteboard has not confirmed its save. Try again.')); }, 20_000);
    window.addEventListener('message', receive);
    frame.contentWindow?.postMessage({ type: 'penecho:flush-board', requestId }, origin);
  })));
}

class PreviewQueue {
  private pending: { id: string; source: string; resolve: (html: string) => void; reject: (error: Error) => void }[] = [];
  private scheduled = false;
  constructor(private transport: EditorTransport) {}
  render(source: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.pending.push({ id: crypto.randomUUID(), source, resolve, reject });
      if (!this.scheduled) { this.scheduled = true; setTimeout(() => void this.drain(), 30); }
    });
  }
  private async drain() {
    while (this.pending.length) {
      const batch = this.pending.splice(0, 32);
      try {
        const result = await this.transport.request('preview', { fragments: batch.map(({ id, source }) => ({ id, source })) });
        for (const item of batch) item.resolve(result.fragments.find((f: any) => f.id === item.id)?.html ?? '');
      } catch (error) { for (const item of batch) item.reject(error as Error); }
    }
    this.scheduled = false;
  }
}

export interface ObjectActions {
  edit(node: PMNode, position: number): void;
  move(position: number, direction: -1 | 1): Promise<void>;
  remove(position: number): Promise<void>;
  error(error: unknown): void;
}

export function objectViews(transport: EditorTransport, actions: ObjectActions, localImages = new Map<string, LocalImagePreview>(), isTyping = () => false) {
  const previews = new PreviewQueue(transport);
  const pendingPreviews = new WeakMap<Element, () => void>();
  const visiblePreviews = new Set<Element>();
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  const drainPreviews = () => {
    previewTimer = undefined;
    if (!visiblePreviews.size) return;
    if (isTyping()) { previewTimer = setTimeout(drainPreviews, 150); return; }
    const deadline = performance.now() + 6;
    for (const target of visiblePreviews) {
      visiblePreviews.delete(target);
      pendingPreviews.get(target)?.(); pendingPreviews.delete(target);
      // A textbook can reveal dozens of equations at once. Yield between
      // small batches so rendering them cannot monopolize a typing frame.
      if (performance.now() >= deadline) break;
    }
    if (visiblePreviews.size) previewTimer = setTimeout(drainPreviews, 0);
  };
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      observer.unobserve(entry.target);
      visiblePreviews.add(entry.target);
    }
    if (visiblePreviews.size && previewTimer === undefined) previewTimer = setTimeout(drainPreviews, 0);
  }, { rootMargin: '700px' });
  const create = (initial: PMNode, view: EditorView, getPos: () => number | undefined): NodeView => {
    let node = initial, disposed = false, interacting = false, loadedRaw: string | null = null;
    const inline = node.type.name === 'inline_object';
    const dom = document.createElement(inline ? 'span' : 'div');
    dom.className = inline ? 'bb-inline-object' : 'bb-document-object';
    dom.dataset.noHighlight = 'true'; dom.contentEditable = 'false';
    const syncMathSource = () => {
      if (node.attrs.kind === 'math') dom.dataset.bbMathSource = mathAnnotationText(node.attrs.raw, !inline);
      else delete dom.dataset.bbMathSource;
    };
    syncMathSource();
    const body = document.createElement(inline ? 'span' : 'div'); body.className = 'bb-object-content';
    let image: HTMLImageElement | undefined;
    const renderImage = () => {
      if (node.attrs.kind !== 'image' && !node.attrs.uploadId) return false;
      const local = localImages.get(node.attrs.localImageId ?? node.attrs.uploadId);
      let data = node.attrs.image;
      if (!data && /^<img\b[^>]*>\s*$/i.test(node.attrs.raw)) {
        const template = document.createElement('template'); template.innerHTML = node.attrs.raw;
        const img = template.content.querySelector('img');
        if (img) data = { src: img.getAttribute('src'), alt: img.alt, title: img.title, width: img.getAttribute('width'), height: img.getAttribute('height') };
      }
      const useLocal = local && (node.attrs.uploadId || local.raw === node.attrs.raw);
      const src = useLocal ? local.url : data?.src;
      // Relative/wiki references still use Quartz's resolver. Uploaded paths
      // and ordinary image URLs can display without a server preview round trip.
      if (typeof src !== 'string' || !/^(?:\/(?!\/)|https?:\/\/|blob:|data:image\/)/i.test(src)) return false;
      image ??= document.createElement('img');
      image.alt = data?.alt ?? local?.name ?? '';
      image.title = data?.title ?? '';
      image.loading = useLocal ? 'eager' : 'lazy'; image.decoding = 'async';
      for (const key of ['width', 'height'] as const) {
        if (/^[1-9]\d*$/.test(String(data?.[key] ?? ''))) image.setAttribute(key, String(data[key]));
        else image.removeAttribute(key);
      }
      const template = document.createElement('template');
      const probe = document.createElement('img'); probe.src = src;
      template.innerHTML = quartzImageSources(probe.outerHTML, transport.slug, location.origin, transport.origin);
      const resolved = template.content.querySelector('img')!.getAttribute('src')!;
      if (image.getAttribute('src') !== resolved) image.src = resolved;
      if (image.parentNode !== body) body.replaceChildren(image);
      body.querySelector('.bb-image-upload-status')?.remove();
      if (node.attrs.uploadId) {
        const status = document.createElement('span'); status.className = 'bb-image-upload-status'; status.textContent = 'Uploading…'; body.append(status);
      }
      return true;
    };
    const tools = document.createElement('span'); tools.className = 'bb-object-tools'; tools.setAttribute('role', 'toolbar'); tools.setAttribute('aria-label', 'Embedded object');
    const adapter = embedAdapter(node.attrs.raw), interactionLabel = 'interact' in adapter ? adapter.interact : 'Interact';
    const button = (label: string, run: () => unknown) => {
      const el = document.createElement('button'); el.type = 'button'; el.textContent = label;
      el.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); Promise.resolve(run()).catch(actions.error); }); tools.append(el); return el;
    };
    const select = () => { const pos = getPos(); if (pos !== undefined) view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos))); };
    let interact: HTMLButtonElement | undefined;
    const showTools = () => {
      if (tools.parentNode) return;
      interact = button(interactionLabel, () => { interacting = !interacting; dom.classList.toggle('bb-object-interacting', interacting); interact!.textContent = interacting ? 'Return to document' : interactionLabel; if (!interacting) { select(); view.focus(); } });
      if (node.attrs.kind === 'transclusion') button('Open original note', () => body.querySelector<HTMLAnchorElement>('a.internal,a.transclude-src')?.click());
      button('Configure', () => { const pos = getPos(); if (pos !== undefined) actions.edit(node, pos); });
      if (!inline) { button('Move up', () => { const pos = getPos(); return pos !== undefined && actions.move(pos, -1); }); button('Move down', () => { const pos = getPos(); return pos !== undefined && actions.move(pos, 1); }); }
      button('Remove', () => { const pos = getPos(); return pos !== undefined && actions.remove(pos); });
      dom.prepend(tools);
    };
    dom.append(body);
    let stopMathDrag = () => {};
    dom.addEventListener('mousedown', event => {
      if (!(event instanceof MouseEvent) || event.button !== 0 || !view.editable || interacting || (event.target as Element).closest('button')) return;
      event.preventDefault(); select(); view.focus();
      if (node.attrs.kind !== 'math') return;
      // A noneditable equation is one document atom. Extend a real editor
      // selection while dragging so the browser cannot collapse it to a caret.
      const start = getPos(); if (start === undefined) return;
      const move = (pointer: MouseEvent) => {
        const at = view.posAtCoords({ left: pointer.clientX, top: pointer.clientY });
        if (!at) return;
        const end = start + node.nodeSize;
        const selection = at.pos >= start && at.pos <= end ? NodeSelection.create(view.state.doc, start)
          : TextSelection.create(view.state.doc, at.pos < start ? end : start, at.pos);
        view.dispatch(view.state.tr.setSelection(selection));
      };
      stopMathDrag();
      stopMathDrag = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', stopMathDrag); };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', stopMathDrag);
    });
    dom.addEventListener('dblclick', event => { if (node.attrs.kind === 'math' && view.editable) { event.preventDefault(); select(); view.focus(); } });
    const render = async () => {
      if (loadedRaw === node.attrs.raw && !node.attrs.uploadId) return;
      if (loadedRaw !== null) disposeObject(body);
      loadedRaw = node.attrs.raw;
      const raw = node.attrs.raw as string;
      if (renderImage()) return;
      body.textContent = node.attrs.uploadId ? 'Uploading…' : node.attrs.label || (node.attrs.kind === 'source' ? raw : '');
      if (node.attrs.uploadId) return;
      if (node.attrs.kind === 'footnote') { const reference = document.createElement('sup'); reference.textContent = `[${node.attrs.label}]`; body.replaceChildren(reference); return; }
      if (node.attrs.kind === 'math' || /^\$\$/.test(raw)) {
        try { katex.render(raw.replace(/^\${1,2}\s*|\s*\${1,2}$/g, ''), body, { displayMode: !inline, throwOnError: false, output: 'html' }); } catch { body.textContent = raw; }
        return;
      }
      if (/^%%/.test(raw) || /^\s*\^/.test(raw)) { body.textContent = '⋯'; body.title = raw; return; }
      try {
        const html = await previews.render(node.attrs.preview ?? raw);
        if (disposed || raw !== node.attrs.raw) return;
        const template = document.createElement('template'); template.innerHTML = html;
        // Source is retained verbatim, but authoring never executes pasted scripts.
        template.content.querySelectorAll('script,object,embed,base,meta').forEach(el => el.remove());
        for (const el of template.content.querySelectorAll('*')) for (const attr of [...el.attributes]) {
          if (/^on/i.test(attr.name) || /^(?:href|src|action)$/i.test(attr.name) && /^\s*(?:javascript|vbscript):/i.test(attr.value)) el.removeAttribute(attr.name);
        }
        body.replaceChildren(template.content);
        if (!body.textContent && !body.children.length) body.textContent = raw.startsWith('<!--') ? 'Comment' : raw;
        hydrateObject(body);
      } catch (error) {
        if (disposed) return;
        body.textContent = 'Preview unavailable. '; const retry = document.createElement('button'); retry.textContent = 'Retry'; retry.type = 'button';
        retry.onclick = () => { loadedRaw = null; void render(); }; body.append(retry); body.title = String(error);
      }
    };
    pendingPreviews.set(dom, () => void render());
    observer.observe(dom);
    body.textContent = node.attrs.label || (node.attrs.kind === 'source' ? node.attrs.raw : '');
    if (node.attrs.uploadId || node.attrs.image || /^<img\b/i.test(node.attrs.raw)) void render();
    return {
      dom, stopEvent: event => interacting || node.attrs.kind === 'math' && /^(?:mouse|pointer|drag)/.test(event.type) || (event.target as Element).closest?.('button') !== null,
      ignoreMutation: () => true,
      selectNode: () => { dom.classList.add('ProseMirror-selectednode'); showTools(); },
      deselectNode: () => { dom.classList.remove('ProseMirror-selectednode'); interacting = false; dom.classList.remove('bb-object-interacting'); tools.remove(); tools.replaceChildren(); interact = undefined; },
      update(next) { if (next.type !== node.type) return false; const changed = next.attrs.raw !== node.attrs.raw || next.attrs.uploadId !== node.attrs.uploadId; node = next; syncMathSource(); if (changed) void render(); return true; },
      destroy() { disposed = true; stopMathDrag(); observer.unobserve(dom); visiblePreviews.delete(dom); pendingPreviews.delete(dom); disposeObject(dom); },
    };
  };
  return { embed: create, inline_object: create };
}
