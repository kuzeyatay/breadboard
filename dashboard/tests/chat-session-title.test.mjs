import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import {
  CONVERSATION_TITLE_INSTRUCTION,
  applyGeneratedConversationTitle,
  fallbackConversationTitle,
  generateConversationTitle,
  normalizeGeneratedConversationTitle,
  shouldGenerateConversationTitleForTurn,
} from '../src/lib/conversations/title-service.ts';

test('title generation sends only the first prompt to a plain LLM', async () => {
  let capturedUrl = '';
  let capturedBody;
  const title = await generateConversationTitle({
    firstPrompt: 'Can you explain surrogate gradients for spiking neural networks?',
    model: 'gpt-5.6-terra',
    baseUrl: 'http://title.test/v1',
    fetcher: async (url, init) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(String(init.body));
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'Surrogate Gradient Learning Guide' } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  assert.equal(title, 'Surrogate Gradient Learning Guide');
  assert.equal(capturedUrl, 'http://title.test/v1/chat/completions');
  assert.equal(capturedBody.messages.length, 2);
  assert.deepEqual(capturedBody.messages[0], {
    role: 'system',
    content: CONVERSATION_TITLE_INSTRUCTION,
  });
  assert.equal(capturedBody.messages[1].role, 'user');
  assert.match(capturedBody.messages[1].content, /describe it; do not answer it/i);
  assert.match(
    capturedBody.messages[1].content,
    /Can you explain surrogate gradients for spiking neural networks\?/,
  );
  assert.equal(capturedBody.messages.some((message) => message.role === 'assistant'), false);
  assert.equal(capturedBody.model, 'gpt-5.6-terra');
  assert.equal(capturedBody.stream, false);
  assert.equal('tools' in capturedBody, false);
  assert.equal('tool_choice' in capturedBody, false);
});

test('generated titles are cleaned and capped at four words', () => {
  assert.equal(
    normalizeGeneratedConversationTitle('Title: "Fix Chat Renaming Pipeline."'),
    'Fix Chat Renaming Pipeline',
  );
  assert.equal(normalizeGeneratedConversationTitle('One Two Three Four Five Six'), null);
  assert.equal(normalizeGeneratedConversationTitle('Too short'), null);
  assert.equal(normalizeGeneratedConversationTitle("I'll inspect the chat-renaming"), null);
  assert.equal(
    normalizeGeneratedConversationTitle('<think>hidden</think>\nGarden Memory Privacy Rules'),
    'Garden Memory Privacy Rules',
  );
});

test('a local title keeps chats named when the title model is unavailable', async () => {
  const prompt =
    '/agents:deep-research why is robotic considered the future, what would its consequences be to the world economy';
  assert.equal(
    fallbackConversationTitle(prompt),
    'Robotic Future World Economy',
  );
  assert.equal(
    await generateConversationTitle({
      firstPrompt: prompt,
      fetcher: async () => new Response('unavailable', { status: 502 }),
    }),
    'Robotic Future World Economy',
  );
  assert.equal(
    fallbackConversationTitle(
      '/interactive-visualizer-in-chat of coulomb force and charge',
    ),
    'Coulomb Force Charge',
  );
});

test('a later retry repairs New chat after the reserved first turn was interrupted', () => {
  assert.equal(
    shouldGenerateConversationTitleForTurn({
      currentTitle: 'New chat',
      userOrderIndex: 2,
      reservationIsNew: true,
      preDispatchReserved: false,
    }),
    true,
  );
  assert.equal(
    shouldGenerateConversationTitleForTurn({
      currentTitle: 'Coulomb Force Explorer',
      userOrderIndex: 2,
      reservationIsNew: true,
      preDispatchReserved: false,
    }),
    false,
  );
  assert.equal(
    shouldGenerateConversationTitleForTurn({
      currentTitle: 'New chat',
      userOrderIndex: 2,
      reservationIsNew: false,
      preDispatchReserved: false,
    }),
    false,
  );
});

test('an automatic title updates linked history but never overwrites a manual rename', () => {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE conversations (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      legacy_chat_session_id INTEGER
    );
    CREATE TABLE chat_sessions (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL
    );
    INSERT INTO chat_sessions(id, title) VALUES (7, 'Assistant conversation');
    INSERT INTO conversations(id, title, legacy_chat_session_id)
      VALUES (3, 'Assistant conversation', 7);
  `);

  const updated = applyGeneratedConversationTitle({
    conversationId: 3,
    expectedTitle: 'Assistant conversation',
    generatedTitle: 'Repair Chat Rename Flow',
  }, database);
  assert.equal(updated.title, 'Repair Chat Rename Flow');
  assert.equal(
    database.prepare('SELECT title FROM chat_sessions WHERE id = 7').get().title,
    'Repair Chat Rename Flow',
  );

  database.prepare('UPDATE conversations SET title = ? WHERE id = 3')
    .run('My Manual Name');
  const skipped = applyGeneratedConversationTitle({
    conversationId: 3,
    expectedTitle: 'Repair Chat Rename Flow',
    generatedTitle: 'Late Automatic Rename',
  }, database);
  assert.equal(skipped, null);
  assert.equal(
    database.prepare('SELECT title FROM conversations WHERE id = 3').get().title,
    'My Manual Name',
  );
  database.close();
});

test('an external-chat title keeps its source prefix outside the word cap', () => {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE conversations (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      legacy_chat_session_id INTEGER
    );
    INSERT INTO conversations(id, title, legacy_chat_session_id)
      VALUES (9, 'Telegram · Kuzey: remind me', NULL);
  `);

  const updated = applyGeneratedConversationTitle({
    conversationId: 9,
    expectedTitle: 'Telegram · Kuzey: remind me',
    generatedTitle: 'Remind Drink Minutes Later',
    sourcePrefix: 'Telegram',
  }, database);
  assert.equal(updated.title, 'Telegram:Remind Drink Minutes Later');
  database.close();
});
