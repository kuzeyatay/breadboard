import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

const SHARED_ASSETS = ['prescript.js', 'postscript.js', 'index.css'] as const;

/** Refresh app code in retained publications; never copy content or indexes. */
export function refreshQuartzRuntimeAssets(assetsRoot: string, publicRoot: string): number {
  // Read the complete build before touching the served files. A missing build
  // must be reported, not silently leave an old Explorer in an updated app.
  const assets = SHARED_ASSETS.map(name => ({ name, bytes: fs.readFileSync(path.join(assetsRoot, name)) }));
  fs.mkdirSync(publicRoot, { recursive: true });
  let changed = 0;
  for (const { name, bytes } of assets) {
    const destination = path.join(publicRoot, name);
    if (fs.existsSync(destination) && fs.readFileSync(destination).equals(bytes)) continue;
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, bytes, { flag: 'wx' });
      fs.renameSync(temporary, destination);
      changed++;
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
  return changed;
}
