import "server-only";

import {
  configuredStaleMs,
  getSkillsCatalogStore,
} from "./lib/openharness/skills-catalog-store.ts";
import { synchronizeSkillsCatalog } from "./lib/openharness/skills-catalog-sync.ts";

const globalState = globalThis as typeof globalThis & {
  __breadboardSkillsCatalogScheduler?: ReturnType<typeof setInterval>;
};

if (!globalState.__breadboardSkillsCatalogScheduler) {
  const refreshIfStale = async () => {
    const store = getSkillsCatalogStore();
    if (!store.status().stale) return;
    await synchronizeSkillsCatalog({ store }).catch(() => {
      // The failed run is stored durably and the last-known-good snapshot stays active.
    });
  };
  setTimeout(() => void refreshIfStale(), 0);
  const timer = setInterval(() => void refreshIfStale(), configuredStaleMs());
  timer.unref();
  globalState.__breadboardSkillsCatalogScheduler = timer;
}
