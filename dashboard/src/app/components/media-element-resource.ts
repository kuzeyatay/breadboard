/**
 * Release network, demuxer, decoder, and decoded-frame state owned by a media
 * element. Removing a player from the DOM eventually makes it collectible,
 * but Chromium can retain its native allocations until a later collection.
 */
export function releaseMediaElement(element: HTMLMediaElement): void {
  try {
    element.pause();
  } catch {}
  try {
    element.currentTime = 0;
  } catch {}
  try {
    element.removeAttribute("src");
    element.load();
  } catch {}
}
