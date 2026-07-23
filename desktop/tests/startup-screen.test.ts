import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const desktopRoot = path.resolve(__dirname, "..", "..");
const startupRoot = path.join(desktopRoot, "src", "startup");
const html = fs.readFileSync(path.join(startupRoot, "index.html"), "utf8");
const css = fs.readFileSync(path.join(startupRoot, "startup.css"), "utf8");
const script = fs.readFileSync(path.join(startupRoot, "startup.ts"), "utf8");

test("desktop startup is a text-free kinetic scale field", () => {
  assert.match(html, /id="kinetic-field" class="kinetic-field"/);
  assert.doesNotMatch(html, /class="brand"/);
  assert.doesNotMatch(html, /<h1/);
  assert.match(html, /id="phase-message" class="visually-hidden"/);
  assert.match(html, /id="service-list" class="visually-hidden"/);

  assert.match(css, /--background: #faf7ef;/);
  assert.match(css, /@keyframes scale-lift/);
  assert.match(css, /\.kinetic-scale::after/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);

  assert.match(script, /const rowSizes = \[5, 7, 8, 7, 5\]/);
  assert.match(script, /scale\.className = "kinetic-scale"/);
  assert.match(script, /document\.body\.dataset\["phase"\] = state\.phase/);
});
