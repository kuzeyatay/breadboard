import test from "node:test";
import assert from "node:assert/strict";
import { isPdfAssistantPageContext, isReaderAssistantPageContext, isVideoAssistantPageContext } from "../src/lib/pdf-assistant-scope.ts";

test("Video Studio's assistant keys are accepted like PDF keys, and nothing looser is", () => {
  assert.equal(isVideoAssistantPageContext("dashboard_terminal", "video:0123456789abcdef"), true);
  assert.equal(isReaderAssistantPageContext("dashboard_terminal", "video:0123456789abcdef"), true);
  assert.equal(isReaderAssistantPageContext("dashboard_terminal", "pdf:0123456789abcdef"), true);
  assert.equal(isPdfAssistantPageContext("dashboard_terminal", "video:0123456789abcdef"), false, "a video chat is not labelled a PDF chat");
  for (const bad of ["video:../../etc", "video:0123", "video:0123456789ABCDEF", "garden-note", null]) {
    assert.equal(isReaderAssistantPageContext("dashboard_terminal", bad), false, String(bad));
  }
  assert.equal(isVideoAssistantPageContext("garden_chat", "video:0123456789abcdef"), false);
});
