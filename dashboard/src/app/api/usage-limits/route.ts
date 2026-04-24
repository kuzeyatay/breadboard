import { NextResponse } from 'next/server';
import { requireUserId, RouteError, routeErrorResponse } from '@/lib/server-auth';
import fs from 'fs';
import path from 'path';
import os from 'os';

export const dynamic = 'force-dynamic';

function trimEnv(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function candidateLimitPaths(): string[] {
  const explicitPath = trimEnv(process.env.CHATMOCK_USAGE_LIMITS_PATH);
  const homeCandidates = [
    trimEnv(process.env.CHATMOCK_USAGE_HOME),
    trimEnv(process.env.CHATGPT_LOCAL_HOME),
    trimEnv(process.env.CODEX_HOME),
    path.join(os.homedir(), '.chatgpt-local'),
    path.join(os.homedir(), '.codex'),
  ].filter((value): value is string => Boolean(value));

  return [
    ...(explicitPath ? [explicitPath] : []),
    ...homeCandidates.map((home) => path.join(home, 'usage_limits.json')),
  ];
}

function getLimitsPath(): string | null {
  const candidates = candidateLimitPaths();
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return candidates[0] ?? null;
}

export async function GET() {
  try {
    await requireUserId();

    const filePath = getLimitsPath();
    if (!filePath) {
      return NextResponse.json({ available: false });
    }

    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return NextResponse.json({ available: false });
    }

    const data = JSON.parse(raw);
    return NextResponse.json({ available: true, ...data });
  } catch (error) {
    if (error instanceof RouteError) return routeErrorResponse(error);
    return NextResponse.json({ available: false });
  }
}
