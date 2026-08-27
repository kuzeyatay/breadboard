import { NextResponse } from "next/server";

import {
  acquirePackagedServiceEvidenceLease,
  packagedServiceEvidenceDefinition,
  packagedServiceEvidenceEndpoints,
  packagedServiceEvidenceHeldServiceIds,
  packagedServiceEvidenceStatuses,
  PACKAGED_SERVICE_EVIDENCE_DEFINITIONS,
  releasePackagedServiceEvidenceLease,
} from "@/lib/runtime-v2/packaged-service-evidence.ts";
import {
  PACKAGED_SERVICE_EVIDENCE_TOKEN_PATTERN,
  authorizedPackagedServiceEvidenceRequest,
} from "@/lib/runtime-v2/packaged-service-evidence-auth.ts";
import { SupervisorResourceExhaustedError } from "@/lib/supervisor-control.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 1_024;

function evidenceToken(): string | null {
  if (process.env.BREADBOARD_PACKAGED_SERVICE_EVIDENCE !== "1") return null;
  const token = process.env.BREADBOARD_MEMORY_DIAGNOSTIC_TOKEN?.trim() ?? "";
  return PACKAGED_SERVICE_EVIDENCE_TOKEN_PATTERN.test(token) ? token : null;
}

function headers(): HeadersInit {
  return { "Cache-Control": "no-store, max-age=0" };
}

function gate(request: Request): NextResponse | null {
  const token = evidenceToken();
  if (!token) return new NextResponse(null, { status: 404 });
  if (!authorizedPackagedServiceEvidenceRequest(request, token, process.env.PORT)) {
    return NextResponse.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401, headers: headers() });
  }
  return null;
}

async function boundedBody(request: Request): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_REQUEST_BYTES)) {
    throw new TypeError("The packaged service evidence request is too large.");
  }
  if (!request.body) throw new TypeError("The packaged service evidence request is invalid.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel("packaged service evidence request exceeded 1024 bytes");
        throw new TypeError("The packaged service evidence request is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

function action(value: unknown): { action: "acquire" | "release"; serviceId: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("The packaged service evidence request is invalid.");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "action,serviceId" ||
    (record.action !== "acquire" && record.action !== "release") ||
    typeof record.serviceId !== "string"
  ) {
    throw new TypeError("The packaged service evidence request is invalid.");
  }
  return { action: record.action, serviceId: record.serviceId };
}

export async function GET(request: Request) {
  const denied = gate(request);
  if (denied) return denied;
  try {
    return NextResponse.json(
      {
        schemaVersion: 1,
        ok: true,
        packaged: true,
        definitions: PACKAGED_SERVICE_EVIDENCE_DEFINITIONS,
        endpoints: packagedServiceEvidenceEndpoints(),
        heldServiceIds: packagedServiceEvidenceHeldServiceIds(),
        services: await packagedServiceEvidenceStatuses(),
      },
      { headers: headers() },
    );
  } catch {
    return NextResponse.json(
      { ok: false, code: "SERVICE_STATUS_UNAVAILABLE" },
      { status: 503, headers: headers() },
    );
  }
}

export async function POST(request: Request) {
  const denied = gate(request);
  if (denied) return denied;
  let input: ReturnType<typeof action>;
  try {
    input = action(await boundedBody(request));
  } catch {
    return NextResponse.json(
      { ok: false, code: "INVALID_REQUEST" },
      { status: 400, headers: headers() },
    );
  }
  const definition = packagedServiceEvidenceDefinition(input.serviceId);
  if (!definition) {
    return NextResponse.json(
      { ok: false, code: "SERVICE_NOT_EVIDENCE_CONTROLLED" },
      { status: 409, headers: headers() },
    );
  }
  try {
    const result = input.action === "acquire"
      ? await acquirePackagedServiceEvidenceLease(definition.id, request.signal)
      : await releasePackagedServiceEvidenceLease(definition.id);
    return NextResponse.json(
      { ok: true, action: input.action, serviceId: definition.id, ...result },
      { headers: headers() },
    );
  } catch (error) {
    if (error instanceof SupervisorResourceExhaustedError) {
      return NextResponse.json(
        {
          ok: false,
          code: error.result.code,
          serviceId: definition.id,
          resource: error.result.resource,
          requiredHeadroomMb: error.result.requiredHeadroomMb,
          availableHeadroomMb: error.result.availableHeadroomMb,
        },
        { status: 503, headers: headers() },
      );
    }
    const state = await packagedServiceEvidenceStatuses()
      .then((services) => services.find(({ id }) => id === definition.id)?.state ?? null)
      .catch(() => null);
    const scopedCode = state === "installation-unavailable"
      ? "INSTALLATION_UNAVAILABLE"
      : state === "resource-blocked"
        ? "SERVICE_RESOURCE_BLOCKED"
        : state === "failed"
          ? "SERVICE_FAILED"
          : error instanceof DOMException && error.name === "AbortError"
            ? "REQUEST_CANCELLED"
            : "SERVICE_EVIDENCE_UNAVAILABLE";
    return NextResponse.json(
      {
        ok: false,
        code: scopedCode,
        serviceId: definition.id,
        state,
      },
      { status: 503, headers: headers() },
    );
  }
}
