/**
 * A single textbook-sized reply can contain tens of thousands of KaTeX nodes.
 * Row virtualization cannot help while that reply is visible. Let Chromium
 * skip its offscreen prose/math blocks, retaining their measured heights so
 * the transcript's virtualizer and the reader's scroll position stay intact.
 * The DOM stays complete for selection, accessibility and browser find.
 */
export function containLongChatMarkdown(root: HTMLElement): () => void {
  const view = root.ownerDocument.defaultView;
  if (!view || !view.CSS?.supports("content-visibility", "auto") || root.children.length < 80) {
    return () => {};
  }

  // Paragraphs/headings have no collapsing block descendants. Do not contain
  // lists/disclosures or asynchronously sized media: establishing a new layout
  // context there can change margins or retain a pre-load image height.
  const blocks = Array.from(root.children).filter((node): node is HTMLElement =>
    node instanceof view.HTMLElement &&
    (node.matches("p,h1,h2,h3,h4,h5,h6") || node.classList.contains("katex-display")) &&
    !node.querySelector("img,video,iframe"),
  );
  if (blocks.length < 80) return () => {};

  const previous = blocks.map(block => ({
    visibility: block.style.contentVisibility,
    size: block.style.containIntrinsicBlockSize,
  }));
  const restore = () => blocks.forEach((block, index) => {
    block.style.contentVisibility = previous[index].visibility;
    block.style.containIntrinsicBlockSize = previous[index].size;
  });
  let frame = 0;
  let disposed = false;
  let width = -1;
  const measure = () => {
    frame = 0;
    if (disposed || !root.isConnected || root.clientWidth === 0) return;
    restore();
    width = root.clientWidth;
    // Read every natural content-box height before writing any containment.
    // Guessed heights (even with `auto`) make long messages jump on first scroll.
    const sizes = blocks.map(block => {
      const style = view.getComputedStyle(block);
      return Math.max(0, block.getBoundingClientRect().height
        - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
        - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth));
    });
    blocks.forEach((block, index) => {
      block.style.containIntrinsicBlockSize = `auto ${sizes[index]}px`;
      block.style.contentVisibility = "auto";
    });
  };
  const schedule = () => {
    if (!disposed && !frame) frame = view.requestAnimationFrame(measure);
  };
  const observer = new view.ResizeObserver(() => {
    // Heights change as the browser activates blocks. Only a new wrapping
    // width invalidates the cached offscreen heights.
    if (root.clientWidth !== width) schedule();
  });
  observer.observe(root);
  root.ownerDocument.fonts?.addEventListener("loadingdone", schedule);
  // The effect runs after React committed the reply. Measure once now: an
  // Electron tab can be hidden (and have no animation frames) until selected.
  measure();

  return () => {
    disposed = true;
    if (frame) view.cancelAnimationFrame(frame);
    observer.disconnect();
    root.ownerDocument.fonts?.removeEventListener("loadingdone", schedule);
    restore();
  };
}
