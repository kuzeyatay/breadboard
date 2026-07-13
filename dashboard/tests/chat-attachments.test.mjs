import assert from 'node:assert/strict';
import test from 'node:test';

import { extractChatAttachments } from '../src/lib/chat-attachments.ts';

test('plain-text documents are attached without a server extraction round trip', async () => {
  const file = new File(['Breadboard notes'], 'notes.md', { type: 'text/markdown' });
  const result = await extractChatAttachments([file]);

  assert.deepEqual(result, {
    attachments: [{ type: 'text', text: 'Breadboard notes', name: 'notes.md' }],
    errors: [],
    warnings: [],
  });
});
