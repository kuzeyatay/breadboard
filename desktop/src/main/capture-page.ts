import { nativeImage, type NativeImage, type WebContents } from "electron";

const pendingCaptures = new WeakMap<WebContents, Promise<NativeImage>>();

/** Request a fresh compositor frame, including fully occluded controls. Native
 * capturePage(stayHidden) alone can wait forever for an occluded surface and can
 * return pixels from before a DOM update. DevTools capture forces that frame
 * without selecting a tab or acquiring Electron's visible capturer. Serialize
 * per page so overlapping callers cannot detach each other's debugger. */
export async function capturePageWithFreshFrame(contents: WebContents): Promise<NativeImage> {
  const previous = pendingCaptures.get(contents);
  const capture = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(async () => {
    if (contents.isDestroyed() || contents.isCrashed()) throw new Error("The page is no longer available for a screenshot.");
    const inspector = contents.debugger;
    const attachedHere = !inspector.isAttached();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (attachedHere) inspector.attach("1.3");
      const result = await Promise.race([
        (async () => {
          const { cssVisualViewport: viewport } = await inspector.sendCommand("Page.getLayoutMetrics");
          // Explicitly clip to the current viewport. Without a clip Chromium
          // captures the whole document, shrinking long pages beyond legibility.
          return inspector.sendCommand("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: true,
            clip: { x: viewport.pageX, y: viewport.pageY, width: viewport.clientWidth, height: viewport.clientHeight, scale: 1 } });
        })(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("The page did not render a screenshot. Wait for it to finish loading and retry.")), 5_000);
        }),
      ]);
      const image = nativeImage.createFromBuffer(Buffer.from(result.data, "base64"));
      if (image.isEmpty()) throw new Error("The page returned an empty screenshot. Wait for it to finish rendering and retry.");
      return image;
    } finally {
      if (timer) clearTimeout(timer);
      if (!contents.isDestroyed() && attachedHere && inspector.isAttached()) inspector.detach();
    }
  });
  pendingCaptures.set(contents, capture);
  try { return await capture; }
  finally { if (pendingCaptures.get(contents) === capture) pendingCaptures.delete(contents); }
}
