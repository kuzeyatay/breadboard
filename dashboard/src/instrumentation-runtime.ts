import "server-only";

import { startRuntimeMemorySampling } from "./lib/runtime-memory.ts";

// Next owns only its bounded memory sampler. Recurring work and messaging
// gateways are registered with the native Runtime V2 scheduler/service engine;
// instrumentation must never create a background process or timer for them.
startRuntimeMemorySampling();
// Recover persisted teams and cross-chat deliveries through the authenticated
// route boundary. Importing their dispatch graph here makes instrumentation
// trace specialist workspaces and user data into the standalone package.
// The handoff is finite; Runtime V2 retains process and cancellation ownership.
void Promise.all([import("./lib/db.ts"), import("./lib/conversations/coordination-recovery.ts")]).then(async ([{ default: db }, { recoverPendingChatMessages }]) => {
  await recoverPendingChatMessages(db);
}).catch(() => { /* Durable outboxes are also recovered on the next tool read. */ });

// One pass, no timer: parse the gardens opened last, in slices, so their first
// open after a restart finds the knowledge graph ready. Each note's text comes
// from the garden's cache file (note-text-cache.ts), so this no longer reads
// every note from disk first: that pre-read cost about 10 ms a file, a minute
// and a half for three large gardens, during the busiest part of a launch.
// Read-only: the open itself still runs the source migration.
void Promise.all([import("./lib/db.ts"), import("./lib/knowledge.ts")]).then(async ([{ default: db }, { scanClusterKnowledgeCooperatively }]) => {
  const contentPath = process.env.QUARTZ_CONTENT_PATH;
  if (!contentPath) return;
  const recent = db.prepare("SELECT slug FROM clusters WHERE last_viewed_at IS NOT NULL ORDER BY last_viewed_at DESC LIMIT 3").all() as Array<{ slug: string }>;
  // One at a time, so the parsing never competes with itself.
  // Recordings of the gardens used last may sit on a sleeping external drive:
  // start it turning now rather than when the first video is clicked.
  void import("./lib/media-drive-wake.ts").then(({ wakeGardenMediaDrive }) => {
    const owners = db.prepare("SELECT id, user_id FROM clusters WHERE last_viewed_at IS NOT NULL ORDER BY last_viewed_at DESC LIMIT 3").all() as Array<{ id: number; user_id: number }>;
    for (const owner of owners) wakeGardenMediaDrive(owner.id, owner.user_id);
  }).catch(() => undefined);
  for (const { slug } of recent) await scanClusterKnowledgeCooperatively(contentPath, slug, { migrateSources: false }).catch(() => undefined);
}).catch(() => { /* Best effort: the first scan simply reads a cold disk. */ });

// One-time handoff of durable physical jobs to their native supervisor owner.
// No printer timer or process is owned by Next or a mounted renderer.
void import("./lib/bambu/server.ts").then(async ({ bambuService }) => {
  bambuService().recoverInspections();
  const { restoreBambuRuntime } = await import("./lib/bambu/runtime-client.ts");
  await restoreBambuRuntime(bambuService().store);
}).catch(() => { /* Jobs remain durable and visibly stale if the native service is unavailable. */ });
