import type { BrowserAnnotationTarget } from "../shared/browser-annotations";

/** Runs in the untrusted document. It returns a reference, never app credentials. */
function captureAnnotation(x: number, y: number, media: string, source: string) {
  const element = document.elementFromPoint(x, y);
  const selectorFor = (node: Element) => {
    if (node.id) return `#${CSS.escape(node.id)}`;
    const parts: string[] = [];
    for (let current: Element | null = node; current && current !== document.documentElement && parts.length < 12; current = current.parentElement) {
      const siblings = current.parentElement ? Array.from(current.parentElement.children).filter(item => item.tagName === current!.tagName) : [];
      parts.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(current) + 1})`);
    }
    return parts.join(" > ");
  };
  if (media === "image" || media === "video") {
    const node = element?.closest(media === "image" ? "img" : "video") ?? Array.from(document.querySelectorAll(media === "image" ? "img" : "video")).find(node => (node as HTMLImageElement).currentSrc === source || (node as HTMLImageElement).src === source);
    return { kind: media, mediaUrl: source, ...(node ? { selector: selectorFor(node) } : {}),
      ...(node instanceof HTMLVideoElement && Number.isFinite(node.currentTime) ? { time: Math.round(node.currentTime) } : {}) };
  }
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed && selection.rangeCount) {
    const range = selection.getRangeAt(0);
    if ((range.startContainer.parentElement?.closest("input,textarea,[contenteditable]"))) return null;
    const quote = selection.toString().slice(0, 4000);
    const parent = range.commonAncestorContainer.nodeType === Node.TEXT_NODE ? range.commonAncestorContainer.parentElement : range.commonAncestorContainer;
    const text = parent?.textContent ?? "";
    const index = text.indexOf(quote);
    return { kind: "text", quote, prefix: index < 0 ? "" : text.slice(Math.max(0, index - 160), index), suffix: index < 0 ? "" : text.slice(index + quote.length, index + quote.length + 160) };
  }
  return { kind: "page" };
}

export function browserAnnotationCaptureScript(x: number, y: number, media: string, source: string) {
  return `(${captureAnnotation.toString()})(${JSON.stringify(x)},${JSON.stringify(y)},${JSON.stringify(media)},${JSON.stringify(source)})`;
}

function paintAnnotations(items: Array<{ id: string; target: BrowserAnnotationTarget }>) {
  const page = window as Window & { __breadboardCommunityDispose?: () => void; Highlight?: new (...ranges: Range[]) => unknown };
  page.__breadboardCommunityDispose?.();
  const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
  registry?.delete("breadboard-community");
  if (!items.length) return;
  const host = document.createElement("div");
  host.setAttribute("data-breadboard-selection", "community");
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = "button{position:fixed;z-index:2147483647;border:1px solid #99ac9f;border-radius:12px;background:#faf7ef;color:#19392b;padding:2px 6px;font:11px system-ui;cursor:pointer;box-shadow:0 1px 4px #0002}button:focus-visible{outline:2px solid #4f6f68}";
  shadow.append(style);
  const highlightStyle = document.createElement("style");
  highlightStyle.textContent = "::highlight(breadboard-community){background-color:#dce9d7;color:#19392b;}";
  document.documentElement.append(host, highlightStyle);
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  function paint() {
    if (disposed) return;
    shadow.querySelectorAll("button").forEach(node => node.remove());
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: node => node.parentElement?.closest("script,style,input,textarea,select,[contenteditable],[data-breadboard-selection]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const nodes: Array<{node: Text; start: number; end: number}> = [];
    let text = "";
    for (let node = walker.nextNode(); node && text.length < 1000000; node = walker.nextNode()) { const start=text.length; text+=node.textContent ?? ""; nodes.push({node: node as Text,start,end:text.length}); }
    const ranges: Range[] = [];
    for (const { id, target } of items) {
      let rect: DOMRect | undefined;
      if (target.kind === "text" && target.quote) {
        const matches: number[] = [];
        for (let index=text.indexOf(target.quote);index>=0 && matches.length<2;index=text.indexOf(target.quote,index+1)) {
          if ((!target.prefix || text.slice(Math.max(0,index-target.prefix.length),index)===target.prefix) && (!target.suffix || text.slice(index+target.quote.length,index+target.quote.length+target.suffix.length)===target.suffix)) matches.push(index);
        }
        if (matches.length!==1) continue;
        const start=matches[0]!,end=start+target.quote.length;
        const first=nodes.find(node=>node.start<=start&&node.end>start),last=nodes.find(node=>node.start<end&&node.end>=end);
        if (!first||!last) continue;
        const range=document.createRange();range.setStart(first.node,start-first.start);range.setEnd(last.node,end-last.start);ranges.push(range);rect=range.getBoundingClientRect();
      } else if (target.kind === "image" || target.kind === "video") {
        // A URL match wins over a CSS path after a page redesign.
        let element: Element | undefined=target.mediaUrl ? Array.from(document.querySelectorAll(target.kind === "image" ? "img" : "video")).find(node => (node as HTMLImageElement).currentSrc===target.mediaUrl || (node as HTMLImageElement).src===target.mediaUrl) : undefined;
        if (!element && !target.mediaUrl && target.selector) { try { element=document.querySelector(target.selector) ?? undefined; } catch { /* Changed selector. */ } }
        rect=element?.getBoundingClientRect();
      }
      if (!rect || rect.bottom<0 || rect.top>innerHeight || !rect.width) continue;
      const button=document.createElement("button");button.type="button";button.textContent="Comment";button.setAttribute("aria-label","Open discussion on this selection");
      button.style.left=Math.max(0,Math.min(innerWidth-80,rect.right-12))+"px";button.style.top=Math.max(0,rect.top-22)+"px";
      button.addEventListener("click",()=>{location.href="breadboard-annotation://open?id="+encodeURIComponent(id);});shadow.append(button);
    }
    if (registry && page.Highlight) registry.set("breadboard-community",new page.Highlight(...ranges));
  }
  const schedule=()=>{if(timer)clearTimeout(timer);timer=setTimeout(paint,120);};
  window.addEventListener("scroll",schedule,{capture:true,passive:true,signal:abort.signal});window.addEventListener("resize",schedule,{signal:abort.signal});
  const observer=new MutationObserver(schedule);observer.observe(document.body,{childList:true,subtree:true,characterData:true});
  page.__breadboardCommunityDispose=()=>{disposed=true;abort.abort();observer.disconnect();clearTimeout(timer);host.remove();highlightStyle.remove();registry?.delete("breadboard-community");};
  paint();
}
export function browserAnnotationPaintScript(items: Array<{id: string; target: BrowserAnnotationTarget}>) {
  return `(${paintAnnotations.toString()})(${JSON.stringify(items)})`;
}
