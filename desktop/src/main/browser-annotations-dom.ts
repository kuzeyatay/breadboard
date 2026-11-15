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

function paintAnnotations(items: Array<{ id: string; target: BrowserAnnotationTarget; count?: number; preview?: string }>) {
  const page = window as Window & { __breadboardCommunityDispose?: () => void; Highlight?: new (...ranges: Range[]) => unknown };
  page.__breadboardCommunityDispose?.();
  const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
  registry?.delete("breadboard-community");
  if (!items.length) return;
  const host = document.createElement("div");
  host.setAttribute("data-breadboard-selection", "community");
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = "button{position:fixed;z-index:2147483647;display:inline-flex;align-items:center;gap:4px;border:1px solid #99ac9f;border-radius:12px;background:#faf7ef;color:#19392b;padding:2px 7px;font:600 11px system-ui;cursor:pointer;box-shadow:0 1px 4px #0002}button:hover{border-color:#4f6f68}button:focus-visible{outline:2px solid #4f6f68}"
    + "svg{width:12px;height:12px;color:#4f6f68}"
    + "span{position:fixed;z-index:2147483647;max-width:280px;padding:7px 10px;border:1px solid #bccfc2;border-radius:10px;background:#fffefb;color:#13201b;font:12px/1.45 system-ui;box-shadow:0 6px 20px #0003;pointer-events:none;overflow-wrap:anywhere}";
  shadow.append(style);
  const highlightStyle = document.createElement("style");
  highlightStyle.textContent = "::highlight(breadboard-community){background-color:#dce9d7;color:#19392b;}";
  document.documentElement.append(host, highlightStyle);
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  function paint() {
    if (disposed) return;
    shadow.querySelectorAll("button,span").forEach(node => node.remove());
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: node => node.parentElement?.closest("script,style,input,textarea,select,[contenteditable],[data-breadboard-selection]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const nodes: Array<{node: Text; start: number; end: number}> = [];
    let text = "";
    for (let node = walker.nextNode(); node && text.length < 1000000; node = walker.nextNode()) { const start=text.length; text+=node.textContent ?? ""; nodes.push({node: node as Text,start,end:text.length}); }
    const ranges: Range[] = [];
    for (const { id, target, count, preview } of items) {
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
      // The marker: the Crumbs mark and how many notes this passage has. Hovering previews the first one.
      const button=document.createElement("button");button.type="button";
      const total=typeof count==="number"&&count>0?count:0;
      button.setAttribute("aria-label",total?`Open ${total} ${total===1?"crumb":"crumbs"} on this selection`:"Open discussion on this selection");
      const mark=document.createElementNS("http://www.w3.org/2000/svg","svg");mark.setAttribute("viewBox","0 0 24 24");mark.setAttribute("fill","none");mark.setAttribute("stroke","currentColor");mark.setAttribute("stroke-width","2");mark.setAttribute("aria-hidden","true");
      const slice=document.createElementNS("http://www.w3.org/2000/svg","path");slice.setAttribute("d","M5.6 10.3C4.4 9.7 3.6 8.7 3.6 7.5c0-2.2 2.6-3.7 6.4-3.7s6.4 1.5 6.4 3.7c0 1.2-.8 2.2-2 2.8v6.1c0 1-.8 1.8-1.8 1.8H7.4c-1 0-1.8-.8-1.8-1.8v-6.1Z");mark.append(slice);
      button.append(mark,document.createTextNode(total?String(total):"Comment"));
      const left=Math.max(0,Math.min(innerWidth-80,rect.right-12)),top=Math.max(0,rect.top-22);
      button.style.left=left+"px";button.style.top=top+"px";
      if (preview) {
        let tip: HTMLSpanElement | undefined;
        const show=()=>{if(tip)return;tip=document.createElement("span");tip.textContent=preview;tip.style.left=Math.max(4,Math.min(innerWidth-290,left-120))+"px";tip.style.bottom=(innerHeight-top+6)+"px";shadow.append(tip);};
        const hide=()=>{tip?.remove();tip=undefined;};
        button.addEventListener("mouseenter",show);button.addEventListener("focus",show);button.addEventListener("mouseleave",hide);button.addEventListener("blur",hide);
      }
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
export function browserAnnotationPaintScript(items: Array<{id: string; target: BrowserAnnotationTarget; count?: number; preview?: string}>) {
  return `(${paintAnnotations.toString()})(${JSON.stringify(items)})`;
}
