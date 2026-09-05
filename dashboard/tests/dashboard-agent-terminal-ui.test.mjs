import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const terminal = fs.readFileSync(
  new URL("../src/app/components/hermes/dashboard-agent-terminal.tsx", import.meta.url),
  "utf8",
);
const lazyTerminal = fs.readFileSync(
  new URL("../src/app/components/hermes/lazy-dashboard-agent-terminal.tsx", import.meta.url),
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
const globals = fs.readFileSync(
  new URL("../src/app/globals.css", import.meta.url),
  "utf8",
);
const terminalSidebar = fs.readFileSync(
  new URL("../src/app/components/hermes/terminal-sidebar.tsx", import.meta.url),
  "utf8",
);
const composer = fs.readFileSync(
  new URL("../src/app/components/assistant-composer.tsx", import.meta.url),
  "utf8",
);
const runtimeHealthRoute = fs.readFileSync(
  new URL("../src/app/api/hermes/health/route.ts", import.meta.url),
  "utf8",
);
const developmentRuntimeUrl = new URL(
  "../src/lib/hermes/development-runtime.ts",
  import.meta.url,
);

test("Hermes terminal uses the original Breadboard terminal shell", () => {
  assert.match(terminal, /breadboard:knowledge-terminal-height/);
  assert.match(
    terminal,
    /background: glassActive[\s\S]{0,180}?bodyMounted[\s\S]{0,120}?"var\(--paper-surface\)"[\s\S]{0,80}?"var\(--terminal-bar\)"/,
  );
  assert.match(
    terminal,
    /style=\{\{[\s\S]{0,80}?background: glassActive \? "transparent" : "var\(--terminal-bar\)"[\s\S]{0,40}?\}\}/,
  );
  // The rail is opened and closed by its own edge, not by a toolbar button.
  assert.match(terminalSidebar, /name="Toggle the sidebar"/);
  assert.doesNotMatch(terminal, /aria-label="Toggle the sidebar"/);
  // New chat and Recents live in the rail the divider opens.
  assert.match(terminalSidebar, /label="New chat"/);
  assert.match(terminalSidebar, /label="Recents"/);
  assert.match(terminal, /terminal-boot-reveal/);
  assert.doesNotMatch(terminal, /#0b0f14/);
});

test("the resting terminal uses half the home dock extent and keeps its rounded shoulders", () => {
  assert.match(terminal, /terminalDockCollapsedHeight/);
  assert.match(legacyTerminal, /terminalDockCollapsedHeight/);
  assert.match(globals, /--terminal-collapsed-height: calc\(\(var\(--browser-dock-height\) \+ var\(--browser-dock-bottom\)\) \/ 2\)/);
  assert.match(terminal, /const GOLDEN_RATIO_SQUARED = 2\.618/);
  assert.match(
    terminal,
    /cornerRadius: TERMINAL_BAR_RADIUS/,
  );
  assert.match(globals, /--terminal-bar-height: 42px/);
  assert.match(
    globals,
    /--terminal-bar-radius: calc\(var\(--terminal-bar-height\) \/ 2\.618\)/,
  );
  assert.match(
    globals,
    /\.bb-terminal-dock \{[\s\S]{0,160}?border-start-start-radius: var\(--terminal-bar-radius\);[\s\S]{0,100}?border-start-end-radius: var\(--terminal-bar-radius\);/,
  );
});

test("the header conceals on close the way it reveals on open", () => {
  // Items stay mounted through the exit animation instead of vanishing.
  assert.match(terminal, /flex h-\[42px\] shrink-0/);
  assert.match(terminal, /headerMounted \? "" : "justify-center"/);
  assert.match(terminal, /\{headerMounted \? \(/);
  assert.match(
    terminal,
    /headerClosing\s*\n?\s*\? "terminal-boot-conceal"\s*\n?\s*: "terminal-boot-reveal"/,
  );
  // Exit starts immediately, uses the compositor-only close curve, and
  // unmounts with the dock rather than trailing it for most of a second.
  assert.match(terminal, /const DOCK_CLOSE_MS = 240/);
  assert.match(terminal, /const DOCK_CLOSE_EASING = "var\(--neu-easing\)"/);
  assert.match(terminal, /\}, DOCK_CLOSE_MS\)/);
  assert.match(terminal, /animationDelay: headerClosing \? "0ms" : "40ms"/);
  assert.match(
    globals,
    /\.terminal-boot-conceal \{\s*animation: terminal-boot-conceal 0\.2s var\(--neu-easing\) both;/,
  );
  assert.doesNotMatch(
    globals,
    /@keyframes terminal-boot-conceal[\s\S]{0,300}?filter:/,
  );
});

// The dock is the heaviest box on the page and the page behind it measures it,
// so a height animation relaid out both on every frame — the stutter the glide
// used to open with. It slides instead: the box takes its final size up front
// and only its offset is animated.
test("the dock slides open rather than growing open", () => {
  assert.match(terminal, /height: drawerPresentation \? "100%" : glideBox \?\? \(isOpen \? height : "var\(--terminal-collapsed-height\)"\)/);
  assert.match(terminal, /!drawerPresentation && glide\s*\? `translate3d\(0, \$\{glideShift\}px, 0\)`/);
  assert.match(terminal, /transition: !drawerPresentation && glideMoving[\s\S]*?`transform \$\{DOCK_OPEN_MS\}ms/);
  assert.doesNotMatch(terminal, /`height \$\{DOCK_OPEN_MS\}ms/);

  // Opening mounts the whole terminal in the same commit that sets the height.
  // The move waits for that work to land, or it spends its first frames queued
  // behind the mount — which is what a laggy open actually was.
  assert.match(
    terminal,
    /requestAnimationFrame\(\(\) => \{\s*glideRaf\.current = window\.requestAnimationFrame/,
  );
  assert.match(terminal, /setGlideMoving\(true\);\s*\n\s*setGlideShift\(open \? 0 :/);

  // Reversing mid-flight starts from the edge's real position, which is neither
  // the height in state nor the box's own height while it sits offset.
  assert.match(terminal, /window\.innerHeight - dock\.getBoundingClientRect\(\)\.top/);
  assert.match(terminal, /startHeight: visualHeight\(\)/);
});

test("the brown terminal header toggles fully open and fully closed", () => {
  assert.match(
    terminal,
    /function openHeight\(preferred: number \| null\): number \{[\s\S]{0,600}?return preferred === null\s*\? max\s*:\s*Math\.min\(Math\.max\(preferred, MIN_OPEN_HEIGHT\), max\);\s*\}/,
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
    /const target = open \? openHeight\(null\) : terminalDockCollapsedHeight\(\)/,
  );
  assert.match(terminal, /const box = Math\.max\(openHeight\(null\), terminalDockCollapsedHeight\(\)\)/);
  assert.doesNotMatch(
    terminal,
    /const target = open\s*\? openHeight\(preferredOpenHeightRef\.current\)/,
  );
  assert.match(terminal, /aria-label=\{!drawerPresentation && !isOpen \? `Open terminal\$\{unreadSuffix\}` : undefined\}/);
  assert.match(terminal, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.match(terminal, /toggleDock\(true\)/);

  // The legacy fallback follows the same contract for pointer, hydration-click,
  // and keyboard paths instead of reviving the last dragged height.
  assert.equal(
    legacyTerminal.match(/setHeight\(maxHeight\(\)\)/g)?.length,
    3,
  );
  assert.doesNotMatch(
    legacyTerminal,
    /setHeight\(preferredOpenHeightRef\.current \?\? defaultOpenHeight\(\)\)/,
  );
});

test("opening the terminal puts the native caret in the chat field", () => {
  assert.match(terminal, /const focusComposerAfterOpenRef = useRef\(false\)/);
  assert.match(
    terminal,
    /if \(open\) \{\s*focusComposerAfterOpenRef\.current = true;/,
  );
  assert.match(
    terminal,
    /if \(!isOpen \|\| !focusComposerAfterOpenRef\.current\) return;[\s\S]*?composerTextareaRef\.current\?\.focus\(\)/,
  );
});

test("the terminal always starts collapsed without reopening to a stale height", () => {
  assert.match(terminal, /drawerPresentation \? 720 : DEFAULT_TERMINAL_DOCK_HEIGHT/);
  assert.match(legacyTerminal, /useState\(DEFAULT_TERMINAL_DOCK_HEIGHT\)/);
  for (const source of [terminal, legacyTerminal]) {
    assert.doesNotMatch(source, /setHeight\(clampHeight\(saved(?:Height)?\)\)/);
  }
  assert.match(
    terminal,
    /preferredOpenHeightRef\.current = clampHeight\(saved(?:Height)?\)/,
  );
  assert.doesNotMatch(legacyTerminal, /preferredOpenHeightRef|HEIGHT_KEY/);
  assert.match(terminal, /if \(height < minOpenHeight\(\)\) return/);
});

test("the collapsed terminal bar has no implementation-status copy", () => {
  assert.match(
    lazyTerminal,
    /import DashboardAgentTerminal from "\.\/dashboard-agent-terminal"/,
  );
  assert.match(lazyTerminal, /<DashboardAgentTerminal \{\.\.\.props\} \/>/);
  assert.doesNotMatch(lazyTerminal, /next\/dynamic|loading:|Loading Terminal|setEnabled|onClick/);
  assert.doesNotMatch(lazyTerminal, /open when needed/i);
});

test("an open Hermes terminal survives a renderer reload", () => {
  assert.match(
    terminal,
    /window\.sessionStorage\.getItem\(OPEN_STATE_KEY\) === "true"/,
  );
  assert.match(terminal, /if \(initialPanel \|\| wasOpen\)/);
  assert.match(
    terminal,
    /window\.sessionStorage\.setItem\([\s\S]*?OPEN_STATE_KEY[\s\S]*?height >= minOpenHeight\(\) \? "true" : "false"/,
  );
  assert.match(
    terminal,
    /if \(!openStatePersistenceReadyRef\.current\)[\s\S]*?return;/,
  );
});

test("the selected Terminal chat survives a renderer reload without changing fresh-launch behavior", () => {
  assert.match(terminal, /const ACTIVE_CHAT_KEY = "breadboard:terminal:active-chat"/);
  assert.match(terminal, /restoreLastConversation: false/);
  assert.match(
    terminal,
    /readActiveTerminalChatId\(restoreOwnerKey\)[\s\S]*?openTerminalSession\([\s\S]*?savedSessionId,[\s\S]*?readActiveTerminalChatSnapshot\(restoreOwnerKey, savedSessionId\)/,
  );
  assert.match(
    terminal,
    /if \([\s\S]*?!activeChatPersistenceReadyRef\.current[\s\S]*?session\.loadingSession[\s\S]*?\) \{\s*return;/,
  );
  assert.match(
    terminal,
    /JSON\.stringify\(\{ ownerKey: restoreOwnerKey, sessionId: session\.sessionId \}\)/,
  );
  assert.match(
    terminal,
    /if \(temporaryChat \|\| !session\.sessionId\) \{\s*window\.sessionStorage\.removeItem\(ACTIVE_CHAT_KEY\)/,
  );
  assert.match(
    terminal,
    /const ACTIVE_CHAT_SNAPSHOT_MAX_CHARS = 1_500_000/,
  );
  assert.match(
    terminal,
    /writeActiveTerminalChatSnapshot\([\s\S]*?restoreOwnerKey,[\s\S]*?session\.sessionId!,[\s\S]*?session\.messages/,
  );
  assert.match(terminal, /window\.addEventListener\("pagehide", persist\)/);
  assert.match(
    terminal,
    /const snapshot = activeChatSnapshotRef\.current;[\s\S]*?writeActiveTerminalChatSnapshot\(/,
  );
  assert.match(
    terminal,
    /parsed\?\.ownerKey === ownerKey[\s\S]*?parsed\.sessionId === sessionId/,
  );
});

test("the restored shell retains Hermes runtime capabilities", () => {
  assert.match(terminal, /useAgentSession\("dashboard_terminal"/);
  assert.match(terminal, /<AgentRuntimePanel/);
  assert.match(terminal, /pendingPermission=\{session\.pendingPermission\}/);
  assert.match(terminal, /onPermissionDecision=/);
  assert.match(terminal, /onAbort=/);
  assert.match(terminal, /model=\{selectedModel\}/);
  assert.match(terminal, /reasoningEffort=\{selectedReasoningEffort\}/);
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
  assert.match(terminal, /aria-label="Agent runtime is unavailable"/);
  assert.doesNotMatch(terminal, /function runtimeLabel/);
  assert.match(terminal, /\{!runtimeOnline \? \(/);
  assert.doesNotMatch(terminal, /knowledgeUnavailable/);
  assert.doesNotMatch(terminal, /session\.connection === "idle" \? "ready"/);
});

test("the red terminal status offers a transcript-preserving reconnect action", () => {
  const refreshHealth = terminal.slice(
    terminal.indexOf("const refreshRuntimeHealth"),
    terminal.indexOf("// Route-owned panels"),
  );
  assert.match(terminal, /\{!runtimeOnline \? \(/);
  assert.match(terminal, /"Reconnect terminal"/);
  assert.match(terminal, /const runtimeReady = await onRefreshRuntime\(\)/);
  assert.match(terminal, /loadRuntimeHealth\(\{ reconnect: true \}\)/);
  assert.match(terminal, /method: reconnect \? "POST" : "GET"/);
  assert.match(runtimeHealthRoute, /export async function POST\(\)/);
  assert.match(
    runtimeHealthRoute,
    /acquireServiceLease\("hermes", "terminal-reconnect"\)/,
  );
  assert.match(runtimeHealthRoute, /releaseSupervisorLease\(lease\)/);
  assert.equal(fs.existsSync(developmentRuntimeUrl), false);
  assert.doesNotMatch(
    runtimeHealthRoute,
    /node:child_process|ensureDevelopmentHermesRuntime|start-hermes\.mjs/,
  );
  assert.match(runtimeHealthRoute, /never launch[\s\S]{0,80}detached child/);
  assert.doesNotMatch(refreshHealth, /status: "checking"/);
  assert.match(terminal, /if \(!runtimeReady\) return/);
  assert.match(
    terminal,
    /await session\.openSession\(session\.sessionId, session\.messages\)/,
  );
  assert.match(
    terminal,
    /refreshingTerminal \? \([\s\S]{0,120}?<BreadboardLoader className="h-3\.5 w-3\.5"/,
  );
  assert.match(
    terminal,
    /className="neu-button inline-flex h-7 w-7/,
  );
  assert.match(terminal, /flex h-\[42px\] shrink-0/);
  assert.doesNotMatch(
    terminal,
    /<span>\{refreshingTerminal \? "Refreshing" : "Reconnect"\}<\/span>/,
  );
});

test("mount polling is passive and a stopped Hermes service remains submit-ready", () => {
  const healthEffect = terminal.slice(
    terminal.indexOf("async function checkHealth()"),
    terminal.indexOf("const refreshRuntimeHealth"),
  );
  assert.match(healthEffect, /loadRuntimeHealth\(\)/);
  assert.doesNotMatch(healthEffect, /reconnect: true/);
  assert.match(runtimeHealthRoute, /readSupervisedServiceSnapshot\("hermes"\)/);
  assert.match(runtimeHealthRoute, /serviceState: "available-but-stopped"/);
  assert.match(runtimeHealthRoute, /available: true/);
});

test("runtime startup never disables drafting and retries a transient failed health check", () => {
  assert.match(
    terminal,
    /health\.status === "runtime" \|\|\s*health\.status === "checking" \|\|\s*runtimeSurfaceEngaged/,
  );
  assert.match(
    terminal,
    /window\.setTimeout\(\s*\(\) => void checkHealth\(\),\s*HEALTH_RETRY_DELAY_MS/,
  );
  assert.match(terminal, /HEALTH_FAILURE_THRESHOLD = 3/);
  assert.match(
    terminal,
    /if \(consecutiveFailures >= HEALTH_FAILURE_THRESHOLD\) \{\s*setHealth\(nextHealth\)/,
  );
  assert.match(
    terminal,
    /A transport miss is not evidence that the agent runtime\s*\/\/ is down/,
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
  assert.match(breadboardLoader, /className=\{`bb-loader \$\{className\}`\}/);
  assert.match(breadboardLoader, /<circle[\s\S]*className="bb-loader-settled"/);
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

test("initial transcript and Recents loading use the same multi-pass drawn ring", () => {
  assert.match(
    runtime,
    /<BreadboardLoader[\s\S]{0,120}?label="Loading this chat"[\s\S]{0,120}?\/>/,
  );
  assert.match(historyControls, /export function ChatHistoryLoading/);
  assert.match(historyControls, /<SpinnerIcon className="h-3\.5 w-3\.5" \/>/);
  assert.doesNotMatch(historyControls, /<span>\{label\}<\/span>/);
  assert.match(breadboardLoader, /viewBox="0 0 24 24"/);
  assert.match(breadboardLoader, /inkRingPath/);
  assert.match(breadboardLoader, /LOADER_SKETCH_RINGS = \[/);
  assert.match(breadboardLoader, /LOADER_SKETCH_RINGS\.map/);
  assert.match(breadboardLoader, /bb-loader-settled/);
  assert.match(breadboardLoader, /bb-loader-sketch bb-loader-sketch-/);
  assert.match(breadboardLoader, /<circle/);
  assert.doesNotMatch(breadboardLoader, /bb-loader-snake|bb-loader-rotor/);
  assert.doesNotMatch(breadboardLoader, /animate-spin/);
  assert.match(
    globals,
    /\.bb-loader-sketch \{[\s\S]{0,320}?stroke-dasharray: 1;[\s\S]{0,160}?animation: bb-loader-trace 2820ms linear var\(--bb-loader-sketch-delay, 0ms\)\s+infinite/,
  );
  assert.match(
    globals,
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]{0,220}?\.bb-loader-sketch \{[\s\S]{0,160}?animation: bb-loader-soft 2\.1s cubic-bezier\(0\.77, 0, 0\.175, 1\) infinite/,
  );
  assert.match(globals, /\.bb-loader \{[\s\S]{0,320}?overflow: hidden;/);
  assert.match(globals, /\.bb-loader-sketch-3 \{\s*--bb-loader-trace-opacity: 0\.54;/);
  assert.doesNotMatch(breadboardLoader, /<rect|HOLES|bb-loader-charge/);
});

test("a fully open terminal stops the page behind it from scrolling", () => {
  const start = terminal.indexOf("const previousOverflow = body.style.overflow;");
  assert.ok(start > 0, "the terminal must remember the page's own overflow before locking it");
  const lock = terminal.slice(start - 400, start + 2_400);

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
  const effectTail = terminal.slice(start, start + 2_800);
  assert.match(effectTail, /\}, \[drawerPresentation, height\]\);/);
});

test("a message queues while its chat is still loading", () => {
  // The hook is the backstop: `send` reads a ref, because the handlers that
  // call it run outside the render that produced the flag.
  assert.match(agentSession, /const loadingSessionRef = useRef\(true\);/);
  assert.match(
    agentSession,
    /const markLoadingSession = useCallback\(\(loading: boolean\) => \{\s*loadingSessionRef\.current = loading;\s*setLoadingSession\(loading\);/,
  );
  // Every write goes through the wrapper, or the ref drifts from the state.
  assert.doesNotMatch(agentSession, /(?<!set)\bsetLoadingSession\(true\)/);
  assert.match(agentSession, /if \(loadingSessionRef\.current\) return;/);

  // Direct conversation mutations stay locked for the same window. The shared
  // queue, however, holds the typed follow-up until this lock clears.
  assert.match(
    runtime,
    /const conversationLoading =\s*loadingTranscript \|\| \(!visibleConversationJustCreated && !artifactsReady\);/,
  );
  assert.match(runtime, /const conversationLocked = Boolean\(disabled\) \|\| conversationLoading;/);
  assert.match(runtime, /disabled=\{conversationLocked\}/);
  assert.match(runtime, /const queueHeld = conversationLoading \|\| runInFlight/);
  assert.match(runtime, /runInFlight: queueHeld/);
  assert.match(runtime, /queueDisabled=\{Boolean\(disabled\)\}/);

  // Transcript loading is shown on the send button, not in the box. Only an
  // answer in flight changes the ordinary invitation into follow-up copy.
  assert.match(
    runtime,
    /runInFlight \? "Follow up\." : \(placeholder \?\? "Ask the agent…"\)/,
  );
  assert.doesNotMatch(runtime, /conversationLoading \? "Follow up\."/);
  assert.doesNotMatch(runtime, /loadingTranscript \? "Loading this chat…"/);
  assert.match(runtime, /loading=\{conversationLoading\}/);
  assert.match(composer, /\(isSending \|\| loading\) && !canQueueFollowUp/);
  assert.match(composer, /const queueHeld = loading \|\| runInFlight/);
  assert.match(composer, /if \(queueHeld\) \{\s*queueSteer\(\)/);
  assert.match(composer, /canQueueFollowUp\s*\? 'Queue message'/);
  assert.match(composer, /runInFlight && onStop && !canQueueFollowUp/);
  // Loading keeps the accent colour when empty; typing restores the arrow.
  assert.match(composer, /\$\{loading \? 'disabled:cursor-wait/);
  assert.doesNotMatch(composer, /if \(loading\) return;/);
  // Voice mode submits without touching the send button.
  assert.match(
    runtime,
    /function submitComposer\(\) \{[\s\S]{0,220}if \(conversationLoading\) return;/,
  );

  // Both surfaces stop at the top of their dispatch cascade, so a runtime
  // agent cannot bind its run to a conversation that has not settled either.
  assert.match(
    terminal,
    /const submit = useCallback\([\s\S]{0,800}if \(session\.loadingSession \|\| openGymRoutingRef\.current\) return;/,
  );
  // The terminal's empty-state openers used to be a second dispatch path and
  // carried the same guard. They now only fill the composer, so submit is the
  // one door into the runtime and the one place the guard has to hold.
  assert.match(terminal, /onSelectSuggestion=\{fillComposerWithPrompt\}/);
  assert.doesNotMatch(terminal, /const fillComposerWithPrompt = useCallback\([\s\S]{0,400}session\.send\(/);
  assert.match(
    gardenChat,
    /const submit = useCallback\(\(\) => \{[\s\S]{0,300}if \(session\.loadingSession\) return;/,
  );
  assert.match(gardenChat, /if \(busy \|\| session\.loadingSession\) return;/);
});
