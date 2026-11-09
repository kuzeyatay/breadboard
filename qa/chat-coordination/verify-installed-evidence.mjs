import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const directory = 'qa/chat-coordination/installed-q2TelN';
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const hash = name => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex');
const originalPath = `${directory}/result.json`;
const originalHash = hash(originalPath);
const original = read(originalPath);
const evidence = read(`${directory}/owned-exchange-evidence.json`);
const guardedCleanup = read(`${directory}/reconciled-cleanup.json`);
const interruptedCleanup = read(`${directory}/reconciled-cleanup-after-recovery.json`);
const finalCleanup = read(`${directory}/final-cleanup.json`);
const regression = read('.tmp-chat-coordination-receipt-fix/verification.json');
const activation = read('audits/agent-repairs-2026-11-06/activation27.json');
const ids = { sender: 'conv_0XowQHWnNWgUPl2qkVPiRCMb', receiver: 'conv_zAJpCTsBLfcfm4lQfvKkiyon' };
const source = evidence.owned.find(row => row.public_id === ids.sender);
const receiver = evidence.owned.find(row => row.public_id === ids.receiver);
assert.ok(source && receiver);
assert.equal(original.fingerprint, activation.dashboard.fingerprint);
assert.equal(original.passed, false, 'Preserve the original monitoring harness failure');
assert.equal(original.released, false);
assert.equal(original.owned.length, 2);
assert.equal(source.messages.length, 2);
assert.equal(receiver.messages.length, 4);
assert.ok([...source.messages, ...receiver.messages].every(message => message.status === 'complete'));
const code = receiver.messages[0].content.match(/answer-[a-f0-9-]{36}/)?.[0];
assert.ok(code);
assert.equal(receiver.messages[1].content, 'READY');
assert.equal(source.messages[0].content, original.sourcePrompt);
assert.ok(!original.sourcePrompt.includes(code), 'The sender must learn the code from the other chat');
assert.ok(!receiver.messages[2].content.includes(code));
assert.ok(receiver.messages[2].content.startsWith('Message from chat '));
assert.ok(receiver.messages[2].content.split('\n\n')[0].endsWith(`(${ids.sender}):`));
assert.equal(receiver.messages[3].content.trim(), code);
const answer = source.messages[1];
assert.deepEqual(answer.content.match(/answer-[a-f0-9-]{36}/g), [code]);
const requiredTools = ['chat_list', 'chat_send_message', 'chat_wait'];
const permittedTools = new Set([...requiredTools, 'tool_search', 'tool_describe', 'tool_call']);
assert.ok(answer.metadata.toolCalls.every(call => permittedTools.has(call.toolName) && call.success === true));
const verifiedTools = requiredTools.map(toolName => {
  const call = answer.metadata.toolCalls.find(call => call.toolName === toolName);
  assert.equal(call?.success, true);
  const receipt = answer.metadata.verification.evidence.find(item => item.toolCallId === call.toolCallId);
  assert.equal(receipt?.success, true);
  assert.equal(receipt.details.toolName, toolName);
  assert.equal(Object.hasOwn(receipt.details.result, 'error'), false);
  return { toolName, toolCallId: call.toolCallId, completedAt: call.completedAt, result: receipt.details.result };
});
const send = verifiedTools.find(tool => tool.toolName === 'chat_send_message').result;
const wait = verifiedTools.find(tool => tool.toolName === 'chat_wait').result;
assert.equal(wait.messageId, send.messageId);
assert.equal(wait.chatId, ids.receiver);
assert.equal(wait.status, 'complete');
assert.equal(wait.answer, code);
assert.equal(wait.answerTruncated, false);
assert.equal(wait.timedOut, false);
assert.equal(evidence.outbox.length, 1);
assert.equal(evidence.outbox[0].id, send.messageId);
assert.equal(evidence.outbox[0].source_id, source.id);
assert.equal(evidence.outbox[0].target_id, receiver.id);
assert.equal(evidence.outbox[0].status, 'complete');
assert.equal(evidence.outbox[0].error, null);
assert.equal(receiver.messages[2].client_message_id, `chat-message:${send.messageId}`);
const elapsedMs = Date.parse(answer.metadata.responseCompletedAt) - Date.parse(original.startedAt);
assert.ok(elapsedMs > 0 && elapsedMs <= 120000);
// Independently corroborate saved database evidence with authenticated API projections.
for (const [kind, chat] of [['sender', source], ['receiver', receiver]]) {
  const snapshot = interruptedCleanup.snapshots[kind];
  assert.equal(snapshot.id, chat.public_id);
  assert.equal(snapshot.activeRun, null);
  assert.deepEqual(snapshot.messages.map(message => [message.role, message.clientMessageId, message.content]),
    chat.messages.map(message => [message.role, message.client_message_id, message.content]));
}
for (const toolName of requiredTools) {
  assert.equal(interruptedCleanup.snapshots.sender.messages[1].tools.find(tool => tool.toolName === toolName)?.status, 'completed');
}
assert.equal(guardedCleanup.requests.length, 0);
assert.equal(interruptedCleanup.requests.length, 2);
assert.ok(interruptedCleanup.requests.every(request => request.method === 'GET' && request.status === 200));
assert.equal(finalCleanup.released, true);
assert.equal(finalCleanup.identity.fingerprint, original.fingerprint);
assert.deepEqual(finalCleanup.requests.filter(request => request.method === 'DELETE').map(request => [request.id, request.status]), [[ids.receiver, 200]]);
for (const id of Object.values(ids)) {
  assert.equal(finalCleanup.requests.filter(request => request.id === id && request.method === 'GET').at(-1).status, 404);
  assert.equal(finalCleanup.canonicalRows.find(row => row.id === id)?.count, 0);
}
assert.equal(regression.nodeTestsPassed, 22);
assert.equal(regression.pythonPluginTestsPassed, 1);
assert.equal(regression.typescriptDiagnostics, 0);
const artifactPaths = [originalPath, `${directory}/owned-exchange-evidence.json`,
  `${directory}/reconciled-cleanup.json`, `${directory}/reconciled-cleanup-after-recovery.json`,
  `${directory}/recovered-runtime-reconciliation.json`, `${directory}/final-cleanup.json`,
  '.tmp-chat-coordination-receipt-fix/verification.json',
  'qa/chat-coordination/live-2026-11-07-PX3sMD.json',
  'qa/chat-coordination/startup-http-2026-11-07.json'];
