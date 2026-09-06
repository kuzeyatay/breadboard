import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { DEFAULT_VOICE_ASSISTANT, heardHeyBread, parseVoiceAssistantPreferences } from '../src/lib/speech/assistant-preferences.ts';
import { readVoiceAssistantPreferences, writeVoiceAssistantPreferences } from '../src/lib/speech/assistant-store.ts';

test('voice preferences default off, validate strictly, persist, and remain account scoped', () => {
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES (1), (2)');
    assert.deepEqual(readVoiceAssistantPreferences(db, 1), DEFAULT_VOICE_ASSISTANT);
    writeVoiceAssistantPreferences(db, 1, { readAloudNotifications:true, alwaysOnVoiceAssistant:true });
    assert.deepEqual(readVoiceAssistantPreferences(db, 1), { readAloudNotifications:true, alwaysOnVoiceAssistant:true });
    assert.deepEqual(readVoiceAssistantPreferences(db, 2), DEFAULT_VOICE_ASSISTANT);
    for (const value of [null, [], {}, { ...DEFAULT_VOICE_ASSISTANT, command:'execute' }, { ...DEFAULT_VOICE_ASSISTANT, alwaysOnVoiceAssistant:'true' }]) assert.equal(parseVoiceAssistantPreferences(value), null);
    writeVoiceAssistantPreferences(db, 1, DEFAULT_VOICE_ASSISTANT);
    assert.deepEqual(readVoiceAssistantPreferences(db, 1), DEFAULT_VOICE_ASSISTANT);
  } finally { db.close(); }
});

test('wake phrase accepts transcriber punctuation and rejects substrings', () => {
  for (const text of ['Hey Bread', 'hey, bread!', 'HEY BREAD.', 'Hey Bread can you help']) assert.equal(heardHeyBread(text), true, text);
  for (const text of ['bread', 'hey', 'hey breadboard', 'they bread', 'hey breadcrumb', 'make bread']) assert.equal(heardHeyBread(text), false, text);
});
