import { NextResponse } from 'next/server';
import { DEFAULT_ASSISTANT_MODELS, mergeAssistantModels } from '@/lib/ai-models';
import { resolveChatmockBaseUrl } from '@/lib/chatmock-server';
import { requireUserId, RouteError, routeErrorResponse } from '@/lib/server-auth';
import { getAgentRuntime } from '@/lib/agent-runtime/runtime';
import { readHermesMode } from '@/lib/hermes/config';
import { HERMES_CHATMOCK_PROVIDER_ID } from '@/lib/hermes/model-selection';

export const dynamic = 'force-dynamic';

/**
 * Models the Intelligence menu offers, each with the reasoning ("intelligence
 * mode") levels it actually honours.
 *
 * ChatMock is the authority: it knows both the ChatGPT model registry and every
 * configured provider. The agent runtime only constrains which ids it can name
 * directly — provider models reach it through the `default` sentinel — so a
 * runtime that has not declared a model must not remove it from the menu.
 */
async function chatmockModels(request: Request): Promise<ChatmockModel[]> {
  const { baseURL } = resolveChatmockBaseUrl(request);
  const base = baseURL.replace(/\/v1\/?$/, '');
  const res = await fetch(`${base}/v1/models`, { cache: 'no-store' });
  const data = await res.json();
  const rows = Array.isArray(data?.data) ? data.data : [];

  return rows.flatMap((row: unknown): ChatmockModel[] => {
    if (!row || typeof row !== 'object') return [];
    const { id, owned_by: ownedBy, reasoning_efforts: efforts } = row as Record<string, unknown>;
    if (typeof id !== 'string' || !id.trim()) return [];
    return [{
      id,
      object: 'model',
      owned_by: typeof ownedBy === 'string' ? ownedBy : 'chatmock',
      reasoning_efforts: Array.isArray(efforts)
        ? efforts.filter((effort): effort is string => typeof effort === 'string')
        : [],
    }];
  });
}

interface ChatmockModel {
  id: string;
  object: 'model';
  owned_by: string;
  reasoning_efforts: string[];
}

export async function GET(request: Request) {
  try {
    await requireUserId();

    const models = await chatmockModels(request);

    if (readHermesMode() !== 'legacy') {
      // The runtime's own list decides which ChatGPT ids it can address; it has
      // no say over provider models, which are addressed indirectly.
      //
      // Its failure is isolated: an unreachable runtime must not delete every
      // subscription and provider model from the picker, which is what happens
      // when this throws into the outer fallback.
      let runtimeIds: Set<string> | null = null;
      try {
        const runtimeModels = await getAgentRuntime().listModels();
        runtimeIds = new Set(
          runtimeModels
            .filter((model) => model.providerId === HERMES_CHATMOCK_PROVIDER_ID)
            .map((model) => model.id),
        );
      } catch {
        runtimeIds = null;
      }

      return NextResponse.json({
        object: 'list',
        data: models.filter(
          (model) =>
            model.owned_by !== 'chatgpt' ||
            // Runtime list unavailable: keep the built-in ids rather than
            // showing an empty menu.
            (runtimeIds === null
              ? DEFAULT_ASSISTANT_MODELS.includes(model.id)
              : runtimeIds.has(model.id)),
        ),
      });
    }

    const nativeIds = new Set(DEFAULT_ASSISTANT_MODELS);
    return NextResponse.json({
      object: 'list',
      data: [
        ...DEFAULT_ASSISTANT_MODELS.map((id) => ({
          id,
          object: 'model' as const,
          owned_by: 'chatmock',
          reasoning_efforts:
            models.find((model) => model.id === id)?.reasoning_efforts ?? [],
        })),
        ...models.filter((model) => !nativeIds.has(model.id)),
      ],
    });
  } catch (error) {
    if (error instanceof RouteError) return routeErrorResponse(error);

    // ChatMock unreachable: fall back to the built-in ids with no advertised
    // modes, so the picker still works and the mode list simply stays empty
    // rather than offering levels nothing can honour.
    return NextResponse.json({
      object: 'list',
      data: mergeAssistantModels([]).map((id) => ({
        id,
        object: 'model',
        owned_by: 'chatmock',
        reasoning_efforts: [],
      })),
    });
  }
}
