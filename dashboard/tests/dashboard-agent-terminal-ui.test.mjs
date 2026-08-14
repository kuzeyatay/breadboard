import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const terminal = fs.readFileSync(
  new URL("../src/app/components/hermes/dashboard-agent-terminal.tsx", import.meta.url),
  "utf8",
);
const legacyTerminal = fs.readFileSync(
  new URL("../src/app/components/knowledge-terminal.tsx", import.meta.url),
  "utf8",
);
const runtime = fs.readFileSync(
  new URL("../src/app/components/hermes/agent-runtime-panel.tsx", import.meta.url),
  "utf8",
);
const agentSession = fs.readFileSync(
  new URL("../src/app/components/hermes/use-agent-session.ts", import.meta.url),
  "utf8",
);
const gardenChat = fs.readFileSync(
  new URL("../src/app/components/hermes/garden-agent-chat.tsx", import.meta.url),
  "utf8",
);
const historyControls = fs.readFileSync(
  new URL("../src/app/components/hermes/history-client.tsx", import.meta.url),
  "utf8",
);
const breadboardLoader = fs.readFileSync(
  new URL("../src/app/components/breadboard-loader.tsx", import.meta.url),
  "utf8",
);
const terminalSidebar = fs.readFileSync(
  new URL("../src/app/components/hermes/terminal-sidebar.tsx", import.meta.url),
  "utf8",
);

