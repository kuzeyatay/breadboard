import db from '@/lib/db';
import { requireUserId, routeErrorResponse, RouteError } from '@/lib/server-auth';
import { readJsonBody } from '@/lib/hermes/route-core.ts';
import { readClapPreferences, writeClapPreferences } from '@/lib/speech/clap/store';
import { parseClapPreferences } from '@/lib/speech/clap/preferences';
import { readClapAction } from '@/lib/profile/clap-action-store';
import { requestGestureControl } from '@/lib/speech/clap/control-request';
import { requireSameOrigin } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const userId = await requireUserId();
    return Response.json({ userId: String(userId), preferences: readClapPreferences(db, userId), action: readClapAction(db, userId),
      snapPreferences: readClapPreferences(db, userId, 'snap'), snapAction: readClapAction(db, userId, 'snap') },
      { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return routeErrorResponse(error); }
}
export async function PUT(request: Request) {
  try {
    const userId = await requireUserId();
    const control = requestGestureControl(request);
    requireSameOrigin(request, `Use Breadboard to change ${control === 'snap' ? 'finger-snap' : 'clap'} controls.`);
    const p = parseClapPreferences(await readJsonBody(request, 4096));
    if (!p) throw new RouteError(400, 'Choose valid clap control settings.');
    return Response.json({ preferences: writeClapPreferences(db, userId, p, control) });
  } catch (error) { return routeErrorResponse(error); }
}
