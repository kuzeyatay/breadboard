// The loopback client for the Python CAD service.
//
// Server-only. The base URL and the shared secret live in the Next.js server
// process and never reach a browser: the artifact renderer receives measured
// numbers and download URLs, never a service address or a credential.
//
// Configuration follows the same shape as Breadboard's other loopback sidecars
// (GBrain, UI-TARS): an explicit URL plus a per-launch secret, both injected by
// the desktop supervisor or the dev launcher.

import net from "node:net";
import { cadBaseUrl, cadServiceSecret } from "./config.ts";
import { CadServiceError } from "./errors.ts";

export interface CadHealth {
  status: "ok" | "degraded";
  serviceVersion: string;
  pythonVersion: string;
  cadqueryVersion: string;
  ocpVersion: string;
  exportFormats: string[];
  engines: string[];
  detail: string;
}

export interface CadExportRequest {
  format: "step" | "stl" | "glb" | "3mf";
  filename: string;
  linearTolerance?: number;
  angularTolerance?: number;
}

export interface CadExpectations {
  expectedSolidCount?: number;
  boundingBox?: { x?: number; y?: number; z?: number };
  boundingBoxTolerance?: number;
  minimumWallThickness?: number;
  minimumFeatureSize?: number;
  holeDiameters?: number[];
  clearances?: number[];
  printerBed?: { x: number; y: number; z: number };
  units?: "mm" | "inch";
}

/** Reading a file the user supplied, rather than running a program. */
export interface CadConvertRequest {
  format: "step" | "stp" | "iges" | "igs" | "brep";
  /** The file itself, base64-encoded. */
  contentBase64: string;
  timeoutMs: number;
  exports: CadExportRequest[];
  linearTolerance?: number;
  angularTolerance?: number;
}

export interface CadExecuteRequest {
  source: string;
  entrypoint: string;
  parameters: Record<string, number | string | boolean>;
  timeoutMs: number;
  exports: CadExportRequest[];
  expectations: CadExpectations;
  linearTolerance?: number;
  angularTolerance?: number;
}

export interface CadServiceIssue {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  feature?: string | null;
  expected?: unknown;
  actual?: unknown;
  repairHint?: string | null;
}

export interface CadExecuteResponse {
  ok: boolean;
  failure: {
    code: string;
    message: string;
    exceptionType?: string;
    line?: number;
    tracebackTail?: string;
    violations?: Array<{ code?: string; message?: string; line?: number }>;
  } | null;
  solids: Array<{
    name: string;
    volume: number;
    surfaceArea: number;
    boundingBox: { x: number; y: number; z: number };
    valid: boolean;
    watertight: boolean;
    faceCount: number;
    edgeCount: number;
  }>;
  solidCount: number;
  volume: number;
  surfaceArea: number;
  boundingBox: { x: number; y: number; z: number } | null;
  tessellation: {
    linearTolerance: number;
    angularTolerance: number;
    vertexCount: number;
    triangleCount: number;
    degenerateTriangleCount: number;
    nonManifoldEdgeCount: number;
    openEdgeCount: number;
    hasNonFiniteCoordinates: boolean;
  } | null;
  exports: Array<{
    format: string;
    filename: string;
    byteSize: number;
    sha256: string;
    linearTolerance?: number | null;
    angularTolerance?: number | null;
  }>;
  issues: CadServiceIssue[];
  /** What the program built with: its own DEFAULT_PARAMS plus the overrides. */
  effectiveParameters: Record<string, number | string | boolean>;
  stdout: string;
  stderr: string;
  durationMs: number;
  engine: string;
  engineVersion: string;
  kernelVersion: string;
  pythonVersion: string;
  /** Export bytes, keyed by format. Decoded from the service's base64. */
  files: Record<string, Buffer>;
}

interface Endpoint {
  baseUrl: string;
  secret: string;
}

export function cadServiceEndpoint(env: NodeJS.ProcessEnv = process.env): Endpoint | null {
  const secret = cadServiceSecret(env);
  if (!secret) return null;
  return { baseUrl: cadBaseUrl(env), secret };
}

/**
 * Whether Breadboard knows how to reach the service at all.
 *
 * Almost always true: the address defaults to loopback and the secret is
 * file-backed, so no launcher has to hand them over. False means the secret
 * could neither be read nor written, which is a setup problem rather than a
 * service that happens to be down.
 */
export function cadServiceConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return cadServiceEndpoint(env) !== null;
}

/**
 * Is anything listening?
 *
 * A TCP connect rather than a request to `/health`, which imports OpenCascade
 * in a child process and takes several seconds on a cold cache. This answers
 * the only question worth asking before spending two minutes of model time:
 * whether starting the run can possibly end in a part.
 */
