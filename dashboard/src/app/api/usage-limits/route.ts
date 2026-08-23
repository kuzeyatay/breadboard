import { NextResponse } from 'next/server';
import { resolveChatmockBaseUrl } from '@/lib/chatmock-server';
import { requireUserId, RouteError, routeErrorResponse } from '@/lib/server-auth';
import { readUsageLimits } from '@/lib/usage-limits';
import { buildUsageRefreshRequest } from '@/lib/usage-refresh';
import {
  antigravityModelId,
  readGoogleUsageLimits,
} from '@/lib/cliproxy/google-usage-limits';
import {
  CLAUDE_USAGE_PAGE,
  claudeSubscriptionModelId,
  readClaudeUsageLimits,
} from '@/lib/claude-usage-limits';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

export async function GET(request: Request) {
  const model = new URL(request.url).searchParams.get('model')?.trim() ?? '';
  const googleModel = antigravityModelId(model);
  const claudeModel = claudeSubscriptionModelId(model);
  try {
    await requireUserId();
    if (googleModel) {
      return NextResponse.json(await readGoogleUsageLimits(model), {
        headers: NO_STORE_HEADERS,
      });
    }
    if (claudeModel) {
      return NextResponse.json(await readClaudeUsageLimits(model), {
        headers: NO_STORE_HEADERS,
      });
    }
    return NextResponse.json(readUsageLimits(), { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof RouteError) return routeErrorResponse(error);
    if (googleModel) {
      return NextResponse.json(
        {
          provider: 'google',
          available: false,
          model: googleModel,
          accounts: [],
          error: error instanceof Error ? error.message : 'Could not load Google usage limits.',
        },
        { status: 502, headers: NO_STORE_HEADERS },
      );
    }
    if (claudeModel) {
      return NextResponse.json(
        {
          provider: 'anthropic',
          available: false,
          model: claudeModel,
          limits: [],
          usage_url: CLAUDE_USAGE_PAGE,
          error: error instanceof Error ? error.message : 'Could not load Anthropic usage limits.',
        },
        { status: 502, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json({ available: false }, { headers: NO_STORE_HEADERS });
  }
}

export async function POST(request: Request) {
  try {
    await requireUserId();
    const before = readUsageLimits();
    const { baseURL } = resolveChatmockBaseUrl(request);

    const probeResponse = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY || 'local'}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildUsageRefreshRequest()),
      signal: AbortSignal.timeout(30_000),
    });

    // ChatMock stores the limit headers before returning this response, even
    // when the probe itself is rate-limited.
    await probeResponse.text().catch(() => '');
    const latest = readUsageLimits();
    const refreshed = Boolean(
      latest.captured_at && latest.captured_at !== before.captured_at,
    );

    if (refreshed) {
      return NextResponse.json(
        { ...latest, refreshed: true },
        { headers: NO_STORE_HEADERS },
      );
    }

    const refreshError = probeResponse.ok
      ? 'The refresh completed but did not report updated usage limits.'
      : `Could not refresh usage limits (HTTP ${probeResponse.status}).`;
    return NextResponse.json(
      { ...latest, refreshed: false, refresh_error: refreshError },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof RouteError) return routeErrorResponse(error);
    const refreshError =
      error instanceof Error && error.name === 'TimeoutError'
        ? 'The usage refresh timed out.'
        : 'Could not refresh usage limits.';
    return NextResponse.json(
      { ...readUsageLimits(), refreshed: false, refresh_error: refreshError },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
