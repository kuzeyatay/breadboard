import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import esbuild from "esbuild";
import { chromium } from "playwright";

test("watercolor stays visible on dark paper without changing reveal progress", { timeout: 30_000 }, async (t) => {
  const root = path.resolve(import.meta.dirname, "..");
  const bundle = await esbuild.build({
    absWorkingDir: root,
    stdin: {
      resolveDir: root,
      contents: 'import { PaintReveal } from "./src/lib/paint-reveal"; window.PaintReveal = PaintReveal;',
    },
    bundle: true, write: false, format: "iife", platform: "browser",
  });
  const executablePath = [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/chromium",
  ].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<canvas width="160" height="160"></canvas>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });

  const result = await page.evaluate(async () => {
    // Step real canvas animations deterministically; no network artwork or timer waits.
    const frames = new Map();
    let nextFrame = 0;
    window.requestAnimationFrame = callback => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    };
    window.cancelAnimationFrame = id => frames.delete(id);
    const settle = () => {
      let count = 0;
      while (frames.size && count++ < 500) {
        const batch = [...frames.values()];
        frames.clear();
        batch.forEach(callback => callback(count * 16));
      }
      if (frames.size) throw new Error("The reveal did not stop animating");
    };

    const canvas = document.querySelector("canvas");
    const sample = document.createElement("canvas");
    sample.width = sample.height = 70;
    const sampleContext = sample.getContext("2d");
    sampleContext.fillStyle = "#7c4028";
    sampleContext.fillRect(0, 0, 70, 70);
    sampleContext.fillStyle = "#d2ad6d";
    sampleContext.fillRect(35, 0, 35, 70);
    const artwork = sample.toDataURL();
    const owned = [];
    const createElement = document.createElement.bind(document);
    document.createElement = (...args) => {
      const element = createElement(...args);
      if (args[0] === "canvas") owned.push(element);
      return element;
    };
    const reveal = new window.PaintReveal(canvas);
    const wash = owned[0];
    const pixels = () => canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    const covered = data => data.reduce((count, value, index) => count + (index % 4 === 3 && value > 0 ? 1 : 0), 0);
    const difference = (left, right) => {
      // Compare displayed, premultiplied channels; transparent RGB rounding is invisible.
      let delta = 0;
      for (let i = 0; i < left.length; i += 4) {
        delta = Math.max(delta, Math.abs(left[i + 3] - right[i + 3]));
        for (let channel = 0; channel < 3; channel += 1) {
          delta = Math.max(delta, Math.abs(left[i + channel] * left[i + 3] - right[i + channel] * right[i + 3]) / 255);
        }
      }
      return delta;
    };

    reveal.setDarkMode(true);
    const initiallyBlank = covered(pixels()) === 0;
    reveal.setDarkMode(false);
    await reveal.load(artwork);
    reveal.setTarget(0.25);
    settle();
    const light = pixels();
    reveal.setDarkMode(true);
    const dark = pixels();
    const backing = owned.at(-1);
    let brighterPixels = 0;
    let changedBlankPixels = 0;
    for (let i = 0; i < light.length; i += 4) {
      if (!light[i + 3] && dark[i + 3]) changedBlankPixels += 1;
      const lightBrightness = (light[i] + light[i + 1] + light[i + 2]) * light[i + 3];
      const darkBrightness = (dark[i] + dark[i + 1] + dark[i + 2]) * dark[i + 3];
      if (darkBrightness > lightBrightness + 255) brighterPixels += 1;
    }

    reveal.setDarkMode(false);
    const lightRestored = difference(light, pixels());
    const backingReleased = backing.width === 0 && backing.height === 0;
    reveal.setDarkMode(true);
    const darkRestored = difference(dark, pixels());
    reveal.setTarget(0.1);
    settle();
    const lowerTargetKeptProgress = difference(dark, pixels());
    reveal.setTarget(1);
    const pendingBeforeTheme = frames.size;
    reveal.setDarkMode(false);
    reveal.setDarkMode(true);
    const finalBacking = owned.at(-1);
    const pendingAfterTheme = frames.size;
    settle();
    const coverageGrew = covered(pixels()) > covered(dark);
    const idleFrames = frames.size;
    reveal.resizeCanvas(120, 90);
    const resizePreservedPaint = canvas.width === 120 && canvas.height === 90 && covered(pixels()) > 0;
    await reveal.load(artwork);
    const newArtworkClearedPaint = covered(pixels()) === 0;
    reveal.setTarget(0.1);
    reveal.destroy();
    reveal.setDarkMode(false);
    reveal.setDarkMode(true);

    return {
      initiallyBlank, brighterPixels, changedBlankPixels, lightRestored, darkRestored,
      backingReleased, lowerTargetKeptProgress, pendingBeforeTheme, pendingAfterTheme,
      coverageGrew, idleFrames, resizePreservedPaint, newArtworkClearedPaint,
      releasedBuffers: [canvas, wash, finalBacking].every(buffer => buffer.width === 0 && buffer.height === 0),
      framesAfterDestroy: frames.size,
    };
  });

  assert.equal(result.initiallyBlank, true);
  assert.ok(result.brighterPixels > 1_000, "revealed paint needs visible light backing");
  assert.equal(result.changedBlankPixels, 0, "unpainted areas must remain dark");
  assert.ok(result.lightRestored <= 1);
  assert.ok(result.darkRestored <= 1);
  assert.ok(result.lowerTargetKeptProgress <= 1);
  assert.equal(result.backingReleased, true);
  assert.equal(result.pendingBeforeTheme, result.pendingAfterTheme);
  assert.equal(result.coverageGrew, true);
  assert.equal(result.idleFrames, 0);
  assert.equal(result.resizePreservedPaint, true);
  assert.equal(result.newArtworkClearedPaint, true);
  assert.equal(result.releasedBuffers, true);
  assert.equal(result.framesAfterDestroy, 0);
});
