import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const actions = source("../src/app/components/assistant-message-actions.tsx");
const responseMeta = source(
  "../src/app/components/assistant-response-meta.tsx",
);
const activity = source("../src/app/components/hermes/activity-panel.tsx");
const timing = source("../src/lib/assistant-activity-timing.ts");
const evidence = source("../src/app/components/hermes/evidence-panel.tsx");
const runtime = source(
  "../src/app/components/hermes/agent-runtime-panel.tsx",
);
const agentSession = source(
  "../src/app/components/hermes/use-agent-session.ts",
);
const sessionsRoute = source("../src/app/api/hermes/sessions/route.ts");
const eventStream = source("../src/lib/hermes/event-stream.ts");
const conversationStore = source("../src/lib/conversations/store.ts");
const chatSessionsRoute = source("../src/app/api/chat-sessions/route.ts");
const chatSessionRoute = source(
  "../src/app/api/chat-sessions/[sessionId]/route.ts",
);
const workspace = source(
  "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
);
const gardenAssistant = source("../src/app/garden/garden-assistant.tsx");
const terminal = source(
  "../src/app/components/hermes/dashboard-agent-terminal.tsx",
);
const gardenAgentChat = source(
  "../src/app/components/hermes/garden-agent-chat.tsx",
);
const knowledgeTerminal = source(
  "../src/app/components/knowledge-terminal.tsx",
);
const composer = source("../src/app/components/assistant-composer.tsx");
const chatMarkdown = source("../src/app/components/chat-markdown.tsx");
const commandText = source(
  "../src/app/components/hermes/command-text.tsx",
);
const globalStyles = source("../src/app/globals.css");
const quartzActivity = source(
  "../../quartz/quartz/components/scripts/breadboardAI.inline.ts",
);

