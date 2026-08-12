// Filesystem grant management for the authenticated user.
//
// This is the only way a folder outside a session's ephemeral workspace becomes
// reachable. The browser proposes a path; the server canonicalizes it, verifies
// it exists, resolves symlinks, and stores the grant against the authenticated
// user. A path named in a chat message never reaches this route on its own —
// the user has to approve it.

import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  GrantError,
  type FilesystemPermissions,
} from "@/lib/hermes/filesystem-grants.ts";
import {
  grantFilesystemRoot,
  listFilesystemGrants,
  revokeFilesystemGrant,
} from "@/lib/hermes/filesystem-grant-store.ts";
import { candidatePathsForAlias } from "@/lib/hermes/filesystem-paths.ts";
import { recordAuditEvent } from "@/lib/hermes/runtime-store.ts";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";

export const dynamic = "force-dynamic";

/** Only these keys are accepted; anything else in the body is ignored. */
function readPermissions(value: unknown): Partial<FilesystemPermissions> {
  if (!value || typeof value !== "object") return { read: true };
  const source = value as Record<string, unknown>;
  const permissions: Partial<FilesystemPermissions> = {};
  for (const key of ["read", "create", "modify", "move", "delete", "execute"] as const) {
    if (typeof source[key] === "boolean") permissions[key] = source[key];
  }
  // A grant with no operation at all is meaningless; default to read.
  return Object.keys(permissions).length ? permissions : { read: true };
}

export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json({ grants: listFilesystemGrants(userId) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readJsonBody(request);

    // An alias ("Documents") is expanded to candidate locations here, but only
    // an existing one is granted — the alias itself confers nothing.
    const requestedPath =
      typeof body.path === "string" && body.path.trim()
        ? body.path.trim()
        : typeof body.alias === "string"
          ? (candidatePathsForAlias(body.alias)[0] ?? "")
          : "";
    if (!requestedPath) {
      return NextResponse.json(
        { error: "path_required", message: "A folder path is required." },
        { status: 400 },
      );
    }

    const grant = grantFilesystemRoot({
      userId,
      requestedPath,
      displayName: typeof body.displayName === "string" ? body.displayName : undefined,
      permissions: readPermissions(body.permissions),
      scope: body.scope === "one_time" ? "one_time" : "remembered",
    });

    recordAuditEvent({
      eventType: "filesystem.grant_created",
      runtimeSessionId: null,
      userId,
      gardenId: null,
      payload: {
        grantId: grant.id,
        displayName: grant.displayName,
        permissions: grant.permissions,
        scope: grant.scope,
      },
    });
    return NextResponse.json({ grant });
  } catch (error) {
    if (error instanceof GrantError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.code === "path_not_found" ? 404 : 400 },
      );
    }
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = await requireUserId();
    const grantId = new URL(request.url).searchParams.get("id")?.trim();
    if (!grantId) {
      return NextResponse.json(
        { error: "id_required", message: "A grant id is required." },
        { status: 400 },
      );
    }
    // revoke() is scoped to the authenticated user, so another user's grant id
    // simply reports not-found rather than revoking anything.
    const revoked = revokeFilesystemGrant(userId, grantId);
    if (!revoked) {
      return NextResponse.json(
        { error: "grant_not_found", message: "Grant not found." },
        { status: 404 },
      );
    }
    recordAuditEvent({
      eventType: "filesystem.grant_revoked",
      runtimeSessionId: null,
      userId,
      gardenId: null,
      payload: { grantId },
    });
    return NextResponse.json({ revoked: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
