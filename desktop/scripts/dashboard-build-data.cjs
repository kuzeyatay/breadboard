// Loaded only by the build launcher, including forked route collectors.
// Every process/thread gets disposable data before application modules load.
const root = process.env.BREADBOARD_BUILD_DATA_ROOT;
if (root) {
  const fs = require('node:fs');
  const path = require('node:path');
  const { threadId } = require('node:worker_threads');
  const data = path.join(path.resolve(root), String(process.pid) + '-' + String(threadId));
  fs.mkdirSync(data, { recursive: true });
  process.env.BREADBOARD_DATA_DIR = data;
  process.env.BREADBOARD_GOAL_HOME = path.join(data, 'goals');
}
