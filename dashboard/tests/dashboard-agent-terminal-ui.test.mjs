import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const terminal = fs.readFileSync(
  new URL("../src/app/components/openharness/dashboard-agent-terminal.tsx", import.meta.url),
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
  assert.match(terminal, /<SkillReviewPanel/);
  assert.match(terminal, /Review skills/);
  assert.match(terminal, /api\/openharness\/sessions\?surface=dashboard_terminal/);
});
