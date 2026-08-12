import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import db from "@/lib/db.ts";
import { CAD_FILE_DESCRIPTORS, CadStorageError } from "@/lib/cad/blob-store.ts";
import { getCadProject, readCadFile } from "@/lib/cad/project-store.ts";
import { authorizeGardenAccess } from "@/lib/hermes/session-service.ts";
import type { CADExportFormat } from "@/lib/cad/types.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Authenticated download for one CAD file.
 *
 * The route takes a project id, an integer revision and a format from a fixed
 * list — never a path. The stored relative path comes from the database row and
 * is re-checked against the storage root before the file is read, so a request
 * cannot address anything Breadboard did not write.
 */
export async function GET(
  _request: Request,
  {
    params,
  }: { params: Promise<{ projectId: string; revision: string; format: string }> },
) {
  try {
    const userId = await requireUserId();
    const { projectId, revision, format } = await params;

    if (!(format in CAD_FILE_DESCRIPTORS)) {
      return NextResponse.json({ ok: false, error: "invalid_export_format" }, { status: 400 });
    }
    const revisionNumber = Number(revision);
    if (!Number.isInteger(revisionNumber) || revisionNumber < 1) {
      return NextResponse.json({ ok: false, error: "invalid_revision" }, { status: 400 });
    }

    const project = getCadProject(projectId);
    if (!project || project.user_id !== userId) {
      return NextResponse.json({ ok: false, error: "cad_project_not_found" }, { status: 404 });
    }
    if (project.cluster_id !== null) {
      const garden = gardenSlugForCluster(project.cluster_id);
      if (garden) authorizeGardenAccess(userId, garden);
    }

    const file = readCadFile({
      projectId: project.id,
      revision: revisionNumber,
      format: format as CADExportFormat,
    });

    return new Response(new Uint8Array(file.content), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": `attachment; filename="${file.filename.replace(/["\r\n]/g, "-")}"`,
        "Content-Length": String(file.content.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof CadStorageError) {
      return NextResponse.json({ ok: false, error: error.code }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}

function gardenSlugForCluster(clusterId: number): string | null {
  const row = db.prepare(`SELECT slug FROM clusters WHERE id = ?`).get(clusterId) as
    | { slug: string }
    | undefined;
  return row?.slug ?? null;
}
