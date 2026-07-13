import path from 'node:path';
import { migrateGardenSemantics } from '../dashboard/src/lib/garden-semantics.ts';

const gardenPath = process.argv[2];
if (!gardenPath) {
  console.error('Usage: node --experimental-strip-types scripts/migrate-garden-semantics.ts <garden-path>');
  process.exitCode = 1;
} else {
  const gardenDir = path.resolve(gardenPath);
  const report = migrateGardenSemantics(gardenDir, { gardenId: path.basename(gardenDir) });
  console.log(JSON.stringify(report, null, 2));
  if (report.ambiguousMappings.length > 0 || report.diagnostics.some((item) => /conflict/i.test(item))) {
    process.exitCode = 2;
  }
}
