import { randomUUID } from "node:crypto";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { GardenFileError, type GardenFileScope, type GardenFileStore } from "./store.ts";

/** A separate working copy; external apps must never edit an immutable original. */
export function exportGardenFile(store: GardenFileStore, scope: GardenFileScope, id: string): string {
  if (scope.userId !== scope.ownerId) throw new GardenFileError(403, "file_read_only", "Only the owner can export a file to this computer.");
  const content = store.content(scope, id);
  let name = content.entry.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/, "");
  if (!name || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) name = `_${name}`;
  const directory = path.join(store.root, "exports", randomUUID());
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, name);
  try { fs.copyFileSync(content.path, target, fs.constants.COPYFILE_EXCL); }
  catch (error) { fs.rmSync(directory, { recursive: true, force: true }); throw error; }
  return target;
}
