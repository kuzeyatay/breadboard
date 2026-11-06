import "server-only";

import { startRuntimeMemorySampling } from "./lib/runtime-memory.ts";

// Next owns only its bounded memory sampler. Recurring work and messaging
// gateways are registered with the native Runtime V2 scheduler/service engine;
// instrumentation must never create a background process or timer for them.
startRuntimeMemorySampling();

// One pass, no timer: warm the OS file cache for the gardens opened last, then
// parse the most recent one in slices so its first open after a restart finds
// the knowledge graph cached instead of parsing every note. Read-only: the
// open itself still runs the source migration.
void Promise.all([import("./lib/db.ts"), import("./lib/garden-file-warmup.ts"), import("./lib/knowledge.ts")]).then(async ([{ default: db }, { warmGardenFiles }, { scanClusterKnowledgeCooperatively }]) => {
  const contentPath = process.env.QUARTZ_CONTENT_PATH;
  if (!contentPath) return;
  const recent = db.prepare("SELECT slug FROM clusters WHERE last_viewed_at IS NOT NULL ORDER BY last_viewed_at DESC LIMIT 3").all() as Array<{ slug: string }>;
  await warmGardenFiles(contentPath, recent.map(row => row.slug));
  if (recent[0]) await scanClusterKnowledgeCooperatively(contentPath, recent[0].slug, { migrateSources: false });
}).catch(() => { /* Best effort: the first scan simply reads a cold disk. */ });

// One-time handoff of durable physical jobs to their native supervisor owner.
// No printer timer or process is owned by Next or a mounted renderer.
void import("./lib/bambu/server.ts").then(async ({ bambuService }) => {
  bambuService().recoverInspections();
  const { restoreBambuRuntime } = await import("./lib/bambu/runtime-client.ts");
  await restoreBambuRuntime(bambuService().store);
}).catch(() => { /* Jobs remain durable and visibly stale if the native service is unavailable. */ });
