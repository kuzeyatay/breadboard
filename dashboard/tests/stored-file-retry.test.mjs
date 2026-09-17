import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import AdmZip from 'adm-zip';

// A regenerated turn carries a pointer to each stored file and no text. The
// server must read every stored format back the way its upload read it, or the
// retry silently asks a different question than the original did.
test('a retried turn reads stored files of every format back from their bytes', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stored-file-retry-'));
  const previous = process.env.BREADBOARD_DATA_DIR;
  process.env.BREADBOARD_DATA_DIR = dataDir;
  try {
    const store = await import('../src/lib/conversations/stored-file-blob-store.ts');
    const { resolveDocumentAttachments } = await import('../src/lib/document-attachments-server.ts');

    const write = (format, bytes) =>
      store.writeStoredFileBlob({ userId: 7, format, body: new Blob([bytes]).stream() });
    const script = await write('bin', Buffer.from('function y = erlangc(a, n)\nend\n'));
    const binary = await write('bin', Buffer.from([0, 1, 2, 3]));
    const archive = new AdmZip();
    archive.addFile('notes/readme.txt', Buffer.from('inside the archive'));
    archive.addFile('photo.jpg', Buffer.from([0xff, 0xd8]));
    const zipped = await write('zip', archive.toBuffer());
    const plain = await write('txt', Buffer.from('plain notes'));

    const pointer = (name, stored) => ({
      type: 'text', name, blobId: stored.blobId, format: stored.format, text: '',
    });
    const resolved = resolveDocumentAttachments(7, [
      pointer('erlangc-2.m', script),
      pointer('firmware.bin', binary),
      pointer('lab.zip', zipped),
      pointer('notes.txt', plain),
      { type: 'text', name: 'inline.m', text: 'already here' },
    ]);
    assert.deepEqual(resolved.map((attachment) => attachment.text), [
      'function y = erlangc(a, n)\nend\n',
      'Original binary file attached: firmware.bin. Inspect the workspace copy with the appropriate file tools.',
      '=== notes/readme.txt ===\ninside the archive',
      'plain notes',
      'already here',
    ]);

    // Another user's pointer to the same blob stays empty rather than leaking.
    const [foreign] = resolveDocumentAttachments(8, [pointer('erlangc-2.m', script)]);
    assert.equal(foreign.text, '');
  } finally {
    if (previous === undefined) delete process.env.BREADBOARD_DATA_DIR;
    else process.env.BREADBOARD_DATA_DIR = previous;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('the upload route keeps a file of unknown kind as bin instead of refusing it', () => {
  const route = fs.readFileSync(
    new URL('../src/app/api/chat-attachments/files/route.ts', import.meta.url),
    'utf8',
  );
  assert.match(route, /storedFileAttachmentFormat\(filename\) \?\? "bin"/);
  assert.doesNotMatch(route, /unsupported_file_format/);
});
