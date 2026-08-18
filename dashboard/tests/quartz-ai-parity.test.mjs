// The Quartz page AI panel must expose the same Hermes capability set as
// the dashboard terminal: server-resolved model + reasoning effort, session
// history with transcript restore, new chat, markdown answers, usage, retry.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");

const chatRoute = read("../src/app/api/quartz-ai/chat/route.ts");
const modelsRoute = read("../src/app/api/quartz-ai/models/route.ts");
const sessionsRoute = read("../src/app/api/quartz-ai/sessions/route.ts");
const hermesSessionsRoute = read("../src/app/api/hermes/sessions/route.ts");
const runtimeStore = read("../src/lib/hermes/runtime-store.ts");
const conversationStore = read("../src/lib/conversations/store.ts");
const component = read("../../quartz/quartz/components/BreadboardAI.tsx");
const inline = read("../../quartz/quartz/components/scripts/breadboardAI.inline.ts");
const styles = read("../../quartz/quartz/components/styles/breadboardAI.scss");

test("quartz chat route resolves the engine server-side like the terminal", () => {
  assert.match(chatRoute, /resolveHermesEngine\(body\.model, body\.reasoningEffort\)/);
  // Both the first-turn and continuation dispatches carry the resolved engine.
  const modelSends = chatRoute.match(
    /model: engine\.model,\s*\n\s*modelIdentity: \{ modelID: engine\.selectedModelID \},\s*\n\s*variant: engine\.variant,/g,
  ) ?? [];
  assert.equal(modelSends.length, 2, "both sendMessage branches must pass the engine");
  const auditFields = chatRoute.match(/modelId: engine\.model\.modelID/g) ?? [];
  assert.equal(auditFields.length, 2, "both audit events must record the model");
});

test("quartz models route serves the intelligence picker with CORS", () => {
  assert.match(modelsRoute, /HERMES_MODEL_IDS/);
  assert.match(modelsRoute, /DEFAULT_ASSISTANT_REASONING_EFFORT/);
  assert.match(modelsRoute, /corsHeaders\(request\.headers\.get\("origin"\)\)/);
  assert.match(modelsRoute, /export async function OPTIONS/);
  assert.match(modelsRoute, /requireEnabled\(\)/);
  // 'none' is legacy-only and must not be offered.
  assert.doesNotMatch(modelsRoute, /"none"/);
});

