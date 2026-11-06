import { acquireLensSound } from './chat-lens-sound';

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

export function lensGeometry(index: number, position: number, height: number) {
  const radius = Math.max(14, (height - 22) / 2);
  const step = Math.min(1.2, 15.5 / radius);
  const angle = (index - position) * step;
  const visible = Math.abs(angle) < 1.49;
  const depth = visible ? Math.cos(angle) : 0;
  return { visible, depth, y: Math.sin(clamp(angle, -1.49, 1.49)) * radius, step };
}

export type ChatLensRail = ReturnType<typeof mountChatLensRail>;

/** Owns only the rail's presentation. Message identity, tooltips and jumps stay with the host. */
export function mountChatLensRail({ root, track, onHover }: {
  root: HTMLElement;
  track: HTMLElement;
  onHover: (index: number | null, tick: HTMLButtonElement | null) => void;
}) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  let buttons: HTMLButtonElement[] = [], shown = new Set<number>();
  let active = 0, position = 0, target = 0, velocity = 0, height = 30;
  let frame = 0, previousTime = 0, audible = false, lastNotch = 0, destroyed = false;
  let hoverY: number | null = null, focusIndex: number | null = null, lastHover: number | null = null;
  let pointer: { id: number; y: number; start: number; moved: boolean } | null = null;
  let suppressClick = false, clickTimer = 0;
  const sound = acquireLensSound();
  function initialPosition() {
    const last = Math.max(0, buttons.length - 1);
    const half = 1.49 / lensGeometry(0, 0, height).step;
    return last < 2 * half ? last / 2 : active;
  }
  // Center short chats initially, but let the ring turn even when all ticks fit.
  function limit(value: number) { return clamp(value, 0, Math.max(0, buttons.length - 1)); }
  function stop() { cancelAnimationFrame(frame); frame = 0; velocity = 0; target = position; audible = false; }
  function label(index: number | null) {
    if (lastHover !== null && lastHover !== index) buttons[lastHover]?.removeAttribute('data-lens-hovered');
    if (index !== null) buttons[index]?.setAttribute('data-lens-hovered', 'true');
    // Position can change without the hovered index changing as the ring turns.
    if (index !== null || lastHover !== null) onHover(index, index === null ? null : buttons[index]);
    lastHover = index;
  }
  function draw() {
    if (destroyed) return;
    const notch = Math.round(position);
    if (audible && notch !== lastNotch) sound.play(Math.sign(notch - lastNotch));
    lastNotch = notch;
    const half = Math.ceil(1.49 / lensGeometry(0, 0, height).step);
    const nextShown = new Set<number>();
    let nearest: number | null = null, distance = Infinity;
    for (let i = Math.max(0, Math.floor(position) - half); i <= Math.min(buttons.length - 1, Math.ceil(position) + half); i++) {
      const tick = buttons[i], g = lensGeometry(i, position, height);
      if (!g.visible) continue;
      nextShown.add(i);
      tick.style.visibility = 'visible';
      tick.style.pointerEvents = '';
      tick.removeAttribute('aria-hidden');
      tick.tabIndex = i === Math.round(position) ? 0 : -1;
      tick.style.transform = `translateY(${g.y - 7}px) scaleY(${Math.max(.2, g.depth)})`;
      tick.style.setProperty('--lens-depth', String(g.depth));
      tick.style.setProperty('--lens-opacity', String((i === active ? .5 + g.depth * .5 : .26 + g.depth * .38) * Math.min(1, g.depth * 3)));
      const mark = tick.querySelector<HTMLElement>('.bb-chat-lens-mark');
      // Let the marks narrow with the ring's profile as they turn around its ends.
      if (mark) mark.style.width = `${(i === active ? 20 : 14) * g.depth}px`;
      if (hoverY !== null && Math.abs(g.y - hoverY) < distance) { distance = Math.abs(g.y - hoverY); nearest = i; }
    }
    for (const i of shown) if (!nextShown.has(i)) {
      const tick = buttons[i];
      if (tick) { tick.style.visibility = 'hidden'; tick.style.pointerEvents = 'none'; tick.tabIndex = -1; tick.setAttribute('aria-hidden', 'true'); }
    }
    shown = nextShown;
    label(pointer?.moved ? null : focusIndex ?? (distance < 15 ? nearest : null));
    root.dataset.lensPosition = position.toFixed(3);
  }
  function animate(now: number) {
    frame = 0;
    const dt = Math.min(Math.max((now - previousTime) / 1000, .001), .032);
    previousTime = now;
    const omega = 22, offset = position - target, decay = Math.exp(-omega * dt), c = velocity + omega * offset;
    position = limit(target + (offset + c * dt) * decay);
    velocity = (velocity - omega * c * dt) * decay;
    draw();
    if (Math.abs(position - target) > .002 || Math.abs(velocity) > .015) frame = requestAnimationFrame(animate);
    else { position = target; velocity = 0; draw(); audible = false; }
  }
  function turn(value: number, user = false, instant = false) {
    if (instant || reduce.matches) {
      stop(); position = target = limit(value); audible = user; draw(); audible = false; return;
    }
    target = limit(value); audible = user;
    if (!frame) { previousTime = performance.now(); frame = requestAnimationFrame(animate); }
  }
  function refresh() {
    const nextButtons = Array.from(track.querySelectorAll<HTMLButtonElement>('.bb-chat-lens-item'));
    // Streaming updates the host's item array without changing these controls.
    // Keep a ring the reader is turning in place as the answer arrives.
    if (nextButtons.length === buttons.length && nextButtons.every((button, i) => button === buttons[i])) return;
    const hadButtons = buttons.length > 0;
    stop(); label(null); shown.clear();
    buttons = nextButtons;
    if (focusIndex !== null && focusIndex >= buttons.length) focusIndex = null;
    active = clamp(active, 0, Math.max(0, buttons.length - 1));
    track.style.setProperty('--lens-length', `${Math.min(310, buttons.length * 14 + 22)}px`);
    height = track.clientHeight || Math.min(310, buttons.length * 14 + 22);
    buttons.forEach((button, i) => {
      button.dataset.lensIndex = String(i); button.tabIndex = -1;
      button.style.visibility = 'hidden'; button.setAttribute('aria-hidden', 'true');
    });
    position = target = limit(hadButtons ? position : initialPosition()); lastNotch = Math.round(position); draw();
  }
  function setActive(index: number) {
    const changed = active !== index;
    active = clamp(index, 0, Math.max(0, buttons.length - 1));
    if (changed && hoverY === null && !pointer && focusIndex === null &&
        (!shown.has(active) || Math.abs((active - position) * lensGeometry(0, 0, height).step) > 1.1)) turn(active);
    else draw();
  }
  function wheel(event: WheelEvent) {
    if (event.ctrlKey || event.metaKey || !buttons.length) return;
    event.preventDefault(); if (pointer) return;
    focusIndex = null;
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1);
    turn(target + clamp(delta / 42, -6, 6), true);
  }
  function pointerMove(event: PointerEvent) {
    if (event.pointerType !== 'touch' && finePointer.matches) {
      hoverY = event.clientY - track.getBoundingClientRect().top - height / 2;
      focusIndex = null; if (!pointer?.moved) draw();
    }
  }
  function pointerLeave() { hoverY = null; if (focusIndex === null) label(null); }
  function down(event: PointerEvent) {
    if (!event.isPrimary || event.button !== 0) return;
    stop(); sound.unlock(); focusIndex = null;
    pointer = { id: event.pointerId, y: event.clientY, start: position, moved: false };
  }
  function drag(event: PointerEvent) {
    if (!pointer || event.pointerId !== pointer.id) return;
    const delta = event.clientY - pointer.y;
    if (!pointer.moved && Math.abs(delta) > 4) { pointer.moved = true; track.setPointerCapture?.(event.pointerId); }
    if (!pointer.moved) return;
    event.preventDefault(); suppressClick = true;
    track.dataset.lensDragging = 'true';
    position = target = limit(pointer.start - delta / 16); audible = true; draw();
  }
  function end(event: PointerEvent, cancelled = false) {
    if (!pointer || event.pointerId !== pointer.id) return;
    const moved = pointer.moved; pointer = null;
    delete track.dataset.lensDragging;
    if (track.hasPointerCapture?.(event.pointerId)) track.releasePointerCapture(event.pointerId);
    if (moved && !cancelled) turn(Math.round(position), true);
    else if (cancelled) stop();
    clearTimeout(clickTimer); clickTimer = window.setTimeout(() => { suppressClick = false; }, 0);
  }
  function up(event: PointerEvent) { end(event); }
  function cancel(event: PointerEvent) { end(event, true); }
  function click(event: MouseEvent) { if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); } }
  function focus(event: FocusEvent) {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.bb-chat-lens-item');
    if (!button) return;
    focusIndex = Number(button.dataset.lensIndex); hoverY = null;
    if (!shown.has(focusIndex)) turn(focusIndex, false, true); else draw();
  }
  function blur(event: FocusEvent) {
    if (!track.contains(event.relatedTarget as Node | null)) { focusIndex = null; hoverY = null; label(null); }
  }
  function key(event: KeyboardEvent) {
    const steps: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, PageUp: -6, PageDown: 6 };
    if (!(event.key in steps) && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault(); sound.unlock();
    const next = clamp(event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 :
      (focusIndex ?? Math.round(position)) + steps[event.key], 0, buttons.length - 1);
    focusIndex = next; hoverY = null; turn(next, true, true); buttons[next]?.focus({ preventScroll: true });
  }
  function onReduce() { stop(); draw(); }
  function deactivate() {
    if (pointer) end({ pointerId: pointer.id } as PointerEvent, true);
    stop(); hoverY = null; focusIndex = null; label(null);
  }
  function onVisibility() { if (document.hidden) deactivate(); }
  function onResize() {
    height = track.clientHeight || height; position = target = limit(position); draw();
  }
  const resize = typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(onResize) : null;
  resize?.observe(track);
  track.addEventListener('wheel', wheel, { passive: false });
  track.addEventListener('pointermove', pointerMove);
  track.addEventListener('pointerleave', pointerLeave);
  track.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', drag, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('blur', deactivate);
  document.addEventListener('visibilitychange', onVisibility);
  track.addEventListener('lostpointercapture', cancel);
  track.addEventListener('click', click, true);
  track.addEventListener('focusin', focus);
  track.addEventListener('focusout', blur);
  track.addEventListener('keydown', key);
  reduce.addEventListener('change', onReduce);
  root.dataset.lensReady = 'true'; refresh();
  return {
    refresh, setActive,
    destroy() {
      destroyed = true; stop(); label(null); clearTimeout(clickTimer); resize?.disconnect(); sound.release();
      track.removeEventListener('wheel', wheel); track.removeEventListener('pointermove', pointerMove);
      track.removeEventListener('pointerleave', pointerLeave); track.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', drag); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', deactivate); document.removeEventListener('visibilitychange', onVisibility);
      track.removeEventListener('lostpointercapture', cancel); track.removeEventListener('click', click, true);
      track.removeEventListener('focusin', focus); track.removeEventListener('focusout', blur); track.removeEventListener('keydown', key);
      reduce.removeEventListener('change', onReduce);
      delete root.dataset.lensReady;
    },
  };
}
