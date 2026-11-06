import assert from 'node:assert/strict';
import test from 'node:test';
import { dictationPreview, parseDictationCommand } from '../src/lib/speech/dictation-command.ts';

test('a trailing send message command is removed, with punctuation and casing tolerated', () => {
  for (const [spoken, text] of [
    ['Hello there send message', 'Hello there'],
    ['Hello there. Send message.', 'Hello there.'],
    ['Hello there, SEND MESSAGE!', 'Hello there,'],
    ['Hello there. Send message. Send message!', 'Hello there.'],
    ['Send message.', ''],
    ['  Send   message  ', ''],
    ['Hello there. Send, message.', 'Hello there.'],
    ['Hello there. Send. Message!', 'Hello there.'],
    ['Hello there. Send message,', 'Hello there.'],
  ]) assert.deepEqual(parseDictationCommand(spoken), { text, submit: true });
});
test('interior mentions, quoted commands, substrings and ordinary text do not submit', () => {
  for (const text of ['Please send message to Sam', 'The button says “send message”', 'Type "send message".',
    'resend message', 'send messages', 'send a message', 'Café 世界', 'Send message? Is that the button?']) {
    assert.deepEqual(parseDictationCommand(text), { text, submit: false });
  }
});

test('live previews withhold a possible trailing send command until its meaning is known', () => {
  for (const suffix of ['s', 'se', 'sen', 'send', 'send m', 'send me', 'send messag', 'send message.', 'send.', 'send, me', 'send   messag', 'send. message.']) {
    assert.equal(dictationPreview('Café 🌱. ' + suffix), 'Café 🌱.');
  }
  for (const text of ['Please send message to Sam', 'The button says “send message”', 'resend', 'sensitive', 'Hello world']) {
    assert.equal(dictationPreview(text), text);
  }
  assert.deepEqual(parseDictationCommand('Please send'), { text: 'Please send', submit: false });
});
