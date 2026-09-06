import { test } from "node:test";
import assert from "node:assert/strict";
import type { NativeImage } from "electron";
import { capturePagePreservingVisibility } from "../src/main/capture-page";

test("a screenshot never acquires a visible capturer, including concurrent captures", async () => {
  let visibleCapturers = 0;
  const releases: Array<() => void> = [];
  const image = {} as NativeImage;
  const contents = {
    isDestroyed: () => false,
    isCrashed: () => false,
    capturePage: (_rect?: unknown, options?: { stayHidden?: boolean }) => {
      if (!options?.stayHidden) visibleCapturers++;
      return new Promise<NativeImage>(resolve => releases.push(() => resolve(image)));
    },
  };
  const first = capturePagePreservingVisibility(contents);
  const second = capturePagePreservingVisibility(contents);
  assert.equal(visibleCapturers, 0, "capture must not temporarily show a background view");
  for (const release of releases) release();
  assert.deepEqual(await Promise.all([first, second]), [image, image]);
});

for (const unavailable of ["destroyed", "crashed"]) {
  test(`a ${unavailable} page never reaches the native capture API`, async () => {
    await assert.rejects(capturePagePreservingVisibility({
      isDestroyed: () => unavailable === "destroyed",
      isCrashed: () => unavailable === "crashed",
      capturePage: () => { throw new Error("native capture must not run"); },
    }), /no longer available/);
  });
}
