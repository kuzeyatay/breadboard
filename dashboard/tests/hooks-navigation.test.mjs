import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const sidebar = source("../src/app/components/hermes/terminal-sidebar.tsx");
const terminal = source("../src/app/components/hermes/dashboard-agent-terminal.tsx");
const panel = source("../src/app/components/hermes/hooks-panel.tsx");
const hooksPage = source("../src/app/hooks/page.tsx");
const dashboardShell = source("../src/app/dashboard/dashboard-page-shell.tsx");
const dashboardClient = source("../src/app/dashboard/dashboard-client.tsx");
const database = source("../src/lib/db.ts");
const hookStore = source("../src/lib/hooks/store.ts");
const chatCompleted = source("../src/lib/hooks/chat-completed.ts");
const conversationStore = source("../src/lib/conversations/store.ts");
const webhookTrigger = source("../src/app/api/webhooks/trigger/[path]/route.ts");

test("Hooks stays below Scheduled and opens through the same in-place panel control", () => {
  const navStart = sidebar.indexOf('<nav aria-label="Terminal actions"');
  const navEnd = sidebar.indexOf("</nav>", navStart);
  const nav = sidebar.slice(navStart, navEnd);
  const scheduled = nav.indexOf('label="Scheduled"');
  const hooks = nav.indexOf('label="Hooks"');
  const processes = nav.indexOf('label="Processes"');

  assert.ok(scheduled >= 0 && hooks > scheduled, "Hooks follows Scheduled");
  assert.ok(processes > hooks, "Processes follows Hooks");
  assert.ok(sidebar.indexOf('label="Recents"') > navEnd, "Recents follows the main navigation");
  assert.match(nav, /label="Hooks"[\s\S]{0,180}active=\{openPanel === "hooks"\}/);
  assert.match(nav, /label="Hooks"[\s\S]{0,220}onClick=\{\(\) => onTogglePanel\("hooks"\)\}/);
  assert.doesNotMatch(nav, /label="Hooks"[\s\S]{0,180}href=/);
});

test("the /hooks route reuses the dashboard terminal shell and opens the Hooks panel", () => {
  assert.match(hooksPage, /<DashboardPageShell initialTerminalPanel="hooks" \/>/);
  assert.match(dashboardShell, /initialTerminalPanel\?: TerminalPanel \| null/);
  assert.match(dashboardClient, /initialPanel=\{initialTerminalPanel\}/);
  assert.match(
    terminal,
    /const \[sidePanel, setSidePanel\] = useState<TerminalPanel \| null>\(\s*initialPanel,?\s*\)/,
  );
  assert.match(terminal, /if \(initialPanel \|\| wasOpen\)[\s\S]{0,520}setHeight\(/);
  assert.match(terminal, /sidePanel === "hooks" \? \([\s\S]{0,240}<HooksPanel \/>/);
});

test("the Hooks empty state matches the requested copy and offers a primary action", () => {
  assert.match(panel, />Hooks<\/h2>/);
  assert.match(panel, /Create automations that react when something happens\./);
  assert.match(panel, />No hooks yet<\/h3>/);
  assert.match(panel, /Create a hook to automatically run an action when an event occurs\./);
  assert.match(panel, /neu-button-accent[\s\S]{0,180}>\s*\+ New hook\s*<\/button>/);
});

test("hooks storage is initialized by the application database bootstrap", () => {
  assert.match(database, /import \{ ensureHooksSchema \} from "\.\/hooks\/schema\.ts"/);
  assert.match(database, /ensureScheduledChatSchema\(db\);[\s\S]{0,360}ensureHooksSchema\(db\);/);
});

test("a Chat completed trigger is exposed with cohesive action controls", () => {
  assert.match(panel, /id: "chat_completed"[\s\S]{0,100}label: "Chat completed"/);
  assert.match(panel, />\s*Trigger\s*<select/);
  assert.match(panel, /neu-segmented[\s\S]{0,160}aria-label="Hook action"/);
  assert.match(panel, /neu-button-accent[\s\S]{0,360}\{saving \? "Creating…" : "Create hook"\}/);
  assert.match(panel, /neu-button[\s\S]{0,140}>\s*Cancel\s*<\/button>/);
  assert.doesNotMatch(panel, /mode === "workflow" \|\| true/);
});

test("successful chat hooks are post-commit, deduplicated, and cannot recurse", () => {
  assert.match(hookStore, /export const CHAT_COMPLETED_PROVIDER = "chat_completed"/);
  assert.match(hookStore, /assertProviderConfig\(input\.provider, input\.providerConfig \?\? \{\}\)/);
  assert.match(hookStore, /provider = \? AND enabled = 1/);
  assert.match(conversationStore, /import\("\.\.\/hooks\/chat-completed\.ts"\)/);
  assert.match(conversationStore, /fireSuccessfulChatHooks\(\{/);
  assert.match(chatCompleted, /clientMessageId\.startsWith\("hook-"\)/);
  assert.match(chatCompleted, /conversation\.temporary === 1/);
  assert.match(chatCompleted, /assistant\.status !== "complete"/);
  assert.match(chatCompleted, /recordDelivery\(hook\.id, deliveryKey, db\)/);
  assert.match(chatCompleted, /recordHookFire\(hook\.id, db\)/);
  assert.match(webhookTrigger, /hook\.provider === CHAT_COMPLETED_PROVIDER/);
});
