import { requireUserId, routeErrorResponse } from '@/lib/server-auth';
import { getSpeechSettings } from '@/lib/speech/settings';
import { createVoiceDetector, detectVoiceFrame, closeVoiceDetector, VoiceDetectorError } from '@/lib/speech/livekit-detector';
import { LIVEKIT_MAX_BATCH_SAMPLES } from '@/lib/speech/livekit-turns';

export const runtime = 'nodejs';
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
function errorResponse(error: unknown) {
  return error instanceof VoiceDetectorError ? reply({ error: error.message }, error.status) : routeErrorResponse(error);
}
export async function POST() {
  try {
    const userId = await requireUserId();
    if (!getSpeechSettings(userId).enabled) return reply({ error: 'Speech is turned off in Voice settings.' }, 409);
    return reply({ id: await createVoiceDetector(userId) });
  } catch (error) { return errorResponse(error); }
}
export async function PUT(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const sequence = Number(url.searchParams.get('sequence'));
    if (!url.searchParams.has('sequence') || !Number.isSafeInteger(sequence) || sequence < 0) return reply({ error: 'Invalid audio sequence.' }, 400);
    const reader = request.body?.getReader();
    if (!reader) return reply({ error: 'No audio received.' }, 400);
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > LIVEKIT_MAX_BATCH_SAMPLES * 2) { await reader.cancel(); return reply({ error: 'Audio frame is too large.' }, 413); }
        parts.push(value);
      }
    } finally { reader.releaseLock(); }
    if (size % 2) return reply({ error: 'Invalid PCM audio.' }, 400);
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    return reply(await detectVoiceFrame(userId, url.searchParams.get('id') ?? '', sequence, new Int16Array(bytes.buffer)));
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request) {
  try {
    closeVoiceDetector(await requireUserId(), new URL(request.url).searchParams.get('id') ?? '');
    return reply({ closed: true });
  } catch (error) { return errorResponse(error); }
}
