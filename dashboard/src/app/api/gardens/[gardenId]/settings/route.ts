// The garden settings dialog's data.
//
// Writes are delegated to the server actions in src/app/actions/clusters.ts
// rather than reimplemented, because those do more than touch a column —
// renaming a garden also rewrites its _index.md and republishes Quartz, and a
// second code path would eventually forget to. They are called from here rather
// than imported into the dialog directly: importing a "use server" module into a
// client component drags Next's server runtime in with it, which is both heavier
// than it needs to be and unbundleable by the component render tests.

import { NextResponse } from "next/server";

import {
  deleteCluster,
  setClusterChatAccessible,
  setClusterInstructions,
  setClusterMemoryScope,
  updateClusterDetails,
} from "@/app/actions/clusters";
import db from "@/lib/db";
import { isGardenMemoryScope } from "@/lib/garden-settings";
import { requireOwnedClusterFromSlug, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ gardenId: string }> },
) {
  try {
    const { gardenId } = await params;
    // Owner-only: these are settings, not garden content, so a reader who can
    // see a public garden must not see or change how it is configured.
    const { cluster } = await requireOwnedClusterFromSlug(gardenId);

    const row = db
      .prepare(
        `SELECT id, name, description, instructions, memory_scope, chat_accessible, visibility
           FROM clusters WHERE id = ?`,
      )
      .get(cluster.id) as
      | {
          id: number;
          name: string;
          description: string | null;
          instructions: string | null;
          memory_scope: string | null;
          chat_accessible: number;
          visibility: string;
        }
      | undefined;

    if (!row) {
      return NextResponse.json(
        { error: "not_found", message: "Garden not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({
      settings: {
        id: row.id,
        slug: gardenId,
        name: row.name,
        description: row.description ?? "",
        instructions: row.instructions ?? "",
        memoryScope: isGardenMemoryScope(row.memory_scope) ? row.memory_scope : "default",
        chatAccessible: row.chat_accessible === 1,
        visibility: row.visibility === "public" ? "public" : "private",
      },
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ gardenId: string }> },
) {
  try {
    const { gardenId } = await params;
    const { cluster } = await requireOwnedClusterFromSlug(gardenId);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    // Name and description travel together because updateClusterDetails writes
    // both into _index.md in one pass; sending one alone would blank the other.
    if (body.name !== undefined || body.description !== undefined) {
      const name = typeof body.name === "string" ? body.name : "";
      const description = typeof body.description === "string" ? body.description : "";
      if (!name.trim()) {
        return NextResponse.json(
          { error: "name_required", message: "A garden needs a name." },
          { status: 400 },
        );
      }
      await updateClusterDetails(cluster.id, name, description);
    }

    if (body.instructions !== undefined) {
      await setClusterInstructions(
        cluster.id,
        typeof body.instructions === "string" ? body.instructions : "",
      );
    }

    if (body.memoryScope !== undefined) {
      if (!isGardenMemoryScope(body.memoryScope)) {
        return NextResponse.json(
          { error: "invalid_memory_scope", message: "Unknown memory setting." },
          { status: 400 },
        );
      }
      await setClusterMemoryScope(cluster.id, body.memoryScope);
    }

    if (body.chatAccessible !== undefined) {
      await setClusterChatAccessible(cluster.id, body.chatAccessible === true);
    }

    return GET(request, { params });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ gardenId: string }> },
) {
  try {
    const { gardenId } = await params;
    const { cluster } = await requireOwnedClusterFromSlug(gardenId);
    await deleteCluster(cluster.id);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
