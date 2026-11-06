// Breadboard adapter. Upstream sources remain untouched in runtime/, lib/, pieces/.
import {play} from './runtime/player.js';

const pieces = new Map();
export function loadPiece(slug) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return Promise.reject(new Error('Invalid ASCII scene'));
  if (!pieces.has(slug)) {
    const promise = import(`./pieces/${slug}.js`).catch(error=>{pieces.delete(slug); throw error;});
    pieces.set(slug,promise);
  }
  return pieces.get(slug);
}

export function mount(host, piece, {still = false, preview = false} = {}) {
  const pre = document.createElement('pre');
  pre.setAttribute('aria-hidden','true');
  // Bound the raster size even on high-DPI displays. CSS fits it to the viewport.
  const px = Math.min(preview ? 8 : 18, (preview ? 280 : 800) / (piece.meta.cols * .602));
  pre.style.cssText = `margin:0;font:${px}px/1 Consolas,monospace;color:#dce8e2;white-space:pre`;
  host.replaceChildren(pre);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let stop = () => {}, elapsed = 2, disposed = false;
  const start = () => {
    stop();
    if (disposed) return;
    stop = play(pre, piece, {
      still: still || reduced.matches || document.visibilityState === 'hidden',
      maxFps: preview ? 10 : 16,
      t0: elapsed,
      onFrame(_frame,t) { elapsed = t; },
    });
  };
  start();
  document.addEventListener('visibilitychange',start);
  reduced.addEventListener('change',start);
  // Window blur deliberately does not stop art on another visible monitor.
  return () => {
    disposed = true;
    stop();
    document.removeEventListener('visibilitychange',start);
    reduced.removeEventListener('change',start);
    host.replaceChildren();
  };
}
