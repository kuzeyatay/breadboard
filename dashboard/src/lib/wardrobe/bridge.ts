// The OpenAI-shaped endpoint the Wardrobe clone talks to.
//
// The clone makes exactly two kinds of model call, both against
// `OPENAI_API_BASE_URL`: `POST /responses` to detect the garments in a photo,
// and `POST /images/edits` to draw the cutout and the modeled shot. ChatMock
// serves the first natively and does not implement the second at all — image
// generation there is the Responses `image_generation` tool, not the Images API.
//
// So Breadboard stands up a loopback server that speaks the Images API,
// translates an edit into that tool call, and forwards everything else to
// ChatMock untouched. The clone then runs completely unmodified, which is the
// point: its chroma-key removal, spill verification, trimming and atomic library
// write are the parts worth keeping, and none of them are model calls.
//
// It listens on 127.0.0.1 with an ephemeral port and a per-process bearer token,
// and the token is the value handed to the clone as its `OPENAI_API_KEY`. So the
// clone's own "is a key configured?" check passes with a credential that is
// worthless anywhere else, and nothing on the machine can reach the bridge by
// guessing the port.

import { randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  generateArtifactImage,
  isGeneratedImageSize,
  type GeneratedImageSize,
} from "../hermes/artifact-image-service.ts";

export interface ImagesBridge {
  /** What the clone is handed as `OPENAI_API_BASE_URL`, ending in `/v1`. */
  baseUrl: string;
  /** What the clone is handed as `OPENAI_API_KEY`. */
  apiKey: string;
  /** Where forwarded requests go, i.e. ChatMock's own `/v1`. */
  upstreamUrl: string;
  close(): void;
}

interface BridgeState extends ImagesBridge {
  server: http.Server;
}

const bridgeGlobal = globalThis as typeof globalThis & {
  __breadboardWardrobeBridge?: BridgeState | null;
};

/** Bodies carry a full-resolution photo in each direction. */
const MAX_BODY_BYTES = 40 * 1024 * 1024;

