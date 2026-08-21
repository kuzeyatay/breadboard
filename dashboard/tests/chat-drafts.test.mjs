import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  chatDraftKey,
  clearChatDraft,
  draftPersistStep,
  forgetChatDrafts,
  readChatDraft,
  resolveDraftRestore,
  writeChatDraft,
} from "../src/lib/conversations/drafts.ts";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const terminal = source("../src/app/components/hermes/dashboard-agent-terminal.tsx");
const gardenChat = source("../src/app/components/hermes/garden-agent-chat.tsx");
const knowledgeTerminal = source("../src/app/components/knowledge-terminal.tsx");
const gardenAssistant = source("../src/app/garden/garden-assistant.tsx");
const workspace = source("../src/app/gardens/[clusterSlug]/workspace-client.tsx");
const hook = source("../src/app/components/hermes/use-chat-draft.ts");

function fakeStorage(initial = {}) {
  const entries = new Map(Object.entries(initial));
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
    entries,
  };
}

test("a draft survives being written and read back, per chat", () => {
  const storage = fakeStorage();
  writeChatDraft(storage, chatDraftKey("dashboard_terminal", "conv_a"), "half a question", 1);
  writeChatDraft(storage, chatDraftKey("dashboard_terminal", "conv_b"), "something else", 2);

  assert.equal(readChatDraft(storage, chatDraftKey("dashboard_terminal", "conv_a")), "half a question");
  assert.equal(readChatDraft(storage, chatDraftKey("dashboard_terminal", "conv_b")), "something else");
  assert.equal(readChatDraft(storage, chatDraftKey("dashboard_terminal", "conv_c")), null);
});

test("the same chat id in different surfaces is different boxes", () => {
  const storage = fakeStorage();
  writeChatDraft(storage, chatDraftKey("dashboard_terminal", "conv_a"), "terminal text", 1);
  assert.equal(readChatDraft(storage, chatDraftKey("garden_chat:physics", "conv_a")), null);
});

test("a chat that does not exist yet has a bucket of its own", () => {
  const storage = fakeStorage();
  assert.equal(chatDraftKey("dashboard_terminal", null), "dashboard_terminal:new");
  writeChatDraft(storage, chatDraftKey("dashboard_terminal", null), "typed before sending", 1);
  assert.equal(readChatDraft(storage, "dashboard_terminal:new"), "typed before sending");
});

test("sending a message empties the box, and an empty box keeps no draft", () => {
  const storage = fakeStorage();
  const key = chatDraftKey("dashboard_terminal", "conv_a");
  writeChatDraft(storage, key, "about to send", 1);
  writeChatDraft(storage, key, "", 2);
  assert.equal(readChatDraft(storage, key), null);
  // No empty entry is left behind to be restored over a later draft.
  assert.equal(storage.getItem("breadboard:chat-drafts"), "{}");
});

test("clearing and forgetting drop only the chats named", () => {
  const storage = fakeStorage();
  writeChatDraft(storage, chatDraftKey("dashboard_terminal", "conv_a"), "a", 1);
  writeChatDraft(storage, chatDraftKey("dashboard_terminal", "conv_b"), "b", 2);
  writeChatDraft(storage, chatDraftKey("dashboard_terminal", null), "unstarted", 3);

  clearChatDraft(storage, chatDraftKey("dashboard_terminal", null));
  assert.equal(readChatDraft(storage, chatDraftKey("dashboard_terminal", null)), null);
  assert.equal(readChatDraft(storage, chatDraftKey("dashboard_terminal", "conv_a")), "a");

  forgetChatDrafts(storage, "dashboard_terminal", ["conv_a"]);
  assert.equal(readChatDraft(storage, chatDraftKey("dashboard_terminal", "conv_a")), null);
  assert.equal(readChatDraft(storage, chatDraftKey("dashboard_terminal", "conv_b")), "b");
});

test("only the newest drafts are kept, so the entry cannot grow without bound", () => {
  const storage = fakeStorage();
  for (let index = 0; index < 60; index += 1) {
    writeChatDraft(storage, chatDraftKey("dashboard_terminal", `conv_${index}`), `draft ${index}`, index);
  }
  const kept = JSON.parse(storage.getItem("breadboard:chat-drafts"));
  assert.equal(Object.keys(kept).length, 40);
  assert.equal(readChatDraft(storage, chatDraftKey("dashboard_terminal", "conv_59")), "draft 59");
  assert.equal(readChatDraft(storage, chatDraftKey("dashboard_terminal", "conv_0")), null);
});

