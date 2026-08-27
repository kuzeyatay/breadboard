// Trusted preparation of the private OpenScience provider profile.
//
// This runs in the authenticated dashboard before the finite Runtime job is
// submitted. The disposable worker receives neither ChatMock's URL/key nor a
// way to rewrite this file; Rust starts the service dependency after the
// profile is durably in place.

import { declaredModels, writeConfig } from "./config.ts";

export interface OpenscienceServiceProfileInput {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

function loopbackV1(value: string): string {
  const parsed = new URL(value);
  if (
    parsed.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !["/v1", "/v1/"].includes(parsed.pathname)
  ) {
    throw new Error("The OpenScience provider endpoint is invalid.");
  }
  return `${parsed.origin}/v1`;
}

/** Atomically prepare the exact profile the next service admission consumes. */
export async function prepareService(
  input: OpenscienceServiceProfileInput,
): Promise<{ readonly changed: boolean }> {
  const model = input.model.trim();
  const apiKey = input.apiKey.trim();
  if (!model || Buffer.byteLength(model, "utf8") > 256 || /\p{Cc}/u.test(model)) {
    throw new Error("The OpenScience model is invalid.");
  }
  if (
    !apiKey ||
    Buffer.byteLength(apiKey, "utf8") > 1_024 ||
    /[\u0000-\u001f\u007f]/u.test(apiKey)
  ) {
    throw new Error("The OpenScience provider capability is invalid.");
  }
  return {
    changed: writeConfig({
      baseUrl: loopbackV1(input.baseUrl),
      apiKey,
      models: [model, ...declaredModels()],
    }),
  };
}
