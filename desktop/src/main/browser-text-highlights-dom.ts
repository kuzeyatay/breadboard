import type { WebTextHighlight } from "../shared/web-text-selection";

/** Runs inside the sandboxed page. No product preload, cookies, network, or DOM wrapping. */
/** What the page receives: anchors and a has-note flag, never the note's text. */
type PaintedHighlight = Omit<WebTextHighlight, "note" | "conversationId"> & { noted?: true };
/** A passage someone you follow left a crumb on: its anchor, a short id and a color, never who. */
type FollowedPassage = { id: string; quote: string; prefix: string; suffix: string; tone: number };

function installBrowserTextHighlights() {
  type Entry = PaintedHighlight;
  type HighlightWindow = Window & typeof globalThis & {
    Highlight: new (...ranges: Range[]) => unknown;
    __breadboardHighlights?: { update: (entries: Entry[], error?: string | null, follows?: FollowedPassage[]) => void; track: (id: string | null) => void; dispose: () => void };
  };
  const page = window as HighlightWindow;
  page.__breadboardHighlights?.dispose();
  const registry = (CSS as unknown as { highlights: Map<string, unknown> }).highlights;
  if (!registry || !page.Highlight || !document.body) return;
  const abort = new AbortController();
  const style = document.createElement("style");
  style.setAttribute("data-breadboard-selection", "");
  // Pair the pastel fill with dark ink: a dark website's inherited white text
  // is otherwise almost invisible inside a saved highlight.
  // Hover deepens the fill as chat marks do; a noted passage is a dotted underline, as in chat.
  const tones = [["#f8b878", "#f3a35a"], ["#82d6cd", "#63c9be"], ["#f2938a", "#ec7a6f"], ["#cbe17f", "#bbd662"], ["#d9c2a3", "#cdb08a"]];
  const colors = [["blue", "#8fc3eb", "#75b2e0"], ["green", "#8ed09e", "#72c386"], ["pink", "#e99abb", "#df7fa6"],
    ["purple", "#b79be9", "#a482df"], ["answer", "#f4e7ad", "#edda8f"]];
  style.textContent = [
    ...colors.map(([name, color]) => `::highlight(breadboard-web-${name}) { background-color:${color}; color:#13201b; }`),
    ...colors.map(([name, , hover]) => `::highlight(breadboard-web-hover-${name}) { background-color:${hover}; color:#13201b; }`),
    "::highlight(breadboard-web-note) { background-color:transparent; text-decoration:underline dotted 1.5px; text-underline-offset:0.2em; }",
    // People you follow: colors you cannot highlight with, one per person. Kept in step with FOLLOWED_TONES.
    ...tones.map(([color], tone) => `::highlight(breadboard-web-follow-${tone}) { background-color:${color}; color:#13201b; }`),
    ...tones.map(([, hover], tone) => `::highlight(breadboard-web-follow-hover-${tone}) { background-color:${hover}; color:#13201b; }`),
  ].join("\n");
  const names = ["blue", "green", "pink", "purple", "answer", "note"];
  const groupName = (entry: Entry) => entry.mode === "inline" ? "answer" : entry.noted ? "note" : entry.color ?? "blue";
  let hovered: Entry | null = null;
  document.documentElement.append(style);
  const skip = "script,style,noscript,template,textarea,input,select,[contenteditable]:not([contenteditable='false']),[data-breadboard-selection]";
  let entries: Entry[] = [];
  let follows: FollowedPassage[] = [];
  let followLocated: Array<{ entry: FollowedPassage; range: Range }> = [];
  // The passage whose hover card is showing; the card itself is drawn by the app.
  let tipped: string | null = null;
  const tip = (id: string | null, kind: "note" | "follow", range?: Range) => {
    if (id === tipped) return;
    tipped = id;
    const box = range?.getClientRects()[0] ?? range?.getBoundingClientRect();
    const rect = box ? { x: box.left, y: box.top, width: box.width, height: box.height } : { x: 0, y: 0, width: 0, height: 0 };
    location.href = "breadboard-selection://hover?data=" + encodeURIComponent(JSON.stringify({ id, kind, rect }));
  };
  let selected: Entry | null = null;
  let selectedAnchor = { x: 0, y: 0 };
  let index: { text: string; nodes: Array<{ node: Text; start: number; end: number }> } | null = null;
  let located: Array<{ entry: Entry; range: Range; start: number; end: number }> = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let tracked: string | null = null;
  let positionTimer: ReturnType<typeof setTimeout> | undefined;
  let lastPosition = "";
  const send = (action: "select" | "open" | "position" | "dismiss", entry: Entry, anchor: { x: number; y: number; height?: number }, visible?: boolean) => {
    location.href = "breadboard-selection://annotation?data=" + encodeURIComponent(JSON.stringify({ action, entry, anchor, visible }));
  };
  function reportPosition() {
    if (!tracked || positionTimer) return;
    positionTimer = setTimeout(() => {
      positionTimer = undefined;
      const item = located.find(item => item.entry.id === tracked);
      const entry = item?.entry ?? entries.find(entry => entry.id === tracked);
      if (!entry) return;
      const rect = item?.range.getBoundingClientRect() ?? { left: 0, top: 0, height: 0, bottom: 0, right: 0 };
      const anchor = { x: Math.max(0, rect.left), y: Math.max(0, rect.top), height: rect.height };
      const visible = rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
      const key = JSON.stringify({anchor,visible});
      if (key !== lastPosition) { lastPosition = key; send("position", entry, anchor, visible); }
    }, 32);
  }
  const hide = () => { if (selected) send("dismiss", selected, selectedAnchor); selected = null; };
  const eligible = (node: Node) => node.nodeType === Node.TEXT_NODE && !node.parentElement?.closest(skip);
  const excluded = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest(skip);
  function textIndex() {
    if (index) return index;
    const nodes: Array<{ node: Text; start: number; end: number }> = [];
    const chunks: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: node => eligible(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT });
    let size = 0;
    for (let node = walker.nextNode(); node && size < 1_000_000; node = walker.nextNode()) {
      const text = (node.textContent ?? "").slice(0, 1_000_000 - size);
      nodes.push({ node: node as Text, start: size, end: size + text.length });
      chunks.push(text); size += text.length;
    }
    return index = { text: chunks.join(""), nodes };
  }
  function rangeAt(start: number, end: number) {
    const nodes = textIndex().nodes;
    const find = (offset: number) => {
      let low = 0; let high = nodes.length - 1;
      while (low < high) { const mid = (low + high) >>> 1; if (nodes[mid]!.end > offset) high = mid; else low = mid + 1; }
      return nodes[low];
    };
    const first = find(start);
    const last = find(end - 1);
    if (!first || !last) return null;
    const range = document.createRange();
    range.setStart(first.node, start - first.start); range.setEnd(last.node, end - last.start);
    return range;
  }
  function resolve(entry: Entry, text: string) {
    const matches = (start: number) => text.slice(start, start + entry.quote.length) === entry.quote &&
      (!entry.prefix || text.slice(Math.max(0, start - entry.prefix.length), start) === entry.prefix) &&
      (!entry.suffix || text.slice(start + entry.quote.length, start + entry.quote.length + entry.suffix.length) === entry.suffix);
    if (matches(entry.start)) return entry.start;
    let best = -1; let score = -1; let tied = false;
    let occurrences = 0;
    for (let start = text.indexOf(entry.quote); start >= 0; start = text.indexOf(entry.quote, start + 1)) {
      if (++occurrences > 10000) return -1;
      let context = 0;
      const prefix = entry.prefix ?? ""; const suffix = entry.suffix ?? "";
      for (let i = 1; i <= prefix.length && text[start - i] === prefix[prefix.length - i]; i++) context++;
      for (let i = 0; i < suffix.length && text[start + entry.quote.length + i] === suffix[i]; i++) context++;
      if (context > score) { best = start; score = context; tied = false; }
      else if (context === score) tied = true;
    }
    // Never paint a different occurrence when a changed page has ambiguous text.
    return tied ? -1 : best;
  }
  function paint() {
    located = [];
    const groups = new Map<string, Range[]>();
    if (entries.length) {
      const text = textIndex().text;
      for (const entry of entries) {
        const start = resolve(entry, text);
        if (start < 0) continue;
        const range = rangeAt(start, start + entry.quote.length);
        if (!range) continue;
        located.push({ entry, range, start, end: start + entry.quote.length });
        const name = groupName(entry);
        const ranges = groups.get(name) ?? []; ranges.push(range); groups.set(name, ranges);
      }
    }
    for (const name of names) {
      const key = "breadboard-web-" + name;
      const ranges = groups.get(name);
      if (ranges?.length) registry.set(key, new page.Highlight(...ranges)); else registry.delete(key);
    }
    followLocated = [];
    const toned = new Map<number, Range[]>();
    if (follows.length) {
      const text = textIndex().text;
      for (const entry of follows) {
        const start = resolve({ ...entry, start: 0, end: entry.quote.length } as unknown as Entry, text);
        if (start < 0) continue;
        const range = rangeAt(start, start + entry.quote.length);
        if (!range) continue;
        followLocated.push({ entry, range });
        const ranges = toned.get(entry.tone) ?? []; ranges.push(range); toned.set(entry.tone, ranges);
      }
    }
    for (let tone = 0; tone < tones.length; tone++) {
      const ranges = toned.get(tone);
      // Under your own highlights where the two overlap.
      if (ranges?.length) { const highlight = new page.Highlight(...ranges) as { priority: number }; highlight.priority = -1; registry.set("breadboard-web-follow-" + tone, highlight); }
      else registry.delete("breadboard-web-follow-" + tone);
    }
    if (tipped && !followLocated.some(item => item.entry.id === tipped) && !located.some(item => item.entry.id === tipped)) tip(null, "follow");
    const stillHovered = hovered && located.find(item => item.entry.id === hovered!.id);
    paintHover(stillHovered);
    reportPosition();
  }
  let followHovered: string | null = null;
  function paintFollowHover(item: { entry: FollowedPassage; range: Range } | null | undefined) {
    for (let tone = 0; tone < tones.length; tone++) registry.delete("breadboard-web-follow-hover-" + tone);
    followHovered = item?.entry.id ?? null;
    if (!item) return;
    const highlight = new page.Highlight(item.range) as { priority: number };
    highlight.priority = 1;
    registry.set("breadboard-web-follow-hover-" + item.entry.tone, highlight);
  }
  function paintHover(item: { entry: Entry; range: Range } | null | undefined) {
    for (const name of names) registry.delete("breadboard-web-hover-" + name);
    hovered = item?.entry ?? null;
    const name = item && groupName(item.entry);
    // A noted passage keeps its underline on hover, as in chat.
    if (!item || name === "note") return;
    const highlight = new page.Highlight(item.range) as { priority: number };
    highlight.priority = 1;
    registry.set("breadboard-web-hover-" + name, highlight);
  }
  let hoverFrame = 0;
  document.addEventListener("pointermove", event => {
    if ((!located.length && !followLocated.length && !hovered && !followHovered) || hoverFrame) return;
    const { clientX, clientY } = event;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0;
      // A caret lands on the nearest text even beside it; require the pointer to be over the passage.
      const over = (range: Range) => Array.from(range.getClientRects())
        .some(rect => clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom);
      const item = located.find(item => over(item.range));
      if ((item?.entry.id ?? null) !== (hovered?.id ?? null)) paintHover(item);
      // Your own highlight wins where it overlaps one from someone you follow.
      const followed = item ? undefined : followLocated.find(item => over(item.range));
      if ((followed?.entry.id ?? null) !== followHovered) paintFollowHover(followed);
      if (item?.entry.noted) tip(item.entry.id, "note", item.range);
      else if (followed) tip(followed.entry.id, "follow", followed.range);
      else if (tipped) tip(null, "note");
    });
  }, { passive: true, signal: abort.signal });
  document.documentElement.addEventListener("pointerleave", () => { if (hovered) paintHover(null); if (followHovered) paintFollowHover(null); if (tipped) tip(null, "note"); }, { signal: abort.signal });
  function show(entry: Entry, range: Range, action: "select" | "open" = "select") {
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    selected = entry;
    selectedAnchor = { x: Math.max(0, rect.left), y: Math.max(0, rect.top) };
    send(action, entry, { ...selectedAnchor, height: rect.height });
  }

  function place(event?: PointerEvent) {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.rangeCount) {
      const range = selection.getRangeAt(0);
      if (!document.body.contains(range.commonAncestorContainer) || range.startContainer.parentElement?.closest(skip) || range.endContainer.parentElement?.closest(skip)) { hide(); return; }
      const map = textIndex();
      // Range comparison supports element boundaries as well as text-node boundaries.
      let start = -1; let end = -1;
      for (const item of map.nodes) {
        if (!range.intersectsNode(item.node)) continue;
        const from = range.startContainer === item.node ? range.startOffset : 0;
        const to = range.endContainer === item.node ? range.endOffset : item.end - item.start;
        if (from >= to) continue;
        if (start < 0) start = item.start + from;
        end = item.start + to;
      }
      if (start < 0 || end <= start) { hide(); return; }
      const raw = map.text.slice(start, end); const leading = raw.search(/\S/);
      if (leading < 0) { hide(); return; }
      start += leading; end = Math.min(end - (raw.length - raw.trimEnd().length), start + 4000);
      const existing = located.find(item => item.start < end && item.end > start)?.entry;
      show({ ...(existing ?? {}), id: existing?.id ?? crypto.randomUUID(), start, end, quote: map.text.slice(start, end),
        prefix: map.text.slice(Math.max(0, start - 160), start), suffix: map.text.slice(end, end + 160) }, range);
    } else if (event) {
      const point = document.caretRangeFromPoint(event.clientX, event.clientY);
      const saved = point && located.find(item => item.range.isPointInRange(point.startContainer, point.startOffset));
      const followed = !saved && point ? followLocated.find(item => item.range.isPointInRange(point.startContainer, point.startOffset)) : undefined;
      if (saved) show(saved.entry, saved.range, "open");
      else if (followed) { hide(); if (tipped) tip(null, "follow"); location.href = "breadboard-selection://follow?data=" + encodeURIComponent(JSON.stringify({ id: followed.entry.id })); }
      else hide();
    }
  }
  document.addEventListener("pointerup", event => place(event), { capture: true, signal: abort.signal });
  document.addEventListener("keyup", event => { if (event.key === "Escape") hide(); else if (event.shiftKey || event.key.startsWith("Arrow")) place(); }, { signal: abort.signal });
  document.addEventListener("pointerdown", hide, { capture: true, signal: abort.signal });
  addEventListener("scroll", () => { hide(); reportPosition(); if (tipped) tip(null, "note"); }, { capture: true, signal: abort.signal });
  addEventListener("resize", () => { hide(); reportPosition(); if (tipped) tip(null, "note"); }, { signal: abort.signal });
  const observer = new MutationObserver(records => {
    // Editors are excluded from the text index. Typing (including IME changes
    // to Text nodes) must not invalidate it or rescan a long conversation.
    if (records.every(record => excluded(record.target))) return;
    index = null;
    // No idle page scan. Active pages rebuild one cached text index per batch.
    if ((!entries.length && !follows.length) || timer) return;
    timer = setTimeout(() => { timer = undefined; paint(); }, 350);
  });
  observer.observe(document.body, { childList: true, characterData: true, subtree: true });
  page.__breadboardHighlights = {
    track(id) { tracked = id; lastPosition = ""; reportPosition(); },
    update(next, error, nextFollows) {
      entries = next;
      if (nextFollows) follows = nextFollows;
      paint();
      if (!error) {
        const selection = window.getSelection();
        // A delayed load/save may finish after the person starts typing or
        // selects another passage. Only dismiss the annotation's own selection.
        if (selected && selection && !selection.isCollapsed && selection.rangeCount) {
          const range = selection.getRangeAt(0);
          if (!excluded(range.startContainer) && !excluded(range.endContainer) &&
              selection.toString().trim() === selected.quote) selection.removeAllRanges();
        }
        selected = null;
      }
    },
    dispose() {
      abort.abort(); observer.disconnect(); clearTimeout(timer); clearTimeout(positionTimer); cancelAnimationFrame(hoverFrame); style.remove();
      for (const name of names) { registry.delete("breadboard-web-" + name); registry.delete("breadboard-web-hover-" + name); }
      for (let tone = 0; tone < tones.length; tone++) { registry.delete("breadboard-web-follow-" + tone); registry.delete("breadboard-web-follow-hover-" + tone); }
      if (tipped) tip(null, "note");
    },
  };
}

export function browserTextHighlightsBootstrapScript(): string {
  return `(${installBrowserTextHighlights.toString()})()`;
}

export function browserTextHighlightsUpdateScript(entries: readonly PaintedHighlight[], error: string | null = null, follows?: readonly FollowedPassage[]): string {
  return `window.__breadboardHighlights?.update(${JSON.stringify(entries)}, ${JSON.stringify(error)}${follows ? `, ${JSON.stringify(follows)}` : ""})`;
}
