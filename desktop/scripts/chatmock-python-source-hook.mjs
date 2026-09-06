import fs from "node:fs";
import path from "node:path";

// The app-selected launcher supplies this variable after pinning its own
// source tree. A bare embedded Python process must not inherit whichever
// generated app-services snapshot happened to be staged most recently.
export const CHATMOCK_SOURCE_HOOK = "import os, sys; _breadboard_chatmock_source = os.environ.get('BREADBOARD_CHATMOCK_SOURCE_ROOT'); sys.path.insert(0, _breadboard_chatmock_source) if _breadboard_chatmock_source else None\n";

export function ensureChatMockSourceHook(pythonRoot) {
  const root = path.resolve(pythonRoot);
  const target = path.join(root, "Lib", "site-packages", "breadboard-chatmock.pth");
  // This is executable startup configuration. Reject links/hardlinks rather
  // than following a redirected runtime directory or modifying a shared file.
  for (let entry = target; ; entry = path.dirname(entry)) {
    let stat;
    try { stat = fs.lstatSync(entry); } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (stat) {
      if (stat.isSymbolicLink() || (entry === target && (!stat.isFile() || stat.nlink !== 1))) {
        throw new Error(`Unsafe ChatMock source hook path: ${entry}`);
      }
    }
    if (entry === path.dirname(entry)) break;
  }
  if (fs.existsSync(target) && fs.readFileSync(target, "utf8") === CHATMOCK_SOURCE_HOOK) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, CHATMOCK_SOURCE_HOOK, "utf8");
  return true;
}
