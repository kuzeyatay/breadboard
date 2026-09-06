import fs from "node:fs";
import path from "node:path";
import { ACESTEP_REVISION } from "./capabilities.ts";
export const ACESTEP_MODEL_REVISION = "19671f406d603126926c1b7e2adc169acbcade22";
export function preparedAceStep(directory: string) {
  try {
    const root = fs.realpathSync.native(directory);
    const filename = path.join(root, "models-ready.json"), stat = fs.lstatSync(filename);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 1024 * 1024)
      return null;
    const data = JSON.parse(fs.readFileSync(filename, "utf8"));
    if (data.sourceRevision !== ACESTEP_REVISION || data.modelRevision !== ACESTEP_MODEL_REVISION || data.model !== "acestep-v15-turbo" || !Array.isArray(data.files) || data.files.length < 3 || data.files.length > 2000)
      return null;
    const weights = new Set<string>();
    for (const item of data.files) {
      if (typeof item.path !== "string" || !/^source\/checkpoints\/(acestep-v15-turbo|vae|Qwen3-Embedding-0.6B)\//.test(item.path) || item.path.split('/').some((part: string) => part === '..') || item.path.includes('\\') || !Number.isSafeInteger(item.size) || item.size < 1)
        return null;
      const file = path.resolve(root, item.path), canonical = fs.realpathSync.native(file);
      if (path.relative(file, canonical) !== "" || fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size !== item.size)
        return null;
      if (item.path.endsWith('.safetensors'))
        weights.add(item.path.split('/')[2]);
    }
    if (weights.size !== 3)
      return null;
    const hardware = data.hardware;
    return {
      hardware: {
        cuda: hardware?.cuda === true, mps: hardware?.mps === true,
        gpu: typeof hardware?.gpu === "string" ? hardware.gpu.slice(0, 160) : null,
        vramBytes: Number.isSafeInteger(hardware?.vramBytes) ? hardware.vramBytes : null
      }
    };
  }
  catch {
    return null;
  }
}
