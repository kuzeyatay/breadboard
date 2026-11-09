export interface TerminalDockDragOptions {
  dock: HTMLElement;
  handle: HTMLElement | null;
  startX: number;
  startY: number;
  startHeight: number;
  collapsedHeight: number;
  minOpenHeight: number;
  maxHeight: number;
  onDragStart: () => void;
}

/** Own the live edge outside React. The transcript only needs a committed
 * height when the gesture ends, not a new render for every pointer sample. */
export function createTerminalDockDrag(options: TerminalDockDragOptions) {
  const { dock, handle, collapsedHeight, minOpenHeight, maxHeight } = options;
  let height = options.startHeight;
  let dragged = false;
  let frame: number | null = null;
  let disposed = false;

  function paint() {
    frame = null;
    for (const element of [dock, handle]) {
      if (!element) continue;
      element.style.setProperty("--terminal-drag-height", `${height}px`);
      element.dataset.terminalResizing = "true";
    }
    dock.dataset.terminalDragSmall = String(height < minOpenHeight);
  }

  function move(x: number, y: number) {
    if (disposed) return;
    if (!dragged && Math.hypot(x - options.startX, y - options.startY) < 4) return;
    height = Math.min(maxHeight, Math.max(collapsedHeight,
      Math.round(options.startHeight + options.startY - y)));
    if (!dragged) {
      dragged = true;
      // Install the override before cancelling a click-driven glide. This
      // prevents its target height from flashing during the handoff.
      paint();
      options.onDragStart();
    } else if (frame === null) {
      frame = requestAnimationFrame(paint);
    }
  }

  function finish(x?: number, y?: number) {
    if (x !== undefined && y !== undefined) move(x, y);
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    if (dragged) {
      // Snap the unusably short transcript only on release. While dragging,
      // the border follows the pointer continuously through this range.
      if (height < minOpenHeight) {
        height = height >= (collapsedHeight + minOpenHeight) / 2
          ? minOpenHeight : collapsedHeight;
      }
      paint();
    }
    return { dragged, height };
  }

  function dispose() {
    disposed = true;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    for (const element of [dock, handle]) {
      if (!element) continue;
      element.style.removeProperty("--terminal-drag-height");
      delete element.dataset.terminalResizing;
    }
    delete dock.dataset.terminalDragSmall;
  }

  return { move, finish, dispose };
}

export type TerminalDockDrag = ReturnType<typeof createTerminalDockDrag>;
