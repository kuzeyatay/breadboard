// CLI for the deterministic garden finalizer.
//
//   node --experimental-strip-types scripts/finalize-breadboard-garden.ts <garden-dir> [slug]
//
// Runs the same finalize stage the Learn pipeline runs before publish, on an
// already-generated garden directory. Prints what changed and exits non-zero if
// a critical invariant could not be repaired.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { finalizeGardenExport } from "../dashboard/src/lib/garden-finalize.ts";

function main(): void {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: finalize-breadboard-garden.ts <garden-dir> [slug]");
    process.exit(2);
  }
  const gardenDir = path.resolve(arg);
  const gardenSlug = process.argv[3] ?? path.basename(gardenDir);
  const report = finalizeGardenExport({ gardenDir, gardenSlug });
  console.log(`=== finalize ${gardenSlug} ===`);
  console.log(`removed (${report.removed.length}):`);
  for (const item of report.removed) console.log(`  - ${item}`);
  console.log(`changed (${report.changed.length}):`);
  for (const item of [...new Set(report.changed)]) console.log(`  - ${item}`);
  console.log(`notes (${report.notes.length}):`);
  for (const item of report.notes) console.log(`  - ${item}`);
  if (report.criticalProblems.length > 0) {
    console.error(`\nCRITICAL PROBLEMS (${report.criticalProblems.length}):`);
    for (const item of report.criticalProblems) console.error(`  - ${item}`);
    process.exit(1);
  }
  console.log("\nfinalize OK");
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main();
}
