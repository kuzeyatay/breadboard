import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";
import {assertOffline} from "./migrate-data-location.mjs";
import {DATA_MIGRATION_LOCK, resolveDataRoot, validateDataRoot} from "../src/main/data-location.ts";

// Activation follows the built desktop implementation, not a parallel parser.
const require = createRequire(import.meta.url);

export function configureBulkLocation({userDataDir, bulkRoot, appRoot}) {
  const {writeBulkLocation, resolveBulkRoot} = require("../dist/main/bulk-location.js");
  const profile = validateDataRoot(userDataDir);
  const activeData = validateDataRoot(resolveDataRoot(profile));
  const destination = validateDataRoot(bulkRoot);
  const application = validateDataRoot(appRoot);
  assertOffline(activeData);
  const lock = path.join(profile, DATA_MIGRATION_LOCK);
  const fd = fs.openSync(lock, "wx", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify({version:1,kind:"hybrid-storage-activation",pid:process.pid}));
    fs.fsyncSync(fd);
    assertOffline(activeData);
    const previous = resolveBulkRoot(profile, false, [activeData, application]);
    if (previous && path.resolve(previous).toLowerCase() !== destination.toLowerCase()) {
      throw new Error("An existing different bulk root requires its own verified migration; refusing to replace it.");
    }
    writeBulkLocation(profile, {version:1,bulkRoot:destination,verifiedAt:new Date().toISOString()}, [activeData,application]);
    return {configured:true,dataRoot:activeData,bulkRoot:destination,originalDataRetained:true};
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const options = {};
  for (const argument of process.argv.slice(2)) {
    const match = /^--(user-data|bulk-root|app-root)=(.+)$/u.exec(argument);
    if (!match) throw new Error("Use --user-data=<profile> --bulk-root=<direct directory> --app-root=<program root>.");
    options[match[1] === "user-data" ? "userDataDir" : match[1] === "bulk-root" ? "bulkRoot" : "appRoot"] = match[2];
  }
  if (!options.userDataDir || !options.bulkRoot || !options.appRoot) throw new Error("All three explicit roots are required.");
  process.stdout.write(JSON.stringify(configureBulkLocation(options)) + "\n");
}
