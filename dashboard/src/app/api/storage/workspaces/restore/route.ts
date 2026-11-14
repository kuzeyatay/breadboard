import { NextResponse } from "next/server";
import db from "@/lib/db";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { assertStorageOwner } from "@/lib/storage/store";
import { prepareStoredWorkspace } from "@/lib/storage/workspace-access";
import { dashboardDataDir } from "@/lib/runtime-paths";
import { externalRuntimePath as path } from "@/lib/external-runtime-path";

export const dynamic="force-dynamic";
export async function POST(request:Request) {
  try {
    assertStorageOwner(db,await requireUserId());
    const body=await request.json().catch(()=>null);
    if(!body || Object.keys(body).some(key=>key!=="workspaceKey") || typeof body.workspaceKey!=="string"
      || !/^conversations\/[a-z0-9_-]{1,80}\/[a-z0-9_-]{1,80}$/u.test(body.workspaceKey))
      return NextResponse.json({error:"Invalid workspace reference."},{status:400});
    const restored=await prepareStoredWorkspace(path.join(dashboardDataDir(),"runtime","hermes-workspaces",body.workspaceKey));
    return NextResponse.json({restored});
  } catch(error) {return routeErrorResponse(error);}
}
