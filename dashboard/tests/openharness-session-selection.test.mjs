import assert from "node:assert/strict";
import test from "node:test";

import { selectRestorableAgentSession } from "../src/lib/openharness/session-selection.ts";

test("garden chat restores only a conversation from the active garden", () => {
  const sessions = [
    { id: "conv_other", gardenId: "other-garden", pageSlug: null },
    { id: "conv_active", gardenId: "active-garden", pageSlug: null },
  ];

  assert.deepEqual(
    selectRestorableAgentSession(sessions, "conv_other", {
      gardenSlug: "active-garden",
    }),
    sessions[1],
  );
});

test("garden chat starts fresh when no conversation matches its garden", () => {
  const sessions = [
    { id: "conv_other", gardenId: "other-garden", pageSlug: null },
  ];

  assert.equal(
    selectRestorableAgentSession(sessions, "conv_other", {
      gardenSlug: "active-garden",
    }),
    null,
  );
});

test("Quartz restoration also respects the active page", () => {
  const sessions = [
    { id: "conv_page_a", gardenId: "garden", pageSlug: "page-a" },
    { id: "conv_page_b", gardenId: "garden", pageSlug: "page-b" },
  ];

  assert.deepEqual(
    selectRestorableAgentSession(sessions, "conv_page_a", {
      gardenSlug: "garden",
      pageSlug: "page-b",
    }),
    sessions[1],
  );
});
