import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const actions = source("../src/app/components/assistant-message-actions.tsx");
const activity = source("../src/app/components/openharness/activity-panel.tsx");
const timing = source("../src/lib/assistant-activity-timing.ts");
const evidence = source("../src/app/components/openharness/evidence-panel.tsx");
const runtime = source(
  "../src/app/components/openharness/agent-runtime-panel.tsx",
);
const agentSession = source(
  "../src/app/components/openharness/use-agent-session.ts",
);
const workspace = source(
  "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
);
const gardenAssistant = source("../src/app/garden/garden-assistant.tsx");
const composer = source("../src/app/components/assistant-composer.tsx");
const globalStyles = source("../src/app/globals.css");
const quartzActivity = source(
  "../../quartz/quartz/components/scripts/breadboardAI.inline.ts",
);

test("thinking remains visible with response metadata and shimmers while active", () => {
  const thinkingStart = activity.indexOf("{expanded && hasReasoningSummary");
  const thinkingEnd = activity.indexOf("{pendingPermission ?", thinkingStart);
  const thinkingBlock = activity.slice(thinkingStart, thinkingEnd);
  assert.match(activity, /thinking-shimmer/);
  assert.match(activity, /text-left text-sm leading-6/);
  assert.match(activity, /statusMetadata/);
  assert.match(activity, /formatResponseDuration/);
  assert.match(activity, /assistantResponseElapsedMs/);
  assert.match(timing, /Math\.min\(\.\.\.starts\)/);
  assert.match(timing, /Math\.max\(\.\.\.completions\)/);
  assert.match(
    timing,
    /if \(startedAt !== null\)[\s\S]*return Math\.max\(0, end - startedAt\);[\s\S]*return typeof input\.reportedDurationMs/,
    "live wall-clock timestamps must take precedence over provider duration",
  );
  assert.match(activity, /formatTokenCount/);
  assert.match(activity, /↓ counting tokens/);
  assert.match(activity, /!activities\.length && !usage && !reasoning/);
  assert.match(activity, /\{reasoning\}/);
  assert.match(activity, /hasReasoningSummary/);
  assert.doesNotMatch(activity, /if \(!expanded && !active/);
  assert.doesNotMatch(activity, /setTimeout\(\(\) => setExpanded\(false\)/);
  assert.ok(thinkingStart >= 0 && thinkingEnd > thinkingStart);
  assert.doesNotMatch(thinkingBlock, /rounded-2xl border/);
  assert.match(globalStyles, /@keyframes thinking-shimmer/);
  assert.match(globalStyles, /background-position: -180% 0/);
  assert.match(globalStyles, /background-position: 180% 0/);
  assert.match(
    globalStyles,
    /prefers-reduced-motion:[\s\S]*?\.thinking-shimmer/,
  );
});

test("expanded dashboard thinking shows only ChatMock reasoning text", () => {
  assert.match(activity, /expanded && hasReasoningSummary/);
  assert.match(activity, /\{reasoning\}/);
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

  const menuStart = actions.indexOf('aria-label="More response actions menu"');
  const menuEnd = actions.indexOf("{evidenceOpen", menuStart);
  const overflowMenu = actions.slice(menuStart, menuEnd);
  assert.match(overflowMenu, /View evidence/);
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

test("activity and actions render with assistant messages, not above composers", () => {
  for (const transcript of [workspace, gardenAssistant, runtime]) {
    assert.match(transcript, /<AssistantMessageActions/);
    assert.match(transcript, /<ActivityPanel/);
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
  assert.match(
    activity,
    /onClick=\{\(\) => setExpanded\(\(current\) => !current\)\}/,
  );
  assert.doesNotMatch(activity, /View activity/);
  assert.doesNotMatch(activity, /Hide activity/);
  assert.doesNotMatch(composer, /LiveTokenUsageStatus/);
  assert.doesNotMatch(composer, /tokenUsagePending/);
  assert.match(workspace, /usage=\{msg\.usage\}/);
  assert.match(workspace, /reasoning=\{msg\.thinking\}/);
  assert.match(workspace, /msg\.usage \|\|/);
  assert.match(gardenAssistant, /usage=\{message\.usage\}/);
  assert.match(gardenAssistant, /reasoning=\{message\.thinking\}/);
  assert.match(gardenAssistant, /message\.usage \|\|/);
  assert.match(runtime, /usage=\{message\.usage\}/);
  assert.match(runtime, /reasoning=\{message\.reasoning\}/);
  assert.equal(workspace.match(/<ActivityPanel/g)?.length, 1);
  assert.equal(runtime.match(/<ActivityPanel/g)?.length, 1);
  assert.equal(gardenAssistant.match(/<ActivityPanel/g)?.length, 1);
});

test("permission requests use a softly layered action card", () => {
  const start = activity.indexOf("{pendingPermission ? (");
  const block = activity.slice(start, start + 6_000);
  assert.ok(start >= 0);
  assert.match(block, /neu-surface-subtle/);
  assert.match(block, /bg-\[var\(--paper-strong\)\]/);
  assert.match(block, /Permission required/);
  assert.match(block, /rounded-full bg-amber-500\/10/);
  assert.match(block, /rounded-full bg-\[var\(--botanical\)\]/);
  assert.match(block, /Allow similar for session/);
  assert.match(block, /bg-red-500\/\[0\.07\]/);
  assert.match(block, /border border-\[var\(--line\)\]/);
});

test("OpenHarness tool names stay out of assistant responses", () => {
  assert.doesNotMatch(runtime, /function ToolChip/);
  assert.doesNotMatch(runtime, /message\.tools/);
  assert.doesNotMatch(runtime, /tool\.toolName/);
  assert.match(runtime, /<ActivityPanel/);
});

test("restored OpenHarness usage is normalized before rendering", () => {
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
    /handleSubmit\(previousUser\.content, messages\.slice\(0, userIndex\)\)/,
  );
  assert.match(gardenAssistant, /retryAssistantMessage/);
  assert.match(
    gardenAssistant,
    /sendMessage\(previousUser\.content, messages\.slice\(0, userIndex\)\)/,
  );
  assert.match(runtime, /onRetryMessage/);
});
