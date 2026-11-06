/**
 * Publish a scoped navigation hint through the native window title. AirCursor
 * reads this without a network endpoint or desktop privileges in the renderer.
 * Electron forwards the active tab's document title to the containing window.
 */
export const CAD_NAVIGATION_TITLE = "Breadboard CAD | ";

type TitleOwner = { canvas: HTMLCanvasElement; original: string; published: string };
const owners = new WeakMap<Document, TitleOwner>();

export function installCadNavigationContext(canvas: HTMLCanvasElement, ready: () => boolean) {
  const doc = canvas.ownerDocument;
  const win = doc.defaultView;
  if (!win) return () => {};
  let point: { x: number; y: number } | null = null;

  const release = () => {
    const owner = owners.get(doc);
    if (owner?.canvas !== canvas) return;
    // A route or another title owner may already have replaced our hint.
    if (doc.title === owner.published) doc.title = owner.original;
    owners.delete(doc);
  };
  const update = () => {
    const editing = doc.activeElement?.closest(
      "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']",
    );
    if (!point || !canvas.isConnected || !ready() || !doc.hasFocus() || doc.hidden || editing ||
        doc.elementFromPoint(point.x, point.y) !== canvas) {
      release();
      return;
    }
    const previous = owners.get(doc);
    // The desktop preload can supply the same hint to older dashboard builds.
    if (!previous && doc.title.startsWith(CAD_NAVIGATION_TITLE)) return;
    const original = previous && doc.title === previous.published ? previous.original : doc.title;
    const published = CAD_NAVIGATION_TITLE + (original || "Breadboard");
    owners.set(doc, { canvas, original, published });
    if (doc.title !== published) doc.title = published;
  };
  const move = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
    point = { x: event.clientX, y: event.clientY };
    update();
  };
  const leave = () => {
    point = null;
    release();
  };
  doc.addEventListener("pointermove", move, true);
  doc.addEventListener("pointerdown", move, true);
  doc.addEventListener("focusin", update);
  doc.addEventListener("visibilitychange", leave);
  doc.documentElement.addEventListener("pointerleave", leave);
  win.addEventListener("blur", leave);
  // Hit-test even without movement: a dialog, scrolling or resizing can cover
  // the canvas, including while pointer capture is held by an orbit drag.
  const timer = win.setInterval(update, 100);
  return () => {
    win.clearInterval(timer);
    doc.removeEventListener("pointermove", move, true);
    doc.removeEventListener("pointerdown", move, true);
    doc.removeEventListener("focusin", update);
    doc.removeEventListener("visibilitychange", leave);
    doc.documentElement.removeEventListener("pointerleave", leave);
    win.removeEventListener("blur", leave);
    release();
  };
}
