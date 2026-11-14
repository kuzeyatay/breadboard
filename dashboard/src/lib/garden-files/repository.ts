import db from "../db.ts";
import { dashboardDataDir } from "../runtime-paths.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { GardenFileStore } from "./store.ts";
import { GARDEN_FILE_IMPORT_LIMIT } from "./types.ts";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { recoverMixedFolderOperations } from "./mixed-folders.ts";

let store: GardenFileStore | undefined;
export function gardenFiles(): GardenFileStore {
  if (!store) {
    const configured = Number(process.env.BREADBOARD_FILE_MAX_UPLOAD_MB);
    const maxBytes = Number.isFinite(configured) && configured > 0 ? Math.floor(configured * 1024 * 1024) : GARDEN_FILE_IMPORT_LIMIT;
    store = new GardenFileStore(db, path.join(dashboardDataDir(), "garden-files"), maxBytes, (scope, value, allowDirectory) => {
      if (!process.env.QUARTZ_CONTENT_PATH) return false;
      const root = path.resolve(process.env.QUARTZ_CONTENT_PATH, scope.gardenId), target = path.resolve(root, value);
      if (!target.startsWith(root + path.sep)) return true;
      const stat = fs.lstatSync(target, { throwIfNoEntry: false });
      return Boolean(stat && !(allowDirectory && stat.isDirectory() && !stat.isSymbolicLink()));
    });
  }
  recoverMixedFolderOperations(store);
  return store;
}