test("quartz sessions route lists page history safely", () => {
  assert.match(sessionsRoute, /authorizeQuartzAccess\(gardenId, userId\)/);
  assert.match(sessionsRoute, /listConversationsForUser\(userId\)/);
  assert.match(sessionsRoute, /listConversationMessages\(conversation\.id\)/);
  // Anonymous readers only ever get the session bound to their client token.
  assert.match(sessionsRoute, /authorizeQuartzRuntimeSession\(sessionId, \{\s*\n\s*userId: null,\s*\n\s*clientToken,/);
  assert.match(sessionsRoute, /export async function OPTIONS/);
  assert.match(sessionsRoute, /presentRuntimeMessage/);
});

test("session transcript presentation is shared, not duplicated", () => {
  assert.match(runtimeStore, /export function presentRuntimeMessage/);
  assert.match(runtimeStore, /export function runtimeSessionTitle/);
  assert.match(conversationStore, /export function presentConversationMessage/);
  assert.match(hermesSessionsRoute, /presentConversationMessage/);
  assert.match(sessionsRoute, /presentConversationMessage/);
  assert.doesNotMatch(hermesSessionsRoute, /function parseMessages/);
});

test("anonymous Quartz follow-ups carry prior user requests into planning", () => {
  assert.match(chatRoute, /listRuntimeMessages\(session\.row\.id\)/);
  assert.match(
    chatRoute,
    /filter\(\(message\) => message\.role === "user"\)[\s\S]*slice\(-8\)[\s\S]*map\(\(message\) => message\.content\)/,
  );
  assert.match(chatRoute, /prepareTurn\(\{\s*request: text,\s*priorRequests,/);
});

test("quartz panel markup gains terminal-style controls", () => {
  assert.match(component, /breadboard-ai-new/);
  assert.match(component, /breadboard-ai-history-toggle/);
  assert.match(component, /breadboard-ai-history-list/);
  assert.match(component, /breadboard-ai-intelligence/);
  assert.match(component, /breadboard-ai-model/);
  assert.match(component, /breadboard-ai-effort/);
});

test("quartz inline script wires the terminal capability set", () => {
  // Intelligence picker fed by the dashboard, persisted per page session.
  assert.match(inline, /api\/quartz-ai\/models/);
  assert.match(inline, /model: state\.model \|\| undefined/);
  assert.match(inline, /reasoningEffort: state\.effort \|\| undefined/);
  // History + transcript restore + new chat.
  assert.match(inline, /api\/quartz-ai\/sessions/);
  assert.match(inline, /function restoreTranscript/);
  assert.match(inline, /function startNewChat/);
  assert.match(inline, /function openHistory/);
  // Markdown answers are escaped before any tags are introduced.
  assert.match(inline, /function markdownToHtml/);
  assert.match(inline, /escapeHtml\(text\)/);
  assert.match(inline, /renderAssistantContent\(assistantEl, text\)/);
  // Usage + retry parity.
  assert.match(inline, /assistant\.completed/);
  assert.match(inline, /dataset\.usage/);
  assert.match(inline, /breadboard-ai-retry/);
});

test("quartz styles cover the new controls", () => {
  assert.match(styles, /\.breadboard-ai-history/);
  assert.match(styles, /\.breadboard-ai-intelligence/);
  assert.match(styles, /\.breadboard-ai-markdown/);
  assert.match(styles, /\.breadboard-ai-retry/);
});

test("quartz carries the same rail of sent messages as the dashboard", () => {
  // The rail is a sibling of the scroller, not a child: it floats against the
  // right edge of the transcript rather than scrolling away with it.
  assert.match(component, /class="breadboard-ai-transcript"/);
  const transcript = component.slice(component.indexOf("breadboard-ai-transcript"));
  const railAt = transcript.indexOf("breadboard-ai-rail");
  const messagesAt = transcript.indexOf("breadboard-ai-messages");
  assert.ok(messagesAt > 0 && railAt > messagesAt, "the rail sits beside the scroller");
  assert.match(component, /aria-label="Messages you sent"/);

  // One tick per sent message, and the same wording the dashboard rail uses.
  assert.match(inline, /querySelectorAll<HTMLElement>\("\.breadboard-ai-user"\)/);
  assert.match(inline, /`Go to message \$\{index \+ 1\} of \$\{sent\.length\}: \$\{summary\}`/);
  // A lone question under a long answer still gets its tick; only an empty
  // transcript draws nothing. Kept in step with the dashboard rail's minimum.
  assert.match(inline, /rail\.hidden = sent\.length < 1/);
  // Clicking a tick takes the reader to that message.
  assert.match(inline, /messages!\.scrollTo\(\{\s*\n\s*top: Math\.max\(start - 8, 0\),/);
  assert.match(inline, /prefers-reduced-motion: reduce/);

  // The rail has to be rebuilt everywhere the transcript changes shape, or it
  // describes a conversation that is no longer on screen.
  for (const site of [
    /if \(role === "user"\) refreshRail\(\)/, // a message just sent
    /railSuspended = false\s*\n\s*\}\s*\n\s*messages!\.scrollTop[\s\S]{0,40}refreshRail\(\)/, // a session restored
    /messages!\.replaceChildren\(\)\s*\n\s*refreshRail\(\)/, // a new chat started
  ]) {
    assert.match(inline, site);
  }

  assert.match(styles, /\.breadboard-ai-rail-tick/);
  assert.match(styles, /aria-current="true"/);
});
