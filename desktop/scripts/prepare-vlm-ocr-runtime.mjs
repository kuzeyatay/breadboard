import path from "node:path";
import { fileURLToPath } from "node:url";

import { stagePinnedVlmOcrRuntime } from "./vlm-ocr-runtime-artifact.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
for (const argument of args) {
  if (argument !== "--offline") {
    throw new Error(`Unknown VLM OCR preparation argument: ${argument}`);
  }
}

await stagePinnedVlmOcrRuntime({
  targetRoot: path.join(desktopRoot, "resources", "bin", "vlm-ocr"),
  licensesRoot: path.join(desktopRoot, "build-resources", "licenses"),
  suppliedPaths: {
    llamaArchive: process.env.BREADBOARD_VLM_OCR_LLAMA_ARCHIVE,
    model: process.env.BREADBOARD_VLM_OCR_MODEL_ARTIFACT,
    projector: process.env.BREADBOARD_VLM_OCR_PROJECTOR_ARTIFACT,
    llamaLicense: process.env.BREADBOARD_VLM_OCR_LLAMA_LICENSE,
    modelLicense: process.env.BREADBOARD_VLM_OCR_MODEL_LICENSE,
  },
  offline: args.has("--offline"),
  log: (message) => console.log(`[prepare-vlm-ocr] ${message}`),
});

console.log("[prepare-vlm-ocr] exact immutable runtime assembled");
