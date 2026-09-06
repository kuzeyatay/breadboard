import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { requireUserId, routeErrorResponse } from '@/lib/server-auth';
import { readClapAction } from '@/lib/profile/clap-action-store.ts';
import { executeClapMusic } from '@/lib/profile/clap-music.ts';
import { requireEnabled, ApiError, readJsonBody } from '@/lib/hermes/route-core.ts';
import { actionForGesturePrompt, parseClapAction } from '@/lib/profile/clap-action';
import { requestGestureControl } from '@/lib/speech/clap/control-request';
import type { GestureControl } from '@/lib/speech/clap/preferences';
import { requireSameOrigin } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Result = { message: string; href?: string; failed?: boolean };
const running = new Map<string, Promise<Result>>();
const delivered = new Map<string, { at: number; task: Promise<Result> }>();

async function execute(userId: number, control: GestureControl): Promise<Result> {
  // Execution always reads the user's saved command, never an arbitrary body.
  const saved = readClapAction(db, userId, control).action;
  const action = saved.kind === 'assistant' ? actionForGesturePrompt(saved.prompt) : saved;
  if (action.kind === 'music') {
    const spotify = await import('@/lib/spotify/service.ts');
    const { spotifyPlaybackEngineStatus } = await import('@/lib/spotify/playback-engine.ts');
    return { message: await executeClapMusic(action, {
      connected: () => spotify.spotifyConnectionStatus(userId).connected,
      api: input => spotify.spotifyApiRequest({ ...input, userId }),
      search: query => spotify.searchSpotifyTracks(userId, query, 10),
      engine: () => spotifyPlaybackEngineStatus(userId),
      random: Math.random,
    }) };
  }
  if (action.kind !== 'assistant') throw new ApiError(409, 'clap_action_changed', 'Your clap action changed. Clap again to use the new setting.');
  const gesture = control === 'snap' ? 'snap' : 'clap';
  requireEnabled();
  const { createConversation } = await import('@/lib/conversations/store.ts');
  const { startConversationTurn } = await import('@/lib/conversations/turn-service.ts');
  const { resolveConversationRuntime } = await import('@/lib/hermes/session-service.ts');
  const { startSessionEventPump } = await import('@/lib/hermes/event-stream.ts');
  const conversation = createConversation({ userId, title: action.prompt.slice(0, 120), surface: 'dashboard_terminal', scopeKind: 'global', originLabel: control === 'snap' ? 'Finger-snap shortcut' : 'Clap shortcut' });
  const href = `/dashboard?terminalChat=${encodeURIComponent(conversation.public_id)}`;
  try {
    const session = await resolveConversationRuntime({ conversation, surface: 'dashboard_terminal', activeGardenSlug: null, activePageSlug: null });
    startSessionEventPump(session);
    const result = await startConversationTurn({
      conversation, clientMessageId: `${gesture}-${crypto.randomUUID()}`,
      text: action.prompt, surface: 'dashboard_terminal',
      // Let the agent select from the reviewed skills and connected tools,
      // including Breadboard and computer use, under the normal permission policy.
      superAgent: true,
      yoloMode: false,
    });
    if (!result.accepted) {
      return { message: 'blocked' in result ? `Your ${gesture} request needs permission. Review it in the chat.` : 'clarified' in result ? result.message : `Opened your ${gesture} request.`, href };
    }
    return { message: `Started your ${gesture} request in a new chat.`, href };
  } catch {
    // Preserve the chat and any recorded failure for inspection/retry, without
    // silently creating another task after an uncertain dispatch response.
    return { message: 'The request could not be confirmed. Check its chat before trying again.', href, failed: true };
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const control = requestGestureControl(request);
    requireSameOrigin(request, `Use Breadboard to run a ${control === 'snap' ? 'finger-snap' : 'clap'} action.`);
    const body = await readJsonBody(request, 4096);
    const expected = parseClapAction(body.expectedAction);
    const saved = readClapAction(db, userId, control).action;
    if (!expected || JSON.stringify(expected) !== JSON.stringify(saved)) throw new ApiError(409, 'clap_action_changed', 'The saved action changed. Review it before running.');
    if (typeof body.eventId !== 'string' || !/^[A-Za-z0-9:_-]{1,120}$/.test(body.eventId)) throw new ApiError(400, 'invalid_event', 'A valid clap event is required.');
    const ownerKey = `${userId}:${control}`;
    const key = `${ownerKey}:${body.eventId}`;
    const now = Date.now();
    for (const [id, value] of delivered) if (now - value.at > 60_000) delivered.delete(id);
    const prior = delivered.get(key);
    if (prior) return NextResponse.json(await prior.task);
    let task = running.get(ownerKey);
    if (!task) {
      task = execute(userId, control);
      running.set(ownerKey, task);
      void task.finally(() => { if (running.get(ownerKey) === task) running.delete(ownerKey); }).catch(() => {});
    }
    if (delivered.size >= 1000) delivered.delete(delivered.keys().next().value!);
    delivered.set(key, { at: now, task });
    return NextResponse.json(await task);
  } catch (error) { return routeErrorResponse(error); }
}
