import { DEFAULT_MODEL } from './ai-models.ts';

export const USAGE_REFRESH_MESSAGE = 'Reply only with OK.';

/** A minimal hidden completion used only to make ChatMock capture fresh limit headers. */
export function buildUsageRefreshRequest() {
  return {
    model: DEFAULT_MODEL,
    messages: [{ role: 'user', content: USAGE_REFRESH_MESSAGE }],
    council: false,
    reasoning: { effort: 'none' },
    fast_mode: false,
    stream: false,
  } as const;
}
