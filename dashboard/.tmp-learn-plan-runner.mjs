import { createRequire, register } from "node:module";

const dashboardRoot = "C:/Users/20252082/breadboard/dashboard";
const require = createRequire(`${dashboardRoot}/package.json`);
const srcRoot = `file://${dashboardRoot}/src/`;
const loader = `export async function resolve(specifier, context, nextResolve) {
  let mapped = specifier;
  if (specifier.startsWith("@/")) mapped = new URL(specifier.slice(2), "${srcRoot}").href;
  else if (specifier.startsWith("./") || specifier.startsWith("../")) mapped = new URL(specifier, context.parentURL).href;
  if (mapped.startsWith("file:") && !/\\.[a-z0-9]+$/i.test(new URL(mapped).pathname)) mapped += ".ts";
  return nextResolve(mapped, context);
}`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, import.meta.url);

const [
  { runLearnPipeline },
  { createChatmockClient },
  { resolveChatmockBaseUrl },
  { selectedModelForUser },
] = await Promise.all([
  import("@/lib/learn.ts"),
  import("@/lib/knowledge.ts"),
  import("@/lib/chatmock-server.ts"),
  import("@/lib/selected-model.ts"),
]);

const Database = require("better-sqlite3");
const db = new Database(`${dashboardRoot}/db/brain.db`, { readonly: true });
const cluster = db.prepare("SELECT slug, user_id FROM clusters WHERE slug = ?").get("electromagnetism-1");
db.close();
if (!cluster || !Number.isInteger(cluster.user_id)) {
  throw new Error("Garden owner was not found.");
}

const model = selectedModelForUser(cluster.user_id);
const { baseURL } = resolveChatmockBaseUrl(new Request("http://127.0.0.1:3000"));
const client = createChatmockClient(baseURL);
console.log(JSON.stringify({ event: "learn_direct_plan_started", gardenId: cluster.slug, model, baseURL }));

const result = await runLearnPipeline({
  gardenId: cluster.slug,
  userId: cluster.user_id,
  mode: "plan",
  includedSourceIds: ["engineering-electromagnetics-9th-ed-9nbsped-compress"],
  syllabusSourceId: "studyguide-5epf0",
  sourceOnly: true,
  includeSourceSnapshots: false,
  autoConfirmTopicMap: false,
  client,
  model,
  contentPath: "C:/Users/20252082/breadboard/quartz/content",
});

console.log(JSON.stringify({ event: "learn_direct_plan_finished", result }, null, 2));
