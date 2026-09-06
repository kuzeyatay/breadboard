import { NextResponse } from 'next/server';
import { requireUserId, routeErrorResponse } from '@/lib/server-auth';
import { ApiError, readJsonBody, requireString } from '@/lib/hermes/route-core.ts';
import { createChatmockClient } from '@/lib/chatmock-client.ts';
import { GLOBAL_MODEL_SENTINEL } from '@/lib/ai-models.ts';
import { clapInterpretationMessages, MAX_CLAP_PROMPT, parseClapInterpretation } from '@/lib/profile/clap-action.ts';
import { requestGestureControl } from '@/lib/speech/clap/control-request';
import { requireSameOrigin } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    await requireUserId();
    const control = requestGestureControl(request);
    requireSameOrigin(request, 'Set gesture instructions from Breadboard.');
    const body = await readJsonBody(request, 8_192);
    const prompt = requireString(body.prompt, 'prompt', MAX_CLAP_PROMPT).trim();
    if (!prompt) throw new ApiError(400, 'missing_clap_prompt', 'Describe what your gesture should do.');
    let raw: string;
    try {
      const completion = await createChatmockClient().chat.completions.create({
        model: GLOBAL_MODEL_SENTINEL,
        messages: clapInterpretationMessages(prompt, control),
        response_format: { type: 'json_object' },
      }, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]), maxRetries: 0 });
      raw = completion.choices[0]?.message?.content ?? '';
    } catch {
      throw new ApiError(502, 'clap_interpretation_unavailable', `The AI could not prepare that instruction right now. Try again; your saved ${control} action is unchanged.`);
    }
    const interpreted = parseClapInterpretation(raw);
    if (!interpreted) throw new ApiError(502, 'invalid_clap_interpretation', 'The assistant did not return a usable action. Try describing it another way.');
    return NextResponse.json(interpreted);
  } catch (error) { return routeErrorResponse(error); }
}
