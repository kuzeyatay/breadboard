// Code-writing requests are handed to Codex; questions about code are not.
import test from "node:test";
import assert from "node:assert/strict";
import { isCodeWritingRequest } from "../src/lib/hermes/codex-drive.ts";

test("code-writing requests route to Codex, questions and commands do not", () => {
  for (const text of [
    "write a python script that renames my photos by date",
    "fix the bug in src/app/page.tsx where the button does nothing",
    "add unit tests for the parser",
    "build me a small react app for tracking habits",
    "refactor this function to be async",
  ]) assert.equal(isCodeWritingRequest(text), true, text);
  for (const text of [
    "what does this function do?",
    "explain how React hooks work",
    "write a poem about autumn",
    "make me a grocery list",
    "/agents:codex fix the tests",
    "",
  ]) assert.equal(isCodeWritingRequest(text), false, text);
});
