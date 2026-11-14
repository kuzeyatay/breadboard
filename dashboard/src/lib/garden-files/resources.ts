import { GardenFileError, type GardenFileScope, type GardenFileStore } from "./store.ts";

export function gardenFileResource(store: GardenFileStore, scope: GardenFileScope, id: string, relative: string) {
  const source = store.get(scope, id);
  if (!relative || /^[a-z][a-z0-9+.-]*:|^[\\/]/i.test(relative) || relative.includes("\0") || relative.length > 2048) throw new GardenFileError(400, "file_resource_path", "This file reference is not a local library asset.");
  const parts = source.folder ? source.folder.split("/") : [];
  for (const segment of relative.replaceAll("\\", "/").split("/")) {
    if (segment === "..") { if (!parts.length) throw new GardenFileError(400, "file_resource_path", "This reference is outside the garden."); parts.pop(); }
    else if (segment && segment !== ".") parts.push(segment);
  }
  const resource = store.list(scope).find(entry => entry.kind === "file" && entry.path.toLowerCase() === parts.join("/").normalize("NFC").toLowerCase());
  if (!resource) throw new GardenFileError(404, "file_resource_missing", "A companion file is missing or private. Import it alongside this file to preview it.");
  return resource;
}