test("thinking remains visible with response metadata and shimmers while active", () => {
  assert.match(activity, /<AssistantResponseMeta/);
  assert.match(responseMeta, /thinking-shimmer/);
  assert.match(responseMeta, /text-sm leading-6/);
  assert.match(responseMeta, /formatResponseDuration/);
  assert.match(activity, /assistantResponseElapsedMs/);
  assert.match(
    activity,
    /reportedDurationMs: responseDurationMs \?\? usage\?\.responseDurationMs/,
  );
  assert.match(timing, /Math\.min\(\.\.\.starts\)/);
  assert.match(timing, /Math\.max\(\.\.\.completions\)/);
  assert.match(
    timing,
    /if \(startedAt !== null\)[\s\S]*return Math\.max\(0, end - startedAt\);[\s\S]*return typeof input\.reportedDurationMs/,
    "live wall-clock timestamps must take precedence over provider duration",
  );
  assert.match(responseMeta, /formatTokenCount/);
  assert.match(responseMeta, /↓ counting tokens/);
  assert.match(responseMeta, /↓ tokens unavailable/);
  // The row states one answer's cost. A cumulative session snapshot belongs to
  // the whole conversation, so it must never be printed as this message's count.
  assert.match(responseMeta, /usage\?\.scope === "session"/);
  assert.match(responseMeta, /const responseTokens = sessionSnapshot \? undefined/);
  assert.doesNotMatch(responseMeta, /session total/);
  assert.doesNotMatch(responseMeta, /apiCalls/);
  assert.doesNotMatch(
    activity,
    /return null/,
    "every assistant response must retain its thinking and token metadata row",
  );
  assert.doesNotMatch(activity, /\{reasoning\}/);
  assert.doesNotMatch(activity, /hasReasoningSummary/);
  assert.doesNotMatch(
    activity,
    />\s*Stop\s*</,
    "the response metadata row must not render a second Stop control",
  );
  assert.match(globalStyles, /@keyframes thinking-shimmer/);
  assert.match(
    globalStyles,
    /@keyframes thinking-shimmer[\s\S]*?from \{\s*background-position: 180% 0;[\s\S]*?to \{\s*background-position: -180% 0;/,
  );
  assert.match(
    globalStyles,
    /prefers-reduced-motion:[\s\S]*?\.thinking-shimmer/,
  );
});

test("thinking metadata never renders a second status-description line", () => {
  assert.doesNotMatch(responseMeta, /\{summary \? \(/);
  assert.doesNotMatch(responseMeta, /title=\{summary\}/);
});

test("live turns hold Thinking for five seconds, then settle on Thought", () => {
  // The row stays on the message for good, so once the turn is over it should
  // say what the assistant did rather than what it is doing.
  assert.match(
    responseMeta,
    /const displayLabel = label === "Thinking" && !active && !failed \? "Thought" : label;/,
  );
  assert.match(responseMeta, /\{displayLabel\}<\/span>/);
  // A caller's own label already describes a state ("Interrupted", an
  // artifact's) and must be shown exactly as given.
  assert.match(activity, /const liveActivity = activities\.findLast/);
  assert.match(activity, /assistantLiveActivityReady\(elapsedMs\)/);
  assert.match(activity, /liveActivity\?\.label \?\? "Thinking"/);
  assert.match(activity, /pendingPermission[\s\S]*?"Waiting for permission"/);
  assert.match(
    activity,
    /const effectiveLabel = responseActive[\s\S]*?showLiveActivity[\s\S]*?liveLabel[\s\S]*?: "Thinking"/,
  );
  assert.match(timing, /ASSISTANT_LIVE_ACTIVITY_DELAY_MS = 5_000/);
  assert.match(runtime, /stateLabel=\{\s*responseInterrupted\s*\?\s*"Interrupted"/);
  // The accessible name follows the visible one instead of saying "thinking"
  // under a row that reads Thought.
  assert.match(responseMeta, /\$\{displayLabel\.toLowerCase\(\)\}/);
});

test("completed response duration remains attached to restored assistant messages", () => {
  assert.match(agentSession, /responseDurationMs\?: number/);
  assert.match(agentSession, /commitResponseDuration/);
  assert.match(
    agentSession,
    /responseDurationMs: Math\.max\(0, completedAtMs - responseStartedAtMs\)/,
  );
  assert.doesNotMatch(runtime, /message\.responseDurationMs !== undefined/);
  assert.match(
    runtime,
    /responseDurationMs=\{message\.responseDurationMs\}/,
  );
  assert.match(eventStream, /\.\.\.\(responseDurationMs !== undefined/);
  assert.match(sessionsRoute, /presented\.metadata\.responseDurationMs/);
  assert.match(sessionsRoute, /presented\.updatedAt/);
  assert.match(conversationStore, /updatedAt: row\.updated_at/);
  for (const transcript of [workspace, gardenAssistant]) {
    assert.match(transcript, /responseDurationMs\?: number/);
    assert.match(transcript, /responseDurationMs=\{/);
  }
  assert.match(chatSessionRoute, /mergeRuntimeMetadata/);
  assert.match(chatSessionRoute, /metadata\.responseDurationMs/);
  assert.match(chatSessionsRoute, /parseResponseDuration/);
});

test("dashboard thinking metadata never exposes model reasoning text", () => {
  assert.doesNotMatch(activity, /expanded && hasReasoningSummary/);
  assert.doesNotMatch(activity, /\{reasoning\}/);
  assert.doesNotMatch(activity, /reasoning\?: string/);
  assert.doesNotMatch(activity, /Done thinking\./);
  assert.doesNotMatch(activity, /activityStatusSentence/);
  assert.doesNotMatch(activity, /visibleActivities/);
});

test("Quartz activity states use full sentences without status glyphs", () => {
  assert.match(quartzActivity, /function activityStatusSentence/);
  assert.match(quartzActivity, /Done thinking\./);
  assert.match(quartzActivity, /Finished writing the answer\./);
  assert.match(quartzActivity, /Permission is required\./);
  assert.match(quartzActivity, /Permission was denied\./);
  assert.match(quartzActivity, /\$\{phrase\} failed\./);
  assert.match(quartzActivity, /\$\{phrase\} was cancelled\./);
  assert.doesNotMatch(quartzActivity, /function statusGlyph/);
  assert.doesNotMatch(quartzActivity, /const glyph\s*=/);
  assert.match(quartzActivity, /activityStatusSentence\(entry\)/);
});

test("evidence opens from the overflow menu without a standalone disclosure", () => {
  assert.match(evidence, /role="dialog"/);
  assert.match(evidence, /aria-label="Response evidence"/);
  assert.doesNotMatch(evidence, /<details/);
  assert.doesNotMatch(evidence, /<summary/);
  assert.doesNotMatch(evidence, /View evidence/);
  assert.match(evidence, /neu-popover/);
  assert.match(evidence, /border border-\[var\(--line\)\]/);
  assert.doesNotMatch(evidence, /Garden grounding/);
  assert.doesNotMatch(evidence, /Garden not consulted for this answer\./);
  assert.match(evidence, /Open source page/);

  const menuStart = actions.indexOf('aria-label="More response actions menu"');
  const menuEnd = actions.indexOf("{evidenceOpen", menuStart);
  const overflowMenu = actions.slice(menuStart, menuEnd);
  assert.match(overflowMenu, /View evidence/);
  assert.doesNotMatch(
    overflowMenu,
    /\{verification\s*\?\s*\(/,
    "View evidence must be present even when no verification ledger was recorded",
  );
  assert.match(overflowMenu, /Download Markdown/);
  assert.doesNotMatch(overflowMenu, /Copy response/);
  assert.doesNotMatch(overflowMenu, /Regenerate response/);
});

test("assistant action buttons perform copy, feedback, download, retry, and menu actions", () => {
  assert.match(actions, /navigator\.clipboard\.writeText/);
  assert.match(actions, /localStorage\.setItem/);
  assert.match(actions, /aria-pressed=/);
  assert.match(actions, /new Blob/);
  assert.match(actions, /anchor\.download/);
  assert.match(actions, /onRetry\?\.\(\)/);
  assert.match(actions, /More response actions/);
});

test("quoted prompt fields can be copied independently without blocking text selection", () => {
  assert.match(chatMarkdown, /blockquote: CopyableBlockquote/);
  assert.match(chatMarkdown, /contentRef\.current\?\.innerText\.trim\(\)/);
  assert.match(chatMarkdown, /await writeToClipboard\(value\)/);
  assert.match(chatMarkdown, /aria-label=\{copied \? 'Text copied' : 'Copy this text'\}/);
  assert.match(chatMarkdown, /data-selection-exclude/);
  assert.match(globalStyles, /\.chat-markdown \.chat-field-copy/);
  assert.match(globalStyles, /user-select: none/);
});

test("activity and actions render with assistant messages, not above composers", () => {
  for (const transcript of [
    workspace,
    gardenAssistant,
    runtime,
    knowledgeTerminal,
  ]) {
    assert.match(transcript, /<AssistantMessageActions/);
    assert.match(transcript, /<(?:ActivityPanel|AssistantResponseMeta)/);
    assert.doesNotMatch(transcript, /<EvidencePanel/);
  }

  const workspaceInput = workspace.slice(
    workspace.indexOf("{/* Input area */}"),
  );
  const workspaceComposer = workspaceInput.slice(
    0,
    workspaceInput.indexOf("<AssistantComposer"),
  );
  assert.doesNotMatch(workspaceComposer, /<ActivityPanel/);

  const runtimeComposerArea = runtime.slice(
    runtime.indexOf('className="shrink-0 px-4 pb-3"'),
  );
  assert.doesNotMatch(
    runtimeComposerArea.slice(
      0,
      runtimeComposerArea.indexOf("<AssistantComposer"),
    ),
    /<ActivityPanel/,
  );
  assert.doesNotMatch(workspace, /bg-gray-400 ml-0\.5 animate-pulse/);
  assert.doesNotMatch(activity, /reasoningDisclosure/);
  assert.doesNotMatch(activity, /\{reasoning\}/);
  assert.doesNotMatch(activity, /View activity/);
  assert.doesNotMatch(activity, /Hide activity/);
  assert.doesNotMatch(composer, /LiveTokenUsageStatus/);
  assert.doesNotMatch(composer, /tokenUsagePending/);
  assert.match(workspace, /usage=\{msg\.usage\}/);
  assert.doesNotMatch(workspace, /reasoning=\{msg\.thinking\}/);
  assert.match(gardenAssistant, /usage=\{message\.usage\}/);
  assert.doesNotMatch(gardenAssistant, /reasoning=\{message\.thinking\}/);
  assert.match(runtime, /usage=\{message\.usage\}/);
  assert.doesNotMatch(runtime, /reasoning=\{message\.reasoning\}/);
  assert.match(knowledgeTerminal, /usage=\{message\.usage\}/);
  assert.doesNotMatch(knowledgeTerminal, /Thinking \(\{formatResponseDuration/);
  assert.equal(workspace.match(/<ActivityPanel/g)?.length, 1);
  assert.equal(runtime.match(/<ActivityPanel/g)?.length, 1);
  assert.equal(gardenAssistant.match(/<ActivityPanel/g)?.length, 1);
  assert.equal(knowledgeTerminal.match(/<AssistantResponseMeta/g)?.length, 1);
});

test("ordinary assistant rows mount metadata without requiring provider metrics", () => {
  for (const transcript of [workspace, gardenAssistant, runtime]) {
    assert.doesNotMatch(
      transcript,
      /responseDurationMs !== undefined \|\|[\s\S]{0,160}usage[\s\S]{0,240}<ActivityPanel/,
    );
  }
  assert.doesNotMatch(
    knowledgeTerminal,
    /responseDurationMs !== undefined \? \([\s\S]{0,180}Thinking/,
  );
  assert.match(responseMeta, /active\s*\?\s*"↓ counting tokens\.\.\."/);
  assert.match(responseMeta, /:\s*"↓ tokens unavailable"/);
});

test("permission requests use a softly layered action card", () => {
  const start = activity.indexOf("Permission required");
  const block = activity.slice(Math.max(0, start - 2_000), start + 4_000);
  assert.ok(start >= 0);
  assert.match(block, /neu-surface-subtle/);
  assert.match(block, /bg-\[var\(--paper-strong\)\]/);
  assert.match(block, /Permission required/);
  assert.doesNotMatch(block, /pendingPermission\.risk/);
  assert.doesNotMatch(block, /M12 3\.75 5\.25 6\.5/);
  assert.match(block, /rounded-full bg-\[var\(--botanical\)\]/);
  assert.match(block, /Allow similar for session/);
  assert.match(block, /bg-red-500\/\[0\.07\]/);
  assert.match(block, /border border-\[var\(--line\)\]/);
});

test("Hermes tool names stay out of assistant responses", () => {
  assert.doesNotMatch(runtime, /function ToolChip/);
  assert.doesNotMatch(runtime, /message\.tools/);
  assert.doesNotMatch(runtime, /tool\.toolName/);
  assert.match(runtime, /<ActivityPanel/);
});

test("restored Hermes usage is normalized before rendering", () => {
  assert.match(agentSession, /normalizeRestoredMessages/);
  assert.match(agentSession, /normalizeChatTokenUsage\(message\.usage\)/);
  assert.match(
    agentSession,
    /setMessages\(normalizeRestoredMessages\(restored\.messages\)\)/,
  );
});

test("regeneration resubmits the preceding user turn", () => {
  assert.match(workspace, /handleRetryAssistant/);
  assert.match(
    workspace,
    /handleSubmit\([\s\S]*previousUser\.content,[\s\S]*messages\.slice\(0, userIndex\),[\s\S]*retryAttachments/,
  );
  assert.match(gardenAssistant, /retryAssistantMessage/);
  assert.match(
    gardenAssistant,
    /sendMessage\([\s\S]*previousUser\.content,[\s\S]*messages\.slice\(0, userIndex\),[\s\S]*reusableChatAttachments\(previousUser\.attachments\)/,
  );
  assert.match(runtime, /onRetryMessage/);
});

test("regenerating or editing a runtime turn carries its attachments along", () => {
  // A retry that drops the image re-asks the question without the thing it was
  // about, and the model answers that nothing was attached.
  for (const surface of [terminal, gardenAgentChat]) {
    assert.match(
      surface,
      /session\.send\(\s*previousUser\.content,[\s\S]*?attachments: reusableChatAttachments\(previousUser\.attachments\)/,
    );
    assert.match(
      surface,
      /session\.send\(\s*text,[\s\S]*?attachments: reusableChatAttachments\(\s*session\.messages\[messageIndex\]\?\.attachments,\s*\)/,
    );
  }
});

test("user messages accent only the leading slash command", () => {
  assert.match(
    commandText,
    /<span className=\{COMMAND_TEXT_CLASS\}>\{split\.command\}<\/span>/,
  );
  // The rest of the message stays untinted (it only gains link rendering).
  assert.match(
    commandText,
    /<span>\s*<LinkifiedText content=\{split\.rest\} \/>\s*<\/span>/,
  );
  assert.doesNotMatch(
    commandText,
    /<p className=\{`whitespace-pre-wrap \$\{COMMAND_TEXT_CLASS\}`\}>/,
  );
});

test("stalled agent turns render a recoverable in-chat error", () => {
  assert.match(runtime, /stateLabel=\{\s*responseInterrupted\s*\?\s*"Interrupted"/);
  assert.match(runtime, /role="alert"/);
  const stateRow = runtime.search(
    /stateLabel=\{\s*responseInterrupted\s*\?\s*"Interrupted"/,
  );
  const stateBlock = runtime.slice(stateRow, stateRow + 900);
  assert.doesNotMatch(stateBlock, /stateAction=/);
  assert.doesNotMatch(stateBlock, />\s*Try again\s*</);
  assert.doesNotMatch(runtime, />\s*Response interrupted\s*</);
  assert.doesNotMatch(activity, /Response stopped/);
  assert.match(agentSession, /agentStreamTimeout/);
  assert.match(agentSession, /isAgentStreamTimeoutError/);
  assert.match(agentSession, /\/abort/);
  assert.ok(
    agentSession.indexOf('name === "AbortError"') <
      agentSession.indexOf("commitResponseDuration();", agentSession.indexOf("catch (streamError)")),
    "intentional stream aborts must not overwrite completed or clarified responses",
  );
});

test("interrupted assistant turns retain their message actions and retry control", () => {
  assert.match(runtime, /<ActivityPanel/);
  assert.match(
    runtime,
    /message\.content \|\|[\s\S]{0,240}message\.interrupted/,
  );
  assert.match(runtime, /stateLabel=\{\s*responseInterrupted\s*\?\s*"Interrupted"/);
  assert.doesNotMatch(runtime, /canRetryResponseState/);
  assert.match(
    runtime,
    /onRetry=\{[\s\S]*?\(!responseInterrupted \|\| !disabled\)[\s\S]*?message\.interrupted \|\|\s*index === lastAssistantIndex/,
  );
  assert.match(runtime, /!activeRun/);
  assert.match(runtime, /\(\) => retryAssistantAsBranch\(index\)/);
  assert.match(actions, /aria-label="Regenerate response"/);
});

test("response branch navigation remains visible on external-agent cards", () => {
  assert.match(actions, /export function AssistantResponseBranchNavigation/);
  assert.match(actions, /Previous response branch/);
  assert.match(actions, /Next response branch/);
  assert.match(
    runtime,
    /isExternalAgentRunMessage\(message\)[\s\S]*?<AssistantResponseBranchNavigation/,
  );
  assert.match(
    runtime,
    /branch=\{branchNavigationForAssistant\(message, index\)\}/,
  );
});
