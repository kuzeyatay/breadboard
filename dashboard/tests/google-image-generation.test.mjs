import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

import {
  clearGoogleImageGenerationCredentials,
  googleImageGenerationCredentialsStatus,
  readGoogleImageGenerationCredentials,
  storeGoogleImageGenerationCredentials,
} from "../src/lib/hermes/google-image-generation-credentials.ts";
import {
  generateGoogleImage,
  generatedImageFilename,
} from "../src/lib/hermes/google-image-generation-service.ts";

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-google-image-generation-"));

after(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

test("Google Gemini image generation sends the documented interaction and decodes its image", async () => {
  const expected = Buffer.from("verified-google-image");
  let requestBody;
  let requestHeaders;
  const generated = await generateGoogleImage({
    apiKey: "AIza-test-only-generation-key",
    prompt: "A glass greenhouse on Mars",
    fetchImpl: async (url, init) => {
      assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/interactions");
      requestHeaders = init?.headers;
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        id: "interaction-1",
        output_image: {
          mime_type: "image/png",
          data: expected.toString("base64"),
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  assert.equal(requestHeaders["x-goog-api-key"], "AIza-test-only-generation-key");
  assert.deepEqual(requestBody, {
    model: "gemini-3.1-flash-image",
    input: [{ type: "text", text: "A glass greenhouse on Mars" }],
  });
  assert.deepEqual(generated.buffer, expected);
  assert.equal(generated.mimeType, "image/png");
  assert.equal(generated.interactionId, "interaction-1");
  assert.equal(generatedImageFilename(generated.mimeType), "generated-image.png");
});

test("Google Gemini failures retain a provider-specific reason", async () => {
  await assert.rejects(
    generateGoogleImage({
      apiKey: "AIza-test-only-generation-key",
      prompt: "A glass greenhouse on Mars",
      fetchImpl: async () => new Response(JSON.stringify({
        error: { message: "API key is not authorized for this model" },
      }), { status: 403, headers: { "content-type": "application/json" } }),
    }),
    (error) =>
      error?.code === "google_image_generation_credentials_rejected" &&
      /Google rejected the Gemini API key/u.test(error.message) &&
      /not authorized for this model/u.test(error.message),
  );

  await assert.rejects(
    generateGoogleImage({ apiKey: "", prompt: "A glass greenhouse on Mars" }),
    (error) =>
      error?.code === "google_image_generation_unconfigured" &&
      /Add a Gemini API key in Profile/u.test(error.message),
  );
});

test("Google image-generation API keys are encrypted and scoped to one profile", () => {
  const credentialsDirectory = path.join(temporaryRoot, "credentials");
  const savedDirectory = process.env.BREADBOARD_GOOGLE_IMAGE_GENERATION_CREDENTIALS_DIR;
  const savedSecret = process.env.NEXTAUTH_SECRET;
  process.env.BREADBOARD_GOOGLE_IMAGE_GENERATION_CREDENTIALS_DIR = credentialsDirectory;
  process.env.NEXTAUTH_SECRET = "test-only-google-image-generation-vault-secret";
  try {
    assert.deepEqual(googleImageGenerationCredentialsStatus(71), {
      available: true,
      configured: false,
    });
    const credentials = { apiKey: "AIza-test-only-generation-key" };
    storeGoogleImageGenerationCredentials(71, credentials);
    assert.deepEqual(readGoogleImageGenerationCredentials(71), credentials);
    assert.equal(
      readGoogleImageGenerationCredentials(72),
      null,
      "another profile cannot inherit the API key",
    );
    assert.deepEqual(googleImageGenerationCredentialsStatus(71), {
      available: true,
      configured: true,
    });
    const stored = fs.readFileSync(path.join(credentialsDirectory, "user-71.json"), "utf8");
    assert.doesNotMatch(stored, /AIza-test-only/u, "the API key must be sealed on disk");
    clearGoogleImageGenerationCredentials(71);
    assert.equal(readGoogleImageGenerationCredentials(71), null);
  } finally {
    if (savedDirectory === undefined) {
      delete process.env.BREADBOARD_GOOGLE_IMAGE_GENERATION_CREDENTIALS_DIR;
    } else {
      process.env.BREADBOARD_GOOGLE_IMAGE_GENERATION_CREDENTIALS_DIR = savedDirectory;
    }
    if (savedSecret === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = savedSecret;
  }
});

test("the artifact fallback reports both generators when neither can run", () => {
  const route = fs.readFileSync(
    new URL("../src/app/api/hermes/tools/artifacts/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /ChatGPT image generation failed:/u);
  assert.match(route, /Google image generation fallback also failed:/u);
  assert.match(route, /primaryGenerationFailure/u);
  assert.doesNotMatch(route, /searchImages\(/u);

  const generationStart = route.indexOf('action === "artifact_image_generate"');
  const generationEnd = route.indexOf('action === "artifact_list"', generationStart);
  const generationBlock = route.slice(generationStart, generationEnd);
  assert.ok(generationStart >= 0 && generationEnd > generationStart);
  assert.equal(
    generationBlock.match(/await importArtifactImage\(/gu)?.length,
    1,
    "provider fallback must finish before the single artifact import",
  );
  assert.ok(
    generationBlock.indexOf("generateImageWithProviderFallback") <
      generationBlock.indexOf("await importArtifactImage"),
    "artifact persistence must not be inside the provider fallback catch",
  );
});
