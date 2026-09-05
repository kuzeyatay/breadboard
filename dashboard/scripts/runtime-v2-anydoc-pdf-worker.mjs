import fs from "node:fs";
import path from "node:path";

import { convertWithAnydoc } from "../src/lib/anydoc/convert.ts";

const MAX_PDF_BYTES = 2 * 1024 * 1024 * 1024;

function fail(message) {
  throw new Error(message);
}

async function main() {
  const [sourceFilePath] = process.argv.slice(2);
  if (!sourceFilePath || !path.isAbsolute(sourceFilePath)) {
    fail("The isolated anydoc converter requires one absolute PDF path.");
  }
  const metadata = fs.lstatSync(sourceFilePath, { throwIfNoEntry: false });
  if (
    !metadata?.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size <= 0 ||
    metadata.size > MAX_PDF_BYTES ||
    path.extname(sourceFilePath).toLowerCase() !== ".pdf"
  ) {
    fail("The isolated anydoc converter received an invalid PDF.");
  }

  const conversion = await convertWithAnydoc({
    bytes: fs.readFileSync(sourceFilePath),
    ext: "pdf",
  });
  process.stdout.write(JSON.stringify(conversion));
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `[runtime-v2-anydoc-pdf] ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
