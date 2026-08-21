// Direct local launcher for the Learn plan stage.
//
// It mirrors POST /api/gardens/[gardenId]/learn/plan exactly: same entry point,
// same status pre-check, same client, same dynamically resolved selected model,
// same flags. It adds no pipeline behaviour, no model choice, and no bypass of
// any pipeline validation. Auth is the only thing it replaces, because the local
// dev server rejects minted owner sessions.
import path from "node:path";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

const dashboard = import.meta.dirname;
loadEnvConfig(dashboard, true);
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "local";

const [gardenId, syllabusArg, sourcesArg] = process.argv.slice(2);
if (!gardenId) {
  throw new Error(
    "usage: tmp-learn-plan-runner.mjs <gardenSlug> [syllabusSourceId] [sourceId,sourceId,...]",
  );
}

const { default: db } = await import("@/lib/db");
const { getLearnStatusSnapshot, runLearnPipeline } = await import("@/lib/learn");
const { createChatmockClient } = await import("@/lib/knowledge");
const { selectedModelForUser } = await import("@/lib/selected-model");
const { resolveChatmockBaseUrl } = await import("@/lib/chatmock-server");

const contentPath = process.env.QUARTZ_CONTENT_PATH;
if (!contentPath) throw new Error("QUARTZ_CONTENT_PATH not configured");

const cluster = db
  .prepare("SELECT * FROM clusters WHERE slug = ?")
  .get(gardenId);
if (!cluster) throw new Error(`cluster ${gardenId} not found`);
const userId = cluster.user_id;

const status = getLearnStatusSnapshot({ gardenId: cluster.slug, contentPath });
if (status.latestTextbookVersionId || status.hasTextbook) {
  throw new Error(
    "This garden already has learner content. Use Repair issues, or explicitly confirm Rebuild entire garden to recreate it.",
  );
}

// No chatmock-target cookie is set locally, so this resolves the same default
// the route resolves for an ordinary browser request.
const { baseURL } = resolveChatmockBaseUrl(
  new Request(`http://127.0.0.1:3000/api/gardens/${gardenId}/learn/plan`),
);
const model = selectedModelForUser(userId);
const client = createChatmockClient(baseURL);

console.log(
  JSON.stringify({
    event: "launch",
    at: new Date().toISOString(),
    gardenId: cluster.slug,
    userId,
    model,
    baseURL,
    contentPath: path.resolve(dashboard, contentPath),
  }),
);

// A headless direct runner has no HTTP server/request handle to keep Node's
// event loop alive while a long council request is pending. Keep one harmless
// referenced handle for the lifetime of the ordinary pipeline call; the Learn
// lease's own timer is deliberately unref'ed and must not be used for that.
const lifecycleKeepalive = setInterval(() => {}, 60_000);
try {
  const result = await runLearnPipeline({
    gardenId: cluster.slug,
    userId,
    mode: "plan",
    client,
    contentPath,
    includedSourceIds: sourcesArg
      ? sourcesArg.split(",").map((id) => id.trim()).filter(Boolean)
      : undefined,
    syllabusSourceId: syllabusArg?.trim() || undefined,
    model,
    sourceOnly: true,
    includeSourceSnapshots: false,
    autoConfirmTopicMap: false,
  });

  console.log(JSON.stringify({ event: "plan-finished", at: new Date().toISOString(), result }));
} finally {
  clearInterval(lifecycleKeepalive);
}
