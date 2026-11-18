/** Estimate attention for one card at a time. Credit a sustained read once, then cap idle-tab credit. */
export function observeFeedReading(cards: HTMLElement[], onRead: (id: string, kind: "read" | "linger") => void) {
  const visible = new Set<HTMLElement>(), read = new Set<HTMLElement>(), lingered = new Set<HTMLElement>();
  let current: HTMLElement | null = null, pointed: HTMLElement | null = null;
  let timer = 0, longTimer = 0, frame = 0;
  const active = () => document.visibilityState === "visible" && document.hasFocus();
  function select(next: HTMLElement | null) {
    if (next === current) return;
    window.clearTimeout(timer); window.clearTimeout(longTimer); current = next;
    const id = next?.dataset.crumb;
    if (!next || !id || lingered.has(next)) return;
    if (!read.has(next)) timer = window.setTimeout(() => {
      if (active()) { read.add(next); onRead(id, "read"); }
    }, 6000);
    longTimer = window.setTimeout(() => { if (active()) { lingered.add(next); onRead(id, "linger"); } }, 18000);
  }
  function refresh() {
    frame = 0;
    if (!active()) { select(null); return; }
    const focus = document.activeElement?.closest<HTMLElement>("[data-crumb]");
    const center = window.innerHeight / 2;
    let best: HTMLElement | null = null, distance = Infinity;
    for (const card of visible) {
      const rect = card.getBoundingClientRect();
      const height = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
      if (height <= 0 || height < 0.6 * Math.min(rect.height, window.innerHeight)) continue;
      const gap = card === pointed ? -2 : card === focus ? -1 : Math.abs((rect.top + rect.bottom) / 2 - center);
      if (gap < distance) { best = card; distance = gap; }
    }
    select(best);
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(refresh); };
  const pause = () => select(null);
  const pointer = (event: PointerEvent) => {
    pointed = event.target instanceof Element ? event.target.closest("[data-crumb]") : null;
    schedule();
  };
  const scroll = () => { pointed = null; schedule(); };
  const visibility = () => { if (document.hidden) pause(); else schedule(); };
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const card = entry.target as HTMLElement;
      if (entry.isIntersecting) visible.add(card); else visible.delete(card);
    }
    schedule();
  });
  cards.forEach(card => observer.observe(card));
  document.addEventListener("visibilitychange", visibility);
  document.addEventListener("scroll", scroll, true);
  document.addEventListener("pointerover", pointer);
  document.addEventListener("focusin", schedule);
  window.addEventListener("blur", pause);
  window.addEventListener("focus", schedule);
  return () => {
    observer.disconnect(); cancelAnimationFrame(frame); pause();
    document.removeEventListener("visibilitychange", visibility);
    document.removeEventListener("scroll", scroll, true);
    document.removeEventListener("pointerover", pointer);
    document.removeEventListener("focusin", schedule);
    window.removeEventListener("blur", pause);
    window.removeEventListener("focus", schedule);
  };
}
