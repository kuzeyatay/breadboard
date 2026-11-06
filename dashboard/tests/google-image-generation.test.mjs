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

const MODEL = "cliproxy/gemini-3.1-flash-image";
const input = { baseURL: "http://chatmock.test:49981/v1", prompt: "A glass greenhouse on Mars" };
const json = (payload, status = 200) => Response.json(payload, { status });
const catalog = (ids = [MODEL]) => ({ data: ids.map(id => ({ id })) });
const imageReply = (bytes, field = "images") => ({
  id: "chatcmpl-image-1", model: MODEL,
  choices: [{ message: { [field]: [{ image_url: { url: `data:image/jpeg;base64,${bytes.toString("base64")}` } }] } }],
});

test("Gemini fallback uses the subscription model and local bearer, without a Google API key", async () => {
  const expected = Buffer.from("verified-subscription-image");
  const requests = [];
  const savedKey = process.env.CHATMOCK_API_KEY;
  process.env.CHATMOCK_API_KEY = "test-local-bearer";
  try {
    const generated = await generateGoogleImage({
      ...input, baseURL: "http://chatmock.test:49981/",
      fetchImpl: async (url, init) => {
        requests.push({ url, ...init });
        return requests.length === 1 ? json(catalog()) : json(imageReply(expected));
      },
    });
    assert.deepEqual(requests.map(r => r.url), [input.baseURL + "/models", input.baseURL + "/chat/completions"]);
    for (const request of requests) {
      assert.equal(request.headers.authorization, "Bearer test-local-bearer");
      assert.equal(request.headers["x-goog-api-key"], undefined);
    }
    assert.deepEqual(JSON.parse(requests[1].body), {
      model: MODEL, council: false, stream: false,
      messages: [{ role: "user", content: [{ type: "text", text: input.prompt }] }],
    });
    assert.deepEqual(generated.buffer, expected);
    assert.equal(generated.model, MODEL);
    assert.equal(generated.mimeType, "image/jpeg");
    assert.equal(generated.responseId, "chatcmpl-image-1");
    assert.equal(generatedImageFilename(generated.mimeType), "generated-image.jpg");
  } finally {
    if (savedKey === undefined) delete process.env.CHATMOCK_API_KEY;
    else process.env.CHATMOCK_API_KEY = savedKey;
  }
});

test("Gemini discovery accepts other subscription image models but never another provider", async () => {
  const available = ["google/gemini-3.1-flash-image", "cliproxy/gemini-3-flash", "cliproxy/gemini-3-pro-image"];
  const expected = Buffer.from("alternate-image");
  for (const model of [undefined, "gemini-3-pro-image", "cliproxy/gemini-3-pro-image"]) {
    const generated = await generateGoogleImage({
      ...input, model,
      fetchImpl: async (url, init) => {
        if (url.endsWith("/models")) return json(catalog(available));
        assert.equal(JSON.parse(init.body).model, "cliproxy/gemini-3-pro-image");
        return json(imageReply(expected, "content"));
      },
    });
    assert.deepEqual(generated.buffer, expected);
  }
  for (const ids of [[], available.slice(0, 2)]) {
    await assert.rejects(generateGoogleImage({ ...input,
      fetchImpl: async url => {
        assert.ok(url.endsWith("/models"), "unavailable models must not start a generation");
        return json(catalog(ids));
      },
    }), { code: "google_image_generation_unconfigured" });
  }
});

test("Gemini subscription authentication, quota and proxy errors retain their reasons", async () => {
  for (const [status, code] of [[403, "credentials_rejected"], [429, "quota_reached"], [502, "upstream_error"], [200, "upstream_error"]]) {
    await assert.rejects(generateGoogleImage({ ...input,
      fetchImpl: async url => url.endsWith("/models") ? json(catalog()) : json({ error: { message: "upstream detail" } }, status),
    }), error => {
      assert.equal(error.code, "google_image_generation_" + code);
      assert.match(error.message, /upstream detail/u);
      assert.doesNotMatch(error.message, /API key/u);
      return true;
    });
  }
});

test("Gemini rejects malformed image data and text-only replies", async () => {
  for (const [reply, code] of [
    [{ choices: [{ message: { content: "I cannot draw" } }] }, "empty"],
    [{ choices: [{ message: { images: [{ image_url: { url: "data:image/png;base64,%%%" } }] } }] }, "invalid_image"],
    [{ choices: [{ message: { images: [{ image_url: { url: "https://example.com/image.png" } }] } }] }, "empty"],
  ]) {
    await assert.rejects(generateGoogleImage({ ...input,
      fetchImpl: async url => json(url.endsWith("/models") ? catalog() : reply),
    }), { code: "google_image_generation_" + code });
  }
});

test("Gemini cancellation stops before generation, including during response decoding", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(generateGoogleImage({ ...input, signal: controller.signal,
    fetchImpl: async () => { assert.fail("cancelled work must not reach the proxy"); },
  }), { code: "google_image_generation_aborted" });
  const inFlight = new AbortController();
  await assert.rejects(generateGoogleImage({ ...input, signal: inFlight.signal,
    fetchImpl: async url => url.endsWith("/models") ? json(catalog()) : {
      ok: true, status: 200, json: async () => { inFlight.abort(); throw new Error("aborted body"); },
    },
  }), { code: "google_image_generation_aborted" });
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
  const fallback = fs.readFileSync(new URL("../src/lib/hermes/image-generation-fallback.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route + fallback, /readGoogleImageGenerationCredentials/u);
  assert.match(fallback, /ChatGPT image generation failed:/u);
  assert.match(fallback, /Google image generation fallback also failed:/u);
  assert.match(fallback, /primaryGenerationFailure/u);
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
