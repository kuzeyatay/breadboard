// Direct local launcher for normal Learn confirmation and generation.
//
// It mirrors POST /api/gardens/[gardenId]/learn/confirm: it confirms one
// audited proposed map through confirmLearningMap, then invokes the ordinary
// runTextbookGeneration entry point. Auth is the only route concern omitted;
// no planning, source, model, or generation behavior is bypassed.
import path from "node:path";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
const dashboard = import.meta.dirname;
loadEnvConfig(dashboard, true);
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "local";

const [gardenId, learningMapId] = process.argv.slice(2);
if (!gardenId || !learningMapId) {
  throw new Error(
    "usage: tmp-learn-confirm-runner.mjs <gardenSlug> <auditedLearningMapId>",
  );
}

const { default: db } = await import("@/lib/db");
const {
  confirmLearningMap,
  getLearnStatusSnapshot,
  runTextbookGeneration,
} = await import("@/lib/learn");
const { createChatmockClient } = await import("@/lib/knowledge");
const { selectedModelForUser } = await import("@/lib/selected-model");
const { resolveChatmockBaseUrl } = await import("@/lib/chatmock-server");

const contentPath = process.env.QUARTZ_CONTENT_PATH;
if (!contentPath) throw new Error("QUARTZ_CONTENT_PATH not configured");
const cluster = db.prepare("SELECT * FROM clusters WHERE slug = ?").get(gardenId);
if (!cluster) throw new Error(`cluster ${gardenId} not found`);
const userId = cluster.user_id;
const status = getLearnStatusSnapshot({ gardenId: cluster.slug, contentPath });
if (status.latestTextbookVersionId || status.hasTextbook) {
  throw new Error(
    "This garden already has learner content. Use Repair issues, or explicitly confirm Rebuild entire garden to recreate it.",
  );
}

const { baseURL } = resolveChatmockBaseUrl(
  new Request(`http://127.0.0.1:3000/api/gardens/${gardenId}/learn/confirm`),
);
const model = selectedModelForUser(userId);
const client = createChatmockClient(baseURL);
const learningMap = confirmLearningMap({
  gardenId: cluster.slug,
  learningMapId,
  contentPath,
});

console.log(
  JSON.stringify({
    event: "confirmed-generation-launch",
    at: new Date().toISOString(),
    gardenId: cluster.slug,
    learningMapId: learningMap.id,
    userId,
    model,
    baseURL,
    contentPath: path.resolve(dashboard, contentPath),
  }),
);

// See the plan runner: long direct CLI calls need a referenced handle while
// their model request is pending, because the normal Learn lease heartbeat is
// intentionally unref'ed. This changes only the launcher lifecycle.
const lifecycleKeepalive = setInterval(() => {}, 60_000);
try {
  const result = await runTextbookGeneration({
    gardenId: cluster.slug,
    userId,
    client,
    model,
    contentPath,
    confirmedLearningMapId: learningMap.id,
    sourceOnly: true,
    includeSourceSnapshots: false,
    autoConfirmTopicMap: false,
  });

  console.log(
    JSON.stringify({
      event: "generation-finished",
      at: new Date().toISOString(),
      result,
    }),
  );
} finally {
  clearInterval(lifecycleKeepalive);
}
