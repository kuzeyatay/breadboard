import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const workspace = fs.readFileSync(
  path.join(import.meta.dirname, "../src/app/gardens/[clusterSlug]/workspace-client.tsx"),
  "utf8",
);
const sessionRoute = fs.readFileSync(
  path.join(import.meta.dirname, "../src/app/api/chat-sessions/[sessionId]/route.ts"),
  "utf8",
);
const sidebar = fs.readFileSync(
  path.join(import.meta.dirname, "../src/app/components/hermes/terminal-sidebar.tsx"),
  "utf8",
);

test("Garden Chat starts a local draft and persists it on first send", () => {
  const start = workspace.slice(
    workspace.indexOf("function handleNewChat"),
    workspace.indexOf("async function handleForkCluster"),
  );
  assert.match(start, /pendingNewChatRef\.current = true/);
  assert.match(start, /setActiveChatId\(null\)/);
  assert.match(start, /setInput\(""\)/);
  assert.match(start, /setChatAttachments\(\[\]\)/);
  assert.doesNotMatch(start, /createChatSession\(/);

  // Both the ordinary first turn and an external-agent first turn already use
  // this lazy creation path.
  const lazyCreates = workspace.match(
    /writableActiveChat \?\? \(await createChatSession\(\)\)/g,
  ) ?? [];
  assert.ok(lazyCreates.length >= 2);
  assert.match(workspace, /if \(pendingNewChatRef\.current\) return null/);
  assert.match(workspace, /pendingNewChatRef\.current = false;[\s\S]{0,100}chatHistoryEpoch\.current \+= 1/);
});

test("Garden Chat rename matches Terminal's optimistic inline contract", () => {
  // The rename input is the shared rail's now, so the half of the contract
  // about the input itself is held there: it commits on blur, it stops at the
  // 200 characters the server stores, and it freezes the list's order while it
  // is open — a row that moves under a focused input blurs it, and blur commits
  // whatever was typed so far.
  assert.match(sidebar, /onBlur=\{commitRename\}/);
  assert.match(sidebar, /maxLength=\{200\}/);
  assert.match(sidebar, /const visibleChats = frozen \? frozen\.chats : chats/);

  // Renaming is never blocked by a chat that is still answering.
  const rename = workspace.slice(
    workspace.indexOf("function renameChatFromRail"),
    workspace.indexOf("async function renameChatSession"),
  );
  assert.doesNotMatch(rename, /streamingChatIds/);

  // The other half is unchanged and still the workspace's: optimistic, guarded
  // by the epoch so a slow refresh cannot restore the old title, and adopting
  // whatever title the route answers with.
  assert.match(workspace, /chatHistoryEpoch\.current \+= 1/g);
  assert.match(workspace, /item\.id === session\.id && item\.title === title/);
  assert.match(workspace, /const canonical = data\?\.session\?\.title/);
});

test("Garden Chat rename updates the canonical conversation without reordering Recents", () => {
  const patch = sessionRoute.slice(
    sessionRoute.indexOf("export async function PATCH"),
    sessionRoute.indexOf("export async function DELETE"),
  );
  assert.match(patch, /ensureConversationForLegacyChatSession/);
  assert.match(patch, /renameConversation\(conversation, title, db\)/);
  assert.match(patch, /A chat needs a name/);
  assert.match(patch, /session: saved/);
  assert.doesNotMatch(
    patch,
    /SET title = \?, updated_at = datetime\('now'\)/,
  );
});

test("Garden Chat sent messages match Terminal hover actions", () => {
  const transcript = workspace.slice(
    workspace.indexOf("const ChatTranscript"),
    workspace.indexOf("// â”€â”€ Prompts"),
  );

  assert.match(transcript, /group-hover:opacity-100/);
  assert.match(transcript, /group-focus-within:opacity-100/);
  assert.match(transcript, /navigator\.clipboard\.writeText\(message\.content\)/);
  assert.match(transcript, /title="Save to Prompts"/);
  assert.match(transcript, /aria-label="Edit message and create a branch"/);
  assert.match(transcript, /<SavePromptDialog/);
  assert.match(transcript, /Save &amp; send/);
  assert.match(workspace, /onEditMessage=\{handleEditUserMessage\}/);
  assert.match(
    workspace,
    /reusableChatAttachments\(previousUser\.attachments\)/,
  );
});