function readBody(request: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("The request body was too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function sendJson(response: http.ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(body);
}

function sendError(response: http.ServerResponse, status: number, message: string): void {
  sendJson(response, status, { error: { message, type: "wardrobe_bridge_error" } });
}

function bearer(request: http.IncomingMessage): string {
  const header = request.headers.authorization ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

/**
 * The size the Images API asked for, when the tool can honour it.
 *
 * The clone asks for `1024x1024` cutouts and `1536x1024` modeled shots, and both
 * are sizes the tool supports. Anything else falls back to `auto` rather than
 * failing the call — a differently-sized image is still usable, a rejected
 * request is not.
 */
function toolSize(value: unknown): GeneratedImageSize {
  return isGeneratedImageSize(value) ? value : "auto";
}

async function referencesFromForm(
  form: FormData,
): Promise<Array<{ dataUrl: string }>> {
  // `image[]` is what the clone sends; `image` is what the Images API documents
  // for a single file, and accepting both means the bridge is not tied to one
  // caller's spelling.
  const entries = [...form.getAll("image[]"), ...form.getAll("image")];
  const references: Array<{ dataUrl: string }> = [];
  for (const entry of entries) {
    if (typeof entry === "string" || !entry) continue;
    const bytes = Buffer.from(await entry.arrayBuffer());
    if (!bytes.byteLength) continue;
    const mime = entry.type && entry.type.startsWith("image/") ? entry.type : "image/png";
    references.push({ dataUrl: `data:${mime};base64,${bytes.toString("base64")}` });
  }
  return references;
}

async function handleImageEdit(
  raw: Buffer,
  contentType: string,
  upstreamUrl: string,
): Promise<{ status: number; body: unknown }> {
  // Node's own multipart parser, reached through the Web body mixin. Writing a
  // boundary splitter by hand here would be a second implementation of something
  // the runtime already ships and gets right for filenames and encodings.
  let form: FormData;
  try {
    form = await new Response(new Uint8Array(raw), {
      headers: { "content-type": contentType },
    }).formData();
  } catch {
    return {
      status: 400,
      body: { error: { message: "The image request was not valid multipart form data." } },
    };
  }

  const prompt = form.get("prompt");
  if (typeof prompt !== "string" || !prompt.trim()) {
    return { status: 400, body: { error: { message: "An image edit needs a prompt." } } };
  }
  const references = await referencesFromForm(form);
  if (!references.length) {
    return { status: 400, body: { error: { message: "An image edit needs at least one image." } } };
  }

  const generated = await generateArtifactImage({
    baseURL: upstreamUrl,
    prompt: prompt.trim(),
    sourceImages: references,
    size: toolSize(form.get("size")),
  });
  return {
    status: 200,
    body: {
      created: Math.floor(Date.now() / 1_000),
      data: [{ b64_json: generated.buffer.toString("base64") }],
      ...(generated.usage ? { usage: generated.usage } : {}),
    },
  };
}

/**
 * Anything that is not an image edit is ChatMock's own protocol, so it is
 * relayed rather than interpreted. The bearer is replaced on the way out: the
 * clone holds the bridge's token, never ChatMock's.
 */
async function forward(
  request: http.IncomingMessage,
  raw: Buffer,
  upstreamUrl: string,
  path: string,
  response: http.ServerResponse,
): Promise<void> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${process.env.OPENAI_API_KEY || "local"}`,
  };
  const contentType = request.headers["content-type"];
  if (typeof contentType === "string") headers["content-type"] = contentType;

  const upstream = await fetch(`${upstreamUrl}${path}`, {
    method: request.method ?? "POST",
    headers,
    body: raw.byteLength ? new Uint8Array(raw) : undefined,
  });
  const body = Buffer.from(await upstream.arrayBuffer());
  response.writeHead(upstream.status, {
    "content-type": upstream.headers.get("content-type") ?? "application/json",
    "cache-control": "no-store",
  });
  response.end(body);
}

function createServer(apiKey: string, upstreamUrl: string): http.Server {
  return http.createServer((request, response) => {
    void (async () => {
      try {
        if (bearer(request) !== apiKey) {
          sendError(response, 401, "Unauthorized.");
          return;
        }
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        const path = url.pathname.replace(/^\/v1(?=\/|$)/, "") || "/";
        const raw = await readBody(request);

        if (path === "/images/edits" || path === "/images/generations") {
          const contentType = request.headers["content-type"] ?? "";
          if (!contentType.includes("multipart/form-data")) {
            sendError(response, 400, "Image requests must be multipart form data.");
            return;
          }
          const result = await handleImageEdit(raw, contentType, upstreamUrl);
          sendJson(response, result.status, result.body);
          return;
        }

        await forward(request, raw, upstreamUrl, path, response);
      } catch (error) {
        // The provider's own words are what tells a person whether they hit a
        // quota or a model that cannot draw, so they are kept rather than
        // flattened — the clone puts this string straight on the failed stage.
        const message =
          error instanceof Error && error.message ? error.message : "The image request failed.";
        const status = (error as { status?: unknown })?.status;
        sendError(response, typeof status === "number" ? status : 502, message);
      }
    })();
  });
}

/**
 * The running bridge, started if there is none and restarted when the upstream
 * it was pointed at has changed. Kept on `globalThis` so a dev-server hot reload
 * does not orphan the listener.
 */
export function ensureImagesBridge(upstreamUrl: string): Promise<ImagesBridge> {
  const normalized = upstreamUrl.replace(/\/$/, "");
  const existing = bridgeGlobal.__breadboardWardrobeBridge;
  if (existing && existing.upstreamUrl === normalized && existing.server.listening) {
    return Promise.resolve(existing);
  }
  if (existing) closeImagesBridge();

  const apiKey = `wbr_${randomBytes(24).toString("hex")}`;
  const server = createServer(apiKey, normalized);
  server.unref();

  return new Promise<ImagesBridge>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo | null;
      if (!address) {
        server.close();
        reject(new Error("The Wardrobe image bridge could not open a port."));
        return;
      }
      const state: BridgeState = {
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        apiKey,
        upstreamUrl: normalized,
        server,
        close: closeImagesBridge,
      };
      bridgeGlobal.__breadboardWardrobeBridge = state;
      resolve(state);
    });
  });
}

export function closeImagesBridge(): void {
  const state = bridgeGlobal.__breadboardWardrobeBridge;
  if (!state) return;
  try {
    state.server.close();
  } catch {
    // Already closed.
  }
  bridgeGlobal.__breadboardWardrobeBridge = null;
}

export function currentImagesBridge(): ImagesBridge | null {
  return bridgeGlobal.__breadboardWardrobeBridge ?? null;
}
