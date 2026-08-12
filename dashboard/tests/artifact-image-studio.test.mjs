import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function source(relativePath) {
  return fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("artifact pages keep image editing without a standalone new-image button", () => {
  const panel = source("../src/app/components/hermes/artifact-panel.tsx");
  const studio = source("../src/app/components/hermes/artifact-image-studio.tsx");
  const viewer = source("../src/app/components/hermes/artifact-viewer.tsx");
  const inline = source("../src/app/components/hermes/inline-artifact-cards.tsx");

  assert.doesNotMatch(panel, />\s*New image\s*</);
  assert.match(studio, />Generate</);
  assert.match(studio, />Upload</);
  assert.match(studio, />AI edit</);
  assert.match(studio, />Adjust</);
  assert.match(viewer, />\s*Edit image\s*</);
  assert.match(viewer, /sourceHermesTool === "socials_manager_draft"/);
  assert.match(viewer, />\s*Create image\s*</);
  assert.match(studio, /sourceArtifactId/);
  assert.match(studio, /promptArtifact/);
  assert.match(studio, /Post copy:/);
  assert.match(inline, /onCreateImage=/);
  assert.match(inline, /<ArtifactImageStudio/);
  assert.match(studio, /Save as new artifact/);
});

test("Hermes generates verified image artifacts and renders the full image above its menu", () => {
  const route = source("../src/app/api/hermes/tools/artifacts/route.ts");
  const scopes = source("../src/lib/hermes/tool-scopes.ts");
  const adapter = source("../src/lib/agent-runtime/adapters/hermes.ts");
  const configTool = source("../../hermes-config/tool/artifact.ts");
  const pythonTool = source("../../hermes-agent/plugins/breadboard/__init__.py");
  const prompt = source("../../hermes-config/system/main-assistant.md");
  const inline = source("../src/app/components/hermes/inline-artifact-cards.tsx");
  const database = source("../src/lib/db.ts");

  assert.match(scopes, /"artifact_image_generate"/);
  assert.match(adapter, /"artifact_image_generate"/);
  assert.match(configTool, /export const image_generate = tool/);
  assert.match(configTool, /"artifact_image_generate"/);
  assert.match(pythonTool, /"artifact_image_generate"/);
  assert.match(pythonTool, /_IMAGE_GENERATION_REQUEST_TIMEOUT_SECONDS = 8 \* 60/);
  assert.match(
    pythonTool,
    /tool_name == "artifact_image_generate"[\s\S]*?_DEFAULT_REQUEST_TIMEOUT_SECONDS/,
  );
  assert.match(route, /generateArtifactImage/);
  assert.match(route, /sourceTool: "artifact_image_generate"/);
  assert.match(route, /generationVerified: true/);
  assert.match(route, /verified: artifact\.status === "ready"/);
  assert.match(prompt, /do not claim image generation is disabled/i);
  assert.match(inline, /<InlineImageArtifact/);
  assert.match(inline, /className="block h-auto w-full object-contain"/);
  assert.match(inline, /Artifact actions for/);
  assert.ok(
    inline.indexOf("<img") < inline.indexOf("Artifact actions for"),
    "the artifact menu should sit below the complete generated image",
  );
  assert.match(database, /source_\$\{legacyPrefix\}_tool/);
  assert.match(database, /"source_hermes_tool"/);
  assert.match(database, /ALTER TABLE hermes_artifacts RENAME COLUMN/);
});

test("the image route keeps credentials server-side and publishes verified child artifacts", () => {
  const route = source("../src/app/api/hermes/artifacts/images/route.ts");
  const service = source("../src/lib/hermes/artifact-image-service.ts");
  const studio = source("../src/app/components/hermes/artifact-image-studio.tsx");

  assert.match(route, /requireUserId\(\)/);
  assert.match(route, /resolveChatmockBaseUrl\(request\)\.baseURL/);
  assert.match(route, /getArtifactForUser/);
  assert.match(route, /parentArtifactId: source\?\.id \?\? parent\?\.id \?\? null/);
  assert.match(route, /requireArtifactSource/);
  assert.match(service, /type: "image_generation"/);
  assert.match(service, /createImportedArtifact/);
  assert.match(service, /sourceHermesTool: input\.sourceTool/);
  assert.doesNotMatch(studio, /OPENAI_API_KEY|Authorization|apiKey/);
});
