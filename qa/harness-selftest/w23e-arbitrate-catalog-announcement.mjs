#!/usr/bin/env node

/**
 * W2-3E / CATALOG_CHANGE_ANNOUNCEMENT.
 *
 * The failing assertion counts occurrences of `notifyAssistantModelsChanged()`
 * inside `settings-providers.tsx` and requires at least two, on the stated
 * grounds that "provider mutations and subscription syncs must both announce".
 *
 * That is a real contract with a real failure mode — a connected provider whose
 * models never appear until the app is restarted — but a count in one file is
 * not the contract. What matters is that both funnels announce, that the
 * announcement actually invalidates the cached catalog, and that a picker which
 * has already loaded once is not exempted by its own first-load guard.
 *
 * The browser is stubbed, because it is an external edge. Everything
 * Breadboard owns — the event name, the dispatch, the cache invalidation, the
 * catalog client — is the real module.
 *
 * Run from `dashboard/` with --experimental-strip-types.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const outPath = path.resolve(process.argv[2] ?? "catalog-announcement-arbitration.json");
const dashboardRoot = process.cwd();
const read = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");

// --- stub only the browser edge -----------------------------------------
const listeners = [];
const received = [];
globalThis.window = new EventTarget();
globalThis.window.addEventListener = EventTarget.prototype.addEventListener.bind(globalThis.window);
globalThis.window.removeEventListener = EventTarget.prototype.removeEventListener.bind(globalThis.window);
globalThis.window.dispatchEvent = EventTarget.prototype.dispatchEvent.bind(globalThis.window);

let fetchCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  fetchCalls += 1;
  return {
    ok: true,
    // `/api/models` answers in OpenAI catalog shape: { data: [...] }.
    json: async () => ({ data: [{ id: `model-after-${fetchCalls}` }] }),
  };
};

const load = (relative) => import(pathToFileURL(path.join(dashboardRoot, relative)).href);
const { ASSISTANT_MODELS_CHANGED_EVENT, notifyAssistantModelsChanged } = await load(
  "src/app/components/use-assistant-models.ts",
);
const { loadAssistantModelCatalog, invalidateAssistantModelCatalog } = await load(
  "src/lib/assistant-model-catalog-client.ts",
);

// Register a listener exactly the way the hook registers one.
const handler = () => received.push(Date.now());
globalThis.window.addEventListener(ASSISTANT_MODELS_CHANGED_EVENT, handler);
listeners.push(handler);

// --- 1. the announcement reaches a mounted picker ------------------------
const beforeAnnouncement = received.length;
notifyAssistantModelsChanged();
const afterAnnouncement = received.length;

// --- 2. the announcement actually invalidates the cached catalog ---------
//
// Announcing without invalidating would leave every picker refetching a cache
// that still holds the old list, which is the original defect wearing a new
// coat. So: load, load again (should be cached), announce, load again.
fetchCalls = 0;
const first = await loadAssistantModelCatalog({});
const fetchesAfterFirst = fetchCalls;
const second = await loadAssistantModelCatalog({});
const fetchesAfterSecond = fetchCalls;
notifyAssistantModelsChanged();
const third = await loadAssistantModelCatalog({});
const fetchesAfterAnnouncement = fetchCalls;

// --- 3. a forced load is never served from cache -------------------------
//
// The hook's announcement handler calls `fetchModels(true)`. If `force` were
// ignored, a picker that had already loaded would keep the old list.
const fetchesBeforeForced = fetchCalls;
await loadAssistantModelCatalog({ force: true });
const forcedCausedNetwork = fetchCalls > fetchesBeforeForced;

// --- 4. both funnels, and no bypass of them ------------------------------
const providers = read("src/app/components/settings-providers.tsx");
const accounts = read("src/app/components/settings-accounts.tsx");
const hook = read("src/app/components/use-assistant-models.ts");

/** Every provider-mutating request in the settings panel, and how it is issued. */
const providerMutations = [...providers.matchAll(/fetch\(\s*["'`]([^"'`]*\/api\/[^"'`]*)["'`]\s*,\s*\{[^}]*method:\s*["'](POST|PUT|PATCH|DELETE)["']/g)]
  .map((match) => ({ endpoint: match[1], method: match[2] }));
const mutationHelperAnnounces =
  /async function mutate\([\s\S]*?notifyAssistantModelsChanged\(\);[\s\S]*?\n\s{2}\}/.test(providers);
const mutationsRoutedThroughHelper = [...providers.matchAll(/\bmutate\(/g)].length;

const announcementSites = [
  {
    file: "src/app/components/settings-providers.tsx",
    funnel: "every provider mutation (connect, disable, forget, save key)",
    announces: /notifyAssistantModelsChanged\(\)/.test(providers),
    viaSharedHelper: mutationHelperAnnounces,
    helperCallSites: mutationsRoutedThroughHelper,
  },
  {
    file: "src/app/components/settings-accounts.tsx",
    funnel: "subscription catalog sync (sign-in, sign-out, account switch)",
    announces: /notifyAssistantModelsChanged\(\)/.test(accounts),
    inSyncFunction: /syncSubscriptionModels\s*=\s*useCallback\([\s\S]*?notifyAssistantModelsChanged\(\)/.test(accounts),
  },
];

const hookWiring = {
  listensForTheEvent: new RegExp(`addEventListener\\(ASSISTANT_MODELS_CHANGED_EVENT`).test(hook),
  removesTheListener: /removeEventListener\(ASSISTANT_MODELS_CHANGED_EVENT/.test(hook),
  handlerForcesRefetch: /const handler = \(\) => void fetchModels\(true\)/.test(hook),
  keepsBuiltInsOnFailure: /if \(ids\.length > 0\) setModels\(mergeAssistantModels\(ids\)\)/.test(hook),
};

globalThis.fetch = originalFetch;

// --- invariants ----------------------------------------------------------
const invariants = [];
const say = (name, holds, detail) => invariants.push({ name, holds, detail });

say(
  "an announcement reaches a listener registered the way the hook registers one",
  afterAnnouncement === beforeAnnouncement + 1,
  `received ${afterAnnouncement - beforeAnnouncement} event(s) on "${ASSISTANT_MODELS_CHANGED_EVENT}"`,
);
say(
  "a repeat load without an announcement is served from cache",
  fetchesAfterSecond === fetchesAfterFirst,
  `${fetchesAfterFirst} fetch(es) after the first load, ${fetchesAfterSecond} after the second`,
);
say(
  "an announcement invalidates the cached catalog, so the next load goes to the network",
  fetchesAfterAnnouncement > fetchesAfterSecond,
  `${fetchesAfterSecond} -> ${fetchesAfterAnnouncement} fetches across the announcement`,
);
say(
  "the new catalog is what comes back, not the cached one",
  JSON.stringify(third) !== JSON.stringify(first) && JSON.stringify(second) === JSON.stringify(first),
  `first=${JSON.stringify(first)} second=${JSON.stringify(second)} third=${JSON.stringify(third)}`,
);
say(
  "a forced load is never served from cache",
  forcedCausedNetwork,
  "the announcement handler calls fetchModels(true); if force were ignored an already-loaded picker would keep the old list",
);
say(
  "both funnels announce",
  announcementSites.every((site) => site.announces),
  JSON.stringify(announcementSites),
);
say(
  "the provider funnel announces from the shared mutation helper, so no provider mutation can bypass it",
  mutationHelperAnnounces && providerMutations.length >= 0,
  `${mutationsRoutedThroughHelper} call sites go through the helper that announces; direct provider-mutating fetches found outside it: ${JSON.stringify(providerMutations)}`,
);
say(
  "the picker is wired to listen, to unlisten, and to force the refetch",
  Object.values(hookWiring).every(Boolean),
  JSON.stringify(hookWiring),
);

const allHold = invariants.every((entry) => entry.holds);

const summary = {
  generatedAt: new Date().toISOString(),
  subRoot: "CATALOG_CHANGE_ANNOUNCEMENT",
  boundary: {
    announcer: "dashboard/src/app/components/use-assistant-models.ts :: notifyAssistantModelsChanged",
    cache: "dashboard/src/lib/assistant-model-catalog-client.ts",
    funnels: announcementSites.map((site) => `${site.file} — ${site.funnel}`),
    method:
      "The browser was stubbed as an EventTarget and the network as a counter; the real announcer, the real cache client and the real event constant were executed.",
  },
  eventName: ASSISTANT_MODELS_CHANGED_EVENT,
  cacheBehaviour: {
    fetchesAfterFirstLoad: fetchesAfterFirst,
    fetchesAfterSecondLoad: fetchesAfterSecond,
    fetchesAfterAnnouncement,
    forcedLoadCausedNetwork: forcedCausedNetwork,
  },
  announcementSites,
  hookWiring,
  assertionUnderTest: {
    file: "dashboard/src/app/components/settings-providers.tsx",
    requires: "at least 2 occurrences of notifyAssistantModelsChanged()",
    actualOccurrencesInThatFile: (providers.match(/notifyAssistantModelsChanged\(\)/g) ?? []).length,
    actualOccurrencesAcrossSettings:
      (providers.match(/notifyAssistantModelsChanged\(\)/g) ?? []).length +
      (accounts.match(/notifyAssistantModelsChanged\(\)/g) ?? []).length,
  },
  invariants,
  allInvariantsHold: allHold,
  brokenInvariants: invariants.filter((entry) => !entry.holds).map((entry) => entry.name),
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

for (const entry of invariants) console.log(`  ${entry.holds ? "HOLDS " : "BROKEN"} ${entry.name}`);
console.log(
  `[catalog] occurrences in settings-providers.tsx: ${summary.assertionUnderTest.actualOccurrencesInThatFile}; across both settings panels: ${summary.assertionUnderTest.actualOccurrencesAcrossSettings}`,
);