const report = {
  verifiedAt: new Date().toISOString(), installedExchangeVerified: true,
  originalHarnessPassed: false, cleanupVerified: true,
  build: { number: 27, fingerprint: original.fingerprint, exchangeOrigin: original.origin, cleanupOrigin: finalCleanup.identity.origin },
  model: original.model, ids,
  exchange: { startedAt: original.startedAt, completedAt: answer.metadata.responseCompletedAt, elapsedMs,
    receiverOnlyCode: code, senderInputContainsCode: false, receiverAnswer: receiver.messages[3].content,
    senderAnswer: answer.content, senderAttributionVerified: true, completedEnvelopeCount: 1,
    messageId: send.messageId, tools: verifiedTools },
  validation: { targetedNodeTests: 22, actualPythonPluginCallbackTests: 1, typescriptDiagnostics: 0,
    independentEvidence: ['Canonical SQLite transcripts and outbox', 'Authenticated product API transcripts and successful tool statuses'],
    deterministicIntegration: 'Queueing, non-cancelling wait timeout, fresh-process recovery and goal continuation are covered in the linked integration artifacts.' },
  monitoring: { originalResultUnmodified: true, issue: 'Browser test transport timed out while the actual exchange continued and completed within the 120-second work budget.',
    transportCause: 'Undetermined; no claim that the normal app fetch priority wrapper caused the POST timeout.',
    runtimeRecovery: 'The coordinator reconciled automatic recovery after the successful exchange; cleanup verified the unchanged build fingerprint on its new origin.' },
  cleanup: { bothApiGet404: true, bothCanonicalRowCountsZero: true,
    firstAttempt: 'Stopped before API requests because the origin had changed.',
    secondAttempt: 'Both ownership GETs succeeded; sender DELETE was submitted, but its acknowledgement timed out. Subsequent API and database reads confirmed it completed.',
    finalAttempt: 'No sender DELETE replay. Revalidated the still-present receiver, deleted it once, and confirmed both IDs absent.',
    scope: 'Only the two owned QA chats. No foreground changes, browser-global edits, model runs, voice actions, or app restarts during cleanup.' },
  evidence: artifactPaths.map(file => ({ file, sha256: hash(file) })),
};
assert.equal(hash(originalPath), originalHash);
const output = 'qa/chat-coordination/installed-verified-2026-11-07.json';
fs.writeFileSync(path.join(root, output), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, sha256: hash(output), installedExchangeVerified: true, originalHarnessPassed: false, cleanupVerified: true, elapsedMs }));
