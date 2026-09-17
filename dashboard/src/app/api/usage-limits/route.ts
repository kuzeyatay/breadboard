import { NextResponse } from 'next/server';
import { resolveChatmockBaseUrl } from '@/lib/chatmock-server';
import { requireUserId, RouteError, routeErrorResponse } from '@/lib/server-auth';
import { readUsageLimits } from '@/lib/usage-limits';
import { refreshChatgptUsage } from '@/lib/chatgpt-usage-refresh';
import { readCodexUsageReport } from '@/lib/chatgpt-codex-usage';
import { runClaudeAccountJob } from '@/lib/runtime-v2/claude-account-job';
import {
  antigravityModelId,
  readGoogleUsageLimits,
} from '@/lib/cliproxy/google-usage-limits';
import { withCliproxyLease } from '@/lib/cliproxy/runtime-lease';
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
      const usage = await withCliproxyLease(
        'subscription-usage-limits',
        () => readGoogleUsageLimits(model),
      );
      return NextResponse.json(usage, {
        headers: NO_STORE_HEADERS,
      });
    }
    if (claudeModel) {
      return NextResponse.json(await readClaudeUsageLimits(model), {
        headers: NO_STORE_HEADERS,
      });
    }
    // OpenAI's own report is per account and knows about the Luna reserve;
    // the header snapshot is the fallback when ChatMock or OpenAI is away.
    const { baseURL } = resolveChatmockBaseUrl(request);
    const report = await readCodexUsageReport(baseURL);
    return NextResponse.json(report ?? { ...readUsageLimits(), source: 'headers' }, {
      headers: NO_STORE_HEADERS,
    });
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
          auth_required: error instanceof Error && /not signed in|sign-in file is invalid/.test(error.message),
          error: error instanceof Error ? error.message : 'Could not load Anthropic usage limits.',
        },
        { status: 502, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json({ available: false }, { headers: NO_STORE_HEADERS });
  }
}

export async function POST(request: Request) {
  const model = new URL(request.url).searchParams.get('model')?.trim() ?? '';
  try {
    const userId = await requireUserId();
    if (claudeSubscriptionModelId(model)) {
      const payload = await readClaudeUsageLimits(model, new Date(), {
        recoverSession: async () => {
          const result = await runClaudeAccountJob({ userId, operation: 'refresh-usage' });
          if (!result.ok) throw new Error(result.message);
        },
      });
      return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
    }
    if (antigravityModelId(model)) return GET(request);
    const { baseURL } = resolveChatmockBaseUrl(request);
    // A refresh is a fresh read of the report; the completion probe that
    // shakes headers out of ChatMock is only needed when the report is away.
    const report = await readCodexUsageReport(baseURL);
    if (report) {
      return NextResponse.json({ ...report, refreshed: true }, { headers: NO_STORE_HEADERS });
    }
    const result = await refreshChatgptUsage(baseURL, userId);
    return NextResponse.json(
      { ...result.payload, source: 'headers' },
      { status: result.status, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof RouteError) return routeErrorResponse(error);
    if (claudeSubscriptionModelId(model) || antigravityModelId(model)) return GET(request);
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
