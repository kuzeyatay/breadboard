import { randomUUID } from "node:crypto";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { gardenFileExtension, GARDEN_FILE_OFFICE_LIMIT } from "./types.ts";
import { GardenFileError, type GardenFileScope, type GardenFileStore } from "./store.ts";

/** A disposable GLB cache, independent of chat attachment lifetimes. */
export async function gardenModelPreview(store: GardenFileStore, scope: GardenFileScope, id: string, signal?: AbortSignal): Promise<Buffer> {
  const file = store.content(scope, id), format = gardenFileExtension(file.entry.name);
  if (!["step", "stp", "iges", "igs", "brep"].includes(format)) throw new GardenFileError(400, "file_model_format", "This model does not need conversion.");
  if (file.entry.size > GARDEN_FILE_OFFICE_LIMIT) throw new GardenFileError(413, "file_model_large", "This model is too large to preview. Download the original to open it in your CAD app.");
  const directory = path.join(store.root, "previews"), cached = path.join(directory, `${file.version.sha256}.glb`);
  if (fs.existsSync(cached)) return fs.promises.readFile(cached);
  const { cadServiceConvert } = await import("../cad/service.ts");
  let result;
  try { result = await cadServiceConvert({ format: format as "step", contentBase64: (await fs.promises.readFile(file.path)).toString("base64"), exports: [{ format: "glb", filename: "preview.glb" }], timeoutMs: 120_000, linearTolerance: .12, angularTolerance: .35 }, { signal }); }
  catch { throw new GardenFileError(503, "file_model_unavailable", "The CAD preview service is unavailable. Try again or download the original."); }
  const bytes = result.files.glb;
  if (!result.ok || !bytes?.length) throw new GardenFileError(422, "file_model_invalid", "This CAD file could not be converted for viewing. Download the original to open it in its app.");
  fs.mkdirSync(directory, { recursive: true });
  const temp = path.join(directory, `${randomUUID()}.tmp`);
  try {
    await fs.promises.writeFile(temp, bytes);
    try { await fs.promises.rename(temp, cached); }
    catch (error) { if (!fs.existsSync(cached)) throw error; }
  }
  finally { fs.rmSync(temp, { force: true }); }
  return bytes;
}
