import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { gardenDirectory, gardenContentRoot } from "../garden-directory.ts";
import { existingGardenFolder } from "../garden-folder-copy.ts";
import { acquireGardenMutationLeaseWithIngestionRecovery } from "../garden-mutation-recovery.ts";
import { dashboardDataDir } from "../runtime-paths.ts";
import { GardenFileError, type GardenFileScope, type GardenFileStore } from "./store.ts";
import { restoreMixedFolder } from "./mixed-folders.ts";

export async function gardenFileFolderAction(store: GardenFileStore, scope: GardenFileScope, id: string, action: string, revision: number, destination?: string) {
  const file = store.get(scope, id, action === "restore");
  if (file.kind !== "folder") return null;
  if (file.revision !== revision) throw new GardenFileError(409, "file_revision_conflict", "This folder changed elsewhere. Refresh it and try again.");
  if (action === "restore") {
    const lease = acquireGardenMutationLeaseWithIngestionRecovery({ contentPath: gardenContentRoot(), dataRoot: dashboardDataDir(), clusterSlug: scope.gardenId, operation: "restore-file-folder", options: { paths: [file.path] } });
    let restored;
    try {
      restored = restoreMixedFolder(store, scope, id);
      const { refreshClusterIndex } = await import("../knowledge.ts");
      refreshClusterIndex(gardenContentRoot(), scope.gardenId, { migrateSources: false });
    } finally { lease.release(); }
    const { publishQuartzAfterMutation } = await import("../quartz-publish.ts");
    void publishQuartzAfterMutation(`restore folder ${scope.gardenId}/${restored.path}`, { userId: scope.ownerId, gardenSlug: scope.gardenId }).catch(error => console.error("[garden] Folder restored; publication failed:", error));
    return restored;
  }
  const root = gardenDirectory(scope.gardenId), diskPath = path.resolve(root, file.path);
  if (!diskPath.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(diskPath)) return null;
  existingGardenFolder(root, file.path);
  const filesystem = await import("../garden-filesystem.ts");
  if (action === "move" && destination) {
    await filesystem.renameGardenFolder({ userId: scope.ownerId, clusterSlug: scope.gardenId, folder: file.path, name: destination.split("/").pop(), toFolder: destination.split("/").slice(0, -1).join("/") });
    return store.get(scope, id);
  }
  if (action === "copy") {
    const copy = await filesystem.copyGardenFolder({ userId: scope.ownerId, clusterSlug: scope.gardenId, folder: file.path });
    return store.list(scope).find(entry => entry.path === copy.newFolder)!;
  }
  if (action === "trash") {
    await filesystem.deleteGardenFolder({ userId: scope.ownerId, clusterSlug: scope.gardenId, clusterId: scope.clusterId, folder: file.path });
    return store.get(scope, id, true);
  }
  return null;
}
