import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { CadServiceError } from "@/lib/cad/errors.ts";
import { applyParameterUpdate } from "@/lib/cad/parameter-action.ts";
import type { CadParameterValue } from "@/lib/cad/project-store.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A parameter change is a full rebuild plus a re-validation, and OpenCascade is
// not fast on a laptop.
export const maxDuration = 300;

/**
 * Rebuild a design with new parameter values.
 *
 * The artifact renderer submits here; no CAD code is executed in the browser.
 * The result is a new immutable revision and a new artifact version, with the
 * previous revision left untouched.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { projectId } = await params;
    const text = await request.text();
    if (text.length > 64 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    const conversationPublicId =
      typeof body.conversationId === "string" ? body.conversationId.trim() : "";
    const rawValues = body.parameters;
    if (!conversationPublicId) {
      return NextResponse.json({ ok: false, error: "conversation_required" }, { status: 400 });
    }
    if (!rawValues || typeof rawValues !== "object" || Array.isArray(rawValues)) {
      return NextResponse.json({ ok: false, error: "parameters_required" }, { status: 400 });
    }
    const values: Record<string, CadParameterValue> = {};
    for (const [id, value] of Object.entries(rawValues as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) values[id] = value;
      else if (typeof value === "string" && value.length <= 200) values[id] = value;
      else if (typeof value === "boolean") values[id] = value;
      else {
        return NextResponse.json(
          { ok: false, error: "invalid_parameter_value", parameter: id },
          { status: 400 },
        );
      }
    }

    const result = await applyParameterUpdate({
      userId,
      projectId,
      conversationPublicId,
      values,
    });
    return NextResponse.json({
      ok: true,
      revision: result.revision,
      artifactId: result.artifactId,
      artifactVersion: result.artifactVersion,
      changed: result.changed,
      status: result.manifest.status,
      validationPassed: result.manifest.validation.passed,
      measurements: result.manifest.measurements,
      issues: result.manifest.validation.issues.filter((issue) => issue.severity !== "info"),
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof CadServiceError) {
      const status =
        error.code === "cad_project_not_found" || error.code === "revision_not_found" ? 404 : 400;
      return NextResponse.json(
        { ok: false, error: error.code, message: error.message },
        { status },
      );
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
