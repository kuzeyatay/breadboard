/** Serialized into each document; only Text.data and human-facing attributes change. */
function translationDocument(key: string, operation: string, payload?: unknown) {
  type Entry = { node: Node; attribute: string; original: string; applied: string; pending: boolean; done: boolean };
  type State = {
    entries: Map<number, Entry>; nodes: WeakMap<Node, Map<string, number>>; serial: number;
    dirty: boolean; roots: Set<Node>; observer: MutationObserver;
  };
  const scope = globalThis as unknown as Record<string, State | undefined>;
  let state = scope[key];
  const read = (entry: Entry) => entry.attribute ? (entry.node as Element).getAttribute(entry.attribute) ?? "" : entry.node.nodeValue ?? "";
  const write = (entry: Entry, value: string) => {
    if (entry.attribute) (entry.node as Element).setAttribute(entry.attribute, value);
    else entry.node.nodeValue = value;
  };
  if (operation === "restore") {
    if (state) {
      state.observer.disconnect();
      for (const entry of state.entries.values()) {
        // Live app edits take precedence over our saved original.
        if (entry.node.isConnected && read(entry) === entry.applied) write(entry, entry.original);
      }
      delete scope[key];
    }
    return [];
  }
  if (!state) {
    if (operation !== "collect") return [];
    const observer = new MutationObserver(() => { if (scope[key]) scope[key]!.dirty = true; });
    state = { entries: new Map(), nodes: new WeakMap(), serial: 0, dirty: true, roots: new Set(), observer };
    scope[key] = state;
  }
  const current = state;
  if (operation === "apply") {
    if (!Array.isArray(payload)) return 0;
    let applied = 0;
    for (const value of payload as Array<{ id: number; text: string }>) {
      const entry = current.entries.get(value.id);
      if (!entry || typeof value.text !== "string") continue;
      entry.pending = false;
      if (!entry.node.isConnected || read(entry) !== entry.original) { current.dirty = true; continue; }
      const whitespace = entry.original.match(/^(\s*)[\s\S]*?(\s*)$/);
      entry.applied = `${whitespace?.[1] ?? ""}${value.text.trim()}${whitespace?.[2] ?? ""}`;
      write(entry, entry.applied);
      entry.done = true;
      applied++;
    }
    return applied;
  }
  if (operation !== "collect") return [];
  const skipped = "script,style,noscript,template,code,pre,kbd,samp,textarea,[contenteditable]:not([contenteditable='false']),[translate='no'],.notranslate,[data-breadboard-selection]";
  const excluded = (element: Element) => {
    let parent: Element | null = element;
    while (parent) {
      if (parent.closest(skipped)) return true;
      parent = (parent.getRootNode() as ShadowRoot).host ?? null;
    }
    return false;
  };
  if (current.dirty) {
    current.dirty = false;
    for (const [id, entry] of current.entries) if (!entry.node.isConnected) current.entries.delete(id);
    if ([...current.roots].some(root => !root.isConnected)) {
      current.observer.disconnect();
      for (const root of current.roots) {
        if (!root.isConnected) current.roots.delete(root);
        else current.observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
      }
    }
    const remember = (node: Node, attribute: string, value: string) => {
      if (!value.trim() || !/\p{L}/u.test(value) || value.length > 12000) return;
      let ids = current.nodes.get(node);
      if (!ids) { ids = new Map(); current.nodes.set(node, ids); }
      const old = ids.get(attribute);
      const entry = old === undefined ? undefined : current.entries.get(old);
      if (entry && (value === entry.applied || (entry.pending && value === entry.original))) return;
      if (old !== undefined) current.entries.delete(old);
      const id = ++current.serial;
      ids.set(attribute, id);
      current.entries.set(id, { node, attribute, original: value, applied: value, pending: false, done: false });
    };
    const walk = (root: Node) => {
      if (!current.roots.has(root)) {
        current.roots.add(root);
        current.observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
      }
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
          if (!element || excluded(element)) return NodeFilter.FILTER_REJECT;
          if (element.closest("[hidden],[aria-hidden='true']")) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (node.nodeType === Node.TEXT_NODE) remember(node, "", node.nodeValue ?? "");
        else {
          const element = node as Element;
          // Never read input values or edit a person's form content.
          for (const attribute of ["title", "alt", "placeholder", "aria-label"]) {
            if (element.matches("input[type='password'],input[type='hidden']")) continue;
            const value = element.getAttribute(attribute);
            if (value) remember(element, attribute, value);
          }
          if (element.shadowRoot) walk(element.shadowRoot);
        }
      }
    };
    if (document.body) walk(document.body);
  }
  const batch: Array<{ id: number; text: string; context: string }> = [];
  let size = 0;
  for (const [id, entry] of current.entries) {
    if (entry.pending || entry.done || !entry.node.isConnected) continue;
    // Mark unchanged translations complete too; they must not be resubmitted forever.
    const element = entry.node.nodeType === Node.ELEMENT_NODE ? entry.node as Element : entry.node.parentElement;
    if (!element || excluded(element) || !(element.closest("select") ?? element).getClientRects().length) continue;
    const contextRoot = element.closest("p,li,h1,h2,h3,h4,label,button,td,th,figcaption");
    let context = "";
    if (contextRoot) {
      const contextWalker = document.createTreeWalker(contextRoot, NodeFilter.SHOW_TEXT, { acceptNode: node =>
        node.parentElement && !excluded(node.parentElement) && !node.parentElement.closest("[hidden],[aria-hidden='true']")
          ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT });
      let node: Node | null;
      while (context.length < 300 && (node = contextWalker.nextNode())) context += (node.nodeValue ?? "").slice(0, 300 - context.length);
    }
    const length = entry.original.length + context.length;
    if (batch.length && (size + length > 12000 || batch.length >= 40)) break;
    entry.pending = true;
    size += length;
    batch.push({ id, text: entry.original, context });
  }
  return batch;
}

export function translationDocumentScript(key: string, operation: "collect" | "apply" | "restore", payload?: unknown): string {
  return `(${translationDocument.toString()})(${JSON.stringify(key)},${JSON.stringify(operation)},${JSON.stringify(payload ?? null)})`;
}
