// Code-writing requests are handed to Codex; questions about code are not.
import test from "node:test";
import assert from "node:assert/strict";
import { isCodeWritingRequest } from "../src/lib/hermes/codex-drive.ts";
import { isMcpAuthoringRequest } from "../src/lib/hermes/mcp-installer-context.ts";

test("a request to install Bread's own MCP takes the authoring path in any Garden", () => {
  for (const prompt of ["Code a custom MCP server called Lab ledger with put and get tools. Install it.",
    "Can you build an MCP for our lab and register it in Bread?"]) {
    assert.equal(isMcpAuthoringRequest(prompt), true);
    assert.equal(isCodeWritingRequest(prompt), false);
  }
  assert.equal(isCodeWritingRequest("Write an MCP server in this repository using the Python SDK."), true);
  assert.equal(isMcpAuthoringRequest("Use the saved Sample Ledger MCP to create a sample."), false);
  assert.equal(isMcpAuthoringRequest("Create a sample using my saved Ledger MCP server."), false);
  assert.equal(isMcpAuthoringRequest("Explain how to build an MCP server."), false);
  assert.equal(isCodeWritingRequest("Create a bot called Lab Clerk for my Bots page."), false);
  assert.equal(isCodeWritingRequest("Build a Discord bot using the Python SDK."), true);
});

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
