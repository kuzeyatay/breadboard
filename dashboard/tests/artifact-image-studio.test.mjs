import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function source(relativePath) {
  return fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("artifact pages edit images on the Design page and create them in the studio", () => {
  const panel = source("../src/app/components/hermes/artifact-panel.tsx");
  const studio = source("../src/app/components/hermes/artifact-image-studio.tsx");
  const viewer = source("../src/app/components/hermes/artifact-viewer.tsx");
  const inline = source("../src/app/components/hermes/inline-artifact-cards.tsx");

  assert.doesNotMatch(panel, />\s*New image\s*</);
  assert.match(studio, />Generate</);
  assert.match(studio, />Upload</);
  assert.doesNotMatch(studio, />AI edit<|>Adjust<|Save as new artifact/);
  assert.match(viewer, />\s*Edit image\s*</);
  assert.match(viewer, /sourceHermesTool === "socials_manager_draft"/);
  assert.match(viewer, />\s*Create image\s*</);
  assert.match(inline, /onEditImage=\{openImageInDesign\}/);
  assert.match(panel, /openImageInDesign\(artifact\)/);
  assert.match(studio, /promptArtifact/);
  assert.match(studio, /Post copy:/);
  assert.match(inline, /onCreateImage=/);
  assert.match(inline, /<ArtifactImageStudio/);
});

test("Design opens chat images in Doory inside Spaces, with Bread in the corner, and saves back as a child artifact", () => {
  const open = source("../src/app/design/open-in-design.ts");
  const client = source("../src/app/design/design-client.tsx");
  const route = source("../src/app/api/doory/route.ts");
  const mcp = source("../src/app/api/hermes/tools/mcp/route.ts");
  const registry = source("../src/lib/hermes/unified-tool-registry.ts");
  const launcher = source("../src/app/new-tab/combined-home-launcher.tsx");
  assert.match(open, /\/spaces\/edit\?/);
  assert.match(open, /app: "design"/);
  // No assistant of its own: the Spaces shell carries the one bottom-right assistant.
  assert.match(client, /<SpacesShell /);
  assert.doesNotMatch(client, /DesignAssistant|DashboardAgentTerminal/);
  assert.match(client, /action: "import"/);
  assert.match(client, /action: "import-garden"/);
  assert.match(client, /Save to chat/);
  assert.match(route, /parentArtifactId: artifact\.id/);
  assert.match(mcp, /slug === DOORY_CONNECTION/);
  assert.match(registry, /DOORY_CONNECTION/);
  assert.doesNotMatch(launcher, /href="\/design"/);
  // The framed editor wears Breadboard's theme and font, without Doory's name, bunny or account menu.
  const bridge = source("../../doory/breadboard/bridge.js");
  assert.match(client, /source: "breadboard-theme"/);
  assert.match(bridge, /'--color-bg': t\.bg/);
  assert.match(bridge, /Source Sans 3/);
  assert.match(bridge, /replace\(NAME, 'Design'\)/);
  assert.match(bridge, /\[aria-label\^="Account menu for"\]\{display:none/);
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
  const preview = source("../src/app/components/hermes/artifact-image-preview.tsx");

  assert.match(scopes, /"artifact_image_generate"/);
  assert.match(adapter, /"artifact_image_generate"/);
  assert.match(configTool, /export const image_generate = tool/);
  assert.match(configTool, /"artifact_image_generate"/);
  assert.match(configTool, /ChatGPT is always tried first/);
  assert.match(configTool, /Google Gemini image generation/);
  assert.doesNotMatch(configTool, /fallback\.display/);
  assert.match(pythonTool, /"artifact_image_generate"/);
  assert.match(pythonTool, /_IMAGE_GENERATION_REQUEST_TIMEOUT_SECONDS = 8 \* 60/);
  assert.match(
    pythonTool,
    /tool_name == "artifact_image_generate"[\s\S]*?_DEFAULT_REQUEST_TIMEOUT_SECONDS/,
  );
  const fallback = source("../src/lib/hermes/image-generation-fallback.ts");
  assert.match(route, /generateImageWithProviderFallback/);
  assert.match(fallback, /generateArtifactImage/);
  assert.match(fallback, /generateGoogleImage/);
  assert.doesNotMatch(route + fallback, /readGoogleImageGenerationCredentials/);
  assert.match(fallback, /provider: "google_image_generation"/);
  assert.doesNotMatch(route, /google_image_search/);
  assert.match(fallback, /image_generation_fallback_unavailable/);
  assert.match(route, /sourceTool: "artifact_image_generate"/);
  assert.match(route, /generationVerified: true/);
  assert.match(route, /verified: artifact\.status === "ready"/);
  assert.match(prompt, /do not claim image generation is\s+disabled/i);
  assert.match(prompt, /tries ChatGPT image generation\s+first/i);
  assert.match(prompt, /Google Gemini\s+image generation/i);
  assert.match(prompt, /state both\s+provider-specific reasons/i);
  assert.match(pythonTool, /ChatGPT is always tried/i);
  assert.match(pythonTool, /Gemini image generation/i);
  assert.match(pythonTool, /google_image_generation/);
  assert.doesNotMatch(pythonTool, /fallback\.display/);
  assert.match(inline, /<InlineImageArtifact/);
  assert.match(preview, /className="block h-auto w-full object-contain"/);
  assert.match(inline, /Artifact details for/);
  const inlineImageArtifact = inline.slice(
    inline.indexOf("function InlineImageArtifact"),
    inline.indexOf("export function InlineArtifactCardsProvider"),
  );
  assert.match(inlineImageArtifact, /absolute inset-0 z-\[1\] cursor-pointer/);
  assert.match(
    inlineImageArtifact,
    /bb-neu-artifact-preview-tilted[^\n]*-rotate-3/,
  );
  assert.doesNotMatch(inlineImageArtifact, />\s*(?:Open|Close|Edit)\s*</);
  assert.doesNotMatch(inlineImageArtifact, />\s*Download\s*</);
  assert.doesNotMatch(inlineImageArtifact, /Delete artifact/);
  assert.ok(
    inline.indexOf("<ArtifactImagePreview") < inline.indexOf("Artifact details for"),
    "the artifact menu should sit below the complete generated image",
  );
  assert.match(database, /source_\$\{legacyPrefix\}_tool/);
  assert.match(database, /"source_hermes_tool"/);
  assert.match(database, /ALTER TABLE hermes_artifacts RENAME COLUMN/);
});

test("the image route keeps credentials server-side and publishes verified child artifacts", () => {
  const route = source("../src/app/api/hermes/artifacts/images/route.ts");
  const service = source("../src/lib/hermes/artifact-image-service.ts");
  const store = source("../src/lib/hermes/artifact-store.ts");
  const studio = source("../src/app/components/hermes/artifact-image-studio.tsx");

  assert.match(route, /requireUserId\(\)/);
  assert.match(route, /resolveChatmockBaseUrl\(request\)\.baseURL/);
  assert.match(route, /getArtifactForUser/);
  assert.match(route, /parentArtifactId: source\?\.id \?\? parent\?\.id \?\? null/);
  assert.match(route, /requireArtifactSource/);
  assert.match(service, /type: "image_generation"/);
  assert.match(service, /createImportedArtifact/);
  assert.match(service, /dashboardDataDir\(\), "artifact-image-staging"/);
  assert.match(service, /filePath: stagedName/);
  assert.match(service, /sourceHermesTool: input\.sourceTool/);
  assert.match(store, /externalRuntimePortableRealpath/);
  assert.match(store, /withTransientFileOpenRetry/);
  assert.doesNotMatch(studio, /OPENAI_API_KEY|Authorization|apiKey/);
});
