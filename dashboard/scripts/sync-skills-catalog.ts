import fs from "node:fs";
import path from "node:path";
import { getSkillsCatalogStore } from "../src/lib/hermes/skills-catalog-store.ts";
import { synchronizeSkillsCatalog } from "../src/lib/hermes/skills-catalog-sync.ts";

const localEnvPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(localEnvPath)) process.loadEnvFile(localEnvPath);

const store = getSkillsCatalogStore();

try {
  const sync = await synchronizeSkillsCatalog({ store, force: true, includeLocalSources: true });
  process.stdout.write(`${JSON.stringify({ sync, status: store.status() }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Catalog proxy synchronization failed"}\n`);
  process.exitCode = 1;
}
