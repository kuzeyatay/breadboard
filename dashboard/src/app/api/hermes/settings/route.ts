import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
  ApiError,
} from "@/lib/hermes/route-helpers.ts";
import {
  getHermesUserSettings,
  setHermesUserSettings,
  type FilesystemAccessMode,
} from "@/lib/hermes/runtime-store.ts";
import {
  canonicalAccessibleDirectory,
  discoverFilesystemRoots,
} from "@/lib/hermes/workspace.ts";

export const dynamic = "force-dynamic";

function payload(userId: number) {
  const settings = getHermesUserSettings(userId);
  return {
    filesystemMode: settings.filesystemMode,
    lastActiveDirectory: settings.lastActiveDirectory,
    accessibleRoots: discoverFilesystemRoots(),
    note:
      settings.filesystemMode === "full"
        ? "Read discovery may use OS-accessible paths; mutations still require permission."
        : "Sessions remain in an isolated runtime directory.",
  };
}

export async function GET() {
  try {
    const userId = await requireUserId();
    requireEnabled();
    return NextResponse.json(payload(userId));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const body = await readJsonBody(request);
    const mode: FilesystemAccessMode | undefined =
      body.filesystemMode === "full" || body.filesystemMode === "restricted"
        ? body.filesystemMode
        : undefined;
    if (body.filesystemMode !== undefined && !mode) {
      throw new ApiError(400, "invalid_filesystem_mode", "filesystemMode must be restricted or full.");
    }
    let activeDirectory: string | null | undefined;
    if (body.activeDirectory !== undefined) {
      if (body.activeDirectory === null || body.activeDirectory === "") {
        activeDirectory = null;
      } else if (typeof body.activeDirectory === "string") {
        activeDirectory = canonicalAccessibleDirectory(body.activeDirectory);
        if (!activeDirectory) {
          throw new ApiError(400, "directory_unavailable", "The directory does not exist or is not readable.");
        }
      } else {
        throw new ApiError(400, "invalid_directory", "activeDirectory must be a path or null.");
      }
    }
    setHermesUserSettings(userId, {
      ...(mode ? { filesystemMode: mode } : {}),
      ...(activeDirectory !== undefined ? { lastActiveDirectory: activeDirectory } : {}),
    });
    return NextResponse.json(payload(userId));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
