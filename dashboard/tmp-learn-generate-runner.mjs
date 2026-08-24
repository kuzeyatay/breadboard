// Direct local launcher for a normal confirmed Learn generation.
//
// It mirrors POST /api/gardens/[gardenId]/learn/generate, including its narrow
// failed-initial-generation resume gate. It deliberately never plans or
// confirms a map, so the already-approved learning-map decision is preserved.
import path from "node:path";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
const dashboard = import.meta.dirname;
loadEnvConfig(dashboard, true);
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "local";

const [gardenId, learningMapId] = process.argv.slice(2);
if (!gardenId || !learningMapId) {
  throw new Error(
    "usage: tmp-learn-generate-runner.mjs <gardenSlug> <confirmedLearningMapId>",
  );
}

const { default: db } = await import("@/lib/db");
const { getLearnStatusSnapshot, runTextbookGeneration } = await import("@/lib/learn");
const { createChatmockClient } = await import("@/lib/knowledge");
const { selectedModelForUser } = await import("@/lib/selected-model");
const { resolveChatmockBaseUrl } = await import("@/lib/chatmock-server");

const contentPath = process.env.QUARTZ_CONTENT_PATH;
if (!contentPath) throw new Error("QUARTZ_CONTENT_PATH not configured");

const cluster = db.prepare("SELECT * FROM clusters WHERE slug = ?").get(gardenId);
if (!cluster) throw new Error(`cluster ${gardenId} not found`);
const userId = cluster.user_id;
const status = getLearnStatusSnapshot({ gardenId: cluster.slug, contentPath });
const mayResumeFailedInitialGeneration =
  !status.latestTextbookVersionId &&
  status.hasTextbook &&
  status.job?.mode === "generate" &&
  status.job.status === "failed";

if ((status.latestTextbookVersionId || status.hasTextbook) && !mayResumeFailedInitialGeneration) {
  throw new Error(
    "This garden already has learner content. Use Repair issues, or explicitly confirm Rebuild entire garden to recreate it.",
  );
}
if (status.confirmedLearningMapId !== learningMapId) {
  throw new Error(
    "Generate requires the current confirmed Learning Map and matching source selection.",
  );
}
const expectedModel = status.confirmedLearningMapModel?.trim();
if (!expectedModel) {
  throw new Error(
    "The confirmed Learning Map is no longer bound to its exact planning model. Run Learn planning again before generating lessons.",
  );
}
const model = selectedModelForUser(userId);
if (model !== expectedModel) {
  throw new Error(
    "The selected Learn model does not match the model that planned this confirmed Learning Map. Restore the planning model, or run Learn planning again with the current selection.",
  );
}

const { baseURL } = resolveChatmockBaseUrl(
  new Request(`http://127.0.0.1:3000/api/gardens/${gardenId}/learn/generate`),
);
const client = createChatmockClient(baseURL);

console.log(
  JSON.stringify({
    event: "confirmed-generation-resume-launch",
    at: new Date().toISOString(),
    gardenId: cluster.slug,
    learningMapId,
    resumedFailedInitialGeneration: mayResumeFailedInitialGeneration,
    userId,
    model,
    baseURL,
    contentPath: path.resolve(dashboard, contentPath),
  }),
);

// A direct CLI call has no HTTP request handle to keep Node alive while a
// long model request is pending. Keep one harmless referenced handle only for
// the lifecycle of the ordinary generation call.
const lifecycleKeepalive = setInterval(() => {}, 60_000);
try {
  const result = await runTextbookGeneration({
    gardenId: cluster.slug,
    userId,
    client,
    model,
    contentPath,
    confirmedLearningMapId: learningMapId,
    sourceOnly: true,
    includeSourceSnapshots: false,
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
