// Direct local launcher for an entirely fresh, auto-confirmed Learn run.
//
// It uses the current confirmed source selection, re-plans against the live
// evidence, then keeps the same fenced lease through map confirmation and
// generation. This is the normal non-interactive continuation of Learn's
// existing plan -> confirm -> generate workflow.
import path from "node:path";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
const dashboard = import.meta.dirname;
loadEnvConfig(dashboard, true);
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "local";

const [gardenId, primarySourceId, syllabusSourceId] = process.argv.slice(2);
if (!gardenId || !primarySourceId || !syllabusSourceId) {
  throw new Error(
    "usage: tmp-learn-plan-generate-runner.mjs <gardenSlug> <primarySourceSlug> <studyGuideSlug>",
  );
}

const { default: db } = await import("@/lib/db");
const { getLearnStatusSnapshot, runLearnPipeline } = await import("@/lib/learn");
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
  new Request(`http://127.0.0.1:3000/api/gardens/${gardenId}/learn/plan`),
);
const model = selectedModelForUser(userId);
const client = createChatmockClient(baseURL);

console.log(
  JSON.stringify({
    event: "fresh-auto-confirmed-learn-launch",
    at: new Date().toISOString(),
    gardenId: cluster.slug,
    primarySourceId,
    syllabusSourceId,
    userId,
    model,
    baseURL,
    contentPath: path.resolve(dashboard, contentPath),
  }),
);

// A direct CLI call has no HTTP request handle to keep Node alive while a
// model request is pending. Keep one harmless referenced handle only for the
// lifecycle of the ordinary plan -> confirm -> generation call.
const lifecycleKeepalive = setInterval(() => {}, 60_000);
try {
  const result = await runLearnPipeline({
    gardenId: cluster.slug,
    userId,
    mode: "plan",
    client,
    model,
    contentPath,
    includedSourceIds: [primarySourceId],
    syllabusSourceId,
    sourceOnly: true,
    includeSourceSnapshots: false,
    autoConfirmTopicMap: true,
  });
  console.log(
    JSON.stringify({
      event: "fresh-auto-confirmed-learn-finished",
      at: new Date().toISOString(),
      result,
    }),
  );
} finally {
  clearInterval(lifecycleKeepalive);
}
