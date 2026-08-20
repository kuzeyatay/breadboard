import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const responseMeta = fs.readFileSync(
  new URL("../src/app/components/assistant-response-meta.tsx", import.meta.url),
  "utf8",
);
const globalStyles = fs.readFileSync(
  new URL("../src/app/globals.css", import.meta.url),
  "utf8",
);

test("the existing token arrow moves only while Thinking is active", () => {
  assert.match(responseMeta, />\s*↓\s*<\/span>/);
  assert.match(
    responseMeta,
    /className=\{active \? "thinking-token-arrow" : undefined\}/,
  );
  assert.match(globalStyles, /@keyframes thinking-token-arrow-down/);
  assert.match(
    globalStyles,
    /@keyframes thinking-token-arrow-down[\s\S]*?translateY\(0\)[\s\S]*?translateY\(8%\)/,
  );
});

test("the downward arrow motion respects reduced-motion preferences", () => {
  assert.match(
    globalStyles,
    /prefers-reduced-motion:[\s\S]*?\.thinking-token-arrow[\s\S]*?animation: none[\s\S]*?transform: none/,
  );
});