test("Hermes terminal uses the original Breadboard terminal shell", () => {
  assert.match(terminal, /breadboard:knowledge-terminal-height/);
  assert.match(
    terminal,
    /: isOpen\s*\? "var\(--paper-surface\)"\s*: "var\(--terminal-bar\)"/,
  );
  assert.match(
    terminal,
    /style=\{\{ background: glassActive \? "transparent" : "var\(--terminal-bar\)" \}\}/,
  );
  assert.match(terminal, /aria-label="Toggle the sidebar"/);
  // New chat and Recents live in the rail the header toggles.
  assert.match(terminalSidebar, /label="New chat"/);
  assert.match(terminalSidebar, /label="Recents"/);
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

test("the brown terminal header toggles fully open and fully closed", () => {
  assert.match(
    terminal,
    /function defaultOpenHeight\(\): number \{\s*return maxHeight\(\);\s*\}/,
  );
  assert.match(
    terminal,
    /const clickedHeader = event\.currentTarget\.tagName === "HEADER"/,
  );
  assert.match(
    terminal,
    /if \(!moved && event\.type !== "pointercancel" && clickedHeader\)/,
  );
  assert.match(
    terminal,
    /wasOpen[\s\S]*?\? COLLAPSED_HEIGHT[\s\S]*?preferredOpenHeightRef\.current \?\? defaultOpenHeight\(\)/,
  );
  assert.match(terminal, /aria-label=\{isOpen \? undefined : "Open terminal"\}/);
  assert.match(terminal, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.match(
    terminal,
    /setHeight\(preferredOpenHeightRef\.current \?\? defaultOpenHeight\(\)\)/,
  );
});

test("the terminal always starts collapsed and uses saved height only after opening", () => {
  for (const source of [terminal, legacyTerminal]) {
    assert.match(source, /useState\(COLLAPSED_HEIGHT\)/);
    assert.match(source, /preferredOpenHeightRef\.current = clampHeight\(saved(?:Height)?\)/);
    assert.doesNotMatch(source, /setHeight\(clampHeight\(saved(?:Height)?\)\)/);
    assert.match(source, /if \(height <= COLLAPSED_HEIGHT \+ 8\) return/);
  }
});

test("the restored shell retains Hermes runtime capabilities", () => {
  assert.match(terminal, /useAgentSession\("dashboard_terminal"/);
  assert.match(terminal, /<AgentRuntimePanel/);
  assert.match(terminal, /pendingPermission=\{session\.pendingPermission\}/);
  assert.match(terminal, /onPermissionDecision=/);
  assert.match(terminal, /onAbort=/);
  assert.match(terminal, /model=\{model\}/);
  assert.match(terminal, /reasoningEffort=\{reasoningEffort\}/);
  assert.doesNotMatch(terminal, /<SkillReviewPanel/);
  assert.doesNotMatch(terminal, /Review skills/);
  assert.match(terminal, /loadHermesSessionSummaries\("dashboard_terminal"/);
});

test("the terminal header uses a runtime-neutral health dot without an engine badge", () => {
  assert.match(terminal, /runtimeOnline = !runtimeUnavailable/);
  assert.doesNotMatch(
    terminal,
    /runtimeOnline = !runtimeUnavailable && session\.connection !== "error"/,
  );
  assert.match(terminal, /aria-label=\{`Agent runtime is/);
  assert.doesNotMatch(terminal, /function runtimeLabel/);
  assert.match(terminal, /runtimeOnline \? "bg-\[#4F805E\]" : "bg-\[#B65B5B\]"/);
  assert.doesNotMatch(terminal, /session\.connection === "idle" \? "ready"/);
});

test("the red terminal status offers a transcript-preserving reconnect action", () => {
  assert.match(terminal, /\{!runtimeOnline \? \(/);
  assert.match(terminal, /"Reconnect terminal"/);
  assert.match(terminal, /onRefreshRuntime\(\)/);
  assert.match(
    terminal,
    /await session\.openSession\(session\.sessionId, session\.messages\)/,
  );
  assert.match(
    terminal,
    /refreshingTerminal \? "animate-spin" : ""/,
  );
  assert.match(
    terminal,
    /setHealthRefreshVersion\(\(current\) => current \+ 1\)/,
  );
});

test("runtime startup never disables drafting and retries a transient failed health check", () => {
  assert.match(
    terminal,
    /health\.status === "runtime" \|\| health\.status === "checking"/,
  );
  assert.match(
    terminal,
    /window\.setTimeout\(\(\) => void checkHealth\(\), HEALTH_RETRY_DELAY_MS\)/,
  );
  assert.match(terminal, /if \(retryTimer !== null\) window\.clearTimeout\(retryTimer\)/);
});

test("the Hermes composer adds documents immediately after the slash control", () => {
  // The Terminal's own accept list: everything the other chats take, plus the
  // videos only it can read.
  assert.match(terminal, /accept=\{TERMINAL_ATTACHMENT_ACCEPT\}/);
  assert.match(terminal, /extractChatAttachments\(files, \{\s*allowVideo: true,/);
  assert.match(terminal, /onAddDocuments=\{\(\) => attachmentInputRef\.current\?\.click\(\)\}/);
  assert.match(terminal, /attachments=\{chatAttachments\}/);
  assert.match(runtime, /canSubmit=\{Boolean\(input\.trim\(\) \|\| \(!streaming && attachments\?\.length\)\)\}/);
  assert.match(runtime, /onAddDocuments=\{onAddDocuments\}/);
  assert.match(agentSession, /attachments: options\?\.attachments/);
});

test("active conversations show a small spinner beside their row controls", () => {
  assert.match(historyControls, /export function ActiveChatIcon/);
  assert.match(historyControls, /return <BreadboardLoader className=\{className\} \/>/);
  assert.match(breadboardLoader, /className=\{`animate-spin \$\{className\}`\}/);
  assert.match(historyControls, /Boolean\(activeRun\)/);
  assert.match(
    historyControls,
    /message\.role === "assistant"[\s\S]*message\.externalAgentOutcome === "running"/,
  );
  assert.match(
    gardenChat,
    /onExternalAgentTerminal=\{handleExternalAgentTerminal\}/,
  );

  for (const transcript of [terminal, gardenChat]) {
    assert.match(transcript, /item\.externalAgentActive === true/);
    assert.doesNotMatch(transcript, /messages\?: unknown/);
  }

  // Garden chat renders its own rows; the terminal renders the shared rail.
  const gardenRow = gardenChat.slice(gardenChat.indexOf("{history.map"));
  assert.ok(
    gardenRow.indexOf("<ActiveChatIcon") >= 0 &&
      gardenRow.indexOf("<ActiveChatIcon") < gardenRow.indexOf('title="Delete this chat"'),
    "the active-chat spinner must sit directly before the trash control",
  );
  const railRow = terminalSidebar.slice(terminalSidebar.indexOf("function ChatRow"));
  assert.ok(
    railRow.indexOf("<ActiveChatIcon") >= 0 &&
      railRow.indexOf("<ActiveChatIcon") < railRow.indexOf("More actions"),
    "the active-chat spinner must sit before the rail's hover controls",
  );
});

test("initial transcript and Recents loading use the same text-free circle", () => {
  assert.match(runtime, /<BreadboardLoader label="Loading this chat" \/>/);
  assert.match(historyControls, /export function ChatHistoryLoading/);
  assert.match(historyControls, /<SpinnerIcon className="h-3\.5 w-3\.5" \/>/);
  assert.doesNotMatch(historyControls, /<span>\{label\}<\/span>/);
  assert.match(breadboardLoader, /viewBox="0 0 24 24"/);
  assert.match(breadboardLoader, /<circle/);
  assert.doesNotMatch(breadboardLoader, /<rect|HOLES|bb-loader-charge/);
});

test("a fully open terminal stops the page behind it from scrolling", () => {
  const start = terminal.indexOf("const previousOverflow = body.style.overflow;");
  assert.ok(start > 0, "the terminal must remember the page's own overflow before locking it");
  const lock = terminal.slice(start - 400, start + 900);

  // Only at full height: a part-open dock still shows the page, which must
  // keep scrolling. `isOpen` is the wrong trigger — it is true at any height.
  assert.match(lock, /height < maxHeight\(\) - 1/);
  assert.doesNotMatch(lock, /if \(!isOpen\)/);

  assert.match(lock, /body\.style\.overflow = "hidden";/);
  // Hiding the scrollbar would otherwise shift the still-visible nav sideways.
  assert.match(lock, /window\.innerWidth - document\.documentElement\.clientWidth/);
  assert.match(lock, /body\.style\.paddingRight = `\$\{scrollbarWidth\}px`/);

  // Restored on cleanup, and re-evaluated when the viewport changes size.
  assert.match(lock, /window\.addEventListener\("resize", sync\)/);
  assert.match(lock, /window\.removeEventListener\("resize", sync\)/);
  assert.match(lock, /body\.style\.overflow = previousOverflow;[\s\S]*body\.style\.paddingRight = previousPaddingRight;/);

  // Re-runs as the dock is dragged, so releasing below full height unlocks.
  const effectTail = terminal.slice(start, start + 1400);
  assert.match(effectTail, /\}, \[height\]\);/);
});
