import { NextResponse } from "next/server";

import db from "@/lib/db.ts";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { memoryQuery } from "@/lib/memory-tree/query.ts";
import {
  ensureFreshTree,
  syncVault,
  treeStatus,
} from "@/lib/memory-tree/maintain.ts";
import { buildMemoryTree } from "@/lib/memory-tree/build.ts";
import { exportVault, importVault } from "@/lib/memory-tree/vault.ts";

export const dynamic = "force-dynamic";

// The memory tree and its vault, for the Settings → Memory panel.
//
// GET reports what exists and, on request, what the tree looks like. POST does
// the four things that change it: rebuild the structure, write the vault out,
// read the user's edits back, or all three at once.
//
// Writing files into someone's home directory is not something to do on their
// behalf without being asked, so nothing here exports a vault until the user
// calls for one.

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    if (url.searchParams.get("browse") !== "1") {
      return NextResponse.json({ ok: true, data: treeStatus(userId, db) });
    }

    ensureFreshTree(userId, db);
    const browsed = await memoryQuery({ userId, mode: "browse" }, db);
    return NextResponse.json({
      ok: true,
      data: { ...treeStatus(userId, db), branches: browsed.branches },
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function POST(request: Request) {
  let userId: number;
  try {
    userId = await requireUserId();
  } catch (error) {
    return routeErrorResponse(error);
  }

  let action = "rebuild";
  try {
    const body = (await request.json()) as { action?: unknown };
    if (typeof body?.action === "string") action = body.action;
  } catch {
    // An empty body means the default action.
  }

  try {
    switch (action) {
      case "rebuild":
        return NextResponse.json({
          ok: true,
          data: { built: buildMemoryTree(userId, db), status: treeStatus(userId, db) },
        });
      case "export":
        buildMemoryTree(userId, db);
        return NextResponse.json({
          ok: true,
          data: { exported: exportVault(userId, db), status: treeStatus(userId, db) },
        });
      case "import":
        return NextResponse.json({
          ok: true,
          data: { imported: importVault(userId, db), status: treeStatus(userId, db) },
        });
      case "sync":
        return NextResponse.json({
          ok: true,
          data: { ...syncVault(userId, db), status: treeStatus(userId, db) },
        });
      default:
        return NextResponse.json(
          { ok: false, error: `unknown action "${action}"` },
          { status: 400 },
        );
    }
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