export function cadServiceListening(
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = 1_500,
): Promise<boolean> {
  const endpoint = cadServiceEndpoint(env);
  if (!endpoint) return Promise.resolve(false);
  let url: URL;
  try {
    url = new URL(endpoint.baseUrl);
  } catch {
    return Promise.resolve(false);
  }
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  return new Promise((resolve) => {
    const socket = net.connect({ host: url.hostname, port });
    const done = (listening: boolean) => {
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

async function call(
  endpoint: Endpoint,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; timeoutMs: number; signal?: AbortSignal },
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs);
  const onAbort = () => controller.abort();
  init.signal?.addEventListener("abort", onAbort);
  try {
    const response = await fetch(`${endpoint.baseUrl}${path}`, {
      method: init.method,
      headers: {
        authorization: `Bearer ${endpoint.secret}`,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: unknown = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new CadServiceError(
        "cad_service_error",
        "The CAD service returned a response Breadboard could not read.",
        { retryable: true },
      );
    }
    if (!response.ok) {
      const body = payload as { error?: string; detail?: string };
      const code =
        response.status === 503
          ? "cad_service_busy"
          : typeof body.error === "string" && body.error
            ? body.error
            : "cad_service_error";
      throw new CadServiceError(code, body.detail ?? `The CAD service returned ${response.status}.`, {
        retryable: response.status >= 500,
        detail: body.detail ?? "",
      });
    }
    return payload;
  } catch (error) {
    if (error instanceof CadServiceError) throw error;
    if (controller.signal.aborted && !init.signal?.aborted) {
      throw new CadServiceError(
        "execution_timeout",
        "The CAD service did not answer in time.",
        { retryable: true },
      );
    }
    throw new CadServiceError(
      "cad_service_unavailable",
      "The local CAD service could not be reached.",
      { retryable: false, detail: error instanceof Error ? error.message : "" },
    );
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", onAbort);
  }
}

export async function cadServiceHealth(
  env: NodeJS.ProcessEnv = process.env,
): Promise<CadHealth> {
  const endpoint = cadServiceEndpoint(env);
  if (!endpoint) {
    throw new CadServiceError(
      "cad_service_unconfigured",
      "The CAD service has no address or shared secret configured.",
    );
  }
  // The first health probe imports the kernel in a child process, which takes
  // several seconds on a cold filesystem cache.
  const payload = (await call(endpoint, "/health", {
    method: "GET",
    timeoutMs: 150_000,
  })) as Partial<CadHealth>;
  return {
    status: payload.status === "ok" ? "ok" : "degraded",
    serviceVersion: payload.serviceVersion ?? "",
    pythonVersion: payload.pythonVersion ?? "",
    cadqueryVersion: payload.cadqueryVersion ?? "",
    ocpVersion: payload.ocpVersion ?? "",
    exportFormats: Array.isArray(payload.exportFormats) ? payload.exportFormats : [],
    engines: Array.isArray(payload.engines) ? payload.engines : [],
    detail: payload.detail ?? "",
  };
}

/**
 * Tessellate a CAD exchange file the user attached.
 *
 * Same response as a build, because the far side reaches the same place: an
 * imported STEP is measured, meshed and exported by the code that measures,
 * meshes and exports a generated one.
 */
export async function cadServiceConvert(
  request: CadConvertRequest,
  options: { env?: NodeJS.ProcessEnv; signal?: AbortSignal } = {},
): Promise<CadExecuteResponse> {
  const env = options.env ?? process.env;
  const endpoint = cadServiceEndpoint(env);
  if (!endpoint) {
    throw new CadServiceError(
      "cad_service_unconfigured",
      "The CAD service has no address or shared secret configured.",
    );
  }
  const payload = (await call(endpoint, "/convert", {
    method: "POST",
    body: request,
    // The kernel import dominates a first conversion on a cold cache.
    timeoutMs: request.timeoutMs + 180_000,
    ...(options.signal ? { signal: options.signal } : {}),
  })) as Record<string, unknown>;

  const files: Record<string, Buffer> = {};
  const rawFiles = payload.files;
  if (rawFiles && typeof rawFiles === "object" && !Array.isArray(rawFiles)) {
    for (const [format, encoded] of Object.entries(rawFiles as Record<string, unknown>)) {
      if (typeof encoded === "string") files[format] = Buffer.from(encoded, "base64");
    }
  }
  return { ...(payload as unknown as CadExecuteResponse), files };
}

export async function cadServiceExecute(
  request: CadExecuteRequest,
  options: { env?: NodeJS.ProcessEnv; signal?: AbortSignal } = {},
): Promise<CadExecuteResponse> {
  const env = options.env ?? process.env;
  const endpoint = cadServiceEndpoint(env);
  if (!endpoint) {
    throw new CadServiceError(
      "cad_service_unconfigured",
      "The CAD service has no address or shared secret configured.",
    );
  }
  // The service enforces the model's own timeout; this one covers the kernel
  // import and the round trip on top of it.
  const payload = (await call(endpoint, "/execute", {
    method: "POST",
    body: request,
    timeoutMs: request.timeoutMs + 180_000,
    ...(options.signal ? { signal: options.signal } : {}),
  })) as Record<string, unknown>;

  const files: Record<string, Buffer> = {};
  const rawFiles = payload.files;
  if (rawFiles && typeof rawFiles === "object" && !Array.isArray(rawFiles)) {
    for (const [format, encoded] of Object.entries(rawFiles as Record<string, unknown>)) {
      if (typeof encoded === "string") files[format] = Buffer.from(encoded, "base64");
    }
  }
  return { ...(payload as unknown as CadExecuteResponse), files };
}
