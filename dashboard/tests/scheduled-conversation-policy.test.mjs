import assert from "node:assert/strict";
import test from "node:test";

import {
  inferScheduledChatConversationPolicy,
  readScheduledObjectiveDecision,
  scheduledObjectiveEvaluationPrompt,
  SCHEDULE_OBJECTIVE_MET_MARKER,
  SCHEDULE_OBJECTIVE_PENDING_MARKER,
} from "../src/lib/schedules/conversation-policy.ts";

test("conditional notifications wait for their actual objective", () => {
  assert.equal(
    inferScheduledChatConversationPolicy(
      "notify me when 2027 Turkish GP tickets become available",
    ),
    "open_when_objective_met",
  );
  assert.equal(
    inferScheduledChatConversationPolicy("Alert me as soon as registration opens"),
    "open_when_objective_met",
  );
  assert.equal(
    inferScheduledChatConversationPolicy("Keep an eye on this page until tickets go on sale"),
    "open_when_objective_met",
  );
  assert.equal(
    inferScheduledChatConversationPolicy("When registration opens, notify me"),
    "open_when_objective_met",
  );
  assert.equal(
    inferScheduledChatConversationPolicy("Check every day until registration opens"),
    "open_when_objective_met",
  );
});

test("ordinary scheduled work still opens a chat for each useful report", () => {
  assert.equal(
    inferScheduledChatConversationPolicy("look at my mail"),
    "always_open",
  );
  assert.equal(
    inferScheduledChatConversationPolicy("summarize what changed in my gardens"),
    "always_open",
  );
});

test("the private decision is required and stripped before publication", () => {
  const prompt = scheduledObjectiveEvaluationPrompt("Check ticket availability");
  assert.match(prompt, /concrete evidence/);
  assert.match(prompt, new RegExp(SCHEDULE_OBJECTIVE_MET_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(prompt, new RegExp(SCHEDULE_OBJECTIVE_PENDING_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  assert.deepEqual(
    readScheduledObjectiveDecision(
      `Tickets are on sale now.\n\n${SCHEDULE_OBJECTIVE_MET_MARKER}`,
    ),
    { decision: "met", visibleContent: "Tickets are on sale now." },
  );
  assert.deepEqual(
    readScheduledObjectiveDecision(`Not yet.\n${SCHEDULE_OBJECTIVE_PENDING_MARKER}`),
    { decision: "pending", visibleContent: "Not yet." },
  );
  assert.deepEqual(readScheduledObjectiveDecision("No marker"), {
    decision: null,
    visibleContent: "No marker",
  });
});
