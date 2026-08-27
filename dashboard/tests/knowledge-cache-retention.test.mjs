import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const knowledge = fs.readFileSync(
  new URL("../src/lib/knowledge.ts", import.meta.url),
  "utf8",
);

test("cluster knowledge graphs use a small expiring LRU instead of process-lifetime retention", () => {
  assert.match(knowledge, /CLUSTER_KNOWLEDGE_CACHE_MAX_ENTRIES = 12/);
  assert.match(knowledge, /CLUSTER_KNOWLEDGE_CACHE_TTL_MS = 5 \* 60 \* 1000/);
  assert.match(
    knowledge,
    /while \(clusterKnowledgeCache\.size > CLUSTER_KNOWLEDGE_CACHE_MAX_ENTRIES\)/,
  );
  assert.match(knowledge, /if \(current\) clearTimeout\(current\.timer\);/);
  assert.match(knowledge, /dropClusterKnowledge\(cacheKey\);/);
  assert.match(knowledge, /current\?\.generation === generation/);
  assert.match(knowledge, /timer\.unref\?\.\(\);/);
  assert.doesNotMatch(knowledge, /clusterKnowledgeCache\.size > 128/);
});
