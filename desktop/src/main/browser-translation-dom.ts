/** Serialized into each document; only Text.data and human-facing attributes change. */
function translationDocument(key: string, operation: string, payload?: unknown) {
  // pending is the time a sent segment may be collected again: a lost reply must not strand its text.
  type Entry = { node: Node; attribute: string; original: string; applied: string; pending: number; done: boolean };
  type State = {
    entries: Map<number, Entry>; nodes: WeakMap<Node, Map<string, number>>; serial: number;
    dirty: boolean; roots: Set<Node>; observer: MutationObserver;
    /** Nothing near the viewport is waiting; polls return at once until the reader scrolls or the page changes. */
    idleUntil: number; view: string; wake: () => void;
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
      removeEventListener("scroll", state.wake, true);
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
    const observer = new MutationObserver(records => {
      const current = scope[key];
      if (!current || current.dirty) return;
      current.dirty = records.some(record => {
        if (record.type === "childList") return true;
        const id = current.nodes.get(record.target)?.get(record.attributeName ?? "");
        const entry = id === undefined ? undefined : current.entries.get(id);
        // Our own text/attribute writes don't require another whole-page scan.
        // Site edits, including edits to a translated node, still do.
        return !entry?.done || read(entry) !== entry.applied;
      });
    });
    const wake = () => { const current = scope[key]; if (current) current.idleUntil = 0; };
    // For nested scrollers and shadow trees, which the window position below
    // cannot see. Capture is required: scroll does not bubble.
    addEventListener("scroll", wake, { capture: true, passive: true });
    state = { entries: new Map(), nodes: new WeakMap(), serial: 0, dirty: true, roots: new Set(), observer, idleUntil: 0, view: "", wake };
    scope[key] = state;
  }
  const current = state;
  if (operation === "apply") {
    if (!Array.isArray(payload)) return 0;
    let applied = 0;
    for (const value of payload as Array<{ id: number; text: string }>) {
      const entry = current.entries.get(value.id);
      if (!entry || typeof value.text !== "string") continue;
      entry.pending = 0;
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
  const now = Date.now();
  // Scroll events are delivered with the next frame, which can be late; the
  // window position is exact now.
  const view = `${scrollX},${scrollY},${innerWidth},${innerHeight}`;
  if (!current.dirty && current.idleUntil > now && current.view === view) return [];
  // Identity labels are not prose. Auto-detecting each fragment independently
  // otherwise turns the profile name "Kuzey" into "North" and mangles handles.
  const identities = ".vcard-fullname,.vcard-username,.h-card .p-name,.h-card .p-nickname,.vcard .fn,.vcard .nickname,[itemprop~='givenName'],[itemprop~='familyName'],[itemprop~='additionalName'],[itemtype$='/Person'] [itemprop~='name'],[itemtype$='/Organization'] [itemprop~='name'],[rel~='author']";
  const skipped = `script,style,noscript,template,code,pre,kbd,samp,textarea,[contenteditable]:not([contenteditable='false']),[translate='no'],.notranslate,[data-breadboard-selection],${identities}`;
  const github = location.hostname === "github.com";
  const identityLink = (element: Element) => {
    if (!github) return false;
    if (element.closest("[data-hovercard-type='user'],[data-hovercard-type='organization'],[data-hovercard-type='repository']")) return true;
    const anchor = element.closest("a[href]");
    if (!anchor) return false;
    try {
      const url = new URL(anchor.getAttribute("href")!, document.baseURI);
      const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      const label = anchor.textContent?.trim().replace(/^@/, "");
      // Account/repository breadcrumbs need not have a hovercard. Match their
      // literal identifier, not navigation labels such as "Overview".
      return url.origin === location.origin && Boolean(label) && parts.length <= 2 &&
        (label === parts.at(-1) || label === parts.join("/"));
    } catch { return false; }
  };
  const excluded = (element: Element) => {
    let parent: Element | null = element;
    while (parent) {
      if (parent.closest(skipped) || identityLink(parent)) return true;
      parent = (parent.getRootNode() as ShadowRoot).host ?? null;
    }
    return false;
  };
  const language = (payload as { language?: string } | null)?.language?.toLowerCase();
  const alreadyInTargetLanguage = (element: Element) => {
    if (!language) return false;
    let parent: Element | null = element;
    while (parent) {
      const declared = parent.closest("[lang]");
      if (declared) {
        const source = declared.getAttribute("lang")?.trim().toLowerCase();
        return source === language || Boolean(source?.startsWith(`${language}-`));
      }
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
      if (entry && (value === entry.applied || (entry.pending > now && value === entry.original))) return;
      if (old !== undefined) current.entries.delete(old);
      const id = ++current.serial;
      ids.set(attribute, id);
      current.entries.set(id, { node, attribute, original: value, applied: value, pending: 0, done: false });
    };
    const walk = (root: Node) => {
      if (!current.roots.has(root)) {
        current.roots.add(root);
        current.observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
      }
      const top = root.nodeType === Node.ELEMENT_NODE ? root as Element : null;
      if (top && (excluded(top) || top.closest("[hidden],[aria-hidden='true']"))) return;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          // A rejected element takes its subtree with it, so every node that
          // arrives here has accepted ancestors: test the element itself only.
          // Climbing with closest() for every node made large pages stall.
          if (node.nodeType !== Node.ELEMENT_NODE) return NodeFilter.FILTER_ACCEPT;
          const element = node as Element;
          return element.matches(skipped) || element.matches("[hidden],[aria-hidden='true']") || identityLink(element)
            ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
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
    else current.dirty = true;
  }
  const batch: Array<{ id: number; text: string; context: string }> = [];
  const initial = (payload as { initial?: boolean } | null)?.initial === true;
  const maxSegments = initial ? 8 : 40;
  const maxCharacters = initial ? 2400 : 12000;
  const candidates: Array<{ id: number; entry: Entry; element: Element; visible: boolean }> = [];
  const visibility = new Map<Element, { near: boolean; visible: boolean }>();
  // Translate what the reader can see plus two screens either side, and the
  // rest as they scroll to it. Sending a whole long page took most of a minute
  // and enough requests for the translation service to start refusing them.
  const marginX = innerWidth, marginY = innerHeight * 2;
  let sent = false;
  for (const [id, entry] of current.entries) {
    if (entry.done || !entry.node.isConnected) continue;
    if (entry.pending > now) { sent = true; continue; }
    const element = entry.node.nodeType === Node.ELEMENT_NODE ? entry.node as Element : entry.node.parentElement;
    if (!element) continue;
    const layoutElement = element.closest("select") ?? element;
    let layout = visibility.get(layoutElement);
    if (!layout) {
      const rects = Array.from(layoutElement.getClientRects());
      layout = {
        near: rects.some(rect => rect.bottom > -marginY && rect.top < innerHeight + marginY && rect.right > -marginX && rect.left < innerWidth + marginX),
        visible: rects.some(rect => rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth),
      };
      visibility.set(layoutElement, layout);
    }
    // Position is the cheap test, so it runs before the ancestor checks.
    if (!layout.near || excluded(element) || alreadyInTargetLanguage(element) || element.closest("[hidden],[aria-hidden='true']")) continue;
    candidates.push({ id, entry, element, visible: layout.visible });
  }
  // Hover and animation reveals fire neither a scroll nor a mutation; look again after two seconds.
  if (!candidates.length && !sent) { current.idleUntil = now + 2000; current.view = view; }
  // Keep document order within each group, but translate the current viewport
  // first, including after the reader scrolls partway down a long page.
  candidates.sort((a, b) => Number(b.visible) - Number(a.visible));
  const contexts = new Map<Element, string>();
  let size = 0;
  for (const { id, entry, element } of candidates) {
    // Mark unchanged translations complete too; they must not be resubmitted forever.
    const contextRoot = element.closest("p,li,h1,h2,h3,h4,label,button,td,th,figcaption");
    let context = contextRoot ? contexts.get(contextRoot) ?? "" : "";
    if (contextRoot && !contexts.has(contextRoot)) {
      const contextWalker = document.createTreeWalker(contextRoot, NodeFilter.SHOW_TEXT, { acceptNode: node =>
        node.parentElement && !excluded(node.parentElement) && !node.parentElement.closest("[hidden],[aria-hidden='true']")
          ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT });
      let node: Node | null;
      while (context.length < 300 && (node = contextWalker.nextNode())) {
        const id = current.nodes.get(node)?.get("");
        const saved = id === undefined ? undefined : current.entries.get(id);
        // Keep context in the source language as concurrent batches finish.
        const text = saved && read(saved) === saved.applied ? saved.original : node.nodeValue ?? "";
        context += text.slice(0, 300 - context.length);
      }
      contexts.set(contextRoot, context);
    }
    // A complete sentence in one node already supplies its own context.
    if (context === entry.original) context = "";
    const length = entry.original.length + context.length;
    if (batch.length && (size + length > maxCharacters || batch.length >= maxSegments)) break;
    entry.pending = now + 120000;
    size += length;
    batch.push({ id, text: entry.original, context });
  }
  return batch;
}

export function translationDocumentScript(key: string, operation: "collect" | "apply" | "restore", payload?: unknown): string {
  return `(${translationDocument.toString()})(${JSON.stringify(key)},${JSON.stringify(operation)},${JSON.stringify(payload ?? null)})`;
}
