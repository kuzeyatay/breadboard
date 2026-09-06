import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { requireUserId, routeErrorResponse } from '@/lib/server-auth';
import { readJsonBody, ApiError } from '@/lib/hermes/route-core.ts';
import { parseClapSettings } from '@/lib/profile/clap-action.ts';
import { readClapAction, writeClapAction } from '@/lib/profile/clap-action-store.ts';
import { getWorkflow } from '@/lib/workflows/store';
import { requestGestureControl } from '@/lib/speech/clap/control-request';
import { requireSameOrigin } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';

export async function GET(request?: Request) {
  try { return NextResponse.json({ settings: readClapAction(db, await requireUserId(), requestGestureControl(request)) }); }
  catch (error) { return routeErrorResponse(error); }
}

export async function PUT(request: Request) {
  try {
    const userId = await requireUserId();
    const control = requestGestureControl(request);
    requireSameOrigin(request, 'Set gesture actions from Breadboard.');
    const settings = parseClapSettings(await readJsonBody(request, 8_192));
    if (!settings) throw new ApiError(400, 'invalid_clap_action', 'Choose a valid clap action before saving.');
    if (settings.action.kind === 'workflow') {
      const workflow = getWorkflow(userId, settings.action.workflowId);
      if (!workflow) throw new ApiError(404, 'workflow_not_found', 'Choose one of your saved workflows.');
      settings.action.name = workflow.name;
    }
    return NextResponse.json({ settings: writeClapAction(db, userId, settings, control) });
  } catch (error) { return routeErrorResponse(error); }
}
