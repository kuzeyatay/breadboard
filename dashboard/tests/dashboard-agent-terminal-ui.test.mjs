import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const terminal = fs.readFileSync(
  new URL("../src/app/components/openharness/dashboard-agent-terminal.tsx", import.meta.url),
  "utf8",
);
const runtime = fs.readFileSync(
  new URL("../src/app/components/openharness/agent-runtime-panel.tsx", import.meta.url),
  "utf8",
);
const agentSession = fs.readFileSync(
  new URL("../src/app/components/openharness/use-agent-session.ts", import.meta.url),
  "utf8",
);

test("OpenHarness terminal uses the original Breadboard terminal shell", () => {
  assert.match(terminal, /breadboard:knowledge-terminal-height/);
  assert.match(terminal, /background: isOpen \? "var\(--paper-surface\)" : "#EFE8D6"/);
  assert.match(terminal, /aria-label="Toggle history"/);
  assert.match(terminal, />\s*Recents\s*</);
  assert.match(terminal, />\s*New chat\s*</);
  assert.match(terminal, /terminal-boot-reveal/);
  assert.doesNotMatch(terminal, /#0b0f14/);
});

test("the header conceals on close the way it reveals on open", () => {
  // Items stay mounted through the exit animation instead of vanishing.
  assert.match(terminal, /headerMounted \? "py-2\.5"/);
  assert.match(terminal, /\{headerMounted \? \(/);
  assert.match(
    terminal,
    /headerClosing\s*\n?\s*\? "terminal-boot-conceal"\s*\n?\s*: "terminal-boot-reveal"/,
  );
  // The unmount waits for the last staggered item (380ms delay + 320ms run).
  assert.match(terminal, /setTimeout\(\(\) => \{[\s\S]*?\}, 760\)/);
});

test("the restored shell retains OpenHarness runtime capabilities", () => {
  assert.match(terminal, /useAgentSession\("dashboard_terminal"/);
  assert.match(terminal, /<AgentRuntimePanel/);
  assert.match(terminal, /pendingPermission=\{session\.pendingPermission\}/);
  assert.match(terminal, /onPermissionDecision=/);
  assert.match(terminal, /onAbort=/);
  assert.match(terminal, /model=\{model\}/);
  assert.match(terminal, /reasoningEffort=\{reasoningEffort\}/);
  assert.doesNotMatch(terminal, /<SkillReviewPanel/);
  assert.doesNotMatch(terminal, /Review skills/);
  assert.match(terminal, /api\/openharness\/sessions\?surface=dashboard_terminal/);
});

test("the terminal header uses only a restrained runtime health dot", () => {
  assert.match(
    terminal,
    /runtimeOnline = !runtimeUnavailable && session\.connection !== "error"/,
  );
  assert.match(terminal, /aria-label=\{runtimeOnline \? "OpenHarness is available"/);
  assert.match(terminal, /runtimeOnline \? "bg-\[#4F805E\]" : "bg-\[#B65B5B\]"/);
  assert.doesNotMatch(terminal, /session\.connection === "idle" \? "ready"/);
});

test("the OpenHarness composer adds documents immediately after the slash control", () => {
  assert.match(terminal, /accept=\{CHAT_ATTACHMENT_ACCEPT\}/);
  assert.match(terminal, /extractChatAttachments\(files\)/);
  assert.match(terminal, /onAddDocuments=\{\(\) => attachmentInputRef\.current\?\.click\(\)\}/);
  assert.match(terminal, /attachments=\{chatAttachments\}/);
  assert.match(runtime, /canSubmit=\{Boolean\(input\.trim\(\) \|\| \(!streaming && attachments\?\.length\)\)\}/);
  assert.match(runtime, /onAddDocuments=\{onAddDocuments\}/);
  assert.match(agentSession, /attachments: options\?\.attachments/);
});
