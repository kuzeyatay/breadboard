import fs from "node:fs";
import path from "node:path";
import { getSkillsCatalogStore } from "../src/lib/openharness/skills-catalog-store.ts";
import { synchronizeSkillsCatalog } from "../src/lib/openharness/skills-catalog-sync.ts";

const localEnvPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(localEnvPath)) process.loadEnvFile(localEnvPath);

const store = getSkillsCatalogStore();

try {
  const sync = await synchronizeSkillsCatalog({ store, force: true });
  process.stdout.write(`${JSON.stringify({ sync, status: store.status() }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "skills.sh synchronization failed"}\n`);
  process.exitCode = 1;
}