test("a corrupt or missing entry reads as no drafts rather than throwing", () => {
  assert.equal(readChatDraft(fakeStorage(), "dashboard_terminal:new"), null);
  assert.equal(
    readChatDraft(fakeStorage({ "breadboard:chat-drafts": "not json" }), "dashboard_terminal:new"),
    null,
  );
  assert.equal(
    readChatDraft(fakeStorage({ "breadboard:chat-drafts": "[1,2,3]" }), "dashboard_terminal:new"),
    null,
  );
});

test("a store that refuses writes costs the draft and nothing else", () => {
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
  assert.doesNotThrow(() => writeChatDraft(storage, "dashboard_terminal:new", "text", 1));
});

test("opening a chat with a draft puts that draft back", () => {
  assert.deepEqual(
    resolveDraftRestore({
      stored: "kept for this chat",
      value: "text from the chat being left",
      previousKey: "dashboard_terminal:conv_a",
      newChatKey: "dashboard_terminal:new",
      sessionId: "conv_b",
      createdSessionId: null,
    }),
    { next: "kept for this chat", carried: false },
  );
});

test("opening a chat with no draft empties the box", () => {
  assert.deepEqual(
    resolveDraftRestore({
      stored: null,
      value: "text from the chat being left",
      previousKey: "dashboard_terminal:conv_a",
      newChatKey: "dashboard_terminal:new",
      sessionId: "conv_b",
      createdSessionId: null,
    }),
    { next: "", carried: false },
  );
});

test("text typed before a chat existed follows it once it is created", () => {
  assert.deepEqual(
    resolveDraftRestore({
      stored: null,
      value: "a follow-up typed while the first answer streamed",
      previousKey: "dashboard_terminal:new",
      newChatKey: "dashboard_terminal:new",
      sessionId: "conv_fresh",
      createdSessionId: "conv_fresh",
    }),
    { next: "a follow-up typed while the first answer streamed", carried: true },
  );
});

test("a stored draft still wins over carrying text into a new chat", () => {
  assert.deepEqual(
    resolveDraftRestore({
      stored: "what this chat was left with",
      value: "leftover",
      previousKey: "dashboard_terminal:new",
      newChatKey: "dashboard_terminal:new",
      sessionId: "conv_fresh",
      createdSessionId: "conv_fresh",
    }),
    { next: "what this chat was left with", carried: false },
  );
});

test("a chat that merely opened under a blank composer does not take its text", () => {
  // Reload, or a page away and back: the composer starts on the unstarted chat
  // with its draft restored, and moments later the newest existing chat is
  // reopened underneath it. That chat was not created here, so the text stays
  // where it was typed rather than turning up as a draft of an old chat.
  assert.deepEqual(
    resolveDraftRestore({
      stored: null,
      value: "typed into the new chat",
      previousKey: "dashboard_terminal:new",
      newChatKey: "dashboard_terminal:new",
      sessionId: "conv_last_used",
      createdSessionId: null,
    }),
    { next: "", carried: false },
  );
});

test("clicking an existing chat out of a blank one leaves the draft behind", () => {
  // The composer had created a chat earlier in this session, but the chat being
  // opened now is not that one, so nothing follows the reader into it.
  assert.deepEqual(
    resolveDraftRestore({
      stored: null,
      value: "typed into the new chat",
      previousKey: "dashboard_terminal:new",
      newChatKey: "dashboard_terminal:new",
      sessionId: "conv_from_the_rail",
      createdSessionId: "conv_made_earlier",
    }),
    { next: "", carried: false },
  );
});

test("the commit that still carries the outgoing text is not written to the incoming chat", () => {
  const pending = { text: "restored", before: "outgoing" };
  assert.deepEqual(draftPersistStep({ value: "outgoing", pending }), {
    write: false,
    pending,
  });
});

test("once the restore lands, nothing is rewritten, and typing resumes saving", () => {
  const pending = { text: "restored", before: "outgoing" };
  assert.deepEqual(draftPersistStep({ value: "restored", pending }), {
    write: false,
    pending: null,
  });
  // Typing before the restore lands must not stall the store forever.
  assert.deepEqual(draftPersistStep({ value: "typed instead", pending }), {
    write: true,
    pending: null,
  });
  assert.deepEqual(draftPersistStep({ value: "anything", pending: null }), {
    write: true,
    pending: null,
  });
});

