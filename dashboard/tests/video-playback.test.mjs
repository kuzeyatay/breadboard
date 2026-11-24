import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ensurePlaybackCopy, parseProbedStreams, playbackConversionArgs, resolveFfmpeg } from '../src/lib/conversations/video-playback.ts';
import { findVideoBlob, playbackCopyPath, removeVideoBlob } from '../src/lib/conversations/video-blob-store.ts';
import { chatVideoPlaybackHref } from '../src/lib/video-attachments.ts';

test('native formats play from the file itself; Matroska and AVI from the MP4 copy', () => {
  const id = `vid_${'a'.repeat(32)}`;
  assert.equal(chatVideoPlaybackHref(id, 'mp4'), `/api/chat-attachments/videos/${id}`);
  assert.equal(chatVideoPlaybackHref(id, 'mkv'), `/api/chat-attachments/videos/${id}?playback=mp4`);
  assert.equal(chatVideoPlaybackHref(id, 'avi'), `/api/chat-attachments/videos/${id}?playback=mp4`);
});

test('an H.264 stream is rewrapped, anything else is re-encoded', () => {
  const probed = parseProbedStreams(
    '  Stream #0:0(eng): Video: h264 (High), yuv420p\n  Stream #0:1(eng): Audio: aac (LC), 48000 Hz\n',
  );
  assert.deepEqual(probed, { video: 'h264', audio: 'aac' });
  const copy = playbackConversionArgs('in.mkv', 'out.mp4', probed);
  assert.deepEqual(copy.slice(copy.indexOf('-c:v'), copy.indexOf('-c:v') + 2), ['-c:v', 'copy']);
  assert.ok(copy.includes('+faststart'));
  const reencode = playbackConversionArgs('in.avi', 'out.mp4', { video: 'mpeg4', audio: 'mp2' });
  assert.ok(reencode.includes('libx264'));
  assert.deepEqual(reencode.slice(reencode.indexOf('-c:a'), reencode.indexOf('-c:a') + 2), ['-c:a', 'aac']);
  assert.ok(!playbackConversionArgs('a', 'b', { video: 'vp9', audio: null }).includes('-c:a'));
});

const ffmpeg = resolveFfmpeg();
test('a real Matroska and AVI convert to a playable MP4 that is removed with the video', { skip: !ffmpeg && 'ffmpeg not available' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'video-playback-'));
  try {
    const userDir = path.join(root, 'u7');
    fs.mkdirSync(userDir, { recursive: true });
    const cases = [
      ['mkv', ['-c:v', 'libx264', '-c:a', 'aac']],
      ['avi', ['-c:v', 'mpeg4', '-c:a', 'mp3']],
    ];
    for (const [index, [format, codecs]] of cases.entries()) {
      const blobId = `vid_${String(index + 1).repeat(32)}`;
      execFileSync(ffmpeg, [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=321x241:rate=10:duration=1',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
        ...codecs, path.join(userDir, `${blobId}.${format}`),
      ]);
      const blob = findVideoBlob({ userId: 7, blobId, root });
      assert.equal(blob.format, format);
      const [first, second] = await Promise.all([ensurePlaybackCopy(7, blob, root), ensurePlaybackCopy(7, blob, root)]);
      assert.equal(first, second, 'concurrent requests share one conversion');
      assert.equal(first, playbackCopyPath(7, blobId, root));
      const head = fs.readFileSync(first).subarray(0, 64).toString('latin1');
      assert.match(head, /ftyp/);
      assert.ok(removeVideoBlob({ userId: 7, blobId, root }));
      assert.equal(fs.existsSync(first), false);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
