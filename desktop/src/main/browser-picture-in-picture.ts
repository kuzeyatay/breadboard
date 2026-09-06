import type { WebContents, WebFrameMain } from "electron";

interface VideoCandidate {
  active: boolean;
  playing: boolean;
  area: number;
}

// Executed in each frame, including embedded players. No product bridge or
// extension API is exposed to the site; Chromium owns the floating video window.
async function pictureInPictureInPage(action: "inspect" | "toggle"): Promise<VideoCandidate | "started" | "closed" | null> {
  if (document.pictureInPictureElement) {
    if (action === "inspect") return { active: true, playing: true, area: 0 };
    await document.exitPictureInPicture();
    return "closed";
  }
  if (!document.pictureInPictureEnabled) return null;
  const roots: Array<Document | ShadowRoot> = [document];
  const videos: HTMLVideoElement[] = [];
  for (let i = 0; i < roots.length; i += 1) {
    const root = roots[i]!;
    videos.push(...Array.from(root.querySelectorAll("video")));
    for (const element of Array.from(root.querySelectorAll("*"))) {
      if (element.shadowRoot) roots.push(element.shadowRoot);
    }
  }
  const candidates = videos
    .filter(video => video.readyState >= 2 && video.videoWidth > 0 && !video.ended && !video.disablePictureInPicture)
    .map(video => {
      const rect = video.getBoundingClientRect();
      return { video, playing: !video.paused, area: Math.max(0, rect.width) * Math.max(0, rect.height) };
    })
    .filter(candidate => candidate.area > 0)
    .sort((a, b) => Number(b.playing) - Number(a.playing) || b.area - a.area);
  const candidate = candidates[0];
  if (!candidate) return null;
  if (action === "inspect") return { active: false, playing: candidate.playing, area: candidate.area };
  await candidate.video.requestPictureInPicture();
  return "started";
}

async function evaluate(frame: WebFrameMain, action: "inspect" | "toggle"): Promise<unknown> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      frame.executeJavaScript(`(${pictureInPictureInPage.toString()})(${JSON.stringify(action)})`, action === "toggle"),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("The video did not respond. Try again.")), 5000); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** A user-triggered native PiP toggle. Its window belongs to the source page,
 * which Breadboard keeps alive when other browser or product tabs are selected. */
export async function toggleBrowserPictureInPicture(contents: WebContents): Promise<boolean> {
  if (contents.isDestroyed()) return false;
  const frames = contents.mainFrame.framesInSubtree.filter(frame => !frame.detached).slice(0, 128);
  const candidates = await Promise.all(frames.map(async frame => {
    try {
      const value = await evaluate(frame, "inspect") as VideoCandidate | null;
      if (!value || typeof value.active !== "boolean" || typeof value.playing !== "boolean" ||
          typeof value.area !== "number" || !Number.isFinite(value.area)) return null;
      return { frame, active: value.active, playing: value.playing, area: Math.max(0, value.area) };
    } catch {
      // Frames can disappear or navigate while the menu is open.
      return null;
    }
  }));
  const selected = candidates.filter(candidate => candidate !== null)
    .sort((a, b) => Number(b.active) - Number(a.active) || Number(b.playing) - Number(a.playing) || b.area - a.area)[0];
  if (!selected || contents.isDestroyed() || selected.frame.detached) return false;
  const result = await evaluate(selected.frame, "toggle");
  return result === "started" || result === "closed";
}
