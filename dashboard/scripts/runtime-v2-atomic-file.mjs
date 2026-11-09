import fs from 'node:fs';

// Windows readers and scanners can briefly hold the destination without
// FILE_SHARE_DELETE. Keep the old checkpoint intact and retry the same atomic
// rename; never unlink it or fall back to a partially visible copy.
export function renameRuntimeFileSync(source, destination, {
  platform = process.platform,
  rename = fs.renameSync,
  pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
} = {}) {
  for (let attempt = 0; ; attempt++) {
    try { rename(source, destination); return; }
    catch (error) {
      if (platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error?.code) || attempt >= 5) throw error;
      pause(20 * 2 ** attempt);
    }
  }
}
