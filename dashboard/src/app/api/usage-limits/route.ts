import { NextResponse } from 'next/server';
import { requireUserId, RouteError, routeErrorResponse } from '@/lib/server-auth';
import fs from 'fs';
import path from 'path';
import os from 'os';

export const dynamic = 'force-dynamic';

function getLimitsPath(): string {
  const home =
    process.env.CHATGPT_LOCAL_HOME ||
    process.env.CODEX_HOME ||
    path.join(os.homedir(), '.chatgpt-local');
  return path.join(home, 'usage_limits.json');
}

export async function GET() {
  try {
    await requireUserId();

    const filePath = getLimitsPath();
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