test("every chat surface keeps its composer's text across a reload", () => {
  assert.match(terminal, /useChatDraft\(\{\s*surface: "dashboard_terminal"/);
  assert.match(terminal, /onRestore: setInput/);
  assert.match(gardenChat, /useChatDraft\(\{\s*surface: draftSurface/);
  assert.match(gardenChat, /const draftSurface = `garden_chat:\$\{gardenSlug\}`/);
  for (const [name, surface, key] of [
    ["knowledge terminal", knowledgeTerminal, /`knowledge_terminal:\$\{scope\}`/],
    ["garden assistant", gardenAssistant, /`garden_assistant:\$\{activeClusterSlug \?\? 'none'\}`/],
    ["garden workspace", workspace, /`garden_workspace:\$\{clusterSlug\}`/],
  ]) {
    assert.match(surface, /useChatDraft\(\{\s*surface: draftSurface/, name);
    assert.match(surface, key, name);
    // Each of these keeps its chats by a numeric id, which the draft key takes
    // as a string so one shape of key covers every surface.
    assert.match(surface, /sessionId: active(Chat)?Id === null \? null : String\(active(Chat)?Id\)/, name);
  }
});

test("every surface says which chat it created, so a draft follows only that one", () => {
  // The carry is gated on the surface naming the chat it minted itself. A
  // surface that wires the composer but not this would silently file unsent
  // text under whichever chat happened to open next.
  assert.match(terminal, /createdSessionId: session\.createdSessionId/);
  assert.match(gardenChat, /createdSessionId: session\.createdSessionId/);
  for (const [name, surface] of [
    ["knowledge terminal", knowledgeTerminal],
    ["garden assistant", gardenAssistant],
    ["garden workspace", workspace],
  ]) {
    assert.match(
      surface,
      /createdSessionId: created(Chat)?Id === null \? null : String\(created(Chat)?Id\)/,
      name,
    );
  }
  // And the hook refuses to carry when no surface said so.
  assert.match(hook, /createdSessionId = null/);
});

test("a temporary chat leaves no draft behind, and a deleted chat takes its draft with it", () => {
  assert.match(terminal, /enabled: !temporaryChat/);
  assert.match(terminal, /forgetChatDrafts\(window\.localStorage, "dashboard_terminal", \[item\.id\]\)/);
  assert.match(terminal, /forgetChatDrafts\(window\.localStorage, "dashboard_terminal", deleted\)/);
  assert.match(gardenChat, /forgetChatDrafts\(window\.localStorage, draftSurface, \[item\.id\]\)/);
  for (const surface of [knowledgeTerminal, gardenAssistant, workspace]) {
    assert.match(
      surface,
      /forgetChatDrafts\(window\.localStorage, draftSurface, \[String\((sessionId|targetId)\)\]\)/,
    );
  }
  // Turning the promise off for a chat also removes what it already kept.
  assert.match(hook, /if \(!enabled\) \{\s*clearChatDraft\(window\.localStorage, key\);/);
});

test("an unsent draft survives asking for a new chat, since nothing else holds it", () => {
  // These surfaces used to wipe the unstarted-chat bucket here, which was
  // harmless only while an unsent draft was carried onto whichever chat opened
  // next. Now that it stays filed where it was typed, this was the one thing
  // that could destroy it — so the composer comes back to it instead.
  for (const [name, surface] of [
    ["dashboard terminal", terminal],
    ["garden chat", gardenChat],
    ["garden workspace", workspace],
  ]) {
    assert.doesNotMatch(
      surface,
      /clearChatDraft\(\s*window\.localStorage,\s*chatDraftKey\([^)]*, null\),?\s*\)/,
      name,
    );
  }
  // The terminal still clears explicitly on send, because its composer keeps
  // showing the sent words until the server acknowledges them — the empty box
  // that clears every other surface's bucket never happens there.
  assert.match(
    terminal,
    /clearChatDraft\(\s*window\.localStorage,\s*chatDraftKey\("dashboard_terminal", draftSessionId\),?\s*\)/,
  );
});
