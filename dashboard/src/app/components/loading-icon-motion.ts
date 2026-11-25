type Glyph = HTMLElement | SVGElement;

// Save the last painted frame. A canvas clone starts blank, and a cloned CSS
// animation starts at frame zero, which is visible even during a short fade.
function copyGlyph(source: Glyph): Glyph {
  const copy = source.cloneNode(true) as Glyph;
  const originals = [source, ...source.querySelectorAll<Glyph>("*")];
  const copies = [copy, ...copy.querySelectorAll<Glyph>("*")];
  originals.forEach((original, index) => {
    const target = copies[index];
    const style = getComputedStyle(original);
    for (const property of [
      "width", "height", "color", "opacity", "transform", "transform-origin",
      "background-color", "border", "border-radius", "stroke", "stroke-width", "stroke-dasharray",
      "stroke-dashoffset", "fill",
    ]) {
      target.style.setProperty(property, style.getPropertyValue(property));
    }
    target.style.animation = "none";
    target.style.transition = "none";
    target.removeAttribute("id");
    target.removeAttribute("data-loading-icon");
    if (original instanceof HTMLCanvasElement && target instanceof HTMLCanvasElement) {
      if (original.width && original.height) target.getContext("2d")?.drawImage(original, 0, 0);
    }
  });
  Object.assign(copy.style, { position: "static", display: "block", margin: "0" });
  return copy;
}

// React detaches callback refs before removing their DOM. Keep only the glyph
// for the exit, even when the whole loading row is replaced by the result.
function retainLoadingIcon(node: Glyph | null) {
  if (!node) return;
  return () => {
    if (!node.isConnected || document.hidden || node.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) === false) return;
    const bounds = node.getBoundingClientRect();
    if (!bounds.width || !bounds.height || bounds.bottom <= 0 || bounds.right <= 0 ||
        bounds.top >= innerHeight || bounds.left >= innerWidth) return;

    const ancestors: { element: HTMLElement; opacity: number }[] = [];
    let opacity = 1;
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      ancestors.push({ element: parent, opacity });
      const style = getComputedStyle(parent);
      opacity *= Number(style.opacity);
      if (style.overflowX !== "visible" || style.overflowY !== "visible") {
        const clip = parent.getBoundingClientRect();
        if (style.overflowX !== "visible" && (bounds.right <= clip.left || bounds.left >= clip.right)) return;
        if (style.overflowY !== "visible" && (bounds.bottom <= clip.top || bounds.top >= clip.bottom)) return;
      }
    }
    const copy = copyGlyph(node);
    const duration = parseFloat(getComputedStyle(node).getPropertyValue("--bb-loading-fade")) || 150;
    queueMicrotask(() => {
      // A ref can be replayed in Strict Mode while its element stays mounted.
      if (node.isConnected) return;
      const host = ancestors.find(({ element }) => element.isConnected);
      if (!host) return;
      const layer = node.ownerDocument.createElement("span");
      layer.dataset.loadingIconExit = "";
      layer.ariaHidden = "true";
      layer.inert = true;
      Object.assign(layer.style, {
        position: "absolute", left: "0", top: "0", margin: "0",
        display: "block", width: "max-content", height: "max-content",
        pointerEvents: "none", zIndex: "1",
      });
      layer.append(copy);
      host.element.append(layer);
      // Measure in the surviving offset parent's coordinates so the icon also
      // stays with its scroller or dialog as the replacement content lays out.
      const origin = copy.getBoundingClientRect();
      const layerBounds = layer.getBoundingClientRect();
      const scaleX = layer.offsetWidth ? layerBounds.width / layer.offsetWidth : 1;
      const scaleY = layer.offsetHeight ? layerBounds.height / layer.offsetHeight : 1;
      layer.style.left = `${(bounds.left - origin.left) / (scaleX || 1)}px`;
      layer.style.top = `${(bounds.top - origin.top) / (scaleY || 1)}px`;
      const fade = layer.animate([{ opacity: host.opacity }, { opacity: 0 }], {
        duration,
        easing: "cubic-bezier(0.23, 1, 0.32, 1)",
      });
      const remove = () => layer.remove();
      fade.finished.then(remove, remove);
    });
  };
}

/** Apply only to the decorative glyph. Its control and status text stay live. */
export const loadingIconMotion = { "data-loading-icon": "", ref: retainLoadingIcon } as const;
