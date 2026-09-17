import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import Database from "better-sqlite3";
import { createConversationBranch, cloneMessages, applyBranchVariant, messageBranchId, retryTargetUserMessageIndex, restoreBranchAnchor } from "../src/app/components/hermes/conversation-branches.ts";
import { ensureGardenResponseBranches, normalizeGardenResponseBranches, readGardenResponseBranches, writeGardenResponseBranches } from "../src/lib/conversations/garden-response-branches.ts";

const tree = ts.createSourceFile("workspace.tsx", fs.readFileSync(new URL("../src/app/gardens/[clusterSlug]/workspace-client.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map();
function visit(node) { if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(tree)); ts.forEachChild(node, visit); }
visit(tree);
const original = [
  { id: "msg_1", clientMessageId: "original", role: "user", content: "Introduce the magnetic field", attachments: [{ name: "lecture.pdf" }], focusedDocumentSlugs: ["lecture"] },
  { id: "msg_2", clientMessageId: "original", role: "assistant", content: "Original answer" },
];
function fixture() {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE chat_sessions(id INTEGER PRIMARY KEY); INSERT INTO chat_sessions VALUES (1),(2);");
  ensureGardenResponseBranches(db);
  const calls = { sent: [], saved: [], messages: original };
  const scope = { isStreaming: false, activeChat: { id: 1 }, activeChatIdRef: { current: 1 }, savingResponseBranchRef: { current: false },
    messages: original, branchGroups: {}, documents: [], crypto,
    retryBranchRef: { current: null }, createConversationBranch, cloneMessages, applyBranchVariant, messageBranchId, retryTargetUserMessageIndex, restoreBranchAnchor,
    reusableChatAttachments: value => value ?? [], normalizeFocusedDocumentNames: value => value ?? [], normalizeFocusedDocumentSlugs: value => value ?? [],
    assistantExternalAgentRunId: () => null,
    handleSubmit: (...args) => calls.sent.push({ args, retry: scope.retryBranchRef.current }),
    setBranchGroups: updater => { scope.branchGroups = updater(scope.branchGroups); },
    updateChatMessages: (_id, messages) => { scope.messages = messages; calls.messages = messages; },
    persistChatSession: async (id, messages, _title, options) => {
      if (calls.failSave) return false;
      writeGardenResponseBranches(db, id, options.branchGroups);
      calls.saved.push({ id, messages });
      return true;
    },
  };
  const invoke = (name, ...args) => {
    const code = ts.transpile(functions.get(name), { target: ts.ScriptTarget.ES2022 });
    return new Function(...Object.keys(scope), `${code};return ${name};`)(...Object.values(scope))(...args);
  };
  return { db, calls, scope, invoke };
}

test("Retry saves the original before dispatch and both variants remain selectable after browser storage is lost", async () => {
  const f = fixture();
  try {
    await f.invoke("handleRetryAssistant", 1);
    assert.equal(f.calls.saved.length, 1);
    assert.equal(f.calls.sent.length, 1);
    assert.equal(f.calls.sent[0].retry.groupId, "original");
    assert.deepEqual(f.calls.sent[0].args[2], original[0].attachments);
    assert.deepEqual(f.calls.sent[0].args[5].focusedDocumentSlugs, ["lecture"]);
    // Reload with only the newest transcript plus branches read from SQLite.
    f.scope.messages = [
      { ...original[0], id: "msg_3", clientMessageId: "retry", branchGroupId: "original" },
      { ...original[1], id: "msg_4", clientMessageId: "retry", branchGroupId: "original", content: "New answer" },
    ];
    f.scope.branchGroups = readGardenResponseBranches(f.db, 1);
    await f.invoke("switchBranch", "original", -1);
    assert.equal(f.scope.messages[1].content, "Original answer");
    f.scope.branchGroups = readGardenResponseBranches(f.db, 1);
    await f.invoke("switchBranch", "original", 1);
    assert.equal(f.scope.messages[1].content, "New answer");
    assert.deepEqual(readGardenResponseBranches(f.db, 2), {}, "branches are scoped to one chat");
    f.db.prepare("DELETE FROM chat_sessions WHERE id=1").run();
    assert.deepEqual(readGardenResponseBranches(f.db, 1), {});
  } finally { f.db.close(); }
});

test("a failed save leaves the original visible and prevents dispatch; changing chats while saving does not launch a retry", async () => {
  const f = fixture();
  try {
    f.calls.failSave = true;
    await f.invoke("handleRetryAssistant", 1);
    assert.equal(f.calls.sent.length, 0);
    assert.equal(f.scope.messages[1].content, "Original answer");
    f.calls.failSave = false;
    const save = f.scope.persistChatSession;
    f.scope.persistChatSession = async (...args) => { const saved = await save(...args); f.scope.activeChatIdRef.current = 2; return saved; };
    await f.invoke("handleRetryAssistant", 1);
    assert.equal(f.calls.sent.length, 0);
    assert.equal(readGardenResponseBranches(f.db, 1).original.variants[0][1].content, "Original answer");
  } finally { f.db.close(); }
});

test("invalid branch indices and malformed transcripts cannot reach persisted navigation", () => {
  const normal = value => Array.isArray(value) && value.every(m => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string") ? value : null;
  const group = { id: "original", activeIndex: 1, variants: [original, original] };
  assert.equal(normalizeGardenResponseBranches({ original: { ...group, activeIndex: 2 } }, normal), null);
  assert.equal(normalizeGardenResponseBranches({ original: { ...group, variants: [original, [null]] } }, normal), null);
  assert.equal(normalizeGardenResponseBranches({ original: { ...group, id: "wrong" } }, normal), null);
  assert.equal(normalizeGardenResponseBranches({ original: group }, normal).original.variants[0][1].content, "Original answer");
});

test("a recovered older retry preserves follow-ups written after its saved snapshot", () => {
  const replacement = [{ ...original[0], id: "msg_3", clientMessageId: "retry", branchGroupId: "original" },
    { ...original[1], id: "msg_4", clientMessageId: "retry", branchGroupId: "original", content: "New answer" }];
  const group = { id: "original", activeIndex: 1, variants: [original, replacement] };
  const followup = [{ role: "user", content: "New follow-up", clientMessageId: "later" }, { role: "assistant", content: "Follow-up answer", clientMessageId: "later" }];
  const live = [...replacement.map(({ branchGroupId, ...message }) => message), ...followup];
  const restored = applyBranchVariant({ messages: restoreBranchAnchor(live, group), variant: original, groupId: group.id });
  assert.equal(restored[1].content, "Original answer");
  assert.deepEqual(restored.slice(2), followup);
});

test("retrying a recovered answer adds to the same branch group", async () => {
  const f = fixture();
  try {
    await f.invoke("handleRetryAssistant", 1);
    const group = readGardenResponseBranches(f.db, 1).original;
    group.variants[1] = [{ ...original[0], id: "msg_3", clientMessageId: "retry", branchGroupId: "original" },
      { ...original[1], id: "msg_4", clientMessageId: "retry", content: "New answer", branchGroupId: "original" }];
    f.scope.branchGroups = { original: group };
    f.scope.messages = restoreBranchAnchor(group.variants[1].map(({ branchGroupId, ...message }) => message), group);
    await f.invoke("handleRetryAssistant", 1);
    const saved = readGardenResponseBranches(f.db, 1);
    assert.deepEqual(Object.keys(saved), ["original"]);
    assert.equal(saved.original.variants.length, 3);
    assert.equal(saved.original.variants[0][1].content, "Original answer");
    assert.equal(saved.original.variants[1][1].content, "New answer");
  } finally { f.db.close(); }
});
